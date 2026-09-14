import test from 'node:test'
import assert from 'node:assert/strict'
import { traceEvidence, validateTracePlan, validateTraceReview } from '../scripts/lib/relationship-tracing.mjs'
import { renderTracing } from '../scripts/render-relationship-tracing.mjs'
const head = 'a'.repeat(40), old = 'b'.repeat(40)
const source = {
  catalog: (revision) => { if (revision !== 'head') throw new Error('unregistered revision'); return { commitSha: head, paths: ['src/a.ts', 'src/b.ts', 'src2/no.ts', 'src/image.png'] } },
  read: ({ path, startLine }) => ({ id: path + startLine, kind: 'source', path, commitSha: head, startLine, endLine: startLine, totalLines: 2, text: startLine === 2 ? 'mount Card()' : 'import Card' }),
}
const plan = () => ({ sources: [], searches: [{ revision: 'head', prefix: 'src', text: 'mount' }], reason: 'Follow consumer references' })
test('literal search follows late windows, respects prefix boundaries and records complete scanned scope', () => {
  const r = traceEvidence(plan(), source)
  assert.equal(r.searches[0].matches.length, 2)
  assert.deepEqual(r.searches[0].scannedPaths, ['src/a.ts', 'src/b.ts'])
  assert.ok(r.searches[0].completeWithinEligibleScope)
  assert.ok(r.evidence.every((e) => e.startLine === 2))
})
test('search cannot report complete coverage after file or per-file truncation', () => {
  const a = traceEvidence(plan(), source, { maxFiles: 1 }), b = traceEvidence(plan(), source, { maxWindowsPerFile: 1 })
  assert.equal(a.searches[0].completeWithinEligibleScope, false); assert.equal(a.searches[0].unscannedPaths.length, 1)
  assert.equal(b.searches[0].completeWithinEligibleScope, false); assert.equal(b.searches[0].incompletePaths.length, 2)
  assert.equal(b.searches[0].matches.length, 0)
})
test('match and byte caps preserve coverage receipts but disclose omitted evidence', () => {
  const a = traceEvidence(plan(), source, { maxMatches: 1 }), b = traceEvidence(plan(), source, { maxBytes: 0 })
  assert.equal(a.searches[0].omittedMatchingWindows, 1)
  assert.equal(b.searches[0].matchingWindows, 2); assert.equal(b.evidence.length, 0)
  assert.equal(b.searches[0].matches[0].evidenceId, null); assert.equal(b.omitted.length, 2)
})
test('overrequests are bounded with receipts; forbidden paths and sensitive content fail closed', () => {
  const p = plan(); p.searches = Array(5).fill(p.searches[0]); assert.equal(traceEvidence(p, source).omitted.length, 1)
  p.sources = [{ revision: 'head', path: '.env', startLine: 1 }]; assert.throws(() => validateTracePlan(p))
  assert.throws(() => traceEvidence(plan(), { ...source, read: () => { throw new Error('sensitive-looking content') } }))
  const bad = plan(); bad.searches[0].revision = 'not registered'; assert.equal(traceEvidence(bad, source).omitted.length, 1)
})
const claims = [{ id: 'L2' }], evidence = [{ id: 'S1', kind: 'source', commitSha: head }, { id: 'S2', kind: 'source', commitSha: old }]
const review = () => ({ assessments: [{ id: 'L2', outcome: { decision: 'include', type: 'contains', timeScope: 'historical', atCommits: [old], reason: 'Shared outcome in historical code', evidenceIds: ['S2'] }, wiring: { status: 'unknown', atCommit: head, statement: 'Current consumer not established', condition: null, evidenceIds: [], searchIds: [] }, history: [{ atCommit: old, statement: 'Mounted at this revision', evidenceIds: ['S2'] }], unresolved: [] }], unresolved: [] })
test('historical outcome membership coexists with unknown current wiring', () => {
  const r = review(); assert.deepEqual(validateTraceReview(r, claims, evidence, [], head), r)
})
test('review rejects mixed revisions, fabricated negative coverage, unknown IDs and incomplete accounting', () => {
  for (const edit of [
    (r) => r.assessments.pop(), (r) => { r.assessments[0].outcome.atCommits = [head] },
    (r) => { r.assessments[0].history[0].atCommit = head }, (r) => { r.assessments[0].wiring.status = 'not_found_in_scope' },
    (r) => { r.assessments[0].wiring.status = 'observed' }, (r) => { r.assessments[0].outcome.evidenceIds = ['bad'] },
    (r) => { delete r.assessments[0].history[0].atCommit },
  ]) { const r = review(); edit(r); assert.throws(() => validateTraceReview(r, claims, evidence, [], head)) }
})
test('comparison renders independent axes and preserves failed cells without injecting model HTML', () => {
  const r = review(); r.assessments[0].wiring.statement = '<script>not markup</script>'
  const html = renderTracing({ graph: { nodes: [] }, claims, reviews: [{ condition: 'original', order: 'forward', status: 'valid', value: r }], cost: 0, manifest: { headSha: head }, plans: [] }, { enriched: { evidence, searches: [] } })
  assert.ok(html.includes('Outcome: include')); assert.ok(html.includes('Current wiring: unknown'))
  assert.ok(html.includes('Unavailable: not run')); assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('href="#S2"'))
})
