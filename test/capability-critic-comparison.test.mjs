import assert from 'node:assert/strict'
import test from 'node:test'

import { compareCapabilityCritics } from '../scripts/lib/capability-critic-comparison.mjs'

const dataset = {
  repository: 'test', headSha: 'head', protocol: { contentSha256: 'dataset' },
  disagreements: [{
    commitSha: 'a', candidateCapabilityIds: ['capability:0', 'capability:1'],
    alternatives: [
      { capabilityIds: ['capability:0'], occurrences: 2 },
      { capabilityIds: ['capability:1'], occurrences: 1 },
    ],
  }, {
    commitSha: 'b', candidateCapabilityIds: ['capability:1'],
    alternatives: [
      { capabilityIds: [], occurrences: 1 },
      { capabilityIds: ['capability:1'], occurrences: 2 },
    ],
  }],
}

const document = (visible, decisions) => ({
  repository: 'test', headSha: 'head',
  source: { disagreementContentSha256: 'dataset' },
  protocol: {
    candidateUnionVisible: visible,
    model: 'test-model',
    requestSha256: visible ? 'visible-request' : 'blind-request',
  },
  decisions,
})

test('critic comparison reports prompt anchoring without calling either answer correct', () => {
  const report = compareCapabilityCritics(dataset, [
    document(true, [{
      input: 0, commitSha: 'a', verdict: 'assign',
      selectedCapabilityIds: ['capability:0', 'capability:1'], plausibleCapabilityIds: [],
      unassignedPlausible: false, referenceExemplarIds: ['E0'],
    }, {
      input: 1, commitSha: 'b', verdict: 'assign',
      selectedCapabilityIds: ['capability:1'], plausibleCapabilityIds: [],
      unassignedPlausible: false, referenceExemplarIds: [],
    }]),
    document(false, [{
      input: 0, commitSha: 'a', verdict: 'assign',
      selectedCapabilityIds: ['capability:0'], plausibleCapabilityIds: [],
      unassignedPlausible: false, referenceExemplarIds: [],
    }, {
      input: 1, commitSha: 'b', verdict: 'unassigned',
      selectedCapabilityIds: [], plausibleCapabilityIds: [],
      unassignedPlausible: true, referenceExemplarIds: [],
    }]),
  ], { ids: ['visible', 'blind'] })
  assert.equal(report.critics[0].shape.exactCandidateUnionShare, 1)
  assert.equal(report.critics[0].shape.candidateEdgeRetentionShare, 1)
  assert.equal(report.critics[1].shape.exactPluralityShare, 0.5)
  assert.equal(report.critics[1].shape.candidateEdgeRetentionShare, 1 / 3)
  assert.equal(report.comparison.sameVerdictShare, 0.5)
  assert.equal(report.comparison.exactDecisionShare, 0)
  assert.equal(report.comparison.selectedEdgeF1, 0.5)
})

test('critic comparison separates within-treatment and cross-treatment repeats', () => {
  const visible = document(true, [{
    input: 0, commitSha: 'a', verdict: 'assign',
    selectedCapabilityIds: ['capability:0'], plausibleCapabilityIds: [],
    unassignedPlausible: false, referenceExemplarIds: [],
  }, {
    input: 1, commitSha: 'b', verdict: 'assign',
    selectedCapabilityIds: ['capability:1'], plausibleCapabilityIds: [],
    unassignedPlausible: false, referenceExemplarIds: [],
  }])
  const blind = document(false, [{
    input: 0, commitSha: 'a', verdict: 'unassigned',
    selectedCapabilityIds: [], plausibleCapabilityIds: [],
    unassignedPlausible: true, referenceExemplarIds: [],
  }, {
    input: 1, commitSha: 'b', verdict: 'assign',
    selectedCapabilityIds: ['capability:1'], plausibleCapabilityIds: [],
    unassignedPlausible: false, referenceExemplarIds: [],
  }])
  const report = compareCapabilityCritics(
    dataset,
    [visible, visible, blind, blind],
    { ids: ['visible-1', 'visible-2', 'blind-1', 'blind-2'] },
  )
  assert.equal(report.pairwise.length, 6)
  assert.equal(report.treatments['visible-within'].comparisons, 1)
  assert.equal(report.treatments['blind-within'].comparisons, 1)
  assert.equal(report.treatments['cross-treatment'].comparisons, 4)
  assert.equal(report.treatments['visible-within'].exactDecisionShare.mean, 1)
  assert.equal(report.treatments['cross-treatment'].exactDecisionShare.mean, 0.5)
})

test('critic comparison rejects prompt changes hidden inside one treatment', () => {
  const decisions = [{
    input: 0, commitSha: 'a', verdict: 'unassigned',
    selectedCapabilityIds: [], plausibleCapabilityIds: [],
    unassignedPlausible: true, referenceExemplarIds: [],
  }, {
    input: 1, commitSha: 'b', verdict: 'unassigned',
    selectedCapabilityIds: [], plausibleCapabilityIds: [],
    unassignedPlausible: true, referenceExemplarIds: [],
  }]
  const changed = document(false, decisions)
  changed.protocol.requestSha256 = 'changed-request'
  assert.throws(
    () => compareCapabilityCritics(dataset, [document(false, decisions), changed]),
    /changed their request fingerprint/,
  )
})
