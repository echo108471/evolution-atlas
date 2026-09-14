import test from 'node:test'
import assert from 'node:assert/strict'
import { ownershipDiagnostics } from '../scripts/lib/ownership-diagnostics.mjs'
const sha = 'a'.repeat(40), missing = 'b'.repeat(40), evidence = [{ id: 'S1', kind: 'source', commitSha: sha }]
const raw = () => ({ behaviors: [{ id: 'B1', text: 'Read record', conditions: 'Known ID', atCommits: [sha], evidenceIds: ['S1'] }], roles: [{ nodeId: 'A', behaviorId: 'B1', role: 'includes', reason: 'Source', evidenceIds: ['S1'] }], implementations: [], history: [], decisions: [], consistencyNotes: [], coverageLimits: ['Partial'] })
test('complete valid ownership has no new diagnostic errors', () => assert.deepEqual(ownershipDiagnostics(raw(), [{ id: 'A' }], [], evidence), []))
test('all revision locations are reported without mutating the answer', () => {
  const r = raw(); r.behaviors[0].atCommits.push(missing)
  r.history = [{ text: 'Historical claim', atCommits: [missing], evidenceIds: ['S1'] }]
  r.implementations = [{ nodeId: 'A', text: 'Implementation', atCommit: missing, evidenceIds: ['S1'] }]
  const before = structuredClone(r), issues = ownershipDiagnostics(r, [{ id: 'A' }], [], evidence)
  assert.deepEqual(issues.map((i) => i.path), ['behaviors[0].atCommits[1]', 'implementations[0].atCommit[0]', 'history[0].atCommits[0]'])
  assert.deepEqual(r, before)
})
test('malformed fields do not hide later errors or crash feedback', () => {
  for (const r of [null, {}, { behaviors: [null], roles: [null], history: [null], decisions: [null], implementations: [null], consistencyNotes: [null] }]) assert.ok(ownershipDiagnostics(r, [{ id: 'A' }], [], evidence).length)
})
test('unknown evidence, missing roles and witness mismatch are separately located', () => {
  const r = raw(); r.behaviors[0].evidenceIds.push('unknown')
  r.decisions = [{ id: 'AB', relation: 'overlapping', sharedBehaviorIds: ['B1'], aOnlyBehaviorIds: [], bOnlyBehaviorIds: [], reason: 'Claim', evidenceIds: ['S1'], openQuestions: [], revisionTriggers: ['Evidence'] }]
  const issues = ownershipDiagnostics(r, [{ id: 'A' }, { id: 'B' }], [{ id: 'AB', a: 'A', b: 'B' }], evidence)
  for (const path of ['behaviors[0].evidenceIds[1]', 'roles', 'decisions[0].sharedBehaviorIds[0]']) assert.ok(issues.some((i) => i.path === path))
})
