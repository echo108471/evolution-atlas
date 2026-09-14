import test from 'node:test'
import assert from 'node:assert/strict'
import { compareIntegrations, setRecurrence } from '../scripts/lib/integration-stability.mjs'
function graph() {
  return { nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'p', name: 'Parent' }],
    edges: [{ from: 'p', to: 'a', type: 'contains' }, { from: 'p', to: 'b', type: 'contains' }],
    lineage: ['a', 'b'].map(id => ({ originalId: id, successorIds: [id], decision: 'retain' })), edgeLineage: [],
    comparisons: [{ newNodeId: 'b', existingNodeIds: ['a'], relation: 'distinct' }] }
}
test('empty positive sets are unscored, not perfect agreement', () => {
  assert.equal(setRecurrence([], []).jaccard, null)
  assert.equal(compareIntegrations(graph(), graph(), ['a', 'b']).coMergedOriginalPairs.jaccard, null)
})
test('generated parent labels do not change exact descendant membership recurrence', () => {
  const a = graph(), b = graph(); b.nodes[2].name = 'Different scope label'
  const r = compareIntegrations(a, b, ['a', 'b'])
  assert.equal(r.containmentMemberships.shared, 1); assert.equal(r.nodeActions.same, 2)
  assert.notEqual(r.containmentMemberships.leftGroups[0].name, r.containmentMemberships.rightGroups[0].name)
})
test('changed actions, scopes and unmatched comparison targets stay visible', () => {
  const a = graph(), b = graph(); b.lineage[1].decision = 'revise'; b.edges.pop()
  b.comparisons[0].relation = 'overlapping'; b.comparisons.push({ newNodeId: 'b', existingNodeIds: [], relation: 'distinct' })
  const r = compareIntegrations(a, b, ['a', 'b'])
  assert.equal(r.nodeActions.differences.length, 1); assert.equal(r.containmentMemberships.shared, 0)
  assert.equal(r.comparisonTargets.differences.length, 1); assert.equal(r.comparisonTargets.rightOnly.length, 1)
})
test('merge membership uses precursor IDs rather than output labels and accounts for omissions', () => {
  const a = graph(), b = graph(); b.lineage[1] = { originalId: 'b', successorIds: ['a'], decision: 'merge' }
  assert.equal(compareIntegrations(a, b, ['a', 'b']).coMergedOriginalPairs.right, 1)
  b.lineage.pop(); assert.throws(() => compareIntegrations(a, b, ['a', 'b']), /universe/)
})
test('duplicated action records and containment cycles fail closed', () => {
  const a = graph(), b = graph(); b.lineage.push(b.lineage[0]); assert.throws(() => compareIntegrations(a, b, ['a', 'b']))
  const c = graph(); c.edges.push({ from: 'a', to: 'p', type: 'contains' }); assert.throws(() => compareIntegrations(a, c, ['a', 'b']), /cycle/)
})
