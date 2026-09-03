import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCapabilityDisagreementDataset } from '../scripts/lib/capability-disagreement.mjs'

const readings = [0, 1, 2, 3].map((index) => ({
  commitSha: `full-${index}`,
  shortSha: `short-${index}`,
  authoredAt: `2025-01-0${index + 1}T00:00:00Z`,
  subject: `change ${index}`,
  tier1: { summary: `Does thing ${index}.` },
}))

const hierarchy = {
  repository: 'test', headSha: 'head', protocol: { requestSha256: 'hierarchy-request' },
  capabilities: [{
    id: 'capability:0', name: 'Umbrella', summary: 'Broad.', audience: 'user',
    children: [{
      id: 'capability:0.0', name: 'Child A', summary: 'A.', audience: 'user', children: [],
    }, {
      id: 'capability:0.1', name: 'Child B', summary: 'B.', audience: 'user', children: [],
    }],
  }],
}

const assignment = (a, b) => ({
  repository: 'test', headSha: 'head', protocol: { requestSha256: 'assignment-request' },
  capabilities: [{
    ...hierarchy.capabilities[0], directEvidence: [],
    children: [{ ...hierarchy.capabilities[0].children[0], directEvidence: a }, {
      ...hierarchy.capabilities[0].children[1], directEvidence: b,
    }],
  }],
})

test('disagreement extraction retains alternatives but selects exemplars only from stable commits', () => {
  const dataset = buildCapabilityDisagreementDataset(
    { repository: 'test', headSha: 'head', readings },
    hierarchy,
    [
      assignment(['full-0', 'full-1', 'full-3'], ['full-3']),
      assignment(['full-0', 'full-3'], ['full-1', 'full-3']),
      assignment(['full-0', 'full-3'], ['full-1', 'full-3']),
    ],
    { exemplarsPerCapability: 2 },
  )
  assert.equal(dataset.shape.totalCommits, 4)
  assert.equal(dataset.shape.stableCommits, 3)
  assert.equal(dataset.shape.disagreementCommits, 1)
  assert.equal(dataset.disagreements[0].commitSha, 'full-1')
  assert.deepEqual(dataset.disagreements[0].candidateCapabilityIds, [
    'capability:0.0', 'capability:0.1',
  ])
  assert.deepEqual(dataset.disagreements[0].alternatives, [
    { capabilityIds: ['capability:0.0'], occurrences: 1 },
    { capabilityIds: ['capability:0.1'], occurrences: 2 },
  ])
  assert.ok(dataset.stableExemplars.every((entry) => entry.commitSha !== 'full-1'))
  assert.ok(dataset.protocol.contentSha256)
})

test('disagreement extraction rejects runs that changed the request or hierarchy', () => {
  const changedRequest = assignment(['full-0'], [])
  changedRequest.protocol.requestSha256 = 'other'
  assert.throws(() => buildCapabilityDisagreementDataset(
    { repository: 'test', headSha: 'head', readings }, hierarchy,
    [assignment(['full-0'], []), changedRequest],
  ), /identical complete request/)

  const changedHierarchy = assignment(['full-0'], [])
  changedHierarchy.capabilities[0].name = 'Renamed'
  assert.throws(() => buildCapabilityDisagreementDataset(
    { repository: 'test', headSha: 'head', readings }, hierarchy,
    [assignment(['full-0'], []), changedHierarchy],
  ), /same fixed hierarchy/)
})
