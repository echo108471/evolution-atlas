/**
 * Blind capability induction from per-commit readings.
 *
 * This is intentionally not clustering. A flat partition assumes that every commit
 * belongs to exactly one same-sized concept, while software capabilities can contain
 * narrower capabilities and a cross-cutting commit can support several of them. The
 * model therefore proposes a hierarchy and cites evidence directly. No maintainer
 * taxonomy or target count is part of the request.
 */

import { extractJson } from './phase-model.mjs'

export const DEFAULT_MODEL = 'x-ai/grok-4.6'
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const API_KEY_ENV = 'OPENROUTER_API_KEY'

const REQUEST_TIMEOUT_MS = 600000
const MAX_NAME = 120
const MAX_SUMMARY = 500
// Two levels are the current experiment, not a claim about the deepest hierarchy a
// repository can have. The recursive representation deliberately leaves a later
// super-umbrella experiment possible without changing the output shape.
export const MAX_INDUCTION_DEPTH = 2
const AUDIENCES = new Set(['user', 'developer', 'operator', 'mixed'])

export const INDUCTION_SYSTEM_PROMPT = `You are reconstructing what one software system
does from independent readings of its commits.

Infer a capability map from the evidence. A capability is a durable outcome or behavior
that a user, developer, or operator would recognize. It is not merely a directory,
framework, layer, file type, development phase, or one implementation step.

The map may be hierarchical. Use an umbrella capability when several narrower behaviors
serve the same enduring outcome, and put meaningful distinctions beneath it as children.
Do not split one capability merely because its implementation moved, used several layers,
or accumulated fixes over time. Do not merge unrelated outcomes merely to make the map
small. There is no target number of capabilities.

For this experiment, use at most two levels: an umbrella capability and its optional
children. Do not add grandchildren. This is a present output boundary, not a claim that a
larger repository could not support broader umbrellas or deeper nesting in the future.

A capability may cover any share of the repository, including a majority, when the
evidence supports it. Size alone is neither a reason to split nor a reason to merge.

Commits do not have to form a partition. A cross-cutting commit may support more than one
capability. Attach a commit to the most specific nodes it directly supports; do not repeat
it on an ancestor solely because it appears on a child. Leave routine maintenance,
ambiguous work, and evidence that is not a capability unassigned.

Use only the supplied evidence. Do not use examples from a repository you recognize and
do not assume a maintainer-provided taxonomy. Prefer a smaller durable umbrella with
useful children over dozens of lifecycle-, page-, or implementation-sized fragments.

Every input number must appear in at least one capability's evidence or in unassigned.

Reply with JSON only, no prose or fences:

{"capabilities": [{"name": string, "summary": string,
"audience": "user" | "developer" | "operator" | "mixed",
"evidence": [number, ...], "children": [same shape, ...]}],
"unassigned": [number, ...]}`

const cleanText = (value, limit) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, limit) : null
}

const cleanIndexList = (values, count) => {
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const index = Number.parseInt(value, 10)
    if (Number.isInteger(index) && index >= 0 && index < count) seen.add(index)
  }
  return [...seen]
}

export function renderReadings(readings) {
  return readings.map((reading, index) => {
    const interpreted = reading.tier2 ?? reading.tier1 ?? {}
    const parts = [
      `${index}. ${reading.authoredAt?.slice(0, 10) ?? 'unknown-date'} ${reading.subject ?? '(no subject)'}`,
    ]
    if (interpreted.summary) parts.push(`   Reading: ${interpreted.summary}`)
    if (interpreted.capability) parts.push(`   Per-commit label: ${interpreted.capability}`)
    return parts.join('\n')
  }).join('\n')
}

export function buildInductionRequest(readings, { model = DEFAULT_MODEL } = {}) {
  return {
    model,
    max_tokens: 30000,
    usage: { include: true },
    messages: [
      { role: 'system', content: INDUCTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `The observations are oldest first. Each number identifies one commit
reading and is the only identifier you may cite.

${renderReadings(readings)}

Infer the capability hierarchy supported by these ${readings.length} observations.`,
      },
    ],
  }
}

function parseNode(raw, readings, path, depth, assignedCounts, diagnostics) {
  if (!raw || typeof raw !== 'object') {
    diagnostics.invalidNodes += 1
    return null
  }
  if (depth > MAX_INDUCTION_DEPTH) {
    throw new Error(`capability hierarchy exceeds the current ${MAX_INDUCTION_DEPTH}-level experiment`)
  }

  const name = cleanText(raw.name, MAX_NAME)
  if (!name) {
    diagnostics.invalidNodes += 1
    return null
  }

  const evidenceIndices = cleanIndexList(raw.evidence, readings.length)
  for (const index of evidenceIndices) assignedCounts[index] += 1

  const children = []
  for (const [index, child] of (Array.isArray(raw.children) ? raw.children : []).entries()) {
    const parsed = parseNode(child, readings, [...path, index], depth + 1, assignedCounts, diagnostics)
    if (parsed) children.push(parsed)
  }

  const directEvidence = evidenceIndices.map((index) => readings[index].commitSha)
  const rollupEvidence = [...new Set([
    ...directEvidence,
    ...children.flatMap((child) => child.rollupEvidence),
  ])]
  if (rollupEvidence.length === 0) {
    diagnostics.emptyNodes += 1
    return null
  }
  const audience = typeof raw.audience === 'string' && AUDIENCES.has(raw.audience.toLowerCase())
    ? raw.audience.toLowerCase()
    : 'mixed'

  return {
    id: `capability:${path.join('.')}`,
    name,
    summary: cleanText(raw.summary, MAX_SUMMARY),
    audience,
    interpretationStatus: 'candidate',
    directEvidence,
    rollupEvidence,
    directCommitCount: directEvidence.length,
    commitCount: rollupEvidence.length,
    children,
  }
}

export function parseInductionPayload(payload, readings) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('capability induction output was truncated')

  const raw = extractJson(choice.message?.content ?? '')
  const assignedCounts = new Array(readings.length).fill(0)
  const diagnostics = { invalidNodes: 0, emptyNodes: 0 }
  const capabilities = []
  for (const [index, node] of (Array.isArray(raw.capabilities) ? raw.capabilities : []).entries()) {
    const parsed = parseNode(node, readings, [index], 1, assignedCounts, diagnostics)
    if (parsed) capabilities.push(parsed)
  }

  const modelUnassigned = new Set(cleanIndexList(raw.unassigned, readings.length))
  const dropped = []
  for (let index = 0; index < readings.length; index += 1) {
    if (assignedCounts[index] === 0 && !modelUnassigned.has(index)) {
      modelUnassigned.add(index)
      dropped.push(index)
    }
  }
  for (let index = 0; index < readings.length; index += 1) {
    if (assignedCounts[index] > 0) modelUnassigned.delete(index)
  }

  const assigned = assignedCounts.filter((count) => count > 0).length
  const overlapping = assignedCounts.filter((count) => count > 1).length
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)])
  const nodes = flatten(capabilities)

  return {
    capabilities,
    unassigned: [...modelUnassigned].map((index) => readings[index].commitSha),
    shape: {
      topLevelCapabilities: capabilities.length,
      totalCapabilities: nodes.length,
      maxDepth: nodes.reduce((maximum, node) => Math.max(maximum, node.id.split('.').length), 0),
      assignedCommits: assigned,
      unassignedCommits: readings.length - assigned,
      coverage: readings.length === 0 ? 0 : assigned / readings.length,
      overlappingCommits: overlapping,
      overlapShare: assigned === 0 ? 0 : overlapping / assigned,
      assignments: assignedCounts.reduce((sum, count) => sum + count, 0),
    },
    diagnostics: {
      ...diagnostics,
      droppedByModel: dropped.length,
      droppedCommitShas: dropped.map((index) => readings[index].commitSha),
    },
    usage: payload.usage ?? null,
  }
}

export async function requestInductionPayload(
  readings,
  { model = DEFAULT_MODEL, apiKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildInductionRequest(readings, { model })),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`capability induction exceeded ${Math.round(timeoutMs / 1000)}s`)
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
  return response.json()
}
