/** Independently audit commits whose assignments varied against one fixed hierarchy. */

import { extractJson } from './phase-model.mjs'
import { requestChatCompletion } from './openai-provider.mjs'
import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  fingerprintInductionRequest,
} from './capability-induction.mjs'

export { API_KEY_ENV, DEFAULT_MODEL }

const REQUEST_TIMEOUT_MS = 600000
const VERDICTS = new Set(['assign', 'unassigned', 'ambiguous', 'map_insufficient'])

export const CRITIC_SYSTEM_PROMPT = `You are independently auditing disputed evidence
assignments in a candidate software capability hierarchy.

Repeated assignment passes disagreed. Their vote counts, run identities, and exact
alternatives have been withheld. Candidate IDs shown beside a commit are only the unordered
union of IDs previously proposed; inclusion is not proof, and popularity is not available.
Judge the commit reading itself.

The hierarchy is fixed for this experiment. Do not add, remove, merge, split, rename, or
reparent nodes. You may select any supplied hierarchy ID, including one absent from the
candidate union, when the evidence clearly supports it. Attach evidence to the most specific
node it directly supports and do not repeat a child on its ancestor. A commit may support
several nodes when genuinely cross-cutting.

Stable exemplars are recurring model assignments supplied only as provisional boundary
context. They are not ground truth. Use them when helpful, but reject an analogy that the
disputed reading does not support. No maintainer taxonomy is available.

Give each input exactly one verdict:
- assign: the reading clearly supports the selected existing capability IDs;
- unassigned: it is routine, ambiguous, or not durable capability evidence;
- ambiguous: the reading cannot distinguish among existing nodes; list plausible IDs and
  whether unassigned remains plausible;
- map_insufficient: it describes durable capability evidence but the fixed hierarchy lacks
  a suitable node or distinction.

Keep reasons short and evidence-specific. Cite only supplied exemplar IDs.

Reply with JSON only, no prose or fences:

{"decisions": [{"input": number,
"verdict": "assign" | "unassigned" | "ambiguous" | "map_insufficient",
"selectedCapabilityIds": [string, ...],
"plausibleCapabilityIds": [string, ...],
"unassignedPlausible": boolean,
"referenceExemplarIds": [string, ...],
"reason": string}]}`

export const BLIND_CRITIC_SYSTEM_PROMPT = `You are independently auditing disputed evidence
assignments in a candidate software capability hierarchy.

Repeated assignment passes disagreed, but all of their proposed assignments, vote counts,
and run identities have been withheld. Judge the commit reading itself and choose from the
supplied hierarchy without trying to reconstruct a prior answer.

The hierarchy is fixed for this experiment. Do not add, remove, merge, split, rename, or
reparent nodes. Attach evidence to the most specific node it directly supports and do not
repeat a child on its ancestor. A commit may support several nodes when genuinely
cross-cutting.

Stable exemplars are recurring model assignments supplied only as provisional boundary
context. They are not ground truth. Use them when helpful, but reject an analogy that the
disputed reading does not support. No maintainer taxonomy is available.

Give each input exactly one verdict:
- assign: the reading clearly supports the selected existing capability IDs;
- unassigned: it is routine, ambiguous, or not durable capability evidence;
- ambiguous: the reading cannot distinguish among existing nodes; list plausible IDs and
  whether unassigned remains plausible;
- map_insufficient: it describes durable capability evidence but the fixed hierarchy lacks
  a suitable node or distinction.

Keep reasons short and evidence-specific. Cite only supplied exemplar IDs.

Reply with JSON only, no prose or fences:

{"decisions": [{"input": number,
"verdict": "assign" | "unassigned" | "ambiguous" | "map_insufficient",
"selectedCapabilityIds": [string, ...],
"plausibleCapabilityIds": [string, ...],
"unassignedPlausible": boolean,
"referenceExemplarIds": [string, ...],
"reason": string}]}`

const flattenHierarchy = (nodes, parentId = null, output = []) => {
  for (const node of nodes ?? []) {
    output.push({ ...node, parentId })
    flattenHierarchy(node.children ?? [], node.id, output)
  }
  return output
}

export function renderCriticEvidence(dataset, { showCandidateUnion = false } = {}) {
  const hierarchy = JSON.stringify(dataset.hierarchy ?? [], null, 2)
  const exemplars = (dataset.stableExemplars ?? []).map((exemplar) => [
    `${exemplar.id} -> ${exemplar.capabilityId}`,
    `${exemplar.authoredAt?.slice(0, 10) ?? 'unknown-date'} ${exemplar.subject ?? '(no subject)'}`,
    `Reading: ${exemplar.reading ?? '(no reading)'}`,
  ].join('\n')).join('\n\n')
  const disagreements = (dataset.disagreements ?? []).map((disagreement, index) => {
    const lines = [
      `Input ${index}`,
      `${disagreement.authoredAt?.slice(0, 10) ?? 'unknown-date'} ${disagreement.subject ?? '(no subject)'}`,
      `Reading: ${disagreement.reading ?? '(no reading)'}`,
    ]
    if (showCandidateUnion) {
      lines.push(`Candidate ID union: ${disagreement.candidateCapabilityIds.join(', ') || '(none)'}`)
    }
    return lines.join('\n')
  }).join('\n\n')
  return `Fixed candidate hierarchy (no prior memberships):

${hierarchy}

Provisional stable exemplars:

${exemplars || '(none)'}

Disputed commit readings:

${disagreements}`
}

export function buildCapabilityCriticRequest(
  dataset,
  { model = DEFAULT_MODEL, showCandidateUnion = false } = {},
) {
  return {
    model,
    max_completion_tokens: 30000,
    messages: [
      {
        role: 'system',
        content: showCandidateUnion ? CRITIC_SYSTEM_PROMPT : BLIND_CRITIC_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `${renderCriticEvidence(dataset, { showCandidateUnion })}

Audit all ${(dataset.disagreements ?? []).length} disputed inputs independently.`,
      },
    ],
  }
}

const cleanIndex = (value, count) => {
  const index = Number.parseInt(value, 10)
  return Number.isInteger(index) && index >= 0 && index < count ? index : null
}

const cleanText = (value, limit = 600) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

const cleanKnownList = (values, known, unknown) => {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value)
    if (!known.has(id)) { unknown.add(id); continue }
    if (!seen.has(id)) { seen.add(id); result.push(id) }
  }
  return result
}

const removeRedundantAncestors = (ids, parentById, removed) => {
  const selected = new Set(ids)
  for (const id of ids) {
    let parent = parentById.get(id)
    while (parent) {
      if (selected.has(parent)) { selected.delete(parent); removed.add(parent) }
      parent = parentById.get(parent)
    }
  }
  return [...selected]
}

const assignmentKey = (ids) => [...ids].sort().join('|')

export function parseCapabilityCriticPayload(payload, dataset) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('capability critic output was truncated')

  const raw = extractJson(choice.message?.content ?? '')
  const disagreements = dataset.disagreements ?? []
  const nodes = flattenHierarchy(dataset.hierarchy ?? [])
  const knownIds = new Set(nodes.map((node) => node.id))
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]))
  const knownExemplars = new Set((dataset.stableExemplars ?? []).map((entry) => entry.id))
  const unknownCapabilityIds = new Set()
  const unknownExemplarIds = new Set()
  const invalidInputs = []
  const duplicateInputs = []
  const normalizedVerdicts = []
  const removedRedundantAncestorIds = new Set()
  const parsed = new Map()

  for (const decision of Array.isArray(raw.decisions) ? raw.decisions : []) {
    const index = cleanIndex(decision?.input, disagreements.length)
    if (index === null) { invalidInputs.push(decision?.input ?? null); continue }
    if (parsed.has(index)) { duplicateInputs.push(index); continue }
    let verdict = VERDICTS.has(decision.verdict) ? decision.verdict : 'ambiguous'
    if (verdict !== decision.verdict) normalizedVerdicts.push(index)
    let selected = cleanKnownList(
      decision.selectedCapabilityIds, knownIds, unknownCapabilityIds,
    )
    let plausible = cleanKnownList(
      decision.plausibleCapabilityIds, knownIds, unknownCapabilityIds,
    )
    selected = removeRedundantAncestors(selected, parentById, removedRedundantAncestorIds)
    plausible = removeRedundantAncestors(plausible, parentById, removedRedundantAncestorIds)

    if (verdict === 'assign' && selected.length === 0) {
      verdict = 'ambiguous'
      normalizedVerdicts.push(index)
    }
    if (verdict === 'ambiguous') {
      plausible = [...new Set([...selected, ...plausible])]
      selected = []
    } else if (verdict === 'unassigned') {
      selected = []
      plausible = []
    } else if (verdict === 'map_insufficient') {
      plausible = [...new Set([...selected, ...plausible])]
      selected = []
    } else {
      plausible = plausible.filter((id) => !selected.includes(id))
    }

    const referenceExemplarIds = cleanKnownList(
      decision.referenceExemplarIds, knownExemplars, unknownExemplarIds,
    )
    const disagreement = disagreements[index]
    const candidateSet = new Set(disagreement.candidateCapabilityIds)
    const outsideCandidateIds = [...new Set([...selected, ...plausible])]
      .filter((id) => !candidateSet.has(id))
    const resolvedIds = verdict === 'assign' ? selected : verdict === 'unassigned' ? [] : null
    const observedKeys = new Set(disagreement.alternatives.map((alternative) =>
      assignmentKey(alternative.capabilityIds)))
    parsed.set(index, {
      input: index,
      commitSha: disagreement.commitSha,
      verdict,
      selectedCapabilityIds: selected,
      plausibleCapabilityIds: plausible,
      unassignedPlausible: verdict === 'unassigned'
        ? true
        : verdict === 'ambiguous' && Boolean(decision.unassignedPlausible),
      referenceExemplarIds,
      reason: cleanText(decision.reason),
      candidateCapabilityIds: disagreement.candidateCapabilityIds,
      outsideCandidateIds,
      matchesObservedAlternative: resolvedIds === null
        ? null
        : observedKeys.has(assignmentKey(resolvedIds)),
    })
  }

  const omittedInputs = []
  for (let index = 0; index < disagreements.length; index += 1) {
    if (parsed.has(index)) continue
    omittedInputs.push(index)
    const disagreement = disagreements[index]
    parsed.set(index, {
      input: index,
      commitSha: disagreement.commitSha,
      verdict: 'missing',
      selectedCapabilityIds: [],
      plausibleCapabilityIds: [],
      unassignedPlausible: false,
      referenceExemplarIds: [],
      reason: null,
      candidateCapabilityIds: disagreement.candidateCapabilityIds,
      outsideCandidateIds: [],
      matchesObservedAlternative: null,
    })
  }
  const decisions = [...parsed.values()].sort((left, right) => left.input - right.input)
  const count = (verdict) => decisions.filter((decision) => decision.verdict === verdict).length
  const resolved = decisions.filter((decision) => ['assign', 'unassigned'].includes(decision.verdict))
  return {
    decisions,
    shape: {
      disagreements: disagreements.length,
      assigned: count('assign'),
      unassigned: count('unassigned'),
      ambiguous: count('ambiguous'),
      mapInsufficient: count('map_insufficient'),
      missing: count('missing'),
      resolvedMatchesObservedAlternative: resolved.filter(
        (decision) => decision.matchesObservedAlternative).length,
      resolvedBeyondObservedAlternatives: resolved.filter(
        (decision) => !decision.matchesObservedAlternative).length,
      decisionsOutsideCandidateUnion: decisions.filter(
        (decision) => decision.outsideCandidateIds.length > 0).length,
    },
    diagnostics: {
      invalidInputs,
      duplicateInputs,
      omittedInputs,
      unknownCapabilityIds: [...unknownCapabilityIds],
      unknownExemplarIds: [...unknownExemplarIds],
      normalizedVerdicts: [...new Set(normalizedVerdicts)],
      removedRedundantAncestorIds: [...removedRedundantAncestorIds],
    },
    usage: payload.usage ?? null,
  }
}

export function fingerprintCapabilityCriticRequest(
  dataset,
  { model = DEFAULT_MODEL, showCandidateUnion = false } = {},
) {
  return fingerprintInductionRequest(buildCapabilityCriticRequest(
    dataset,
    { model, showCandidateUnion },
  ))
}

export async function requestCapabilityCriticPayload(
  dataset,
  {
    model = DEFAULT_MODEL,
    apiKey,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
    showCandidateUnion = false,
  } = {},
) {
  return requestChatCompletion(buildCapabilityCriticRequest(dataset, { model, showCandidateUnion }), { apiKey, fetchImpl, timeoutMs, timeoutMessage: 'capability critic' })
}
