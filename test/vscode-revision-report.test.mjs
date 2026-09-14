import test from 'node:test'
import assert from 'node:assert/strict'
import { revisionMarkdown, revisionMap, recheckSummary } from '../scripts/report-vscode-revision.mjs'
function fixture() {
  const node = { id: 'N', name: 'Synthetic capability', summary: 'Current summary', actor: 'User', inputs: [], outcomes: ['Result'], conditions: [], exclusions: [], implementations: [], uncertainty: [], evidenceIds: ['S'], assessment: 'partial', claims: [{ text: 'Current claim', evidenceIds: ['S'], assessment: 'partial' }] }
  const output = { candidate: { graph: { nodes: [node], edges: [] }, beforeGraphSha256: 'a'.repeat(64), graphSha256: 'b'.repeat(64),
    reviewState: { changedNodeIds: ['N'] }, lineage: [{ originalId: 'N', decision: 'revise' }],
    revisions: [{ nodeId: 'N', field: 'summary', before: 'Old summary', after: 'Current summary', reason: 'Bounded scope', evidenceIds: ['S'] }],
    decisions: [{ findingId: 'F', action: 'revise', reason: '<script>not active</script>', evidenceIds: ['S'] }], limitations: [],
    receipts: [{ id: 'S', kind: 'source', commitSha: 'c'.repeat(40), blobSha: 'd'.repeat(40), path: 'src/test.ts', startLine: 1, endLine: 1, text: 'synthetic()', truncated: false }] },
    reviews: [{ reviewer: 'A', reviews: [{ nodeId: 'N', definitionVerdict: 'qualified', reason: 'Remaining boundary', evidenceIds: ['S'],
      claims: [{ claimIndex: 0, verdict: 'supported', reason: 'Scope matches', evidenceIds: ['S'], replacement: null }],
      boundaryFindings: [{ field: 'conditions[0]', verdict: 'qualified', reason: 'Additional check', evidenceIds: ['S'], replacement: 'Proposed next wording' }] }], limitations: ['Source only'] }] }
  return { output, baseline: { manifest: { commitSha: 'c'.repeat(40) }, coverage: { eligibleFiles: 100 }, limitations: [] } }
}
test('revision report retains before/after, remaining findings and candidate status', () => {
  const { output } = fixture(), md = revisionMarkdown(output)
  assert.ok(md.includes('Before: Old summary')); assert.ok(md.includes('After: Current summary'))
  assert.ok(md.includes('Proposed next correction: Proposed next wording'))
  assert.ok(md.includes('No previous review approval transfers'))
  assert.ok(!md.includes('<script>')); assert.ok(md.includes('&lt;script&gt;'))
  assert.equal(recheckSummary(output).claims.supported, 1)
  assert.equal(recheckSummary(output).definitions.qualified, 1)
})
test('complete map distinguishes static recheck from runtime verification and has current record links', () => {
  const { output, baseline } = fixture(), html = revisionMap(output, baseline)
  assert.ok(html.includes('Fresh static-source recheck: qualified'))
  assert.ok(html.includes('runtime verification: not performed'))
  assert.ok(html.includes('id="N"')); assert.ok(html.includes('href="candidate.json"'))
  assert.ok(!html.includes('href="reconciled.json"'))
  assert.ok(html.includes('href="../vscode-discovery-1/inventory.json"'))
})
