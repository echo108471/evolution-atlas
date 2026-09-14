import test from 'node:test'
import assert from 'node:assert/strict'
import { scopeTensions, ownershipRequest, validateOwnership } from '../scripts/lib/behavior-ownership.mjs'
const nodes = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }]
const pairs = [{ id: 'AB', a: 'A', b: 'B' }, { id: 'BC', a: 'B', b: 'C' }, { id: 'AC', a: 'A', b: 'C' }]
test('broader-overlap-distinct is a conditional scope diagnostic, not automatic correction', () => {
  const r = { decisions: [{ id: 'AB', relation: 'a_broader' }, { id: 'BC', relation: 'overlapping' }, { id: 'AC', relation: 'distinct' }] }, before = structuredClone(r)
  assert.equal(scopeTensions(pairs, r).length, 1); assert.deepEqual(r, before)
  assert.match(scopeTensions(pairs, r)[0].assumption, /Overlap is not generally transitive/)
  assert.equal(scopeTensions(pairs, { decisions: [...r.decisions.slice(0, 2), { id: 'AC', relation: 'unresolved' }] }).length, 0)
})
test('overlap chains alone produce no false transitivity rule', () => {
  assert.equal(scopeTensions(pairs, { decisions: [{ id: 'AB', relation: 'overlapping' }, { id: 'BC', relation: 'overlapping' }, { id: 'AC', relation: 'distinct' }] }).length, 0)
})
test('diagnostics handle reversed broader direction', () => {
  const p = [{ id: 'BA', a: 'B', b: 'A' }, pairs[1], pairs[2]]
  assert.equal(scopeTensions(p, { decisions: [{ id: 'BA', relation: 'b_broader' }, { id: 'BC', relation: 'overlapping' }, { id: 'AC', relation: 'distinct' }] })[0].larger, 'A')
})
test('requests explicitly allow composite scope and exclude previous decisions and owner examples', () => {
  const packet = { evidence: [], searches: [] }, a = ownershipRequest(nodes, pairs, packet, 'a'.repeat(40), 'test'), b = ownershipRequest(nodes, pairs, packet, 'a'.repeat(40), 'test', true)
  assert.equal(a.messages[0].content, b.messages[0].content); assert.match(a.messages[0].content, /MAY combine several responsibilities/)
  const x = JSON.parse(a.messages[1].content), y = JSON.parse(b.messages[1].content); y.pairs.reverse(); assert.deepEqual(x, y)
  assert.deepEqual(Object.keys(x).sort(), ['candidates', 'headSha', 'pairs', 'retrievedEvidence', 'searchReceipts'])
})
const sha = 'a'.repeat(40), evidence = [{ id: 'S1', kind: 'source', commitSha: sha }]
const sample = () => ({ behaviors: [{ id: 'B1', text: 'Return formatted data', conditions: 'Valid input', atCommits: [sha], evidenceIds: ['S1'] }], roles: nodes.slice(0,2).map((n) => ({ nodeId: n.id, behaviorId: 'B1', role: 'includes', reason: 'Cited responsibility', evidenceIds: ['S1'] })), implementations: [], history: [], decisions: [{ id: 'AB', relation: 'overlapping', sharedBehaviorIds: ['B1'], aOnlyBehaviorIds: [], bOnlyBehaviorIds: [], reason: 'Shared responsibility with other differences', evidenceIds: ['S1'], openQuestions: [], revisionTriggers: ['New behavior evidence'] }], consistencyNotes: [], coverageLimits: ['Partial catalog, not all behavior'] })
test('ownership witnesses are grounded and cross-referenced without inferring all semantics', () => {
  const s = sample(); assert.equal(validateOwnership(s, nodes.slice(0,2), pairs.slice(0,1), evidence), s)
  s.roles[1].role = 'hosts'; assert.throws(() => validateOwnership(s, nodes.slice(0,2), pairs.slice(0,1), evidence), /both includes/)
})
test('unknown responsibility cannot silently become an exclusive behavior', () => {
  const s = sample(); s.roles[1].role = 'unknown'; s.roles[1].evidenceIds = []; s.decisions[0].sharedBehaviorIds = []; s.decisions[0].aOnlyBehaviorIds = ['B1']
  assert.throws(() => validateOwnership(s, nodes.slice(0,2), pairs.slice(0,1), evidence), /explicit B exclusion/)
  s.roles[1].role = 'excludes'; s.roles[1].evidenceIds = ['S1']; assert.equal(validateOwnership(s, nodes.slice(0,2), pairs.slice(0,1), evidence), s)
})
test('missing roles and unsupported revision assertions fail closed', () => {
  const a = sample(); a.roles.pop(); assert.throws(() => validateOwnership(a, nodes.slice(0,2), pairs.slice(0,1), evidence))
  const b = sample(); b.behaviors[0].atCommits = ['b'.repeat(40)]; assert.throws(() => validateOwnership(b, nodes.slice(0,2), pairs.slice(0,1), evidence), /revision/)
})
test('conditional tensions require accounting but an explicit unresolved note remains valid', () => {
  const s = sample(); s.roles.push({ ...s.roles[0], nodeId: 'C' })
  s.decisions = pairs.map((p, i) => ({ ...s.decisions[0], id: p.id, relation: ['a_broader', 'overlapping', 'distinct'][i], sharedBehaviorIds: [] }))
  assert.throws(() => validateOwnership(s, nodes, pairs, evidence), /potential scope tension/)
  s.consistencyNotes = [{ pairIds: ['AB','BC','AC'], status: 'unresolved', reason: 'Need aligned revision and scope evidence', evidenceIds: [] }]
  assert.equal(validateOwnership(s, nodes, pairs, evidence), s)
})
