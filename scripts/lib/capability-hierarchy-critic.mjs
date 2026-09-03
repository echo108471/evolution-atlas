/** Propose evidence-backed changes to a provisional capability hierarchy without applying them. */

import { extractJson } from './phase-model.mjs'
import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  OPENROUTER_ENDPOINT,
  fingerprintInductionRequest,
} from './capability-induction.mjs'

export { API_KEY_ENV, DEFAULT_MODEL }

const REQUEST_TIMEOUT_MS = 600000
const OPERATIONS = new Set([
  'add_node', 'merge_nodes', 'split_node', 'reparent_node', 'remove_node',
])
const CONFIDENCE = new Set(['low', 'medium', 'high'])

export const HIERARCHY_CRITIC_SYSTEM_PROMPT = `You are independently reviewing the structure
of a provisional software capability hierarchy.

No maintainer taxonomy, desired capability count, or gold answer is available. The current
map and all alternative maps were model-generated from the same commit readings. Treat
their names, boundaries, and run recurrence as provisional evidence, never as votes or
truth.

The review packet contains:
- the current two-level hierarchy;
- stable assignment exemplars that illustrate current node boundaries;
- label-independent boundary comparisons against other blind hierarchy runs;
- recurring map-gap findings from blind assignment critics; and
- a bounded registry of commit readings cited by those signals.

Review whether durable user, developer, or operator outcomes are missing, conflated,
duplicated, too fine, or parented under the wrong umbrella. Do not split by directory,
framework, lifecycle stage, or implementation layer alone. Broad umbrellas are allowed.
Overlap belongs to evidence assignment and is not by itself a reason to duplicate nodes.
Keep this experiment at two levels: a top-level capability and optional children.

You may propose add_node, merge_nodes, split_node, reparent_node, or remove_node. Proposals
are suggestions only and will not mutate the map. Every proposal must cite supplied reading
IDs that directly support it. Cite signal IDs when a proposal addresses a supplied signal.
For split_node, provide at least two replacements and cite evidence separately for each.
Mark every current node as reviewed, even when no change is proposed. Every supplied signal
must either be cited by a proposal or listed as unresolved.

Reply with JSON only, no prose or fences:

{"reviewedNodeIds": [string, ...],
"proposals": [{
  "operation": "add_node" | "merge_nodes" | "split_node" | "reparent_node" | "remove_node",
  "targetNodeIds": [string, ...],
  "proposedParentId": string | null,
  "name": string | null,
  "summary": string | null,
  "replacementNodes": [{"name": string, "summary": string,
    "proposedParentId": string | null, "evidenceIds": [string, ...]}],
  "evidenceIds": [string, ...],
  "signalIds": [string, ...],
  "reason": string,
  "confidence": "low" | "medium" | "high"
}],
"unresolvedSignalIds": [string, ...]}`

const cleanText = (value, limit = 600) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

const flattenHierarchy = (nodes, parentId = null, output = []) => {
  for (const node of nodes ?? []) {
    output.push({ ...node, parentId })
    flattenHierarchy(node.children ?? [], node.id, output)
  }
  return output
}

const knownList = (values, known, unknown) => {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value)
    if (!known.has(id)) { unknown.add(id); continue }
    if (!seen.has(id)) { seen.add(id); result.push(id) }
  }
  return result
}

const signalList = (dataset) => [
  ...(dataset.signals?.gapSignals ?? []),
  ...(dataset.signals?.boundarySignals ?? []),
  ...(dataset.signals?.unmatchedAlternativeSignals ?? []),
]

export function renderHierarchyCriticEvidence(dataset) {
  const evidence = (dataset.evidence ?? []).map((entry) => [
    `${entry.id}: ${entry.authoredAt?.slice(0, 10) ?? 'unknown-date'} ${entry.subject ?? '(no subject)'}`,
    `Reading: ${entry.reading ?? '(no reading)'}`,
  ].join('\n')).join('\n\n')
  return `Current provisional hierarchy:

${JSON.stringify(dataset.hierarchy ?? [], null, 2)}

Current-node stable exemplar references:

${JSON.stringify(dataset.nodeContext ?? [], null, 2)}

Recurring blind map-gap signals:

${JSON.stringify(dataset.signals?.gapSignals ?? [], null, 2)}

Cross-run boundary comparisons:

${JSON.stringify(dataset.signals?.boundarySignals ?? [], null, 2)}

Unmatched nodes proposed by alternative blind runs:

${JSON.stringify(dataset.signals?.unmatchedAlternativeSignals ?? [], null, 2)}

Bounded reading registry:

${evidence || '(none)'}`
}

export function buildHierarchyCriticRequest(
  dataset,
  { model = DEFAULT_MODEL, maxTokens = 30000 } = {},
) {
  return {
    model,
    max_tokens: maxTokens,
    usage: { include: true },
    messages: [
      { role: 'system', content: HIERARCHY_CRITIC_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${renderHierarchyCriticEvidence(dataset)}

Review all ${dataset.shape?.hierarchyNodes ?? 0} current nodes and account for all ${
          signalList(dataset).length} supplied signals.`,
      },
    ],
  }
}

const hasParentField = (proposal) => Object.hasOwn(proposal ?? {}, 'proposedParentId')

export function parseHierarchyCriticPayload(payload, dataset) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('hierarchy critic output was truncated')
  const raw = extractJson(choice.message?.content ?? '')
  const nodes = flattenHierarchy(dataset.hierarchy ?? [])
  const nodeIds = new Set(nodes.map((node) => node.id))
  const topLevelNodeIds = new Set(nodes.filter((node) => node.parentId === null).map((node) => node.id))
  const evidenceIds = new Set((dataset.evidence ?? []).map((entry) => entry.id))
  const signals = signalList(dataset)
  const signalIds = new Set(signals.map((signal) => signal.id))
  const unknownNodeIds = new Set()
  const unknownEvidenceIds = new Set()
  const unknownSignalIds = new Set()
  const invalidOperations = []
  const unsupportedProposals = []
  const invalidProposals = []
  const proposals = []

  for (const [index, proposal] of (Array.isArray(raw.proposals) ? raw.proposals : []).entries()) {
    if (!OPERATIONS.has(proposal?.operation)) {
      invalidOperations.push(proposal?.operation ?? null)
      continue
    }
    const targetNodeIds = knownList(proposal.targetNodeIds, nodeIds, unknownNodeIds)
    const citedEvidenceIds = knownList(proposal.evidenceIds, evidenceIds, unknownEvidenceIds)
    const citedSignalIds = knownList(proposal.signalIds, signalIds, unknownSignalIds)
    const rawParent = proposal.proposedParentId
    const parentIsValid = rawParent == null || topLevelNodeIds.has(String(rawParent))
    if (rawParent != null && !nodeIds.has(String(rawParent))) unknownNodeIds.add(String(rawParent))
    const parent = rawParent == null ? null : parentIsValid ? String(rawParent) : null
    const replacementNodes = []
    for (const replacement of Array.isArray(proposal.replacementNodes)
      ? proposal.replacementNodes : []) {
      const name = cleanText(replacement?.name, 120)
      const replacementEvidence = knownList(
        replacement?.evidenceIds, evidenceIds, unknownEvidenceIds,
      )
      if (!name || replacementEvidence.length === 0) continue
      const replacementParent = replacement.proposedParentId
      const replacementParentIsValid = replacementParent == null ||
        topLevelNodeIds.has(String(replacementParent))
      if (replacementParent != null && !nodeIds.has(String(replacementParent))) {
        unknownNodeIds.add(String(replacementParent))
      }
      if (!replacementParentIsValid) continue
      replacementNodes.push({
        name,
        summary: cleanText(replacement.summary, 500),
        proposedParentId: replacementParent == null ? null : String(replacementParent),
        evidenceIds: replacementEvidence,
      })
    }
    if (citedEvidenceIds.length === 0) {
      unsupportedProposals.push(index)
      continue
    }
    const validShape = (
      proposal.operation === 'add_node' && targetNodeIds.length === 0 && hasParentField(proposal) &&
        parentIsValid &&
        cleanText(proposal.name, 120)
    ) || (
      proposal.operation === 'merge_nodes' && targetNodeIds.length >= 2 && hasParentField(proposal) &&
        parentIsValid &&
        cleanText(proposal.name, 120)
    ) || (
      proposal.operation === 'split_node' && targetNodeIds.length === 1 && replacementNodes.length >= 2
    ) || (
      proposal.operation === 'reparent_node' && targetNodeIds.length === 1 && hasParentField(proposal) &&
        parentIsValid && !targetNodeIds.includes(parent) &&
        nodes.find((node) => node.id === targetNodeIds[0])?.parentId !== parent &&
        !(nodes.find((node) => node.id === targetNodeIds[0])?.children?.length > 0 && parent !== null)
    ) || (
      proposal.operation === 'remove_node' && targetNodeIds.length === 1
    )
    if (!validShape) { invalidProposals.push(index); continue }
    proposals.push({
      id: `P${proposals.length}`,
      operation: proposal.operation,
      targetNodeIds,
      proposedParentId: parent,
      name: cleanText(proposal.name, 120),
      summary: cleanText(proposal.summary, 500),
      replacementNodes,
      evidenceIds: citedEvidenceIds,
      signalIds: citedSignalIds,
      reason: cleanText(proposal.reason),
      confidence: CONFIDENCE.has(proposal.confidence) ? proposal.confidence : 'low',
      interpretationStatus: 'candidate',
    })
  }

  const reviewedNodeIds = knownList(raw.reviewedNodeIds, nodeIds, unknownNodeIds)
  const unresolvedSignalIds = knownList(
    raw.unresolvedSignalIds, signalIds, unknownSignalIds,
  )
  const accountedSignals = new Set([
    ...unresolvedSignalIds,
    ...proposals.flatMap((proposal) => proposal.signalIds),
  ])
  const omittedNodeIds = [...nodeIds].filter((id) => !reviewedNodeIds.includes(id))
  const omittedSignalIds = [...signalIds].filter((id) => !accountedSignals.has(id))
  return {
    reviewedNodeIds,
    proposals,
    unresolvedSignalIds,
    shape: {
      hierarchyNodes: nodes.length,
      reviewedNodes: reviewedNodeIds.length,
      proposals: proposals.length,
      addNodes: proposals.filter((proposal) => proposal.operation === 'add_node').length,
      merges: proposals.filter((proposal) => proposal.operation === 'merge_nodes').length,
      splits: proposals.filter((proposal) => proposal.operation === 'split_node').length,
      reparents: proposals.filter((proposal) => proposal.operation === 'reparent_node').length,
      removals: proposals.filter((proposal) => proposal.operation === 'remove_node').length,
      signals: signals.length,
      accountedSignals: accountedSignals.size,
      completeReview: omittedNodeIds.length === 0 && omittedSignalIds.length === 0,
    },
    diagnostics: {
      omittedNodeIds,
      omittedSignalIds,
      invalidOperations,
      invalidProposals,
      unsupportedProposals,
      unknownNodeIds: [...unknownNodeIds],
      unknownEvidenceIds: [...unknownEvidenceIds],
      unknownSignalIds: [...unknownSignalIds],
    },
    usage: payload.usage ?? null,
  }
}

export function fingerprintHierarchyCriticRequest(
  dataset,
  { model = DEFAULT_MODEL, maxTokens = 30000 } = {},
) {
  return fingerprintInductionRequest(buildHierarchyCriticRequest(dataset, { model, maxTokens }))
}

export async function requestHierarchyCriticPayload(
  dataset,
  {
    model = DEFAULT_MODEL,
    maxTokens = 30000,
    apiKey,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildHierarchyCriticRequest(dataset, { model, maxTokens })),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`hierarchy critic exceeded ${Math.round(timeoutMs / 1000)}s`)
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
