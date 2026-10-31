/**
 * Naming as evaluation.
 *
 * Two arms that disagree cannot be ranked by cluster counts, and no gold set exists. But
 * a group of commits that no reader can name is a bad group whichever method produced it,
 * and the epoch work already uses refusal this way: a period the model declines to name
 * is evidence about where the boundaries fell, not only about the work.
 *
 * The same prompt names clusters from both arms, and the namer is never told which arm a
 * cluster came from, how it was built, or that a comparison is happening. It sees commit
 * subjects and is told it may refuse.
 */

import { extractJson } from './phase-model.mjs'
import { DEFAULT_CHEAP_MODEL, requestChatCompletion, requireSynchronousModel } from './openai-provider.mjs'

export const DEFAULT_MODEL = DEFAULT_CHEAP_MODEL

const MAX_SUBJECTS = 12
const REQUEST_TIMEOUT_MS = 120000

export const NAMING_SYSTEM_PROMPT = `You are shown the commit messages of a group of
commits from one software repository, and asked whether they are about one thing.

If they are, name it: the capability a user or another developer would recognize.

If they are not - if the group is a mixture of unrelated work, or too vague to name -
say so. Refusing is the right answer for a group that has no single subject, and is more
useful than a label that papers over the mixture.

Judge only the commits shown. Do not guess at what a repository with these commits would
also contain.

Reply with JSON only, no prose or fences:

{"coherent": boolean, "name": string or null, "reason": string}`

/** Evenly spaced, so a large group is judged on its whole span rather than its opening. */
export function sampleSubjects(evidence, limit = MAX_SUBJECTS) {
  if (evidence.length <= limit) return evidence.map((entry) => entry.subject)
  const step = evidence.length / limit
  return Array.from({ length: limit }, (_, order) => evidence[Math.floor(order * step)].subject)
}

/** The same even spacing, keeping whole entries so a caller may show more than the subject. */
export function sampleEvidence(evidence, limit = MAX_SUBJECTS) {
  if (evidence.length <= limit) return evidence
  const step = evidence.length / limit
  return Array.from({ length: limit }, (_, order) => evidence[Math.floor(order * step)])
}

/**
 * `show` adds channels beside each subject: `reading`, `paths`, or both.
 *
 * There is no neutral view, and pretending otherwise would be the mistake. Showing the
 * readings favours the arms that group on readings; showing the paths favours the arms
 * that group on paths. Showing only subjects is neutral in provenance but not in quality -
 * the pilot's largest baseline group is unmistakably ETL work whose subjects read
 * `cleanup`, `comments`, `cleanup!`, so a subject-only judge refuses a group that is
 * plainly coherent, and depresses every arm at once.
 *
 * So every view is reported, and the finding is whether they agree. A group all three
 * views can name is coherent on any account; one only its own arm's channel can name is
 * the arm marking its own work.
 */
export function buildNamingRequest(evidence, { model, show = [] }) {
  const shown = new Set(show)
  const sampled = sampleEvidence(evidence)
  const lines = sampled.map((entry) => {
    // The body comes with the subject in every view. It is the message the author wrote,
    // observed rather than interpreted, and available to every arm - and on the pilot it
    // is the half that says what the commit was, since 445 merges put provenance in the
    // subject and the pull request title in the body.
    const parts = [`- ${entry.subject}`]
    if (entry.body) parts.push(`    ${entry.body}`)
    if (shown.has('reading') && entry.reading) parts.push(`    ${entry.reading}`)
    if (shown.has('paths') && entry.paths?.length) parts.push(`    touched: ${entry.paths.join(', ')}`)
    return parts.join('\n')
  })
  return {
    model,
    max_completion_tokens: 600,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: NAMING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${evidence.length} commits${evidence.length > sampled.length ? `, ${sampled.length} shown` : ''}:

${lines.join('\n')}

Are these about one thing?`,
      },
    ],
  }
}

export function parseNaming(payload) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  const parsed = extractJson(choice.message?.content ?? '')
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  return {
    coherent: parsed.coherent === true && name.length > 0,
    name: name.length > 0 ? name.slice(0, 120) : null,
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : null,
    usage: payload.usage ?? null,
  }
}

export async function requestNaming(evidence, { model = DEFAULT_MODEL, apiKey, fetchImpl = fetch, show = [] } = {}) {
  const payload = await requestChatCompletion(buildNamingRequest(evidence, { model, show }), { apiKey, fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS, timeoutMessage: 'naming request' })
  return parseNaming(payload)
}

/**
 * Name every cluster in an arm and report how many could not be named. Singletons are
 * excluded: a one-commit group is trivially about one thing, so counting them would
 * reward whichever arm split more.
 */
export async function evaluateArm(capabilities, { model, apiKey, concurrency = 10, request = requestNaming, mapper, show = [] }) {
  // An unsupported transport is a configuration failure, not an unnamed group.
  requireSynchronousModel(model)
  const groups = capabilities.filter((capability) => capability.commitCount > 1)
  const results = await mapper(groups, concurrency, async (capability) => {
    try {
      const naming = await request(capability.evidence, { model, apiKey, show })
      return { commitCount: capability.commitCount, ...naming }
    } catch (error) {
      return { commitCount: capability.commitCount, coherent: null, name: null, reason: error.message }
    }
  })

  const judged = results.filter((result) => result.coherent !== null)
  const coherent = judged.filter((result) => result.coherent).length
  const cost = results.reduce((total, result) => total + (result.usage?.cost ?? 0), 0)
  return {
    groupsJudged: judged.length,
    coherent,
    incoherent: judged.length - coherent,
    coherentShare: judged.length === 0 ? 0 : coherent / judged.length,
    failures: results.length - judged.length,
    cost,
    namings: results,
  }
}
