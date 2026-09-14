import test from 'node:test'
import assert from 'node:assert/strict'
import { supplementalStructure, correctArmPresentation } from '../scripts/report-snapshot-stability.mjs'
const fixture = () => ({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [], lineage: [{ originalId: 'x', successorIds: ['a'], decision: 'retain' }], edgeLineage: [], comparisons: [], decisions: [], inspectedEvidenceIds: ['S'] })
test('supplemental check exposes duplicate successors and malformed split/merge cardinalities', () => {
  const g = fixture(); g.lineage[0] = { originalId: 'x', successorIds: ['a', 'a'], decision: 'split' }
  assert.deepEqual(supplementalStructure(g).duplicateSuccessors, ['x']); assert.deepEqual(supplementalStructure(g).malformedSplits, ['x'])
  g.lineage[0] = { originalId: 'x', successorIds: ['a'], decision: 'merge' }; assert.deepEqual(supplementalStructure(g).malformedMerges, ['x'])
})
test('parent count/depth remain visible when exact original member sets would collapse them', () => {
  const g = fixture(); g.nodes.push({ id: 'p' }); g.edges = [{ from: 'p', to: 'b', type: 'contains' }, { from: 'b', to: 'a', type: 'contains' }]
  const s = supplementalStructure(g); assert.equal(s.parentCount, 2); assert.equal(s.maxContainmentDepth, 2)
})
test('comparison citations absent from reported reading are flagged, not silently counted as read', () => {
  const g = fixture(); g.comparisons.push({ evidenceIds: ['not-reported'] })
  assert.deepEqual(supplementalStructure(g).citedButNotReportedConsulted, ['not-reported'])
})
test('presentation distinguishes available evidence and historical discovery from current reading', () => {
  const text = '<h1>Map</h1><p>192 source windows · 131 / 15,528 eligible files inspected</p><p>New discovery inspected 29 files.</p><p>Broad approval of the first map motivated this expansion. Other text.</p><h2>What was and wasn’t inspected</h2><p>100 unique source lines inspected.</p>'
  const html = correctArmPresentation(text, 9)
  assert.match(html, /reports consulting 9 receipt IDs/); assert.match(html, /source windows available/)
  assert.ok(!html.includes('eligible files inspected')); assert.ok(!html.includes('New discovery inspected')); assert.ok(!html.includes('Broad approval'))
})
