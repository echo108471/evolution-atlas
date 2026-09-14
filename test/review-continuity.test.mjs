import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { projectReviewHistory, renderReviewHistory } from '../scripts/lib/review-continuity.mjs'
import { blindNode } from '../scripts/vscode-evidence-audit.mjs'
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function fixture() {
  const n = { id: 'old:A1', name: 'Candidate', summary: 'Bounded operation', actor: 'User', inputs: [], outcomes: ['Requests X'], conditions: ['When enabled'], exclusions: [], implementations: [], evidenceIds: ['S1'], assessment: 'supported', uncertainty: ['Not executed'], claims: [{ text: 'Requests X', evidenceIds: ['S1'], assessment: 'supported' }] }
  const sourceGraph = { nodes: [n], edges: [] }, target = structuredClone(n)
  target.id = 'old:old:A1'; target.evidenceIds = ['old:S1']; target.claims[0].evidenceIds = ['old:S1']
  const targetGraph = { nodes: [target], edges: [] }
  const receipt = { id: 'S1', kind: 'source', path: 'a.ts', commitSha: 'abc', text: 'requestX()', startLine: 1, endLine: 1 }
  const definition = blindNode(n), finding = { field: 'outcomes[0]', verdict: 'qualified', reason: 'Request is not success', replacement: 'Requests X, without a success guarantee', evidenceIds: ['S1'] }
  return { sourceGraph, targetGraph,
    sourceReceipts: [receipt], targetReceipts: [{ ...receipt, id: 'old:S1' }], evidenceAliases: { S1: 'old:S1' },
    lineage: [{ sourceId: n.id, targetIds: [target.id] }],
    overlay: { graphSha256: hash(sourceGraph), reviewSha256: { A: 'review-hash' }, entries: [
      { reviewer: 'A', nodeId: n.id, scope: 'definition', contentSha256: hash(definition), verdict: 'supported', reason: 'Bounded source support', evidenceIds: ['S1'], boundaryFindings: [finding] },
      { reviewer: 'A', nodeId: n.id, scope: 'claim', claimIndex: 0, contentSha256: hash(definition.claims[0]), verdict: 'qualified', reason: 'Request only', evidenceIds: ['S1'], replacement: 'Only requests X' }
    ] } }
}
test('preserves exact historical content and adverse fields without transferring approval', () => {
  const f = fixture(), before = structuredClone(f), h = projectReviewHistory(f)
  assert.deepEqual(f, before); assert.deepEqual(h.inheritedApprovals, []); assert.equal(h.currentMapReviewed, false)
  assert.equal(h.entries[0].verdict, 'supported'); assert.equal(h.entries[0].projections[0].findings[0].verdict, 'qualified')
  assert.ok(h.entries.every(e => e.projections[0].reviewedContentUnchanged))
  assert.equal(h.entries[0].projections[0].nodeId, 'old:old:A1')
})
test('does not confuse repeated namespaces or choose a same-ID neighbor', () => {
  const f = fixture(); f.targetGraph.nodes.push({ ...structuredClone(f.targetGraph.nodes[0]), id: 'old:A1', summary: 'Different capability' })
  assert.equal(projectReviewHistory(f).entries[0].projections[0].nodeId, 'old:old:A1')
  f.lineage = []; assert.throws(() => projectReviewHistory(f), /explicit lineage/)
})
test('changed definition keeps matching claim history but is not reapproved', () => {
  const f = fixture(); f.targetGraph.nodes[0].summary = 'New scope'
  const h = projectReviewHistory(f)
  assert.equal(h.entries[0].projections[0].reviewedContentUnchanged, false)
  assert.equal(h.entries[1].projections[0].reviewedContentUnchanged, true)
  assert.equal(h.entries[1].projections[0].definitionUnchanged, false)
  assert.equal(h.currentMapReviewed, false)
})
test('changed reviewed field is not silently resolved or reassigned', () => {
  const f = fixture(); f.targetGraph.nodes[0].outcomes.unshift('New outcome')
  const p = projectReviewHistory(f).entries[0].projections[0]
  assert.equal(p.findings[0].fieldUnchanged, false); assert.equal(p.findings[0].currentValue, 'New outcome')
  assert.equal(p.findings[0].verdict, 'qualified')
})
test('removed and split successors retain historical records with explicit correspondence', () => {
  const f = fixture(); f.lineage[0].targetIds = []
  assert.equal(projectReviewHistory(f).entries[0].disposition, 'reviewed-node-has-no-successor')
  assert.equal(projectReviewHistory(f).entries[0].boundaryFindings[0].reason, 'Request is not success')
  assert.match(renderReviewHistory('<h1>Map</h1>', projectReviewHistory(f)), /Earlier reviews with no current successor/)
  f.targetGraph.nodes.push({ ...structuredClone(f.targetGraph.nodes[0]), id: 'split' }); f.lineage[0].targetIds = ['old:old:A1', 'split']
  assert.equal(projectReviewHistory(f).entries[0].projections.length, 2)
  assert.ok(projectReviewHistory(f).entries[0].projections.every(p => p.correspondence === 'multiple-successors'))
})
test('graph, content, citation and duplicate-record tampering fail closed', () => {
  for (const mutate of [f => f.overlay.graphSha256 = 'stale', f => f.overlay.entries[0].contentSha256 = 'stale',
    f => f.targetReceipts[0].text = 'different()', f => f.evidenceAliases = {},
    f => f.overlay.entries.push(f.overlay.entries[0]), f => f.lineage.push(f.lineage[0]),
    f => f.overlay.entries[1].claimIndex = -1, f => f.overlay.entries[0].boundaryFindings[0].field = '__proto__']) {
    const f = fixture(); mutate(f); assert.throws(() => projectReviewHistory(f))
  }
})
test('changed graph context is visible even when every reviewed word is unchanged', () => {
  const f = fixture(); f.targetGraph.edges.push({ from: 'old:old:A1', to: 'old:old:A1', type: 'supports' })
  const h = projectReviewHistory(f); assert.equal(h.graphContextChanged, true); assert.equal(h.entries[0].projections[0].definitionUnchanged, true)
  assert.equal(h.entries[0].projections[0].incidentRelationships.status, 'changed')
})
test('merges preserve distinct predecessor histories rather than asserting one-to-one identity', () => {
  const f = fixture(), old = structuredClone(f.sourceGraph.nodes[0]); old.id = 'other'; f.sourceGraph.nodes.push(old)
  f.lineage.push({ sourceId: 'other', targetIds: ['old:old:A1'] }); f.overlay.graphSha256 = hash(f.sourceGraph)
  const p = projectReviewHistory(f).entries[0].projections[0]
  assert.equal(p.correspondence, 'merged-successor'); assert.equal(p.predecessorCount, 2)
})
test('claim reorder and citation changes never match by stale index or text alone', () => {
  const f = fixture(); f.targetGraph.nodes[0].claims.unshift({ text: 'Something else', evidenceIds: ['old:S1'] })
  assert.equal(projectReviewHistory(f).entries[1].projections[0].reviewedContentUnchanged, false)
  f.targetGraph.nodes[0].claims.shift(); f.targetGraph.nodes[0].claims[0].evidenceIds = []
  assert.equal(projectReviewHistory(f).entries[1].projections[0].reviewedContentUnchanged, false)
})
test('renderer preserves candidate content, escapes findings, and rejects missing anchors', () => {
  const f = fixture(); f.overlay.entries[0].boundaryFindings[0].reason = '<script>bad()</script>'
  const h = projectReviewHistory(f), base = '<h1>Map</h1><article class="capability" id="old:old:A1"><h2>Candidate</h2></article>'
  const html = renderReviewHistory(base, h)
  assert.match(html, /Earlier source review—not a review of this map/); assert.match(html, /&lt;script&gt;/)
  assert.ok(html.includes('<h2>Candidate</h2>')); assert.ok(!html.includes('<script>'))
  assert.throws(() => renderReviewHistory('<h1>Map</h1>', h), /anchor/)
})
