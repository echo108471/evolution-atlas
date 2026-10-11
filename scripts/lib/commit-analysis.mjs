/**
 * Tiers 1 and 2: read one commit and say what it accomplishes.
 *
 * The unit of analysis is a single commit rather than a window of subjects, which is the
 * whole point. Whole-corpus interpretation cited 10-12% of commits and could not be made
 * to cite more, because a request that must cover 3,000 commits can afford a dozen
 * citations per capability. A request that covers one commit can afford its diff.
 *
 * Two tiers exist because cost is dominated by a minority of commits. Tier 1 reads every
 * substantive commit with a small model and a bounded diff. It also decides, per commit,
 * whether the change is consequential enough to deserve a second look - that judgment is
 * the model's rather than a diff-size threshold's, because size and significance are
 * only loosely related: a 4-line change that deletes a subsystem's entry point matters
 * more than a 900-line reformat.
 *
 * Neither tier is told what capability to find, what the repository is for, or what any
 * other pass concluded. Bottom-up naming is the experiment: if capabilities are real,
 * independent readings of separate commits should converge on them, and if they are not,
 * the disagreement is the finding.
 */

import { extractJson } from './phase-model.mjs'

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const API_KEY_ENV = 'OPENROUTER_API_KEY'

/** Volume tier: $0.075/$0.250 per 1M, 1.31M context. */
export const DEFAULT_TIER1_MODEL = 'z-ai/glm-5.3-flash'
/** Depth tier: $0.300/$1.000 per 1M, code-specialized. */
export const DEFAULT_TIER2_MODEL = 'qwen/qwen3-coder'

const REQUEST_TIMEOUT_MS = 300000

export const TIER1_SYSTEM_PROMPT = `You are reading one commit from a software
repository's history and reporting what it accomplishes.

You are given where the commit sits in the history, which parts of the tree it touches,
what was recently happening in those same parts, and the diff itself. The diff may be
partial for very large commits; you will be told when it is.

Report what the change achieves, not what it edits. "Adds a retry loop around the upload
call so transient S3 failures no longer drop the job" is useful. "Modifies uploader.py"
is not.

Name the capability this change belongs to in your own words - the thing a user or
another developer would recognize, not the file name. Use the same words you would use
if you saw a related commit later, since these names are compared across commits.

Judge whether the change deserves a closer reading, and say which of three reasons
applies:

  "partial"       - you were shown only part of the diff and the rest would change your
                    answer. Use this only when more of the same commit would help.
  "consequential" - you saw enough, and the change is important enough to the shape of
                    the codebase to be worth a careful second opinion: it starts or ends
                    a subsystem, migrates something, or rewrites how a thing works.
  "unclear"       - you saw the whole change and still cannot tell what it accomplishes.

Say no for routine work you understood completely. Most commits are routine.

If the change is trivial or you cannot tell what it does, say so plainly and give a low
confidence. A wrong guess is worse than an admission.

Reply with JSON only, no prose or fences:

{"summary": string, "capability": string, "kind": "introduce" | "extend" | "fix" |
"refactor" | "remove" | "migrate" | "test" | "config" | "unclear", "significance": number
between 0 and 1, "needsDepth": boolean, "depthCause": "partial" | "consequential" |
"unclear" | "none", "depthReason": string, "confidence": number between 0 and 1}`

export const TIER2_SYSTEM_PROMPT = `You are reading one commit from a software
repository's history and reporting what it accomplishes in depth.

You are given where the commit sits, which parts of the tree it touches, what was
recently happening there, and a large extract of the diff.

Report what the change achieves and why it was likely made. Where the commit starts,
ends, or moves a subsystem, say which one and what happened to it. Where the diff is
still partial, say what you could not see rather than inferring past it.

Name the capability this change belongs to in your own words - the thing a user or
another developer would recognize.

Reply with JSON only, no prose or fences:

{"summary": string, "capability": string, "kind": "introduce" | "extend" | "fix" |
"refactor" | "remove" | "migrate" | "test" | "config" | "unclear", "significance": number
between 0 and 1, "confidence": number between 0 and 1}`

const DEPTH_CAUSES = new Set(['partial', 'consequential', 'unclear', 'none'])

const KINDS = new Set(['introduce', 'extend', 'fix', 'refactor', 'remove', 'migrate', 'test', 'config', 'unclear'])

const clamp01 = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(1, Math.max(0, number))
}

const text = (value, limit) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, limit)
}

/** The user-message body shared by both tiers. */
export function renderCommitPrompt({ repositoryName, contextText, subject, diff }) {
  const withheldCount = Number.isInteger(diff.withheldCount) ? diff.withheldCount : 0
  const parts = [
    `Repository: ${repositoryName}`,
    '',
    contextText,
    '',
    `Commit message: ${subject}`,
    '',
  ]

  if (diff.totalLines === 0 && withheldCount > 0) {
    parts.push(`No readable file changes are available. Content for ${withheldCount} restricted environment file(s) was withheld; the commit's effects are unknown from the supplied diff.`)
  } else if (diff.totalLines === 0) {
    parts.push('This commit records no file changes.')
  } else if (diff.truncated) {
    parts.push(`Diff (partial - ${diff.included.length} of ${diff.files.length} files shown in full):`, '', diff.text)
    if (withheldCount > 0) parts.push(`Content for ${withheldCount} restricted environment file(s) was withheld; treat this diff as partial.`)
  } else if (withheldCount > 0) {
    parts.push(`Diff (partial - ${diff.files.length} readable file(s) shown; ${withheldCount} restricted environment file(s) withheld):`, '', diff.text)
  } else {
    parts.push(`Diff (complete, ${diff.totalLines} changed lines):`, '', diff.text)
  }

  return parts.join('\n')
}

/**
 * Tier 1 asks for the lowest reasoning effort the endpoint allows.
 *
 * The default volume model reasons before answering, and reasoning is billed and
 * budgeted as output: a first run spent 866 of a 900-token budget thinking and was cut
 * off mid-JSON on 17 of 19 commits. Disabling it outright is rejected - "Reasoning is
 * mandatory for this endpoint" - but `effort: low` measured zero reasoning tokens and a
 * clean stop, turning a 1,540-token answer into a 175-token one at the same price.
 *
 * Summarizing a diff already present in the prompt is not a task that needs
 * deliberation, and tier 2 exists to re-read whatever tier 1 found hard. `reasoning`
 * stays a parameter so the two can be compared rather than assumed.
 */
export function buildTier1Request({ repositoryName, contextText, subject, diff, model, reasoning = { effort: 'low' } }) {
  return {
    model,
    max_tokens: 2000,
    usage: { include: true },
    ...(reasoning ? { reasoning } : {}),
    messages: [
      { role: 'system', content: TIER1_SYSTEM_PROMPT },
      { role: 'user', content: `${renderCommitPrompt({ repositoryName, contextText, subject, diff })}

What does this commit accomplish?` },
    ],
  }
}

/**
 * Tier 2 never sees tier 1's answer.
 *
 * It did at first, framed as "a claim to check". It checked almost nothing: across 14
 * promoted commits it revised 3, and those revisions were rhetorical rather than factual
 * - the first pass had "understated the sophistication" - while its capability names
 * restated tier 1's with extra adjectives. A model shown a prior answer ratifies it,
 * which is the same reason the epoch pass is never shown its detector's peaks.
 *
 * Read blind, the two tiers are independent readings of the same commit, so their
 * agreement is a measurement of tier 1 rather than an echo of it.
 */
export function buildTier2Request({ repositoryName, contextText, subject, diff, model, reasoning = null }) {
  return {
    model,
    max_tokens: 2500,
    usage: { include: true },
    ...(reasoning ? { reasoning } : {}),
    messages: [
      { role: 'system', content: TIER2_SYSTEM_PROMPT },
      { role: 'user', content: `${renderCommitPrompt({ repositoryName, contextText, subject, diff })}

What does this commit accomplish?` },
    ],
  }
}

/**
 * Normalize a tier response. Fields are coerced rather than trusted: a small model
 * returning "0.8 (high)" for a number, or a kind outside the enumeration, should degrade
 * one field instead of failing the commit.
 */
export function parseCommitResponse(payload, { tier }) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')

  // A truncated response is still worth parsing. Reasoning models spend the budget before
  // emitting anything, so `length` usually means the JSON never started - but when it did
  // finish, discarding it would throw away a request that was already paid for.
  let parsed
  try {
    parsed = extractJson(choice.message?.content ?? '')
  } catch (error) {
    if (choice.finish_reason === 'length') {
      throw new Error(`output truncated after ${payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0} reasoning tokens; raise max_tokens or disable reasoning`)
    }
    throw error
  }
  const kind = typeof parsed.kind === 'string' ? parsed.kind.trim().toLowerCase() : ''

  const reading = {
    tier,
    summary: text(parsed.summary, 600),
    capability: text(parsed.capability, 120),
    kind: KINDS.has(kind) ? kind : 'unclear',
    significance: clamp01(parsed.significance) ?? 0,
    confidence: clamp01(parsed.confidence) ?? 0,
    interpretationStatus: 'candidate',
  }

  if (tier === 1) {
    const cause = typeof parsed.depthCause === 'string' ? parsed.depthCause.trim().toLowerCase() : ''
    reading.needsDepth = parsed.needsDepth === true
    reading.depthCause = DEPTH_CAUSES.has(cause) ? cause : reading.needsDepth ? 'unclear' : 'none'
    reading.depthReason = text(parsed.depthReason, 300)
  }

  return { reading, usage: payload.usage ?? null }
}

/**
 * One request. Separated from the loop so tests can substitute a stub.
 *
 * A timeout is re-thrown as 408 so the shared retry policy treats it as the transient
 * infrastructure failure it is. Left as a bare `AbortError` it carries no status, so
 * `isRetryable` returned false and the largest commits in a history - the ones slowest
 * to answer, and the ones most worth reading - were the only ones permanently dropped.
 */
export async function requestReading(body, { apiKey, tier, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`request exceeded ${Math.round(timeoutMs / 1000)}s`)
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
  return parseCommitResponse(await response.json(), { tier })
}

/**
 * Run `task` over `items` with a bounded number in flight.
 *
 * Per-commit analysis is only viable because it parallelizes: the situating context is
 * derived from observed history rather than from the previous commit's output, so no
 * request depends on another. Results are returned in input order regardless of
 * completion order.
 */
export async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await task(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

/** Words carried by almost every capability name, which would inflate any overlap score. */
const CAPABILITY_STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'with', 'from', 'on', 'by',
  'system', 'support', 'handling', 'management', 'layer', 'feature', 'functionality',
])

export function capabilityTokens(name) {
  if (typeof name !== 'string') return new Set()
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !CAPABILITY_STOPWORDS.has(token)),
  )
}

/**
 * How far two independent readings of the same commit agree.
 *
 * This is the measurement blind tier-2 reading exists to produce. Self-reported
 * confidence is known to be unreliable here - one interpreted repository returned only
 * three distinct confidence values, none below 0.7 - so agreement between two models
 * that never saw each other's answer is a better estimate of whether a reading can be
 * trusted than either model's opinion of itself.
 */
export function compareReadings(first, second) {
  if (!first || !second) return null
  const left = capabilityTokens(first.capability)
  const right = capabilityTokens(second.capability)
  const shared = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size

  return {
    capabilityOverlap: union === 0 ? 0 : shared / union,
    kindAgrees: first.kind === second.kind,
    significanceDelta: Math.abs((first.significance ?? 0) - (second.significance ?? 0)),
  }
}
