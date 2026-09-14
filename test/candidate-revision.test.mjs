import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { applyCandidateRevision, revisionTarget } from '../scripts/lib/candidate-revision.mjs'
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
function fixture() {
  const node = id => ({ id, name: 'Behavior ' + id, summary: 'Always returns data', actor: 'Caller', inputs: ['Request'], outcomes: ['Data'], conditions: ['Always works'],
    exclusions: [], implementations: ['source.ts'], uncertainty: ['Not run'], assessment: 'supported', evidenceIds: ['S1'],
    claims: [{ text: 'Always returns data', evidenceIds: ['S1'], assessment: 'supported' }] })
  const graph = { nodes: [node('N1'), node('N2')], edges: [{ from: 'N1', to: 'N2', type: 'depends_on', reason: 'Uses', evidenceIds: ['S1'], assessment: 'partial' }], lineage: [{ originalId: 'legacy', successorIds: ['N1'] }] }
  const options = { findings: [{ id: 'F1', nodeId: 'N1', field: 'claims[0].text' }], receipts: [{ id: 'S1', kind: 'source' }, { id: 'S2', kind: 'source' }, { id: 'Q1', kind: 'search' }], allowedNodeIds: ['N1'] }
  const proposal = { beforeGraphSha256: hash(graph), decisions: [{ findingId: 'F1', action: 'revise', reason: 'Guard limits output', evidenceIds: ['S2'] }],
    patches: [{ nodeId: 'N1', field: 'claims[0].text', before: 'Always returns data', after: 'Returns data when enabled', reason: 'Guard', evidenceIds: ['S2'], findingIds: ['F1'] }], limitations: ['Source-only'] }
  return { graph, options, proposal }
}
test('revision transaction preserves identity, relationships and unaffected records', () => {
  const { graph, options, proposal } = fixture(), original = structuredClone(graph)
  const result = applyCandidateRevision(graph, proposal, options)
  assert.deepEqual(graph, original); assert.deepEqual(result.graph.edges, graph.edges)
  assert.deepEqual(result.graph.nodes[1], graph.nodes[1])
  assert.deepEqual(result.graph.nodes.map(n => [n.id, n.name]), graph.nodes.map(n => [n.id, n.name]))
  assert.equal(result.graph.nodes[0].claims[0].text, proposal.patches[0].after)
  assert.equal(result.graph.nodes[0].claims.length, 1)
  assert.equal(result.lineage[0].decision, 'revise'); assert.equal(result.lineage[1].decision, 'retain')
})
test('invalid later patch does not partially modify the input graph', () => {
  const { graph, options, proposal } = fixture(), before = structuredClone(graph)
  proposal.patches.push({ ...proposal.patches[0], field: '__proto__.polluted' })
  assert.throws(() => applyCandidateRevision(graph, proposal, options), /invalid patch/)
  assert.deepEqual(graph, before); assert.equal({}.polluted, undefined)
})
test('stale graph and stale assertion preconditions fail closed', () => {
  const { graph, options, proposal } = fixture()
  proposal.beforeGraphSha256 = 'old'; assert.throws(() => applyCandidateRevision(graph, proposal, options), /graph precondition/)
  proposal.beforeGraphSha256 = hash(graph); proposal.patches[0].before = 'old'
  assert.throws(() => applyCandidateRevision(graph, proposal, options), /field precondition/)
})
test('a revision note cannot substitute for changing its flagged assertion', () => {
  const { graph, options, proposal } = fixture()
  proposal.patches = []; assert.throws(() => applyCandidateRevision(graph, proposal, options), /flagged field/)
  proposal.patches = [{ nodeId: 'N1', field: 'summary', before: 'Always returns data', after: 'Qualified now', reason: 'Revised claim', evidenceIds: ['S1'], findingIds: ['F1'] }]
  assert.throws(() => applyCandidateRevision(graph, proposal, options), /flagged field/)
})
test('unchanged and whitespace-only revisions are rejected', () => {
  const { graph, options, proposal } = fixture()
  for (const after of ['Always returns data', ' Always returns data\n']) {
    proposal.patches[0].after = after
    assert.throws(() => applyCandidateRevision(graph, proposal, options), /active assertion/)
  }
})
test('all findings have explicit decisions and duplicate edits cannot hide each other', () => {
  const { graph, options, proposal } = fixture()
  proposal.decisions = []; assert.throws(() => applyCandidateRevision(graph, proposal, options), /all findings/)
  proposal.decisions = fixture().proposal.decisions; proposal.patches.push({ ...proposal.patches[0] })
  assert.throws(() => applyCandidateRevision(graph, proposal, options), /duplicate patch/)
})
test('keep and defer are legitimate decisions without forced semantic changes', () => {
  for (const action of ['keep', 'defer']) {
    const { graph, options, proposal } = fixture(); proposal.decisions[0].action = action; proposal.patches = []
    const result = applyCandidateRevision(graph, proposal, options)
    assert.deepEqual(result.graph.nodes, graph.nodes); assert.deepEqual(result.reviewState.changedNodeIds, [])
  }
})
test('source citations cannot be substituted with searches or unknown references', () => {
  const { graph, options, proposal } = fixture()
  for (const id of ['Q1', 'missing']) {
    proposal.patches[0].evidenceIds = [id]
    assert.throws(() => applyCandidateRevision(graph, proposal, options), /non-source evidence/)
  }
})
test('out-of-scope nodes, identity changes and nonexistent fields are not editable', () => {
  const { graph, options, proposal } = fixture()
  proposal.patches[0].nodeId = 'N2'; assert.throws(() => applyCandidateRevision(graph, proposal, options), /permitted nodes/)
  for (const field of ['id', 'name', 'claims[9].text', 'outcomes[1]', 'assessment', 'evidenceIds[0]', 'claims[0].assessment', 'constructor', 'outcomes[-1]']) assert.equal(revisionTarget(graph.nodes[0], field), null)
})
test('unrecognized mutation fields cannot be silently ignored as a successful revision', () => {
  const { graph, options, proposal } = fixture()
  proposal.edges = []; assert.throws(() => applyCandidateRevision(graph, proposal, options), /unknown proposal field/)
  delete proposal.edges; proposal.patches[0].remove = true
  assert.throws(() => applyCandidateRevision(graph, proposal, options), /unknown patch field/)
})
test('new text starts partial with no inherited review; prior decisions remain archived', () => {
  const { graph, options, proposal } = fixture(), result = applyCandidateRevision(graph, proposal, options)
  assert.equal(result.graph.nodes[0].assessment, 'partial'); assert.equal(result.graph.nodes[0].claims[0].assessment, 'partial')
  assert.deepEqual(result.graph.nodes[0].claims[0].evidenceIds, ['S1', 'S2'])
  assert.deepEqual(result.reviewState.inheritedApprovals, []); assert.equal(result.reviewState.automaticPromotion, false)
  assert.equal(result.graph.lineage, undefined); assert.deepEqual(result.previousDecisionRecords.lineage, graph.lineage)
  result.previousDecisionRecords.lineage[0].originalId = 'changed'; assert.equal(graph.lineage[0].originalId, 'legacy')
  assert.notEqual(result.graphSha256, result.beforeGraphSha256)
})
