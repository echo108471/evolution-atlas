import test from 'node:test'
import assert from 'node:assert/strict'
import { conditionalContext, conditionalRequest, validateConditionalPlan, validateConditionalReview, conditionalCandidates } from '../scripts/lib/conditional-relationships.mjs'
import { renderConditionalRelationships } from '../scripts/render-conditional-relationships.mjs'
const head = 'a'.repeat(40), evidence = [{ id: 'S1', kind: 'source', commitSha: head }, { id: 'S2', kind: 'source', commitSha: 'b'.repeat(40) }, { id: 'R1', kind: 'reading' }]
const claims = [{ id: 'L1', from: 'N1', to: 'N2', type: 'depends_on', reason: 'hidden proposer judgment' }]
const review = () => ({ decisions: [{ id: 'L1', decision: 'include', relationship: { type: 'depends_on', atCommit: head, condition: { text: 'Optional branch is enabled', evidenceIds: ['S1'] } }, reason: 'A branch calls the provider', evidenceIds: ['S1'], missingEvidence: [] }], unresolved: [] })
test('conditions survive serialization and candidate projection without mutating inherited claims', () => {
  const original = structuredClone(claims), r = review()
  validateConditionalReview(r, claims, evidence, head)
  const c = conditionalCandidates(claims, JSON.parse(JSON.stringify(r)))[0]
  assert.deepEqual(c.condition, r.decisions[0].relationship.condition)
  assert.equal(c.applicationStatus, 'not-composed'); assert.deepEqual(claims, original)
})
test('conditional review fails closed on missing accounting, invented or historical-only conditions', () => {
  for (const edit of [
    (r) => r.decisions.pop(), (r) => r.decisions.push(r.decisions[0]),
    (r) => { r.decisions[0].relationship.condition.evidenceIds = ['S2'] },
    (r) => { r.decisions[0].relationship.condition.evidenceIds = ['unknown'] },
    (r) => { r.decisions[0].relationship.condition.text = '' },
    (r) => { r.decisions[0].relationship.atCommit = 'b'.repeat(40) },
    (r) => { r.decisions[0].relationship.from = 'N3' },
    (r) => { r.decisions[0].decision = 'defer' },
    (r) => { r.decisions[0].evidenceIds = ['R1'] },
  ]) { const r = review(); edit(r); assert.throws(() => validateConditionalReview(r, claims, evidence, head)) }
})
test('unqualified and deferred interpretations are representable without fabricated predicates', () => {
  const r = review(); r.decisions[0].relationship.condition = null
  validateConditionalReview(r, claims, evidence, head)
  r.decisions[0].decision = 'defer'; r.decisions[0].relationship = null; r.decisions[0].evidenceIds = []
  validateConditionalReview(r, claims, evidence, head); assert.deepEqual(conditionalCandidates(claims, r), [])
})
test('review cells differ only by evidence packet and claim ordering, with no earlier judgments', () => {
  const cs = [...claims, { ...claims[0], id: 'L2' }], a = conditionalContext({}, cs, evidence, head), b = conditionalContext({}, cs, evidence, head, true)
  b.claims.reverse(); assert.deepEqual(a, b); assert.equal(a.claims[0].reason, undefined)
  const x = conditionalRequest('review', a, 'test'), y = conditionalRequest('review', { ...a, retrievedEvidence: [] }, 'test')
  assert.equal(x.messages[0].content, y.messages[0].content)
})
test('retrieval plan bounds windows and permits only known safe paths and revisions', () => {
  const p = { sources: [{ revision: 'head', path: 'src/page.ts', startLine: 80 }], readingIds: [], searches: [], reason: 'Follow the omitted window' }
  validateConditionalPlan(p, { paths: ['src/page.ts'] }, evidence, [])
  for (const edit of [(v) => { v.sources[0].path = '.env' }, (v) => { v.sources[0].revision = 'unknown' }, (v) => { v.sources[0].startLine = 0 }, (v) => { v.sources = Array(13).fill(v.sources[0]) }]) {
    const q = structuredClone(p); edit(q); assert.throws(() => validateConditionalPlan(q, { paths: ['src/page.ts'] }, evidence, []))
  }
})
test('report preserves explicit conditions, failed cells, citations and escaping', () => {
  const r = review(); r.decisions[0].relationship.condition.text = '<script>optional</script>'
  const html = renderConditionalRelationships({ graph: { nodes: [] }, claims, plan: { status: 'invalid', error: 'failure' }, manifest: { headSha: head, limitations: 'bounded' }, cost: 0, reviews: [{ condition: 'enriched', order: 'forward', status: 'valid', value: r }] }, { original: evidence, enriched: evidence }, {})
  assert.ok(html.includes('Only when: &lt;script&gt;optional&lt;/script&gt;'))
  assert.ok(html.includes('Unavailable: not run')); assert.ok(html.includes('href="#S1"'))
  assert.ok(!html.includes('<script>optional</script>'))
})
