/**
 * The model arm: group the capability names the readings proposed into capabilities.
 *
 * Per-commit reading produces one name per commit and no way to relate them. On the pilot
 * that is 579 distinct names across 606 units, with only 23 used more than once - so a
 * capability is almost never named the same way twice, and grouping by string equality
 * recovers essentially nothing. Blind tier-2 reading predicted this: two models reading
 * the same commit share only 0.31 of their wording.
 *
 * The model is shown names alone - never paths, dates, authors, or the deterministic
 * clustering it is being compared against. Names alone is the harder condition and the
 * fair one: shown the baseline's groups it would ratify them, and shown paths it would be
 * solving the baseline's problem rather than its own.
 */

import { extractJson } from './phase-model.mjs'

export const DEFAULT_MODEL = 'x-ai/grok-4.6'
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const API_KEY_ENV = 'OPENROUTER_API_KEY'

const DEFAULT_CHUNK = 250
const REQUEST_TIMEOUT_MS = 300000

export const CONSOLIDATE_SYSTEM_PROMPT = `You are given a list of capability names, each
written independently by someone who read a single commit from one software repository.
Because each was written in isolation, the same capability is usually named differently
every time it appears.

Group the names that refer to the same capability, and give each group one name.

A capability is something a user or another developer would recognize as a thing the
software does. It is not a layer, a directory, or a technology: names like "frontend",
"database work", or the name of a language or framework describe where code lives, not
what the software does.

Do not use examples from any repository you may recognize. Work only from the names
given.

Group by what the software does, not by how the names are worded. Two names with no words
in common may be the same capability, and two names sharing most of their words may not
be.

Leave a name in a group of its own when it genuinely stands alone. Do not force
everything into a small number of large groups, and do not invent a group for a
capability that no name mentions.

Every input number must appear in exactly one group.

Reply with JSON only, no prose or fences:

{"groups": [{"name": string, "members": [number, ...]}]}`

export const MERGE_SYSTEM_PROMPT = `You are given capability names for one software
repository. They were produced by grouping separate batches of names, so the same
capability may appear more than once under different wording.

Merge the names that refer to the same capability, and give each merged group one name.
Leave a name alone when nothing else matches it.

Every input number must appear in exactly one group.

Reply with JSON only, no prose or fences:

{"groups": [{"name": string, "members": [number, ...]}]}`

export function renderNames(names) {
  return names.map((name, index) => `${index}. ${name}`).join('\n')
}

export function buildConsolidationRequest(names, { model, system = CONSOLIDATE_SYSTEM_PROMPT }) {
  return {
    model,
    max_tokens: 16000,
    usage: { include: true },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `${renderNames(names)}\n\nGroup these ${names.length} names.` },
    ],
  }
}

/**
 * Read the groups back, and account for every input.
 *
 * A model asked to place 250 numbered items into groups will occasionally drop one or
 * repeat one. Dropped names become their own group rather than disappearing: losing a
 * capability silently is worse than reporting one that should have been merged, and the
 * count of them is reported so the failure is visible.
 */
export function parseConsolidation(payload, names) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  const parsed = extractJson(choice.message?.content ?? '')

  const seen = new Set()
  const groups = []
  for (const group of parsed.groups ?? []) {
    const members = (group.members ?? [])
      .map((value) => Number.parseInt(value, 10))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < names.length && !seen.has(index))
    for (const index of members) seen.add(index)
    const name = typeof group.name === 'string' ? group.name.trim() : ''
    if (members.length > 0 && name) groups.push({ name: name.slice(0, 120), members })
  }

  const dropped = []
  for (let index = 0; index < names.length; index += 1) {
    if (!seen.has(index)) {
      dropped.push(index)
      groups.push({ name: names[index], members: [index] })
    }
  }

  return { groups, dropped: dropped.length, usage: payload.usage ?? null }
}

export async function requestConsolidation(names, { model = DEFAULT_MODEL, apiKey, system, fetchImpl = fetch } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildConsolidationRequest(names, { model, system })),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`consolidation exceeded ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`)
      timeout.status = 408
      throw timeout
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
    error.status = response.status
    throw error
  }
  return parseConsolidation(await response.json(), names)
}

const chunk = (items, size) => {
  const chunks = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

/**
 * Group every distinct name, in one pass when they fit and in two when they do not: each
 * batch is grouped, then the batch names are grouped against each other so a capability
 * split across batches is rejoined.
 */
export async function consolidateCapabilities(
  names,
  { model = DEFAULT_MODEL, apiKey, chunkSize = DEFAULT_CHUNK, request = requestConsolidation, onProgress } = {},
) {
  const batches = chunk(names.map((name, index) => ({ name, index })), chunkSize)
  const usage = { promptTokens: 0, completionTokens: 0, cost: 0 }
  const addUsage = (value) => {
    if (!value) return
    usage.promptTokens += value.prompt_tokens ?? 0
    usage.completionTokens += value.completion_tokens ?? 0
    if (typeof value.cost === 'number') usage.cost += value.cost
  }

  // Round one: group within each batch.
  const firstRound = []
  let dropped = 0
  for (const [order, batch] of batches.entries()) {
    const result = await request(batch.map((entry) => entry.name), { model, apiKey })
    addUsage(result.usage)
    dropped += result.dropped
    for (const group of result.groups) {
      firstRound.push({ name: group.name, members: group.members.map((local) => batch[local].index) })
    }
    onProgress?.({ round: 1, order, total: batches.length, groups: result.groups.length })
  }

  if (batches.length === 1) {
    return { groups: firstRound, rounds: 1, dropped, usage }
  }

  // Round two: rejoin capabilities that were split across batches.
  const merged = await request(firstRound.map((group) => group.name), {
    model,
    apiKey,
    system: MERGE_SYSTEM_PROMPT,
  })
  addUsage(merged.usage)
  dropped += merged.dropped
  onProgress?.({ round: 2, order: 0, total: 1, groups: merged.groups.length })

  const groups = merged.groups.map((group) => ({
    name: group.name,
    members: group.members.flatMap((index) => firstRound[index].members),
  }))
  return { groups, rounds: 2, dropped, usage }
}
