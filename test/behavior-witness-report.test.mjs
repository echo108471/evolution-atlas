import test from 'node:test'
import assert from 'node:assert/strict'
import { renderWitnessReport } from '../scripts/report-boundary-witness.mjs'
const fixture = () => ({ packet: { pairs: [{ id: 'P1', left: { name: '<script>left</script>' }, right: { name: 'right' } }], receipts: [] }, runs: [{ run: 'P1', condition: 'prose', state: 'saved-invalid', rawSha256: 'hash', issues: [{ message: '<img onerror=bad>' }] }], metrics: { conditions: { prose: { agreeingPairs: 0, comparablePairs: 0 }, witness: { agreeingPairs: 0, comparablePairs: 0 } }, limits: ['No accuracy inference'] } })
test('report escapes candidate text and preserves invalid output visibility', () => {
  const html = renderWitnessReport(fixture(), '')
  assert.ok(!html.includes('<script>left')); assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<img onerror'))
  assert.match(html, /saved-invalid/); assert.match(html, /First complete raw output/); assert.match(html, /0\/0 comparable pairs/)
})
test('report presents all pairs with limits and unchanged candidate definitions', () => {
  const html = renderWitnessReport(fixture(), '')
  assert.match(html, /Both original definitions, unchanged/); assert.match(html, /Agreement is not correctness/)
  assert.match(html, /No capability map is changed/); assert.match(html, /No accuracy inference/)
})
test('source anchors with colon namespaces resolve after fragment decoding', () => {
  const f = fixture(); f.packet.receipts = [{ id: 'old:A-001', path: 'source.ts', startLine: 1, endLine: 1, text: 'value' }]
  f.runs = [{ run: 'P1', condition: 'prose', state: 'saved-valid', output: { inspectedEvidenceIds: ['old:A-001'], limitations: [], decisions: [{ pairId: 'P1', relation: 'distinct', disposition: 'separate', reason: 'reason', evidenceIds: ['old:A-001'], revisionTrigger: 'new evidence', uncertainty: [] }] } }]
  const html = renderWitnessReport(f, '')
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))
  for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(decodeURIComponent(fragment)), fragment)
})
