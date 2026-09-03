import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareHierarchyCritics,
  hierarchyProposalKey,
} from '../scripts/lib/capability-hierarchy-critic-comparison.mjs'

const proposal = (operation, targetNodeIds, proposedParentId, evidenceIds, overrides = {}) => ({
  operation, targetNodeIds, proposedParentId, evidenceIds,
  signalIds: [], replacementNodes: [], confidence: 'medium',
  ...overrides,
})

const document = (proposals, overrides = {}) => ({
  repository: 'test', headSha: 'head',
  source: { hierarchyReviewContentSha256: 'packet' },
  protocol: { model: 'test-model', requestSha256: 'request' },
  shape: {
    hierarchyNodes: 37, reviewedNodes: 37, signals: 33, accountedSignals: 33,
    proposals: proposals.length,
  },
  proposals,
  ...overrides,
})

test('proposal identity uses operation and structural targets rather than wording', () => {
  const left = proposal('add_node', [], 'capability:10', ['R1'], { name: 'Dependencies' })
  const right = proposal('add_node', [], 'capability:10', ['R1'], { name: 'Update automation' })
  assert.equal(hierarchyProposalKey(left), hierarchyProposalKey(right))
  assert.notEqual(
    hierarchyProposalKey(left),
    hierarchyProposalKey(proposal('add_node', [], 'capability:10', ['R2'])),
  )
})

test('hierarchy critic comparison measures recurring targets and evidence separately', () => {
  const splitLeft = proposal('split_node', ['capability:6'], null, ['R1', 'R2'], {
    replacementNodes: [
      { name: 'Growth', evidenceIds: ['R1'] },
      { name: 'Analytics', evidenceIds: ['R2'] },
    ],
  })
  const splitRight = proposal('split_node', ['capability:6'], null, ['R2', 'R3'], {
    replacementNodes: [
      { name: 'Instrumentation', evidenceIds: ['R2'] },
      { name: 'Acquisition', evidenceIds: ['R1'] },
    ],
  })
  const add = proposal('add_node', [], 'capability:10', ['R4'])
  const report = compareHierarchyCritics([
    document([splitLeft, add]),
    document([splitRight]),
    document([splitRight, add]),
  ], { runIds: ['one', 'two', 'three'] })
  assert.equal(report.aggregate.comparisons, 3)
  assert.equal(report.proposalRecurrence.find(
    (entry) => entry.operation === 'split_node').runCount, 3)
  assert.equal(report.proposalRecurrence.find(
    (entry) => entry.operation === 'add_node').runCount, 2)
  assert.equal(report.pairwise[0].matchedProposalEvidenceJaccard.mean, 1 / 3)
  assert.equal(report.pairwise[0].splitReplacementComparisons[0].matched, 2)
  assert.equal(report.qualityGate.allRunsComplete, true)
  assert.equal(report.proposalRecurrence.find(
    (entry) => entry.operation === 'split_node').eligibleForAutomaticRevision, true)
})

test('hierarchy critic comparison rejects changed packets or requests', () => {
  const base = document([])
  assert.throws(
    () => compareHierarchyCritics([
      base,
      document([], { source: { hierarchyReviewContentSha256: 'other' } }),
    ]),
    /different review packets/,
  )
  assert.throws(
    () => compareHierarchyCritics([
      base,
      document([], { protocol: { model: 'test-model', requestSha256: 'other' } }),
    ]),
    /different requests/,
  )
})

test('a recurring proposal remains ineligible when any critic skipped signals', () => {
  const recurring = proposal('add_node', [], 'capability:10', ['R1'], {
    signalIds: ['G0'], name: 'Dependency automation',
  })
  const incomplete = document([recurring], {
    shape: {
      hierarchyNodes: 37, reviewedNodes: 37, signals: 33, accountedSignals: 2,
      proposals: 1,
    },
  })
  const report = compareHierarchyCritics([document([recurring]), incomplete])
  assert.equal(report.qualityGate.allRunsComplete, false)
  assert.equal(report.proposalRecurrence[0].recursAcrossAllRuns, true)
  assert.equal(report.proposalRecurrence[0].eligibleForAutomaticRevision, false)
  assert.equal(report.aggregate.accountedSignalShare.min, 2 / 33)
})
