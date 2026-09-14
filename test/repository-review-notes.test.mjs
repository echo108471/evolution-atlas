import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { reviewRepositoryMap } from '../scripts/review-repository-map.mjs'

const anchor = (kind, id) => `${kind}-${Buffer.from(id, 'utf16le').toString('hex')}`
function fixture() {
  return { displayName: 'Synthetic repository', independentVerification: 'not-performed', graph: { nodes: [
    { id: 'one', name: 'One', summary: 'Shared text', conditions: ['Only when enabled'], claims: [{ text: 'Shared text', assessment: 'partial' }] },
    { id: 'two', name: 'Two', summary: 'Shared text' },
  ], edges: [] }, receipts: [{ id: 'A:001', kind: 'source', text: 'synthetic source' }, { id: 'search-1', kind: 'search' }] }
}
const note = (overrides = {}) => ({ nodeId: 'one', field: 'summary', expectedText: 'Shared text', status: 'qualified', basis: 'proposer-disclosed', message: 'Wording is broader than the inspected example.', evidenceIds: ['A:001'], ...overrides })
const packet = (output, notes = [note()]) => ({ graphSha256: createHash('sha256').update(JSON.stringify(output.graph)).digest('hex'), notes })
const article = (html, id) => html.split(`<article class="capability" id="${anchor('node', id)}">`)[1].split('</article>')[0]

test('notes bind exact node, field and claim.text without mutating the graph or inputs', () => {
  const original = fixture(), notes = packet(original, [note(), note({ field: 'conditions', index: 0, expectedText: 'Only when enabled' }), note({ field: 'claims', index: 0 })])
  const before = structuredClone({ original, notes }), result = reviewRepositoryMap(original, notes)
  assert.deepEqual({ original, notes }, before)
  assert.deepEqual(result.output.graph, original.graph)
  assert.notEqual(result.output.graph, original.graph)
  assert.deepEqual(result.output.reviewNotes, notes)
  assert.equal(result.output.independentVerification, 'not-performed')
  assert.match(result.html, /mechanical overlay performs no source or independent verification/)
  assert.equal((article(result.html, 'one').match(/Claim-local review note/g) ?? []).length, 3)
  assert.doesNotMatch(article(result.html, 'two'), /Claim-local review note/)
  assert.match(article(result.html, 'one'), /claims\[0\]/)
  assert.match(result.html, new RegExp(`href="#${anchor('source', 'A:001')}"`))
  result.output.reviewNotes.notes[0].message = 'Separate copy'
  assert.equal(notes.notes[0].message, before.notes.notes[0].message)
  delete original.independentVerification
  assert.equal(reviewRepositoryMap(original, notes).output.independentVerification, 'not-performed')
})

test('all note text is escaped and unusual IDs retain distinct anchors', () => {
  const original = fixture(), attack = '<script>"&\'</script> $& $`', ids = ['a:b', 'a%3Ab', '\ud800', '\ud801']
  original.graph.nodes = ids.map(id => ({ id, name: id, summary: attack }))
  original.receipts = ids.map(id => ({ id, kind: 'source', text: 'synthetic' }))
  const notes = packet(original, ids.map(id => note({ nodeId: id, expectedText: attack, message: attack, evidenceIds: [id] })))
  const { html } = reviewRepositoryMap(original, notes)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;&quot;&amp;&#39;&lt;\/script&gt;/)
  assert.ok(article(html, ids[0]).includes('$&amp; $`'))
  for (const id of ids) {
    assert.equal((article(html, id).match(/Claim-local review note/g) ?? []).length, 1)
    assert.ok(html.includes(`href="#${anchor('source', id)}"`))
  }
})

test('reject stale graph or exact text, missing target, duplicate targets and non-source references', () => {
  const original = fixture()
  assert.throws(() => reviewRepositoryMap(original, { ...packet(original), graphSha256: 'a'.repeat(64) }), /SHA-256 mismatch/)
  for (const invalid of [note({ nodeId: 'absent' }), note({ expectedText: 'Different' }), note({ field: 'claims', index: 2 }), note({ field: 'conditions', index: 0 }), note({ evidenceIds: ['search-1'] }), note({ evidenceIds: ['unknown'] }), note({ evidenceIds: ['A:001', 'A:001'] }), note({ evidenceIds: [] })]) assert.throws(() => reviewRepositoryMap(original, packet(original, [invalid])))
  assert.throws(() => reviewRepositoryMap(original, packet(original, [note(), note()])), /Duplicate review target/)
  const missingSource = structuredClone(original)
  missingSource.receipts = []
  assert.throws(() => reviewRepositoryMap(missingSource, packet(missingSource)), /known source/)
})

test('reject malformed text, enums, indices, schema additions and conflicting review state', () => {
  const original = fixture()
  for (const invalid of [note({ message: ' ' }), note({ expectedText: 1 }), note({ status: 'verified' }), note({ basis: 'independently-verified' }), note({ field: 'name' }), note({ index: 0 }), note({ field: 'claims' }), note({ field: 'claims', index: -1 }), note({ field: 'claims', index: 0.5 }), note({ approved: true })]) assert.throws(() => reviewRepositoryMap(original, packet(original, [invalid])))
  assert.throws(() => reviewRepositoryMap(original, { ...packet(original), approved: true }), /schema/)
  const reviewed = reviewRepositoryMap(original, packet(original)).output
  assert.deepEqual(reviewRepositoryMap(reviewed, packet(original)).output, reviewed)
  assert.throws(() => reviewRepositoryMap(reviewed, packet(original, [])), /Existing review notes mismatch/)
  assert.throws(() => reviewRepositoryMap({ ...original, independentVerification: 'verified' }, packet(original)), /independentVerification/)
})

test('CLI creates only companions, verifies exact replay and refuses conflicts before writes', t => {
  const run = mkdtempSync(join(tmpdir(), 'repository-review-'))
  t.after(() => rmSync(run, { recursive: true, force: true }))
  const original = fixture(), originalBytes = JSON.stringify(original), notesPath = join(run, 'notes.json')
  writeFileSync(join(run, 'output.json'), originalBytes)
  writeFileSync(notesPath, JSON.stringify(packet(original)))
  const cli = () => spawnSync(process.execPath, [new URL('../scripts/review-repository-map.mjs', import.meta.url).pathname, run, notesPath], { encoding: 'utf8' })
  const first = cli()
  assert.equal(first.status, 0, first.stderr)
  const saved = readFileSync(join(run, 'reviewed-output.json')), html = readFileSync(join(run, 'reviewed.html'))
  assert.equal(cli().status, 0)
  assert.deepEqual(readFileSync(join(run, 'reviewed-output.json')), saved)
  assert.deepEqual(readFileSync(join(run, 'reviewed.html')), html)
  assert.equal(readFileSync(join(run, 'output.json'), 'utf8'), originalBytes)
  writeFileSync(notesPath, JSON.stringify(packet(original, [note({ message: 'Changed review' })])))
  assert.match(cli().stderr, /Refusing changed review artifact/)
  assert.deepEqual(readFileSync(join(run, 'reviewed-output.json')), saved)
  rmSync(join(run, 'reviewed-output.json'))
  assert.match(cli().stderr, /Refusing changed review artifact/)
  assert.equal(existsSync(join(run, 'reviewed-output.json')), false)
  symlinkSync(join(run, 'output.json'), join(run, 'reviewed-output.json'))
  assert.match(cli().stderr, /Regular artifact required/)
})
