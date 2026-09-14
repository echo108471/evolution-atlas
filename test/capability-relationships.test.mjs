import test from 'node:test'
import assert from 'node:assert/strict'
import { relationshipView, validateRelationshipPool, validateRelationshipReview, composeRelationships, reviewRelationshipContext } from '../scripts/lib/capability-relationships.mjs'
import { renderRelationships } from '../scripts/render-capability-relationships.mjs'
const graph = { nodes: ['N0', 'N1', 'N2', 'N3'].map((id) => ({ id, name: id, summary: 'Behavior', evidenceIds: ['S0'] })), edges: [{ id: 'E0', from: 'N0', to: 'N1', type: 'contains', evidenceIds: ['S0'] }] }
const evidence = [{ id: 'S0', kind: 'source', text: 'observed code' }, { id: 'R0', kind: 'reading', text: 'interpretation' }]
const pool = { newNodes: [{ id: 'P1', name: 'Outcome', summary: 'Distinct purpose', reason: 'Broader than N0', evidenceIds: ['S0'] }],
  edges: [{ id: 'L1', from: 'P1', to: 'N1', type: 'contains' }, { id: 'L2', from: 'N2', to: 'N1', type: 'contains' },
    { id: 'L3', from: 'N3', to: 'N2', type: 'supports' }, { id: 'L4', from: 'N2', to: 'N3', type: 'depends_on' }].map((e) => ({ ...e, reason: 'Specific contribution', evidenceIds: ['S0'] })), unresolved: [] }
const review = { nodeDecisions: [{ id: 'P1', decision: 'include', closestExistingId: 'N0', relationship: 'different', reason: 'Different outcome', evidenceIds: ['S0'] }],
  edgeDecisions: pool.edges.map((e) => ({ id: e.id, decision: 'include', reason: 'Grounded contribution', evidenceIds: ['S0'] })), conflicts: [], unresolved: [] }
test('independent outcomes share a child and supports/dependency can coexist', () => {
  validateRelationshipPool(pool, graph, evidence); validateRelationshipReview(review, pool, graph, evidence)
  const result = composeRelationships(graph, pool, review)
  assert.equal(result.acceptedEdgeIds.length, 4)
  assert.deepEqual(result.view.sharedCapabilities, [{ id: 'N1', parentIds: ['N0', 'P1', 'N2'] }])
  assert.deepEqual(result.graph.nodes.slice(0, 4), graph.nodes)
  assert.deepEqual(result.graph.edges[0], graph.edges[0])
})
test('transitive reduction preserves all raw claims and separates shortcuts from shared membership', () => {
  const g = { ...graph, edges: [...graph.edges, { id: 'E1', from: 'N0', to: 'N2', type: 'contains' }, { id: 'E2', from: 'N2', to: 'N1', type: 'contains' }] }
  const view = relationshipView(g)
  assert.deepEqual(view.hiddenTransitiveEdges, [graph.edges[0]])
  assert.equal(view.sharedCapabilities.length, 0)
  assert.equal(g.edges.length, 3)
})
test('combined containment cycles withhold all new cycle edges independent of order', () => {
  const p = { ...pool, edges: [{ ...pool.edges[0], id: 'L1', from: 'N1', to: 'N2' }, { ...pool.edges[0], id: 'L2', from: 'N2', to: 'N0' }] }
  const r = { ...review, edgeDecisions: review.edgeDecisions.slice(0, 2) }
  const a = composeRelationships(graph, p, r), b = composeRelationships(graph, { ...p, edges: [...p.edges].reverse() }, r)
  assert.deepEqual(a.acceptedEdgeIds, []); assert.deepEqual(b.acceptedEdgeIds, [])
  assert.equal(a.compositionBlocked.length, 2)
})
test('review must account for every claim, resolve conflicts, and include only approved endpoints', () => {
  for (const edit of [
    (r) => r.edgeDecisions.pop(), (r) => { r.nodeDecisions[0].decision = 'defer' },
    (r) => { r.nodeDecisions[0].relationship = 'duplicate' },
    (r) => { r.conflicts = [{ edgeIds: ['L1', 'L2'], reason: 'Conflicting meanings', evidenceIds: ['S0'] }] },
    (r) => { r.edgeDecisions[2].evidenceIds = ['R0'] },
  ]) { const r = structuredClone(review); edit(r); assert.throws(() => validateRelationshipReview(r, pool, graph, evidence)) }
})
test('typed claims reject unknown endpoints, duplicate links and reading-only implementation claims', () => {
  for (const edit of [
    (p) => { p.edges[0].to = 'missing' }, (p) => { p.edges[1] = { ...p.edges[0], id: 'L2' } },
    (p) => { p.edges[2].evidenceIds = ['R0'] }, (p) => { p.edges[0].type = 'related_to' },
    (p) => { p.edges[0].evidenceIds = ['unknown'] },
  ]) { const p = structuredClone(pool); edit(p); assert.throws(() => validateRelationshipPool(p, graph, evidence)) }
})
test('review ordering is the only context change and proposer rationales are absent', () => {
  const a = reviewRelationshipContext(graph, pool, evidence), b = reviewRelationshipContext(graph, pool, evidence, true)
  b.proposedNodes.reverse(); b.proposedEdges.reverse(); assert.deepEqual(a, b)
  assert.equal(a.proposedNodes[0].reason, undefined); assert.equal(a.proposedEdges[0].reason, undefined)
})
test('explicit v1.1 reconciliation keeps duplicate claims out of discovery counts without rewriting them', () => {
  const p = { ...pool, edges: [{ ...pool.edges[0], from: 'N0', to: 'N1' }] }
  const r = { ...review, edgeDecisions: [review.edgeDecisions[0]] }
  assert.throws(() => validateRelationshipPool(p, graph, evidence), /duplicate/)
  assert.deepEqual(validateRelationshipPool(p, graph, evidence, { allowExistingClaims: true }), p)
  const result = composeRelationships(graph, p, r)
  assert.equal(result.acceptedEdgeIds.length, 0)
  assert.deepEqual(result.graph.edges, graph.edges)
  assert.deepEqual(result.existingClaims, [{ proposalId: 'L1', existingEdgeId: 'E0', decision: 'include' }])
})
test('relationship report shows shared identities, separate relation types, and escapes model content', () => {
  const p = structuredClone(pool); p.edges[0].reason = '<script>not instructions</script>'
  const html = renderRelationships({ graph, proposal: { status: 'valid', value: p }, reviews: [{ order: 'forward', status: 'valid', value: review,
    composition: composeRelationships(graph, p, review) }], manifest: { limitations: 'Pilot only' }, stages: [], cost: 0 }, evidence)
  assert.match(html, /shared capability/); assert.match(html, /N3 supports N2/); assert.match(html, /N2 depends on N3/)
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
})
