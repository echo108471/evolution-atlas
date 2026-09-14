import test from 'node:test'
import assert from 'node:assert/strict'
import { invariantRequest, ownershipFeedback, correctionRequest } from '../scripts/lib/implementation-invariance.mjs'
const empty = () => ({ behaviors: [], roles: [], implementations: [], history: [], decisions: [], consistencyNotes: [], coverageLimits: ['Synthetic partial evidence'] })
test('challenge keeps candidate evidence, model and output ceiling unchanged', () => {
  const base = { model: 'synthetic', max_tokens: 12000, messages: [{ role: 'system', content: 'Original' }, { role: 'user', content: 'Evidence' }] }, before = structuredClone(base), r = invariantRequest(base)
  assert.deepEqual(base, before); assert.equal(r.messages[1].content, 'Evidence'); assert.equal(r.max_tokens, 12000)
  assert.match(r.messages[0].content, /Clearly mark it hypothetical/)
})
test('control and challenge apply the same ownership checks; challenge adds complete counterfactual accounting', () => {
  const raw = empty(); assert.deepEqual(ownershipFeedback(raw, [], [], [], false), [])
  assert.equal(ownershipFeedback(raw, [], [], [], true).length, 2)
  raw.behaviorContracts = []; raw.implementationChallenges = []
  assert.deepEqual(ownershipFeedback(raw, [], [], [], true), [])
})
test('feedback identifies candidate history as interpretation without inventing a source', () => {
  const raw = empty(); raw.history = [{ text: 'Claim', atCommits: ['a'.repeat(40)], evidenceIds: ['R1'] }]
  const issues = ownershipFeedback(raw, [], [], [{ id: 'R1', kind: 'reading', commitSha: 'a'.repeat(40) }])
  assert.ok(issues.some((i) => i.path === 'history[0]')); assert.match(issues[1].issue, /Do not invent/)
})
test('exclusive-witness mismatch is exposed without modifying model output', () => {
  const raw = empty(); raw.decisions = [{ id: 'AB', aOnlyBehaviorIds: ['B1'], bOnlyBehaviorIds: [] }]; raw.roles = [{ nodeId: 'A', behaviorId: 'B1', role: 'includes' }, { nodeId: 'B', behaviorId: 'B1', role: 'uses' }]
  const before = structuredClone(raw), issues = ownershipFeedback(raw, [{ id: 'A' }, { id: 'B' }], [{ id: 'AB', a: 'A', b: 'B' }], [])
  assert.ok(issues.some((i) => i.issue.includes('includes/uses'))); assert.deepEqual(raw, before)
})
test('correction preserves initial request and raw answer and declares potential semantic revision', () => {
  const base = { messages: [{ role: 'system', content: 'Original' }] }, r = correctionRequest(base, '{"original":true}', [{ path: 'history[0]', issue: 'Missing source' }])
  assert.equal(base.messages.length, 1); assert.equal(r.messages[1].content, '{"original":true}')
  assert.match(r.messages[2].content, /not expected semantic answers/)
})
