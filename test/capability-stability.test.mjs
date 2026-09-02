import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareInductionRuns,
  jaccard,
  matchNodes,
} from '../scripts/lib/capability-stability.mjs'

const node = (id, name, evidence, children = []) => ({
  id,
  name,
  directEvidence: children.length === 0 ? evidence : [],
  rollupEvidence: evidence,
  children,
})

const document = (capabilities, overrides = {}) => {
  const commits = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((sha) => [sha, {}]))
  const assigned = new Set(capabilities.flatMap((capability) => capability.rollupEvidence))
  return {
    schemaVersion: '0.2.0',
    repository: 'test',
    headSha: 'head',
    protocol: { requestSha256: 'same-request' },
    commits,
    capabilities,
    unassigned: [...Object.keys(commits).filter((sha) => !assigned.has(sha))],
    shape: { topLevelCapabilities: capabilities.length },
    ...overrides,
  }
}

test('jaccard compares evidence sets rather than order or duplicates', () => {
  assert.equal(jaccard(['a', 'b', 'b'], ['b', 'a']), 1)
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3)
  assert.equal(jaccard([], []), 1)
})

test('node matching ignores names and finds the maximum evidence assignment', () => {
  const left = [
    { id: 'left-1', name: 'Same label', evidence: ['a', 'b'] },
    { id: 'left-2', name: 'Other', evidence: ['c', 'd'] },
  ]
  const right = [
    { id: 'right-1', name: 'Same label', evidence: ['c', 'd'] },
    { id: 'right-2', name: 'Renamed entirely', evidence: ['a', 'b'] },
  ]
  const result = matchNodes(left, right)
  assert.deepEqual(result.matches.map((match) => [match.left.id, match.right.id]), [
    ['left-1', 'right-2'],
    ['left-2', 'right-1'],
  ])
  assert.ok(result.matches.every((match) => match.jaccard === 1))
})

test('disjoint nodes remain unmatched instead of being paired by position', () => {
  const result = matchNodes(
    [{ id: 'left', name: 'Coincidental', evidence: ['a'] }],
    [{ id: 'right', name: 'Coincidental', evidence: ['b'] }],
  )
  assert.equal(result.matches.length, 0)
  assert.equal(result.unmatchedLeft.length, 1)
  assert.equal(result.unmatchedRight.length, 1)
})

test('comparison measures membership and parent recurrence without using labels', () => {
  const left = document([
    node('l-1', 'Catalog', ['a', 'b'], [node('l-1-1', 'Search', ['a'])]),
    node('l-2', 'Profiles', ['c', 'd'], [node('l-2-1', 'Details', ['c', 'd'])]),
  ])
  const right = document([
    node('r-1', 'Completely renamed', ['c', 'd'], [node('r-1-1', 'Also renamed', ['c', 'd'])]),
    node('r-2', 'Different words', ['a', 'b'], [node('r-2-1', 'No lexical clue', ['a'])]),
  ])
  const report = compareInductionRuns([left, right])
  assert.equal(report.aggregate.umbrellaCoMembershipF1.mean, 1)
  assert.equal(report.aggregate.childCoMembershipF1.mean, 1)
  assert.equal(report.aggregate.parentRelationshipShare.mean, 1)
  assert.equal(report.aggregate.parentRelationshipIntersectionWeightedShare.mean, 1)
  assert.equal(report.pairwise[0].umbrellaMatching.meanMatchedJaccard, 1)
})

test('a child moved beneath another matched umbrella is a hierarchy disagreement', () => {
  const left = document([
    node('l-1', 'One', ['a', 'b'], [node('l-1-1', 'Child', ['a'])]),
    node('l-2', 'Two', ['c', 'd'], [node('l-2-1', 'Other', ['c'])]),
  ])
  const right = document([
    node('r-1', 'One', ['a', 'b'], [node('r-1-1', 'Other', ['c'])]),
    node('r-2', 'Two', ['c', 'd'], [node('r-2-1', 'Child', ['a'])]),
  ])
  const report = compareInductionRuns([left, right])
  assert.equal(report.pairwise[0].parentRelationshipAgreement.sameMatchedParent, 0)
  assert.equal(report.pairwise[0].parentRelationshipAgreement.share, 0)
  assert.equal(report.pairwise[0].parentRelationshipAgreement.intersectionWeightedShare, 0)
})

test('comparison refuses changed or missing protocols by default', () => {
  const first = document([node('one', 'One', ['a'])])
  const changed = document([node('two', 'Two', ['a'])], { protocol: { requestSha256: 'changed' } })
  const legacy = document([node('three', 'Three', ['a'])], { protocol: null })
  const changedSchema = document([node('four', 'Four', ['a'])], { schemaVersion: '0.3.0' })
  assert.throws(() => compareInductionRuns([first, changed]), /shared comparison protocol/)
  assert.throws(() => compareInductionRuns([first, legacy]), /shared comparison protocol/)
  assert.throws(() => compareInductionRuns([first, changedSchema]), /different parsed-document schemas/)
  assert.equal(compareInductionRuns([first, legacy], { allowMixedProtocols: true }).protocol.comparable, false)
  assert.deepEqual(
    compareInductionRuns([first, changedSchema], { allowMixedProtocols: true }).protocol.parsedDocumentSchemas,
    ['0.2.0', '0.3.0'],
  )
})

test('assignment documents may share a protocol while using different hierarchy requests', () => {
  const first = document([node('one', 'One', ['a'])], {
    protocol: { requestSha256: 'hierarchy-one', comparisonSha256: 'assignment-v1' },
  })
  const second = document([node('two', 'Two', ['a'])], {
    protocol: { requestSha256: 'hierarchy-two', comparisonSha256: 'assignment-v1' },
  })
  const report = compareInductionRuns([first, second])
  assert.equal(report.protocol.comparable, true)
  assert.equal(report.protocol.requestsIdentical, false)
  assert.equal(report.protocol.comparisonSha256, 'assignment-v1')
})
