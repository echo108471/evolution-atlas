/** Model-directed, bounded evidence retrieval for the provisional hierarchy critic. */

import { createHash } from 'node:crypto'

import { extractJson } from './phase-model.mjs'
import { fingerprintInductionRequest } from './capability-induction.mjs'
import {
  DEFAULT_MODEL,
  HIERARCHY_CRITIC_SYSTEM_PROMPT,
  buildHierarchyCriticRequest,
  parseHierarchyCriticPayload,
} from './capability-hierarchy-critic.mjs'

const unique = (values) => [...new Set(Array.isArray(values) ? values : [])]

const cleanText = (value, limit = 600) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

const flattenHierarchy = (nodes, output = []) => {
  for (const node of nodes ?? []) {
    output.push(node)
    flattenHierarchy(node.children ?? [], output)
  }
  return output
}

export const hierarchyReviewSignals = (dataset) => [
  ...(dataset.signals?.gapSignals ?? []),
  ...(dataset.signals?.boundarySignals ?? []),
  ...(dataset.signals?.unmatchedAlternativeSignals ?? []),
]

export const STAGED_RETRIEVAL_PLAN_SYSTEM_PROMPT = `You are planning a bounded evidence
retrieval pass for an independent review of a provisional software capability hierarchy.

No maintainer taxonomy, desired capability count, or gold answer is available. Do not
propose hierarchy changes yet. Decide which commit readings are needed to judge each
supplied structural signal. The catalog exposes only reading IDs, dates, and commit
subjects; the full reading text will be supplied in the next stage only for IDs you
request.

Create exactly one plan entry for every supplied signal. Order each entry's evidenceIds from
most to least useful. An entry may request no readings
when the hierarchy and signal metadata are sufficient, but explain why. You may also
request stable exemplars for current nodes whose boundaries need clarification. Never
request an ID absent from the supplied catalog. A deterministic evidence broker will
schedule your ordered requests across signals and cap the retrieved union at the stated
budget, so do not assume every requested reading will be returned.

Reply with JSON only, no prose or fences:

{"signalPlans": [{"signalId": string, "evidenceIds": [string, ...], "reason": string}],
"nodeEvidenceRequests": [{"nodeId": string, "evidenceIds": [string, ...],
"reason": string}]}`

export const LEGACY_HARD_CAP_PLAN_SYSTEM_PROMPT = `You are planning a bounded evidence
retrieval pass for an independent review of a provisional software capability hierarchy.

No maintainer taxonomy, desired capability count, or gold answer is available. Do not
propose hierarchy changes yet. Decide which commit readings are needed to judge each
supplied structural signal. The catalog exposes only reading IDs, dates, and commit
subjects; the full reading text will be supplied in the next stage only for IDs you
request.

Create exactly one plan entry for every supplied signal. An entry may request no readings
when the hierarchy and signal metadata are sufficient, but explain why. You may also
request stable exemplars for current nodes whose boundaries need clarification. Never
request an ID absent from the supplied catalog and keep the union of requested readings
within the stated budget.

Reply with JSON only, no prose or fences:

{"signalPlans": [{"signalId": string, "evidenceIds": [string, ...], "reason": string}],
"nodeEvidenceRequests": [{"nodeId": string, "evidenceIds": [string, ...],
"reason": string}]}`

const PLAN_PROTOCOLS = {
  'broker-ranked-v1': STAGED_RETRIEVAL_PLAN_SYSTEM_PROMPT,
  'hard-cap-v0': LEGACY_HARD_CAP_PLAN_SYSTEM_PROMPT,
}

export const STAGED_DECISION_SYSTEM_PROMPT = `${HIERARCHY_CRITIC_SYSTEM_PROMPT}

This is the decision stage of a bounded retrieval session. You previously selected the
reading registry shown here. You may cite only readings in that retrieved registry. If the
retrieved evidence is insufficient to support a change, list the affected signal as
unresolved rather than inventing support.`

const evidenceCatalog = (dataset) => (dataset.evidence ?? []).map((entry) => ({
  id: entry.id,
  authoredAt: entry.authoredAt?.slice(0, 10) ?? null,
  subject: entry.subject ?? null,
}))

const compactHierarchyForPrompt = (nodes, parentId = null, output = []) => {
  for (const node of nodes ?? []) {
    output.push({
      id: node.id,
      name: node.name,
      summary: node.summary ?? null,
      audience: node.audience ?? 'mixed',
      parentId,
      directCommitCount: node.directCommitCount ?? null,
      rollupCommitCount: node.rollupCommitCount ?? null,
    })
    compactHierarchyForPrompt(node.children ?? [], node.id, output)
  }
  return output
}

const compactSignalsForPrompt = (dataset) => ({
  gaps: (dataset.signals?.gapSignals ?? []).map((signal) => ({
    id: signal.id,
    recurrence: signal.recurrence,
    evidenceIds: signal.evidenceIds,
    reasons: signal.reasons,
  })),
  boundaries: (dataset.signals?.boundarySignals ?? []).map((signal) => ({
    id: signal.id,
    baselineNodeId: signal.baselineNodeId,
    alternativeNode: signal.alternativeNode,
    overlap: signal.overlap == null ? null : {
      jaccard: signal.overlap.jaccard,
      baselineCoverage: signal.overlap.baselineCoverage,
      alternativeCoverage: signal.overlap.alternativeCoverage,
    },
    competingAlternativeNodes: signal.competingAlternativeNodes,
    evidenceIds: signal.evidenceIds,
  })),
  unmatchedAlternatives: (dataset.signals?.unmatchedAlternativeSignals ?? []).map((signal) => ({
    id: signal.id,
    alternativeNode: signal.alternativeNode,
    evidenceIds: signal.evidenceIds,
  })),
})

export function renderHierarchyRetrievalPlanEvidence(
  dataset,
  maxEvidenceReadings,
  plannerProtocol = 'broker-ranked-v1',
) {
  return `Current provisional hierarchy:

${JSON.stringify(compactHierarchyForPrompt(dataset.hierarchy ?? []))}

Current-node stable exemplar references:

${JSON.stringify(dataset.nodeContext ?? [])}

Structural signals to plan for:

${JSON.stringify(compactSignalsForPrompt(dataset))}

Reading catalog without interpretations:

${JSON.stringify(evidenceCatalog(dataset))}

${plannerProtocol === 'hard-cap-v0'
    ? `The union of requested evidenceIds must contain at most ${maxEvidenceReadings} readings.`
    : `The evidence broker will retrieve at most ${maxEvidenceReadings} requested readings.`}`
}

export function buildHierarchyRetrievalPlanRequest(
  dataset,
  {
    plannerModel = DEFAULT_MODEL,
    plannerProtocol = 'broker-ranked-v1',
    maxEvidenceReadings = 32,
    planMaxTokens = 8000,
  } = {},
) {
  const systemPrompt = PLAN_PROTOCOLS[plannerProtocol]
  if (!systemPrompt) throw new Error(`unknown planner protocol: ${plannerProtocol}`)
  return {
    model: plannerModel,
    max_tokens: planMaxTokens,
    usage: { include: true },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${renderHierarchyRetrievalPlanEvidence(
          dataset, maxEvidenceReadings, plannerProtocol,
        )}

Plan evidence retrieval for all ${hierarchyReviewSignals(dataset).length} signals.`,
      },
    ],
  }
}

const parseChoice = (payload, stage) => {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error(`${stage} response contained no choices`)
  if (choice.finish_reason === 'length') throw new Error(`${stage} output was truncated`)
  return extractJson(choice.message?.content ?? '')
}

export function parseHierarchyRetrievalPlan(payload, dataset, { maxEvidenceReadings = 32 } = {}) {
  const raw = parseChoice(payload, 'hierarchy retrieval plan')
  const signals = hierarchyReviewSignals(dataset)
  const signalIds = new Set(signals.map((signal) => signal.id))
  const nodeIds = new Set(flattenHierarchy(dataset.hierarchy ?? []).map((node) => node.id))
  const evidence = dataset.evidence ?? []
  const evidenceIds = new Set(evidence.map((entry) => entry.id))
  const evidenceOrder = new Map(evidence.map((entry, index) => [entry.id, index]))
  const unknownSignalIds = new Set()
  const unknownNodeIds = new Set()
  const unknownEvidenceIds = new Set()
  const duplicateSignalIds = new Set()
  const invalidSignalPlans = []
  const invalidNodeRequests = []
  const seenSignals = new Set()
  const requested = new Set()
  const signalPlans = []

  for (const [index, entry] of (Array.isArray(raw.signalPlans) ? raw.signalPlans : []).entries()) {
    const signalId = String(entry?.signalId ?? '')
    const reason = cleanText(entry?.reason)
    if (!signalIds.has(signalId)) {
      if (signalId) unknownSignalIds.add(signalId)
      invalidSignalPlans.push(index)
      continue
    }
    if (seenSignals.has(signalId)) {
      duplicateSignalIds.add(signalId)
      invalidSignalPlans.push(index)
      continue
    }
    if (!reason) {
      invalidSignalPlans.push(index)
      continue
    }
    seenSignals.add(signalId)
    const selected = []
    for (const value of unique(entry.evidenceIds)) {
      const id = String(value)
      if (!evidenceIds.has(id)) { unknownEvidenceIds.add(id); continue }
      selected.push(id)
      requested.add(id)
    }
    signalPlans.push({ signalId, evidenceIds: selected, reason })
  }

  const nodeEvidenceRequests = []
  for (const [index, entry] of (Array.isArray(raw.nodeEvidenceRequests)
    ? raw.nodeEvidenceRequests : []).entries()) {
    const nodeId = String(entry?.nodeId ?? '')
    const reason = cleanText(entry?.reason)
    if (!nodeIds.has(nodeId) || !reason) {
      if (nodeId && !nodeIds.has(nodeId)) unknownNodeIds.add(nodeId)
      invalidNodeRequests.push(index)
      continue
    }
    const selected = []
    for (const value of unique(entry.evidenceIds)) {
      const id = String(value)
      if (!evidenceIds.has(id)) { unknownEvidenceIds.add(id); continue }
      selected.push(id)
      requested.add(id)
    }
    if (selected.length === 0) { invalidNodeRequests.push(index); continue }
    nodeEvidenceRequests.push({ nodeId, evidenceIds: selected, reason })
  }

  const requestedEvidenceIds = [...requested].sort(
    (left, right) => evidenceOrder.get(left) - evidenceOrder.get(right),
  )
  const retrieved = new Set()
  const lanes = [
    ...signalPlans.map((entry) => entry.evidenceIds),
    ...nodeEvidenceRequests.map((entry) => entry.evidenceIds),
  ]
  const maximumLaneLength = Math.max(0, ...lanes.map((lane) => lane.length))
  for (let rank = 0; rank < maximumLaneLength && retrieved.size < maxEvidenceReadings; rank += 1) {
    for (const lane of lanes) {
      const id = lane[rank]
      if (id != null) retrieved.add(id)
      if (retrieved.size >= maxEvidenceReadings) break
    }
  }
  const retrievedEvidenceIds = [...retrieved].sort(
    (left, right) => evidenceOrder.get(left) - evidenceOrder.get(right),
  )
  const omittedSignalIds = [...signalIds].filter((id) => !seenSignals.has(id))
  const completePlan = omittedSignalIds.length === 0 && duplicateSignalIds.size === 0 &&
    invalidSignalPlans.length === 0 && invalidNodeRequests.length === 0 && unknownSignalIds.size === 0 &&
    unknownNodeIds.size === 0 && unknownEvidenceIds.size === 0
  return {
    signalPlans,
    nodeEvidenceRequests,
    requestedEvidenceIds,
    retrievedEvidenceIds,
    shape: {
      signals: signals.length,
      plannedSignals: seenSignals.size,
      requestedEvidenceReadings: requestedEvidenceIds.length,
      retrievedEvidenceReadings: retrievedEvidenceIds.length,
      maxEvidenceReadings,
      requestWithinBudget: requestedEvidenceIds.length <= maxEvidenceReadings,
      withinBudget: retrievedEvidenceIds.length <= maxEvidenceReadings,
      brokerTruncated: retrievedEvidenceIds.length < requestedEvidenceIds.length,
      completePlan,
    },
    diagnostics: {
      omittedSignalIds,
      duplicateSignalIds: [...duplicateSignalIds],
      invalidSignalPlans,
      invalidNodeRequests,
      unknownSignalIds: [...unknownSignalIds],
      unknownNodeIds: [...unknownNodeIds],
      unknownEvidenceIds: [...unknownEvidenceIds],
    },
    usage: payload.usage ?? null,
  }
}

export function buildRetrievedHierarchyReview(dataset, plan) {
  if (!plan.shape?.completePlan) throw new Error('retrieval plan is incomplete or invalid')
  if (!plan.shape?.withinBudget) throw new Error('retrieval broker exceeded its evidence budget')
  const requested = new Set(plan.retrievedEvidenceIds)
  const retrieved = {
    ...dataset,
    evidence: (dataset.evidence ?? []).filter((entry) => requested.has(entry.id)),
    nodeContext: (dataset.nodeContext ?? []).map((entry) => ({
      ...entry,
      stableExemplarIds: (entry.stableExemplarIds ?? []).filter((id) => requested.has(id)),
    })).filter((entry) => entry.stableExemplarIds.length > 0),
    shape: {
      ...dataset.shape,
      availableEvidenceReadings: dataset.evidence?.length ?? 0,
      evidenceReadings: requested.size,
    },
  }
  return retrieved
}

export function buildStagedHierarchyDecisionRequest(
  dataset,
  plan,
  { model = DEFAULT_MODEL, decisionMaxTokens = 12000, reasoningEffort = null } = {},
) {
  const retrieved = buildRetrievedHierarchyReview(dataset, plan)
  const retrievedIds = new Set(plan.retrievedEvidenceIds)
  const planSummary = {
    signalEvidence: plan.signalPlans.map((entry) => ({
      signalId: entry.signalId,
      evidenceIds: entry.evidenceIds.filter((id) => retrievedIds.has(id)),
    })),
    nodeEvidence: plan.nodeEvidenceRequests.map((entry) => ({
      nodeId: entry.nodeId,
      evidenceIds: entry.evidenceIds.filter((id) => retrievedIds.has(id)),
    })).filter((entry) => entry.evidenceIds.length > 0),
    retrievedEvidenceIds: plan.retrievedEvidenceIds,
  }
  const retrievedReadings = retrieved.evidence.map((entry) => [
    `${entry.id}: ${entry.authoredAt?.slice(0, 10) ?? 'unknown-date'} ${entry.subject ?? '(no subject)'}`,
    `Reading: ${entry.reading ?? '(no reading)'}`,
  ].join('\n')).join('\n\n')
  const request = {
    model,
    max_tokens: decisionMaxTokens,
    usage: { include: true },
    messages: [
      { role: 'system', content: STAGED_DECISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Broker-selected evidence map (planner prose intentionally omitted):

${JSON.stringify(planSummary)}

Current provisional hierarchy:

${JSON.stringify(compactHierarchyForPrompt(retrieved.hierarchy ?? []))}

Current-node stable exemplar references:

${JSON.stringify(retrieved.nodeContext ?? [])}

Structural signals:

${JSON.stringify(compactSignalsForPrompt(retrieved))}

Retrieved reading registry:

${retrievedReadings || '(none)'}

Review all ${retrieved.shape?.hierarchyNodes ?? 0} current nodes and account for all ${
          hierarchyReviewSignals(retrieved).length} supplied signals.`,
      },
    ],
  }
  if (reasoningEffort) request.reasoning = { effort: reasoningEffort }
  return request
}

export function parseStagedHierarchyDecision(payload, dataset, plan) {
  return parseHierarchyCriticPayload(payload, buildRetrievedHierarchyReview(dataset, plan))
}

export const requestPromptCharacters = (request) => request.messages
  .map((message) => message.content).join('\n').length

export function fingerprintStagedHierarchyCriticProtocol(
  dataset,
  {
    plannerModel = DEFAULT_MODEL,
    plannerProtocol = 'broker-ranked-v1',
    model = DEFAULT_MODEL,
    maxEvidenceReadings = 32,
    planMaxTokens = 8000,
    decisionMaxTokens = 12000,
    reasoningEffort = null,
  } = {},
) {
  const retrievalPlanSystemPrompt = PLAN_PROTOCOLS[plannerProtocol]
  if (!retrievalPlanSystemPrompt) throw new Error(`unknown planner protocol: ${plannerProtocol}`)
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: '0.1.0',
    hierarchyReviewContentSha256: dataset.protocol?.contentSha256 ?? null,
    plannerModel,
    plannerProtocol,
    model,
    maxEvidenceReadings,
    planMaxTokens,
    decisionMaxTokens,
    reasoningEffort,
    retrievalPlanSystemPrompt,
    decisionSystemPrompt: STAGED_DECISION_SYSTEM_PROMPT,
  })).digest('hex')
}

export function stagedHierarchyCriticDocument(
  dataset,
  plan,
  decision,
  {
    plannerModel = DEFAULT_MODEL,
    plannerProtocol = 'broker-ranked-v1',
    model = DEFAULT_MODEL,
    maxEvidenceReadings = 32,
    planMaxTokens = 8000,
    decisionMaxTokens = 12000,
    reasoningEffort = null,
    planRequest,
    decisionRequest,
  } = {},
) {
  const staticCharacters = requestPromptCharacters(buildHierarchyCriticRequest(dataset, {
    model,
    maxTokens: decisionMaxTokens,
  }))
  const planCharacters = requestPromptCharacters(planRequest)
  const decisionCharacters = requestPromptCharacters(decisionRequest)
  return {
    schemaVersion: '0.1.0',
    method: `capability-hierarchy-staged-critic:openrouter:${model}`,
    repository: dataset.repository,
    headSha: dataset.headSha,
    source: { hierarchyReviewContentSha256: dataset.protocol?.contentSha256 ?? null },
    protocol: {
      model,
      plannerModel,
      plannerProtocol,
      maxEvidenceReadings,
      planMaxTokens,
      decisionMaxTokens,
      reasoningEffort,
      requestSha256: fingerprintStagedHierarchyCriticProtocol(dataset, {
        plannerModel, plannerProtocol, model, maxEvidenceReadings, planMaxTokens, decisionMaxTokens,
        reasoningEffort,
      }),
      planRequestSha256: fingerprintInductionRequest(planRequest),
      decisionRequestSha256: fingerprintInductionRequest(decisionRequest),
    },
    retrieval: {
      ...plan,
      usage: undefined,
      promptCharacters: {
        staticRequest: staticCharacters,
        plan: planCharacters,
        decision: decisionCharacters,
        total: planCharacters + decisionCharacters,
        peak: Math.max(planCharacters, decisionCharacters),
        decisionVsStaticShare: staticCharacters === 0 ? 0 : decisionCharacters / staticCharacters,
      },
    },
    ...decision,
    usage: {
      plan: plan.usage ?? null,
      decision: decision.usage ?? null,
      cost: (plan.usage?.cost ?? 0) + (decision.usage?.cost ?? 0),
    },
  }
}
