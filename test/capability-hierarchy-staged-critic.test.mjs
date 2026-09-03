import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHierarchyRetrievalPlanRequest,
  buildRetrievedHierarchyReview,
  buildStagedHierarchyDecisionRequest,
  parseHierarchyRetrievalPlan,
  parseStagedHierarchyDecision,
  stagedHierarchyCriticDocument,
} from '../scripts/lib/capability-hierarchy-staged-critic.mjs'

const dataset = {
  repository: 'test',
  headSha: 'head',
  protocol: { contentSha256: 'packet' },
  hierarchy: [{
    id: 'capability:0', name: 'Umbrella', summary: 'Broad outcome.', children: [{
      id: 'capability:0.0', name: 'Child', summary: 'Narrow outcome.', children: [],
    }],
  }],
  nodeContext: [
    { nodeId: 'capability:0', stableExemplarIds: ['R0'] },
    { nodeId: 'capability:0.0', stableExemplarIds: ['R1'] },
  ],
  signals: {
    gapSignals: [{ id: 'G0', evidenceIds: ['R2'], reasons: ['No suitable node.'] }],
    boundarySignals: [{
      id: 'B0', baselineNodeId: 'capability:0.0', overlap: { jaccard: 0.2 },
      evidenceIds: { shared: ['R0'], baselineOnly: ['R1'], alternativeOnly: ['R2'] },
    }],
    unmatchedAlternativeSignals: [],
  },
  evidence: ['zero', 'one', 'two'].map((reading, index) => ({
    id: `R${index}`,
    authoredAt: `2026-01-0${index + 1}T00:00:00Z`,
    subject: `Commit ${index}`,
    reading: `Private interpretation ${reading}`,
  })),
  shape: {
    hierarchyNodes: 2, gapSignals: 1, boundarySignals: 1,
    unmatchedAlternativeSignals: 0, evidenceReadings: 3,
  },
}

const payload = (value, usage = { cost: 0.01 }) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage,
})

const completePlanPayload = () => payload({
  signalPlans: [
    { signalId: 'G0', evidenceIds: ['R2'], reason: 'Read the possible gap.' },
    { signalId: 'B0', evidenceIds: ['R1'], reason: 'Read the disputed boundary.' },
  ],
  nodeEvidenceRequests: [
    { nodeId: 'capability:0', evidenceIds: ['R0'], reason: 'Check the umbrella.' },
  ],
})

test('retrieval planning exposes a catalog but withholds reading interpretations', () => {
  const request = buildHierarchyRetrievalPlanRequest(dataset, {
    plannerModel: 'planner', maxEvidenceReadings: 2, planMaxTokens: 4000,
  })
  const prompt = request.messages.map((message) => message.content).join('\n')
  assert.equal(request.model, 'planner')
  assert.equal(request.max_tokens, 4000)
  assert.match(prompt, /Commit 0/)
  assert.doesNotMatch(prompt, /Private interpretation/)
  assert.match(prompt, /at most 2 requested readings/)
})

test('retrieval plans must cover every signal and the broker enforces the evidence budget', () => {
  const plan = parseHierarchyRetrievalPlan(completePlanPayload(), dataset, {
    maxEvidenceReadings: 3,
  })
  assert.equal(plan.shape.completePlan, true)
  assert.deepEqual(plan.requestedEvidenceIds, ['R0', 'R1', 'R2'])
  assert.deepEqual(plan.retrievedEvidenceIds, ['R0', 'R1', 'R2'])

  const overBudget = parseHierarchyRetrievalPlan(completePlanPayload(), dataset, {
    maxEvidenceReadings: 2,
  })
  assert.equal(overBudget.shape.requestWithinBudget, false)
  assert.equal(overBudget.shape.withinBudget, true)
  assert.equal(overBudget.shape.brokerTruncated, true)
  assert.equal(overBudget.shape.completePlan, true)
  assert.equal(overBudget.retrievedEvidenceIds.length, 2)
  assert.equal(buildRetrievedHierarchyReview(dataset, overBudget).evidence.length, 2)

  const omitted = parseHierarchyRetrievalPlan(payload({
    signalPlans: [{ signalId: 'G0', evidenceIds: [], reason: 'No reading needed.' }],
    nodeEvidenceRequests: [],
  }), dataset)
  assert.deepEqual(omitted.diagnostics.omittedSignalIds, ['B0'])
  assert.equal(omitted.shape.completePlan, false)
})

test('the decision stage receives only requested readings and remains evidence validated', () => {
  const plan = parseHierarchyRetrievalPlan(completePlanPayload(), dataset, {
    maxEvidenceReadings: 3,
  })
  const request = buildStagedHierarchyDecisionRequest(dataset, plan, {
    model: 'decision', decisionMaxTokens: 6000, reasoningEffort: 'low',
  })
  assert.equal(request.model, 'decision')
  assert.equal(request.max_tokens, 6000)
  assert.deepEqual(request.reasoning, { effort: 'low' })
  const prompt = request.messages.map((message) => message.content).join('\n')
  assert.match(prompt, /Private interpretation zero/)
  assert.match(prompt, /Private interpretation one/)
  assert.match(prompt, /Private interpretation two/)
  assert.doesNotMatch(prompt, /Read the possible gap/)

  const decision = parseStagedHierarchyDecision(payload({
    reviewedNodeIds: ['capability:0', 'capability:0.0'],
    proposals: [{
      operation: 'add_node', targetNodeIds: [], proposedParentId: 'capability:0',
      name: 'Dependency automation', summary: 'Automated dependency upkeep.',
      replacementNodes: [], evidenceIds: ['R2'], signalIds: ['G0'],
      reason: 'The gap is supported.', confidence: 'high',
    }],
    unresolvedSignalIds: ['B0'],
  }), dataset, plan)
  assert.equal(decision.shape.completeReview, true)
  assert.equal(decision.proposals.length, 1)
})

test('staged documents preserve the base protocol while recording actual retrieval', () => {
  const options = {
    plannerModel: 'planner', model: 'decision', maxEvidenceReadings: 3,
    planMaxTokens: 4000, decisionMaxTokens: 6000, reasoningEffort: 'low',
  }
  const plan = parseHierarchyRetrievalPlan(completePlanPayload(), dataset, options)
  const planRequest = buildHierarchyRetrievalPlanRequest(dataset, options)
  const decisionRequest = buildStagedHierarchyDecisionRequest(dataset, plan, options)
  const decision = parseStagedHierarchyDecision(payload({
    reviewedNodeIds: ['capability:0', 'capability:0.0'],
    proposals: [], unresolvedSignalIds: ['G0', 'B0'],
  }, { cost: 0.02 }), dataset, plan)
  const document = stagedHierarchyCriticDocument(dataset, plan, decision, {
    ...options, planRequest, decisionRequest,
  })
  assert.equal(document.protocol.plannerModel, 'planner')
  assert.equal(document.protocol.model, 'decision')
  assert.equal(document.protocol.reasoningEffort, 'low')
  assert.equal(document.retrieval.shape.requestedEvidenceReadings, 3)
  assert.equal(document.retrieval.shape.retrievedEvidenceReadings, 3)
  assert.equal(document.usage.cost, 0.03)
  assert.ok(document.retrieval.promptCharacters.peak > 0)
  assert.ok(document.protocol.requestSha256)
  assert.ok(document.protocol.planRequestSha256)
  assert.ok(document.protocol.decisionRequestSha256)
})
