import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOwnership } from '../scripts/render-behavior-ownership.mjs'
const sample = () => ({ status: 'incomplete', cost: 0.2, costComplete: true, nodes: [], pairs: [], comparison: [], agreement: null, diagnostics: [{ order: 'forward', tensions: null }], reviews: [{ order: 'forward', status: 'invalid', error: '<missing source>' }], stages: [{ name: 'ownership-forward', status: 'invalid' }], manifest: { design: 'Synthetic', limitations: 'Not accuracy' } })
test('ownership report does not turn invalid outputs into measurable agreement', () => {
  const html = renderOwnership(sample(), { evidence: [], searches: [] })
  assert.match(html, /Valid reviews: 0\/2/); assert.match(html, /Repeat agreement: not measurable/)
  assert.match(html, /&lt;missing source&gt;/); assert.doesNotMatch(html, /<missing source>/)
  assert.match(html, /ownership-forward.response.json/); assert.match(html, /not silently repaired/)
})
test('assessment is labeled separately and cited evidence is linked safely', () => {
  const html = renderOwnership(sample(), { evidence: [{ id: 'S1', kind: 'source', text: '<script>bad</script>' }], searches: [] }, { summary: 'Provisional', notes: [{ title: 'Check', text: 'Claim', evidenceIds: ['S1', 'missing'] }] })
  assert.match(html, /href="#S1"/); assert.match(html, /missing \(not in packet\)/)
  assert.match(html, /Assistant source spot-check, not an independent judge or model input/)
  assert.doesNotMatch(html, /<script>bad/)
})
test('readable rejected answers stay labeled invalid without altering saved data', () => {
  const data = sample(), before = structuredClone(data)
  const raw = { behaviors: [], roles: [], decisions: [], implementations: [], history: [], consistencyNotes: [], coverageLimits: ['Incomplete'] }
  const html = renderOwnership(data, { evidence: [], searches: [] }, null, { forward: raw })
  assert.match(html, /Unvalidated raw answer/); assert.match(html, /Valid reviews: 0\/2/)
  assert.deepEqual(data, before)
})
