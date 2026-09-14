import test from 'node:test'
import assert from 'node:assert/strict'
import { recheckPacket, recheckOverlay, writeOrVerify } from '../scripts/vscode-revision-loop.mjs'
import { sha } from '../scripts/vscode-snapshot-evidence.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
function fixture() {
  const candidate = { graphSha256: 'a'.repeat(64), graph: { nodes: [{ id: 'N', name: 'Capability', summary: 'Revised behavior', assessment: 'partial', uncertainty: ['Revision reasoning'], evidenceIds: ['S1', 'S2'], claims: [{ text: 'Current behavior', evidenceIds: ['S2'], assessment: 'partial' }] }], edges: [] },
    receipts: [{ id: 'S1', kind: 'source' }, { id: 'S2', kind: 'source' }, { id: 'S3', kind: 'source' }, { id: 'S4', kind: 'source' }],
    proposal: { decisions: ['Hidden old reasoning'] }, previousDecisionRecords: { owner: 'Hidden owner feedback' } }
  return { candidate, sample: { reviewer: 'A', nodeIds: ['N'], evidenceIds: ['S1'] }, extra: ['S3'] }
}
test('fresh recheck sees current definitions plus fixed source without prior reasoning or verdicts', () => {
  const { candidate, sample, extra } = fixture(), packet = recheckPacket(candidate, sample, extra)
  assert.deepEqual(Object.keys(packet), ['reviewer', 'graphSha256', 'nodes', 'receipts'])
  assert.equal(packet.nodes[0].summary, 'Revised behavior')
  assert.equal(packet.nodes[0].assessment, undefined); assert.equal(packet.nodes[0].uncertainty, undefined)
  assert.equal(packet.nodes[0].claims[0].assessment, undefined)
  assert.deepEqual(packet.receipts.map(r => r.id), ['S1', 'S2', 'S3'])
  assert.ok(!JSON.stringify(packet).includes('Hidden'))
})
test('recheck refuses missing sampled nodes or source evidence', () => {
  const { candidate, sample, extra } = fixture()
  assert.throws(() => recheckPacket(candidate, { ...sample, nodeIds: ['missing'] }, extra), /sample node/)
  assert.throws(() => recheckPacket(candidate, sample, ['missing']), /source missing/)
})
test('fresh sidecar binds the revised version and rejects stale candidate or packet content', () => {
  const { candidate, sample, extra } = fixture(), packet = recheckPacket(candidate, sample, extra)
  const review = { reviewer: 'A', reviews: [{ nodeId: 'N', definitionVerdict: 'supported', reason: 'Source support', evidenceIds: ['S2'],
    claims: [{ claimIndex: 0, verdict: 'supported', reason: 'Precise behavior', evidenceIds: ['S2'], replacement: null }], boundaryFindings: [] }], limitations: ['Static only'] }
  const output = { candidate, packets: [packet], reviews: [review], issues: [], manifest: { candidateSha256: sha(candidate), packets: { A: sha(packet) } } }
  const overlay = recheckOverlay(output)
  assert.equal(overlay.graphSha256, candidate.graphSha256); assert.deepEqual(overlay.inheritedApprovals, [])
  assert.equal(overlay.entries.length, 2); assert.equal(overlay.runtimeVerified, false)
  output.packets[0].nodes[0].summary = 'Changed later'; assert.throws(() => recheckOverlay(output), /target changed/)
  output.packets[0] = packet; candidate.graph.nodes[0].summary = 'Changed later'
  assert.throws(() => recheckOverlay(output), /version changed/)
})
test('artifact replay resumes missing files but never overwrites a different saved output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'candidate-revision-test-'))
  try {
    const file = join(dir, 'output.json')
    assert.equal(writeOrVerify(file, 'original'), 'created')
    assert.equal(writeOrVerify(file, 'original'), 'verified-existing')
    assert.throws(() => writeOrVerify(file, 'changed'), /differs/)
    assert.equal(readFileSync(file, 'utf8'), 'original')
    assert.equal(writeOrVerify(join(dir, 'next.json'), 'new'), 'created')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
