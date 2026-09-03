import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCapabilityHierarchyReviewDataset } from '../scripts/lib/capability-hierarchy-review.mjs'
import {
  HIERARCHY_CRITIC_SYSTEM_PROMPT,
  buildHierarchyCriticRequest,
  parseHierarchyCriticPayload,
} from '../scripts/lib/capability-hierarchy-critic.mjs'

const readings = {
  repository: 'test', headSha: 'head',
  readings: ['a', 'b', 'c'].map((commitSha, index) => ({
    commitSha, shortSha: commitSha, authoredAt: `2026-01-0${index + 1}T00:00:00Z`,
    subject: `Commit ${commitSha}`, tier1: { summary: `Reading ${commitSha}` },
  })),
}

const node = (id, name, evidence, children = []) => ({
  id, name, summary: `${name} summary`, audience: 'developer',
  directEvidence: children.length > 0 ? [] : evidence,
  rollupEvidence: evidence, directCommitCount: children.length > 0 ? 0 : evidence.length,
  commitCount: evidence.length, children,
})

const hierarchy = (capabilities) => ({
  repository: 'test', headSha: 'head', readingCount: 3,
  commits: { a: {}, b: {}, c: {} },
  protocol: { requestSha256: 'induction-request' }, capabilities,
})

const disagreementDataset = (capabilities) => ({
  repository: 'test', headSha: 'head', protocol: { contentSha256: 'disagreements' },
  hierarchy: capabilities,
  stableExemplars: [{ id: 'E0', capabilityId: 'capability:0', commitSha: 'a' }],
  disagreements: [{ commitSha: 'b' }],
})

const critic = (verdict = 'map_insufficient') => ({
  repository: 'test', headSha: 'head',
  source: { disagreementContentSha256: 'disagreements' },
  protocol: { requestSha256: 'critic-request', candidateUnionVisible: false },
  decisions: [{ input: 0, commitSha: 'b', verdict, reason: 'No suitable node.' }],
})

test('hierarchy review packets combine recurring gaps with evidence-set boundary comparisons', () => {
  const baselineNodes = [node('capability:0', 'Baseline', ['a', 'b'])]
  const dataset = buildCapabilityHierarchyReviewDataset(
    readings,
    hierarchy(baselineNodes),
    [hierarchy([node('capability:0', 'Alternative', ['a', 'c'])])],
    disagreementDataset(baselineNodes),
    [critic(), critic()],
    { samplesPerSet: 1 },
  )
  assert.equal(dataset.shape.hierarchyNodes, 1)
  assert.equal(dataset.shape.gapSignals, 1)
  assert.equal(dataset.shape.boundarySignals, 1)
  assert.equal(dataset.signals.boundarySignals[0].overlap.jaccard, 1 / 3)
  assert.equal(dataset.signals.gapSignals[0].recurrence.mapInsufficient, 2)
  assert.ok(dataset.evidence.every((entry) => entry.reading.startsWith('Reading')))
})

test('focused review packets select the lowest-overlap boundaries without model output', () => {
  const baselineNodes = [node('capability:0', 'Baseline', ['a', 'b'])]
  const dataset = buildCapabilityHierarchyReviewDataset(
    readings,
    hierarchy(baselineNodes),
    [
      hierarchy([node('capability:0', 'Loose match', ['a', 'c'])]),
      hierarchy([node('capability:0', 'Close match', ['a', 'b', 'c'])]),
    ],
    disagreementDataset(baselineNodes),
    [critic(), critic()],
    { maxBoundarySignals: 1, nodeExemplarsPerNode: 1 },
  )
  assert.equal(dataset.shape.availableBoundarySignals, 2)
  assert.equal(dataset.shape.boundarySignals, 1)
  assert.equal(dataset.signals.boundarySignals[0].overlap.jaccard, 1 / 3)
  assert.equal(dataset.nodeContext[0].stableExemplarIds.length, 1)
})

test('hierarchy critic is a proposal-only evidence review without an owner target', () => {
  const baselineNodes = [node('capability:0', 'Baseline', ['a', 'b'])]
  const dataset = buildCapabilityHierarchyReviewDataset(
    readings,
    hierarchy(baselineNodes),
    [hierarchy([node('capability:0', 'Alternative', ['a', 'c'])])],
    disagreementDataset(baselineNodes),
    [critic(), critic()],
  )
  const request = buildHierarchyCriticRequest(dataset)
  assert.match(HIERARCHY_CRITIC_SYSTEM_PROMPT, /suggestions only/)
  assert.match(HIERARCHY_CRITIC_SYSTEM_PROMPT, /No maintainer taxonomy/)
  assert.doesNotMatch(request.messages[1].content, /gold answer/)
  assert.equal(buildHierarchyCriticRequest(dataset, { maxTokens: 12000 }).max_tokens, 12000)
})

test('hierarchy critic keeps supported proposals provisional and reports incomplete review', () => {
  const baselineNodes = [node('capability:0', 'Baseline', ['a', 'b'])]
  const dataset = buildCapabilityHierarchyReviewDataset(
    readings,
    hierarchy(baselineNodes),
    [hierarchy([node('capability:0', 'Alternative', ['a', 'c'])])],
    disagreementDataset(baselineNodes),
    [critic(), critic()],
  )
  const evidenceId = dataset.signals.gapSignals[0].evidenceIds[0]
  const payload = {
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      reviewedNodeIds: ['capability:0'],
      proposals: [{
        operation: 'add_node', targetNodeIds: [], proposedParentId: null,
        name: 'Dependency automation', summary: 'Keeps dependencies current.',
        replacementNodes: [], evidenceIds: [evidenceId], signalIds: ['G0'],
        reason: 'Recurring evidence has no node.', confidence: 'high',
      }, {
        operation: 'remove_node', targetNodeIds: ['capability:0'], proposedParentId: null,
        name: null, summary: null, replacementNodes: [], evidenceIds: ['unknown'],
        signalIds: [], reason: 'Unsupported.', confidence: 'high',
      }, {
        operation: 'reparent_node', targetNodeIds: ['capability:0'], proposedParentId: null,
        name: null, summary: null, replacementNodes: [], evidenceIds: [evidenceId],
        signalIds: [], reason: 'Already top-level.', confidence: 'high',
      }],
      unresolvedSignalIds: [],
    }) } }],
    usage: { cost: 0.01 },
  }
  const result = parseHierarchyCriticPayload(payload, dataset)
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].interpretationStatus, 'candidate')
  assert.equal(result.shape.completeReview, false)
  assert.deepEqual(result.diagnostics.unsupportedProposals, [1])
  assert.deepEqual(result.diagnostics.invalidProposals, [2])
  assert.deepEqual(result.diagnostics.omittedSignalIds, ['B0'])
})

test('truncated hierarchy critic output fails explicitly', () => {
  assert.throws(
    () => parseHierarchyCriticPayload(
      { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
      { hierarchy: [], signals: {}, evidence: [] },
    ),
    /truncated/,
  )
})
