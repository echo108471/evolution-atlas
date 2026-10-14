/**
 * The model-facing half of epoch detection: render raw commit windows and ask where the
 * work changed character.
 *
 * The windows carry commits and nothing else. No divergence scores, no detector peaks,
 * no hints about where a boundary might be. A model shown a candidate position can only
 * agree with it, rank it, or reject it, which measures ratification rather than reading;
 * the deterministic signals are compared against this output afterwards, never fed into
 * it.
 */

import { DEFAULT_OPENROUTER_MODEL, requireSynchronousModel } from './model-defaults.mjs'
import { batchResultBody } from './openrouter-batch.mjs'

export const DEFAULT_MODEL = DEFAULT_OPENROUTER_MODEL
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const API_KEY_ENV = 'OPENROUTER_API_KEY'

const DEFAULT_WINDOW = 200
const DEFAULT_STRIDE = 100
const MIN_WINDOW = 40
const MAX_PATHS_PER_COMMIT = 6
const MAX_SUBJECT_LENGTH = 140
const REQUEST_TIMEOUT_MS = 240000

export const PHASE_SYSTEM_PROMPT = `You read a slice of a software repository's commit
history and mark the points where the project's phase changed.

A phase change is a point where the work on either side is about something different.
It may show up as a new subsystem appearing, an old one being abandoned, a rewrite, a
shift from building features to stabilizing them, a change in who is working and on
what, or a change in what the team is evidently trying to accomplish.

It is NOT a phase change when a single commit is merely large, unusual, or well
described. Judge the work on both sides of the point, not the commit at the point.

You may mark zero boundaries. Many slices of history are one continuous phase, and
reporting a boundary that is not there is worse than reporting none.

For each boundary, name the commit it falls on and say what the work was about before
and after it. Cite the short SHA exactly as it appears in the input.

Reply with JSON only, no prose or fences:

{"boundaries": [{"shortSha": string, "before": string, "after": string,
"reason": string, "confidence": number between 0 and 1}]}`

export function renderWindow(slice) {
  return slice
    .map((episode) => {
      const head = `${episode.shortSha} ${episode.authoredAt.slice(0, 10)} ${episode.subject.slice(0, MAX_SUBJECT_LENGTH)}`
      const paths = episode.changes.map((change) => change.path)
      if (paths.length === 0) return head
      const shown = paths.slice(0, MAX_PATHS_PER_COMMIT).join(' ')
      const omitted = paths.length - Math.min(paths.length, MAX_PATHS_PER_COMMIT)
      return `${head}\n    ${shown}${omitted > 0 ? ` (+${omitted} more)` : ''}`
    })
    .join('\n')
}

/**
 * Overlapping windows, so most commits are read twice by requests that saw different
 * surrounding history. Agreement across two windows is the closest thing to a free
 * reliability signal this pass has.
 */
export function planWindows(episodes, { window = DEFAULT_WINDOW, stride = DEFAULT_STRIDE } = {}) {
  const windows = []
  for (let start = 0; start < episodes.length; start += stride) {
    const end = Math.min(start + window, episodes.length)
    if (end - start < MIN_WINDOW) break
    windows.push({ start, end, slice: episodes.slice(start, end) })
    if (end === episodes.length) break
  }
  return windows
}

/**
 * Models occasionally wrap JSON in prose or a fence. Recover the object rather than
 * failing a window over formatting.
 */
export function extractJson(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('no JSON object found in model output')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

export function buildWindowRequest(dataset, windowPlan, model) {
  return {
    model,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: PHASE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Repository: ${dataset.repository.name}
Commits ${windowPlan.start + 1}-${windowPlan.end} of ${dataset.episodes.length}, oldest
first. Each commit is "<shortSha> <date> <subject>" followed by an indented line of the
paths it changed.

${renderWindow(windowPlan.slice)}

Mark the phase changes in this slice, if there are any.`,
      },
    ],
  }
}

export function parseWindowResponse(payload) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('output truncated; lower --window')
  const parsed = extractJson(choice.message?.content ?? '')
  return { boundaries: parsed.boundaries ?? [], usage: payload.usage ?? null }
}

/**
 * Send one window to OpenRouter. Exported separately from the loop below so callers can
 * substitute a stub and exercise the surrounding logic without a key or a network call.
 */
export async function requestWindow(dataset, windowPlan, { model = DEFAULT_MODEL, apiKey, fetchImpl = fetch } = {}) {
  requireSynchronousModel(model)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildWindowRequest(dataset, windowPlan, model)),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
  }
  return parseWindowResponse(await response.json())
}

/**
 * Walk the windows one at a time. Historical runs took 40-180 seconds per request,
 * and issuing them in parallel produced no measured speedup. Those measurements do
 * not establish latency for the current default model.
 */
export async function proposePhaseBoundaries(
  dataset,
  { model = DEFAULT_MODEL, apiKey, window, stride, request = requestWindow, batchRunner, onProgress } = {},
) {
  // Configuration errors must abort, not become recoverable per-window failures.
  if (!batchRunner) requireSynchronousModel(model)
  const windows = planWindows(dataset.episodes, { window, stride })
  // All windows are independent. Await the complete batch before per-window error
  // recovery so failed batches and timeouts cannot masquerade as partial success.
  const batchResults = batchRunner && windows.length > 0
    ? await batchRunner({
      stage: 'proposals',
      endpoint: '/v1/chat/completions',
      requests: windows.map((windowPlan) => ({
        custom_id: `window-${windowPlan.start}`,
        body: buildWindowRequest(dataset, windowPlan, model),
      })),
    })
    : null
  const shaIndex = new Map()
  dataset.episodes.forEach((episode, index) => {
    shaIndex.set(episode.shortSha, index)
    shaIndex.set(episode.commitSha, index)
  })

  const proposals = []
  const unresolved = []
  const failures = []
  const usage = {}

  for (const [order, windowPlan] of windows.entries()) {
    const startedAt = Date.now()
    try {
      const result = batchResults
        ? parseWindowResponse(batchResultBody(batchResults.get(`window-${windowPlan.start}`)))
        : await request(dataset, windowPlan, { model, apiKey })
      for (const boundary of result.boundaries) {
        const index = shaIndex.get(String(boundary.shortSha ?? '').trim())
        if (index === undefined) {
          unresolved.push({ shortSha: boundary.shortSha, windowStart: windowPlan.start })
          continue
        }
        proposals.push({ ...boundary, index, windowStart: windowPlan.start })
      }
      for (const [key, value] of Object.entries(result.usage ?? {})) {
        if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value
      }
      onProgress?.({
        order,
        total: windows.length,
        windowPlan,
        found: result.boundaries.length,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      })
    } catch (error) {
      failures.push({ windowStart: windowPlan.start, message: error.message })
      onProgress?.({ order, total: windows.length, windowPlan, error: error.message })
    }
  }

  return { proposals, unresolved, failures, usage, windowCount: windows.length }
}
