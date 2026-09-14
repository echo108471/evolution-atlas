import test from 'node:test'
import assert from 'node:assert/strict'
import { unseenInventory, prefixBaseline } from '../scripts/vscode-expansion.mjs'
import { integrationIssues, changeSummary, renderExpansion } from '../scripts/report-vscode-expansion.mjs'

const receipt = { id: 'A-001', kind: 'source', path: 'src/test.ts', text: 'synthetic', startLine: 1, endLine: 1, commitSha: 'a'.repeat(40), blobSha: 'b'.repeat(40) }
const node = id => ({ id, name: 'Behavior ' + id, summary: 'Synthetic behavior', actor: 'User', inputs: [], outcomes: ['Result'], conditions: [], exclusions: [], implementations: [], uncertainty: [], evidenceIds: ['A-001'], assessment: 'partial', claims: [{ text: 'Result', assessment: 'partial', evidenceIds: ['A-001'] }] })
function fixture() {
  const old = prefixBaseline({ nodes: [node('N1')], edges: [] }, [receipt])
  const fresh = node('A1'), proposals = [{ agent: 'A', nodes: [fresh], edges: [], coverage: {}, crossPartitionLeads: [] }]
  const graph = { nodes: [...old.graph.nodes, fresh], edges: [], lineage: [...old.graph.nodes, fresh].map(n => ({ originalId: n.id, successorIds: [n.id], decision: 'retain', reason: 'Preserve concrete behavior' })),
    comparisons: [{ newNodeId: fresh.id, existingNodeIds: ['old:N1'], relation: 'distinct', disposition: 'Retain separately', reason: 'Synthetic distinction', evidenceIds: ['A-001', 'old:A-001'], uncertainty: [] }], edgeLineage: [], decisions: [], limitations: [] }
  return { old, proposals, graph, receipts: [...old.receipts, receipt] }
}
test('unread inventory excludes any previously excerpted file, not search-only locations', () => {
  const inv = { omitted: [], files: [{ path: 'a', partition: 'A' }, { path: 'b', partition: 'D' }, { path: 'c', partition: 'F' }] }
  const result = unseenInventory(inv, [{ kind: 'source', path: 'a' }, { kind: 'search', matches: [{ path: 'b' }] }])
  assert.deepEqual(result.files.map(f => [f.path, f.partition]), [['b', 'A'], ['c', 'C']])
  assert.equal(result.eligibleFiles, 2); assert.equal(result.omitted[0].path, 'a')
  assert.equal(inv.files[1].partition, 'D')
})
test('baseline namespace changes only identifiers and leaves source and definitions intact', () => {
  const original = { nodes: [node('N1'), node('N2')], edges: [{ from: 'N1', to: 'N2', type: 'contains', evidenceIds: ['A-001'] }] }
  const result = prefixBaseline(original, [receipt])
  assert.equal(result.graph.nodes[0].id, 'old:N1'); assert.equal(result.graph.nodes[0].claims[0].evidenceIds[0], 'old:A-001')
  assert.equal(result.graph.edges[0].from, 'old:N1'); assert.equal(result.receipts[0].text, receipt.text)
  assert.equal(original.nodes[0].id, 'N1'); assert.equal(result.graph.nodes[0].summary, original.nodes[0].summary)
})
test('integration validates explicit comparisons without granting semantic accuracy', () => {
  const f = fixture(); assert.deepEqual(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts), [])
  f.graph.comparisons = []; assert.ok(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts).some(e => e.message === 'missing new-to-existing comparison'))
})
test('retain rejects silently rewritten definitions while explicit revision is allowed', () => {
  const f = fixture(); f.graph.nodes[0] = { ...f.graph.nodes[0], summary: 'Different behavior' }
  assert.ok(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts).some(e => e.message === 'retain changed original content'))
  f.graph.lineage[0].decision = 'revise'
  assert.deepEqual(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts), [])
})
test('each prior relationship must be accounted and retained edges cannot silently change', () => {
  const f = fixture(), e = { from: 'old:N1', to: 'A1', type: 'supports', evidenceIds: ['A-001'], reason: 'Synthetic', assessment: 'partial' }
  f.proposals[0].edges = [e]; f.graph.edges = [e]
  assert.ok(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts).some(e => e.message === 'missing original edge disposition'))
  f.graph.edgeLineage = [{ source: 'discovery', originalIndex: 0, decision: 'retain', successorEdges: [{ from: e.from, to: e.to, type: e.type }], reason: 'Unchanged' }]
  assert.deepEqual(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts), [])
  f.graph.edges = [{ ...e, reason: 'Different' }]
  assert.ok(integrationIssues(f.graph, f.old.graph, f.proposals, f.receipts).some(e => e.message === 'retained edge changed'))
})
test('growth accounting distinguishes integration actions from simple concatenation', () => {
  const f = fixture(); const result = changeSummary(f.graph, f.old.graph, f.proposals)
  assert.equal(result.netNodeGrowth, 1); assert.equal(result.differenceFromConcatenation, 0)
  assert.deepEqual(result.baselineActions, { retain: 1 }); assert.deepEqual(result.newlyConstructedNodes, [])
})
test('expansion report includes the complete map, comparisons, old map and escaped reasons', () => {
  const f = fixture(); f.graph.comparisons[0].reason = '<script>untrusted</script>'
  const output = { graph: f.graph, baselineGraph: f.old.graph, proposals: f.proposals, receipts: f.receipts, manifest: { commitSha: receipt.commitSha },
    coverage: { files: 2, eligibleFiles: 100, uniqueLines: 2, discovery: { files: 1 }, assignments: [] },
    changes: changeSummary(f.graph, f.old.graph, f.proposals), amendments: [], graphIssues: [], proposalIssues: [], provenanceIssues: [], limitations: [] }
  const html = renderExpansion(output)
  assert.ok(html.includes('id="changes"')); assert.ok(html.includes('id="old:N1"')); assert.ok(html.includes('id="A1"'))
  assert.ok(html.includes('Every new-to-existing comparison')); assert.ok(html.includes('vscode-discovery-1/index.html#map'))
  assert.ok(!html.includes('<script>untrusted</script>')); assert.ok(html.includes('&lt;script&gt;untrusted'))
  assert.ok(html.includes('independent verification: not performed'))
})
