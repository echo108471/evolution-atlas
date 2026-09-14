import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateProjection, strictGraphIssues, lineageIssues, reconciledIssues } from '../scripts/lib/repository-engine-contract.mjs'

const receipts = [{ id: 'S1', kind: 'source' }, { id: 'Q1', kind: 'search' }]
const node = id => ({ id, name: id, summary: 'Synthetic behavior', actor: 'Synthetic actor', inputs: [], outcomes: ['Observable synthetic result'], conditions: [], exclusions: [], implementations: [], uncertainty: [], claims: [{ text: 'Synthetic claim', evidenceIds: ['S1'], assessment: 'partial' }], evidenceIds: ['S1'], assessment: 'partial' })
const edge = (from, to, type = 'contains') => ({ from, to, type, reason: 'Synthetic composition', evidenceIds: ['S1'], assessment: 'partial' })
const line = (originalId, successorIds = [originalId], decision = 'retain') => ({ originalId, successorIds, decision, reason: 'Synthetic decision' })
const graph = () => ({ nodes: [node('A'), node('B')], edges: [], lineage: [line('A'), line('B')], edgeLineage: [], decisions: [], limitations: [] })
const messages = issues => issues.map(i => i.message).join('; ')

test('candidate projection strips review metadata at every interpretation level without changing source', () => {
  const input = graph(); input.reviewStatus = 'accepted'; input.independentVerification = 'verified'
  input.nodes[0].reviewStatus = 'accepted'; input.nodes[0].claims[0].independentVerification = 'verified'
  input.edges.push({ ...edge('A', 'B'), reviewStatus: 'accepted' })
  const original = structuredClone(input), projected = candidateProjection(input, 'old:')
  assert.deepEqual(input, original)
  assert.deepEqual(Object.keys(projected), ['nodes', 'edges'])
  assert.ok(!JSON.stringify(projected).includes('verified')); assert.ok(!JSON.stringify(projected).includes('accepted'))
  assert.equal(projected.nodes[0].id, 'old:A'); assert.equal(projected.edges[0].to, 'old:B')
  assert.deepEqual(projected.nodes[0].claims[0].evidenceIds, ['old:S1'])
  assert.deepEqual(strictGraphIssues(projected, [{ id: 'old:S1', kind: 'source' }]), [])
  assert.throws(() => candidateProjection(null), /projection/)
})

test('malformed graph values produce validation issues instead of escaping', () => {
  for (const value of [null, [], {}, { nodes: {}, edges: [] }, { nodes: [], edges: {} }, { nodes: [null], edges: [null] }]) assert.ok(strictGraphIssues(value, receipts).length)
  for (const patch of [{ claims: {} }, { claims: [null] }, { claims: [{ text: {}, evidenceIds: [], assessment: 'unresolved' }] }, { inputs: [{}] }, { evidenceIds: {} }, { uncertainty: [null] }]) {
    const g = graph(); Object.assign(g.nodes[0], patch); assert.ok(strictGraphIssues(g, receipts).length)
  }
  const g = graph(); g.edges = [{ ...edge('A', 'B'), reason: {} }]
  assert.match(messages(strictGraphIssues(g, receipts)), /reason required/)
})

test('candidate fields reject fresh review labels and citations require distinct source IDs', () => {
  for (const target of ['graph', 'node', 'claim', 'edge']) {
    const g = graph(); g.edges.push(edge('A', 'B'))
    const selected = { graph: g, node: g.nodes[0], claim: g.nodes[0].claims[0], edge: g.edges[0] }[target]
    selected.independentVerification = 'verified'
    assert.match(messages(strictGraphIssues(g, receipts)), /unexpected interpretation field/)
  }
  for (const ids of [['Q1'], ['S1', 'S1'], [1], ['missing'], []]) {
    const g = graph(); g.nodes[0].evidenceIds = ids; assert.ok(strictGraphIssues(g, receipts).length)
  }
  assert.match(messages(strictGraphIssues(graph(), [...receipts, receipts[0]])), /duplicate receipt/)
  const g = graph(); g.nodes[0].assessment = 'unresolved'; g.nodes[0].evidenceIds = []
  assert.deepEqual(strictGraphIssues(g, receipts), [])
})

test('multiple parents and arbitrary-depth containment remain legal; cycles and duplicate edges do not', () => {
  const g = { nodes: ['A', 'B', 'C', 'D'].map(node), edges: [edge('A', 'C'), edge('B', 'C'), edge('C', 'D')] }
  assert.deepEqual(strictGraphIssues(g, receipts), [])
  g.edges.push(edge('D', 'A')); assert.match(messages(strictGraphIssues(g, receipts)), /containment cycle/)
  g.edges = [edge('A', 'C'), edge('A', 'C'), edge('A', 'missing')]
  assert.match(messages(strictGraphIssues(g, receipts)), /duplicate edge/)
  assert.match(messages(strictGraphIssues(g, receipts)), /dangling endpoint/)
  const colon = { nodes: ['A:B', 'C', 'A', 'B:C'].map(node), edges: [edge('A:B', 'C'), edge('A', 'B:C')] }
  assert.deepEqual(strictGraphIssues(colon, receipts), [])
  const deep = { nodes: Array.from({ length: 12000 }, (_, i) => node(String(i))), edges: Array.from({ length: 11999 }, (_, i) => edge(String(i), String(i + 1))) }
  assert.deepEqual(strictGraphIssues(deep, receipts), [])
})

test('retain, rename and revision reflect the actual definition change', () => {
  const before = graph().nodes
  assert.deepEqual(lineageIssues(graph(), before, { baseline: [], discovery: [] }), [])
  for (const action of ['retain', 'rename', 'revise']) {
    const g = graph(); g.lineage[0].decision = action
    if (action === 'retain') g.nodes[0].summary += ' changed'
    assert.ok(lineageIssues(g, before, {}).length)
  }
  const renamed = graph(); renamed.nodes[0].name = 'New name'; renamed.lineage[0].decision = 'rename'
  assert.deepEqual(lineageIssues(renamed, before, {}), [])
  renamed.nodes[0].summary = 'Different behavior'; assert.ok(lineageIssues(renamed, before, {}).length)
  renamed.lineage[0].decision = 'revise'; assert.deepEqual(lineageIssues(renamed, before, {}), [])
})

test('splits need distinct successors, merges need multiple explicitly merging originals, removal needs none', () => {
  const before = graph().nodes, g = graph()
  g.nodes = [node('C'), node('D')]; g.lineage = [line('A', ['C', 'D'], 'split'), line('B', [], 'remove')]
  assert.deepEqual(lineageIssues(g, before, {}), [])
  for (const ids of [['C'], ['C', 'C'], []]) { g.lineage[0].successorIds = ids; assert.ok(lineageIssues(g, before, {}).length) }
  g.lineage = [line('A', ['C'], 'merge'), line('B', ['C'], 'merge')]
  assert.deepEqual(lineageIssues(g, before, {}), [])
  g.lineage[1] = line('B', [], 'remove'); assert.match(messages(lineageIssues(g, before, {})), /at least two/)
  g.lineage[1] = line('B', ['C'], 'remove'); assert.ok(lineageIssues(g, before, {}).length)
  g.lineage.push(null); assert.ok(lineageIssues(g, before, {}).length)
  assert.match(messages(lineageIssues(graph(), [...before, before[0]], {})), /duplicate input/)
})

test('every original node and relationship has one exact disposition', () => {
  const before = graph().nodes, originalEdge = edge('A', 'B'), g = graph()
  g.edges = [originalEdge]
  g.edgeLineage = [{ source: 'baseline', originalIndex: 0, decision: 'retain', successorEdges: [{ from: 'A', to: 'B', type: 'contains' }], reason: 'Same relationship' }]
  assert.deepEqual(lineageIssues(g, before, { baseline: [originalEdge] }), [])
  g.edgeLineage[0].decision = 'revise'; assert.match(messages(lineageIssues(g, before, { baseline: [originalEdge] })), /no change/)
  g.edges = [{ ...originalEdge, reason: 'New reason' }]; assert.deepEqual(lineageIssues(g, before, { baseline: [originalEdge] }), [])
  g.edgeLineage[0].successorEdges.push(g.edgeLineage[0].successorEdges[0]); assert.ok(lineageIssues(g, before, { baseline: [originalEdge] }).length)
  g.edgeLineage[0].successorEdges = [null]; assert.ok(lineageIssues(g, before, { baseline: [originalEdge] }).length)
  g.edgeLineage = []; g.lineage.pop()
  assert.match(messages(lineageIssues(g, before, { baseline: [originalEdge] })), /missing original lineage/)
  assert.match(messages(lineageIssues(g, before, { baseline: [originalEdge] })), /missing original edge lineage/)
})

test('initial reconciliation permits explicit revision without requiring empty-baseline comparisons', () => {
  const input = { nodes: graph().nodes, edges: [] }, g = graph()
  g.nodes[0].summary = 'A qualified definition'; g.lineage[0].decision = 'revise'
  assert.deepEqual(reconciledIssues(g, { nodes: [], edges: [] }, [input], receipts, false), [])
  g.limitations = [{}]; assert.ok(reconciledIssues(g, { nodes: [], edges: [] }, [input], receipts, false).length)
  g.limitations = []; g.decisions = [{ question: 'Q', decision: 'D', reason: 'R', evidenceIds: ['S1'], uncertainty: [{}] }]
  assert.ok(reconciledIssues(g, { nodes: [], edges: [] }, [input], receipts, false).length)
})

test('expansion requires evidenced new-to-existing comparison, not a specific semantic answer', () => {
  const baseline = { nodes: [node('A')], edges: [] }, proposals = [{ nodes: [node('B')], edges: [] }], g = graph()
  assert.match(messages(reconciledIssues(g, baseline, proposals, receipts, true)), /comparisons array required/)
  g.comparisons = [{ newNodeId: 'B', existingNodeIds: ['A'], relation: 'overlapping', reason: 'Concrete common and different behavior', disposition: 'Keep both candidates', evidenceIds: ['S1'], uncertainty: [] }]
  for (const relation of ['same', 'overlapping', 'broader', 'narrower', 'distinct', 'uncertain']) {
    g.comparisons[0].relation = relation; assert.deepEqual(reconciledIssues(g, baseline, proposals, receipts, true), [])
  }
  g.comparisons.push(structuredClone(g.comparisons[0])); assert.match(messages(reconciledIssues(g, baseline, proposals, receipts, true)), /duplicate alternative set/)
  g.comparisons = []; assert.match(messages(reconciledIssues(g, baseline, proposals, receipts, true)), /missing new-to-existing/)
})
