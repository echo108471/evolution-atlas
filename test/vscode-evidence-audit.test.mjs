import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleGraph, blindNode, reviewIssues, reviewOverlay, renderAuditMarkdown, definitionField } from '../scripts/vscode-evidence-audit.mjs'
import { sha } from '../scripts/vscode-snapshot-evidence.mjs'
const node = id => ({ id, name: 'Synthetic ' + id, summary: 'Behavior <script>x</script>', assessment: 'supported', uncertainty: ['Earlier reasoning'],
  inputs: [], outcomes: ['attempted result'], evidenceIds: ['X'], claims: [{ text: 'Attempts a result', evidenceIds: ['X'], assessment: 'supported' }] })
const receipt = { id: 'X', kind: 'source', text: 'synthetic()', path: 'src/test.ts', startLine: 1, endLine: 1, commitSha: 'a'.repeat(40) }
function fixture() {
  const packet = { reviewer: 'A', graphSha256: 'b'.repeat(64), nodes: [blindNode(node('N'))] }
  const finding = { verdict: 'supported', reason: 'Source shows the attempt, not delivery', evidenceIds: ['X'], replacement: null }
  const review = { reviewer: 'A', reviews: [{ nodeId: 'N', definitionVerdict: 'supported', reason: 'Bounded responsibility', evidenceIds: ['X'],
    claims: [{ ...finding, claimIndex: 0 }], boundaryFindings: [] }], limitations: ['No runtime verification'] }
  return { packet, review, audit: { graphSha256: 'b'.repeat(64), issues: [], packets: [packet], reviews: [review],
    manifest: { assignments: { A: { packetSha256: sha(packet) } } },
    verificationKind: 'bounded-static-source-review', receipts: [{ reviewer: 'A', source: [receipt], extra: [] }] } }
}
test('stratified sample is independent of graph order and preserves merged pair uniqueness', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => node('N' + i))
  const lineage = nodes.map((n, i) => ({ successorIds: [n.id], decision: i === 0 ? 'merge' : i < 5 ? 'revise' : 'retain' }))
  lineage.push({ successorIds: ['N0'], decision: 'merge' })
  const a = sampleGraph({ nodes, lineage }), b = sampleGraph({ nodes: [...nodes].reverse(), lineage: [...lineage].reverse() })
  assert.deepEqual(a, b); assert.equal(a.length, 6); assert.equal(new Set(a.map(x => x.nodeId)).size, 6)
  assert.deepEqual(a.map(x => x.stratum), ['merge', 'revise', 'revise', 'retain', 'retain', 'retain'])
})
test('review packet preserves behavior but withholds proposer verdicts and uncertainty', () => {
  const original = node('N'), blind = blindNode(original)
  assert.equal(blind.assessment, undefined); assert.equal(blind.uncertainty, undefined)
  assert.equal(blind.claims[0].assessment, undefined); assert.equal(blind.summary, original.summary)
  assert.equal(blind.claims[0].claimIndex, 0); assert.equal(original.assessment, 'supported')
})
test('every node and claim must be reviewed exactly once', () => {
  const { packet, review } = fixture(); assert.deepEqual(reviewIssues(packet, review, [receipt]), [])
  review.reviews[0].claims = []; assert.ok(reviewIssues(packet, review, [receipt]).some(x => x.includes('accounting')))
  review.reviews = []; assert.ok(reviewIssues(packet, review, [receipt]).some(x => x.includes('missing N')))
})
test('search IDs and missing citations cannot serve as source support', () => {
  const { packet, review } = fixture(); review.reviews[0].claims[0].evidenceIds = ['S']
  assert.ok(reviewIssues(packet, review, [receipt, { id: 'S', kind: 'search' }]).some(x => x.includes('citations')))
})
test('qualified findings need replacements and real definition fields', () => {
  const { packet, review } = fixture(), r = review.reviews[0]
  r.claims[0].verdict = 'qualified'
  assert.ok(reviewIssues(packet, review, [receipt]).some(x => x.includes('replacement')))
  r.claims[0].replacement = 'Attempts the result conditionally'
  assert.deepEqual(reviewIssues(packet, review, [receipt]), [])
  r.boundaryFindings = [{ ...r.claims[0], field: 'invented' }]
  assert.ok(reviewIssues(packet, review, [receipt]).some(x => x.includes('invalid boundary field')))
})
test('field-level findings support existing array entries without accepting invented paths', () => {
  const { packet, review } = fixture(), r = review.reviews[0]
  r.boundaryFindings = [{ field: 'outcomes[0]', verdict: 'qualified', reason: 'Bounded result', evidenceIds: ['X'], replacement: 'Attempts only' }]
  assert.deepEqual(reviewIssues(packet, review, [receipt]), [])
  assert.equal(definitionField(packet.nodes[0], 'outcomes[0]'), 'attempted result')
  for (const field of ['outcomes[2]', 'summary[0]', '__proto__', 'claims', 'claims[0]', 'assessment', 'outcomes[-1]']) {
    assert.equal(definitionField(packet.nodes[0], field), undefined)
  }
})
test('sidecar binds content and graph without promoting or mutating candidates', () => {
  const { audit } = fixture(), before = structuredClone(audit), sidecar = reviewOverlay(audit)
  assert.deepEqual(audit, before); assert.equal(sidecar.automaticPromotion, false); assert.equal(sidecar.runtimeVerified, false)
  assert.equal(sidecar.graphSha256, audit.graphSha256); assert.equal(sidecar.entries.length, 2)
  audit.packets[0].nodes[0].claims[0].text = 'Changed assertion'
  assert.throws(() => reviewOverlay(audit), /target changed/)
  audit.issues.push('incomplete'); assert.throws(() => reviewOverlay(audit), /valid reviews/)
})
test('existing citation metadata can be inspected without admitting arbitrary metadata', () => {
  const { packet, review } = fixture()
  review.reviews[0].boundaryFindings = [{ field: 'evidenceIds', verdict: 'supported', reason: 'IDs resolve, not proof of behavior', evidenceIds: ['X'], replacement: null }]
  assert.deepEqual(reviewIssues(packet, review, [receipt]), [])
  assert.deepEqual(definitionField(packet.nodes[0], 'evidenceIds'), ['X'])
  assert.equal(definitionField(packet.nodes[0], 'evidenceIds[1]'), undefined)
  assert.equal(definitionField(packet.nodes[0], 'assessment'), undefined)
  delete packet.nodes[0].evidenceIds
  assert.ok(reviewIssues(packet, review, [receipt]).some(x => x.includes('invalid boundary field')))
})
test('report includes original claims, judgments and scope without active raw HTML', () => {
  const { audit } = fixture(), report = renderAuditMarkdown(audit)
  assert.ok(report.includes('Original: Attempts a result'))
  assert.ok(report.includes('not a measured accuracy rate'))
  assert.ok(report.includes('all graph relationships'))
  assert.ok(!report.includes('<script>')); assert.ok(report.includes('&lt;script&gt;'))
})
