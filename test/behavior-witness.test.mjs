import test from 'node:test'
import assert from 'node:assert/strict'
import { witnessIssues, witnessMetrics, facetKeys } from '../scripts/lib/behavior-witness.mjs'
import { protocol } from '../scripts/snapshot-boundary-witness.mjs'
const packet = { pairs: [{ id: 'P1' }], receipts: [{ id: 'S', startLine: 10, endLine: 20 }] }
const fact = () => ({ statement: 'Concrete outcome with a condition', citations: [{ receiptId: 'S', startLine: 11, endLine: 12 }] })
const output = (condition = 'prose') => ({ schemaVersion: '0.1.0', packetSha256: 'hash', condition,
  decisions: [{ pairId: 'P1', relation: 'distinct', disposition: 'Keep separate candidates', reason: 'Different evidenced outcomes', evidenceIds: ['S'], uncertainty: [], revisionTrigger: 'An evidenced shared observable outcome',
    ...(condition === 'witness' ? { facets: Object.fromEntries(facetKeys.map(k => [k, ['left', 'right'].includes(k) ? [fact()] : []])), sharedBehaviorStatus: 'not-established', separationTest: { scenario: 'Invoke left operation', expectedLeft: 'Left outcome', expectedRight: 'No right outcome established', evidenceIds: ['S'], limit: 'Static inference, not executed' } } : {}) }], inspectedEvidenceIds: ['S'], limitations: ['Bounded source'] })
test('both protocol representations validate without imposing a relation label', () => {
  for (const condition of ['prose', 'witness']) assert.deepEqual(witnessIssues(output(condition), packet, condition, 'hash'), [])
  const o = output('witness'); o.decisions[0].relation = 'uncertain'; assert.deepEqual(witnessIssues(o, packet, 'witness', 'hash'), [])
})
test('wrong packet, condition and schema are rejected', () => {
  const o = output(); o.packetSha256 = 'other'; o.condition = 'witness'; o.schemaVersion = 'future'
  assert.equal(witnessIssues(o, packet, 'prose', 'hash').length, 3)
})
test('every pair exactly once; missing and duplicate decisions remain failures', () => {
  const o = output(); o.decisions.push(structuredClone(o.decisions[0])); assert.ok(witnessIssues(o, packet, 'prose', 'hash').some(i => i.message.includes('duplicate')))
  o.decisions = []; assert.ok(witnessIssues(o, packet, 'prose', 'hash').some(i => i.message.includes('missing pair')))
})
test('line ranges must be ordered integers inside available evidence', () => {
  for (const [startLine, endLine] of [[9, 12], [12, 21], [15, 12], [10.5, 12]]) {
    const o = output('witness'); Object.assign(o.decisions[0].facets.left[0].citations[0], { startLine, endLine })
    assert.ok(witnessIssues(o, packet, 'witness', 'hash').some(i => i.message.includes('citation range')))
  }
})
test('unknown and unreported source IDs are visible failures', () => {
  const o = output(); o.decisions[0].evidenceIds = ['missing']; assert.ok(witnessIssues(o, packet, 'prose', 'hash').some(i => i.target.endsWith('evidenceIds')))
  const w = output('witness'); w.inspectedEvidenceIds = []; assert.ok(witnessIssues(w, packet, 'witness', 'hash').some(i => i.message.includes('not reported')))
})
test('shared behavior status must match its claimed evidence, but absence is not forced to distinct', () => {
  const o = output('witness'); o.decisions[0].sharedBehaviorStatus = 'established'
  assert.ok(witnessIssues(o, packet, 'witness', 'hash').length)
  o.decisions[0].facets.sharedBehavior = [fact()]; assert.deepEqual(witnessIssues(o, packet, 'witness', 'hash'), [])
  o.decisions[0].sharedBehaviorStatus = 'unknown'; assert.ok(witnessIssues(o, packet, 'witness', 'hash').length)
})
test('prose controls cannot silently switch to treatment schema', () => {
  const o = output(); o.decisions[0].facets = {}; assert.ok(witnessIssues(o, packet, 'prose', 'hash').length)
})
test('malformed records produce diagnostics rather than parser crashes', () => {
  for (const bad of [null, [], {}, { decisions: [null] }, { decisions: 'no' }]) assert.ok(witnessIssues(bad, packet, 'witness', 'hash').length)
})
test('recurrence uses two valid runs per condition and never scores missing results as agreement', () => {
  const runs = [{ run: 'P1', condition: 'prose', state: 'saved-valid', output: output() }, { run: 'P2', condition: 'prose', state: 'saved-invalid' }]
  const m = witnessMetrics(runs, packet); assert.equal(m.conditions.prose.comparablePairs, 0); assert.equal(m.conditions.prose.pairs[0].agreement, null); assert.equal(m.fullCoverage, false)
  runs[1] = { ...runs[1], state: 'saved-valid', output: output() }; assert.equal(witnessMetrics(runs, packet).conditions.prose.agreeingPairs, 1)
  runs[1].output.decisions[0].relation = 'overlapping'; assert.equal(witnessMetrics(runs, packet).conditions.prose.agreeingPairs, 0)
})
test('both prompts have identical relation choices and writing guidance, with no expected case labels', () => {
  for (const c of ['prose', 'witness']) {
    const p = protocol(c); assert.match(p, /same, overlapping, broader, narrower, distinct, or uncertain/); assert.match(p, /250 words per pair/); assert.ok(!p.includes('A2')); assert.ok(!p.includes('C1'))
  }
})
