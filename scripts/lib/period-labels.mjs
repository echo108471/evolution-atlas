/**
 * Name each period of a repository's history.
 *
 * Labeling is also the cheapest available check on whether the boundaries are real. A
 * period that can be named — "the demo-to-product restructure" — was a period. One that
 * can only be described as "commits 1446 to 1699" was a cut in the wrong place, and the
 * label makes that visible without any separate evaluation.
 *
 * The hierarchy is summarized upward rather than re-read: an epoch is named from its
 * commits, an era from the epochs inside it. A coarse period never sees raw history,
 * which is what keeps the request bounded no matter how long the repository is.
 */

import { OPENROUTER_ENDPOINT, extractJson } from './phase-model.mjs'
import { requireSynchronousModel } from './model-defaults.mjs'

const REQUEST_TIMEOUT_MS = 180000
const MAX_SAMPLED_COMMITS = 60
const MAX_SUBJECT_LENGTH = 120
const MAX_AREAS = 8

const EPOCH_SYSTEM_PROMPT = `You name one period of a software repository's history.

You are given the commits from a single stretch of that history, in order. Name what
the work during it was about.

The label is a short noun phrase a maintainer would recognize — "Grade distribution
pipeline", "Demo-to-product restructure", "Extension rewrite". Not a date range, not a
directory name, not a restatement of one commit subject, and not a generic word like
"development" or "improvements".

If the commits have no common thread, say so: set coherent to false and label the
period for what it actually is, such as "Mixed maintenance". A period that cannot be
named is useful information about where the boundaries were drawn.

Reply with JSON only, no prose or fences:

{"label": string, "summary": string, "coherent": boolean,
"confidence": number between 0 and 1}`

const GROUP_SYSTEM_PROMPT = `You name one era of a software repository's history from
the periods it contains.

You are given the labels and summaries of consecutive periods. Name the larger arc they
form together.

The label is a short noun phrase — "Prototype era", "Data platform buildout". It should
say something the individual period labels do not already say on their own; if the
periods have no shared arc, set coherent to false and say what they actually are.

Do not invent detail that is not in the periods you were given. You are summarizing
summaries, and anything you add here cannot be traced back to a commit.

Reply with JSON only, no prose or fences:

{"label": string, "summary": string, "coherent": boolean,
"confidence": number between 0 and 1}`

/**
 * Evenly sample a period's commits. A long period would otherwise be named from its
 * opening alone, which is exactly where a period is least distinguishable from the one
 * before it.
 */
export function sampleCommits(episodes, startIndex, endIndex, limit = MAX_SAMPLED_COMMITS) {
  const total = endIndex - startIndex
  if (total <= limit) return episodes.slice(startIndex, endIndex)
  const step = total / limit
  return Array.from({ length: limit }, (_, position) => episodes[startIndex + Math.floor(position * step)])
}

function topAreas(episodes, startIndex, endIndex) {
  const counts = new Map()
  for (let index = startIndex; index < endIndex; index += 1) {
    for (const change of episodes[index].changes) {
      const key = change.path.split('/').slice(0, 2).join('/')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let mass = 0
  for (const value of counts.values()) mass += value
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_AREAS)
    .map(([path, count]) => `${path} ${Math.round((100 * count) / (mass || 1))}%`)
}

export function buildEpochPrompt(dataset, period, episodes) {
  const sampled = sampleCommits(episodes, period.startIndex, period.endIndex)
  const commits = sampled
    .map((episode) => `${episode.authoredAt.slice(0, 10)} ${episode.subject.slice(0, MAX_SUBJECT_LENGTH)}`)
    .join('\n')
  const omitted = period.commitCount - sampled.length

  return `Repository: ${dataset.repository.name}
Period: ${period.firstAuthoredAt.slice(0, 10)} to ${period.lastAuthoredAt.slice(0, 10)}, ${period.commitCount} commits${omitted > 0 ? ` (${sampled.length} sampled evenly across it)` : ''}
Most-touched areas: ${topAreas(episodes, period.startIndex, period.endIndex).join(', ')}

${commits}

Name this period.`
}

export function buildGroupPrompt(dataset, period, children) {
  const described = children
    .map((child, order) => `${order + 1}. ${child.label ?? '(unnamed)'} — ${child.summary ?? 'no summary'} (${child.commitCount} commits, ${child.firstAuthoredAt.slice(0, 10)} to ${child.lastAuthoredAt.slice(0, 10)})`)
    .join('\n')

  return `Repository: ${dataset.repository.name}
Era: ${period.firstAuthoredAt.slice(0, 10)} to ${period.lastAuthoredAt.slice(0, 10)}, ${period.commitCount} commits across ${children.length} periods

${described}

Name the era these periods form.`
}

export async function requestLabel(prompt, systemPrompt, { model, apiKey, fetchImpl = fetch } = {}) {
  requireSynchronousModel(model)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
  const payload = await response.json()
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('label output truncated')
  return { label: extractJson(choice.message?.content ?? ''), usage: payload.usage ?? null }
}

function applyLabel(period, parsed, method) {
  return {
    ...period,
    label: typeof parsed.label === 'string' ? parsed.label.trim() : null,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : null,
    coherent: parsed.coherent !== false,
    labelConfidence: Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : null,
    labelMethod: method,
    labelStatus: 'candidate',
  }
}

/**
 * Label every level, lowest first, so each coarse period can be named from children that
 * already carry labels. Failures are recorded and leave the period unnamed rather than
 * aborting the run: a partly named hierarchy is still readable.
 */
export async function labelPeriodLevels(
  dataset,
  levels,
  { model, apiKey, request = requestLabel, onProgress } = {},
) {
  // Configuration errors must abort, not become recoverable per-period failures.
  requireSynchronousModel(model)
  const method = `period-label:openrouter:${model}`
  const labeled = []
  const failures = []
  const usage = {}
  const byId = new Map()

  for (const [level, periods] of levels.entries()) {
    const named = []
    for (const period of periods) {
      try {
        const children = period.childIds.map((id) => byId.get(id)).filter(Boolean)
        const prompt =
          level === 0
            ? buildEpochPrompt(dataset, period, dataset.episodes)
            : buildGroupPrompt(dataset, period, children)
        const result = await request(prompt, level === 0 ? EPOCH_SYSTEM_PROMPT : GROUP_SYSTEM_PROMPT, { model, apiKey })
        const withLabel = applyLabel(period, result.label, method)
        named.push(withLabel)
        byId.set(period.id, withLabel)
        for (const [key, value] of Object.entries(result.usage ?? {})) {
          if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value
        }
        onProgress?.({ level, period: withLabel })
      } catch (error) {
        failures.push({ periodId: period.id, level, message: error.message })
        const unnamed = { ...period, label: null, summary: null, coherent: null, labelConfidence: null, labelMethod: method, labelStatus: 'failed' }
        named.push(unnamed)
        byId.set(period.id, unnamed)
        onProgress?.({ level, period: unnamed, error: error.message })
      }
    }
    labeled.push(named)
  }

  return { levels: labeled, failures, usage, method }
}
