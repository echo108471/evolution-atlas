import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import * as legacy from '../scripts/versions/repository-engine-v1/repository-engine.mjs'
import { prepareEngine, inspectEngine, engineBroker, checkpointEngine, freezeIntegration, publishEngine, recordEngineLaunch, recordEngineTerminal } from '../scripts/repository-engine.mjs'

const json = x => JSON.stringify(x, null, 2) + '\n'
function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repository-engine-test-'))), repo = root + '/source', out = root + '/initial'
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync('git', ['init', '-q', repo], { env })
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'test@example.invalid'])
  writeFileSync(repo + '/main.go', 'package main\nfunc main() {}\n'); writeFileSync(repo + '/other.go', 'package main\nfunc other() {}\n')
  git(['add', '--all']); git(['commit', '-qm', 'Synthetic source'])
  const config = { mode: 'discovery', repo, displayName: 'Synthetic project', partitionCount: 1 }
  return { root, repo, out, config, git }
}
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, json(value), { flag: 'wx' }) }
const node = (id, evidence) => ({ id, name: 'Synthetic ' + id, summary: 'Synthetic responsibility', actor: 'Synthetic caller', inputs: [], outcomes: ['Synthetic result'], conditions: [], exclusions: [], implementations: [], uncertainty: [], evidenceIds: [evidence], assessment: 'partial', claims: [{ text: 'Synthetic claim', evidenceIds: [evidence], assessment: 'partial' }] })
function proposal(out, receipt) {
  const value = { agent: 'A', scopeSummary: 'Synthetic test data; not model inference', coverage: { inspected: [receipt.path], omissions: ['Other behavior not examined'] }, crossPartitionLeads: [], nodes: [node('A1', receipt.id)], edges: [], limitations: ['Synthetic fixture'] }
  save(out + '/proposals/A.json', value); return value
}
function integrate(out) {
  freezeIntegration(out)
  const packet = JSON.parse(readFileSync(out + '/integration-input.json')), nodes = [...packet.baseline.graph.nodes, ...packet.proposals.flatMap(p => p.nodes)]
  const graph = { nodes, edges: [], lineage: nodes.map(n => ({ originalId: n.id, successorIds: [n.id], decision: 'retain', reason: 'Synthetic exact retain' })), edgeLineage: [], decisions: [], limitations: ['Synthetic fixture'], comparisons: [] }
  if (packet.baseline.graph.nodes.length) graph.comparisons = packet.proposals.flatMap(p => p.nodes).map(n => ({ newNodeId: n.id, existingNodeIds: packet.baseline.graph.nodes.map(n => n.id), relation: 'distinct', reason: 'Synthetic comparison', disposition: 'Retain separately', evidenceIds: n.evidenceIds, uncertainty: [] }))
  save(out + '/reconciled.json', graph); checkpointEngine(out, 'R'); return publishEngine(out)
}
function firstRun(f) {
  prepareEngine(f.out, f.config); const r = engineBroker(f.out, 'A', 'read', ['main.go']); proposal(f.out, r); checkpointEngine(f.out, 'A'); return integrate(f.out)
}

test('archived v1 runtime exactly preserves the original six source pins', () => {
  const pins = {
    'repository-engine.mjs': 'dacd3a87c9efe6c46d7705e3026f2381719ce3463f33ee460bb32bb737e45c1a',
    'repository-run-plan.mjs': '048b3ff7a22d8faebf86263049284e9206221fd43925da57f978566e31f19b84',
    'lib/repository-snapshot.mjs': 'b19583e312ec953c760f5c82dd4efd6671d9aba4c138acae31305ac2571a7365',
    'lib/repository-source.mjs': 'fb4a45680144896d755ba5fba28ad917bfdabbb7686636a0494fbdd871542c85',
    'lib/repository-engine-contract.mjs': '24012a30ee2205cf8971e45dd0e1e6f66fc7e3f700dc66584ed27e61c69bdc03',
    'render-repository-map.mjs': '52bdec5b7f7085d2e7ae262151af108b88ea8dd07ccbe0a54bd5b8f51a197989',
  }
  for (const [file, pin] of Object.entries(pins)) assert.equal(createHash('sha256').update(readFileSync(new URL('../scripts/versions/repository-engine-v1/' + file, import.meta.url))).digest('hex'), pin, file)
})

test('stable entry point resumes and replays v1 bytes while new runs use v2', t => {
  const f = fixture(t)
  legacy.prepareEngine(f.out, f.config)
  const r = engineBroker(f.out, 'A', 'read', ['main.go'])
  proposal(f.out, r); checkpointEngine(f.out, 'A'); integrate(f.out)
  assert.equal(inspectEngine(f.out).plan.version, 'repository-engine/1')
  const artifacts = ['run-plan.json', 'protocol.md', 'integration-input.json', 'output.json', 'index.html'].map(p => [p, readFileSync(f.out + '/' + p)])
  prepareEngine(f.out, f.config); freezeIntegration(f.out); publishEngine(f.out)
  for (const [p, bytes] of artifacts) assert.deepEqual(readFileSync(f.out + '/' + p), bytes)
  const next = prepareEngine(f.root + '/v2', { ...f.config, mode: 'expansion', baseline: f.out + '/output.json' })
  assert.equal(next.plan.version, 'repository-engine/2')
  assert.equal(readFileSync(next.out + '/protocol.md', 'utf8'), readFileSync(f.out + '/protocol.md', 'utf8'))
  assert.deepEqual(next.manifest.budgets, inspectEngine(f.out).manifest.budgets)
  assert.deepEqual(next.baseline.receipts[0].text, r.text)
})

test('v2 packet references baseline receipts exactly once without dropping evidence or changing candidates', t => {
  const f = fixture(t); firstRun(f)
  const out = f.root + '/expansion'
  prepareEngine(out, { ...f.config, mode: 'expansion', baseline: f.out + '/output.json' })
  const r = engineBroker(out, 'A', 'read', ['other.go'])
  const p = proposal(out, r); checkpointEngine(out, 'A'); freezeIntegration(out)
  const state = inspectEngine(out), path = out + '/integration-input.json', bytes = readFileSync(path), packet = JSON.parse(bytes)
  assert.equal(packet.version, 'repository-engine/2')
  assert.deepEqual(packet.baseline.graph, state.baseline.graph)
  assert.deepEqual(packet.baseline.receiptIds, state.baseline.receipts.map(r => r.id))
  assert.equal(Object.hasOwn(packet.baseline, 'receipts'), false)
  assert.deepEqual(packet.receipts, state.receipts)
  assert.deepEqual(packet.proposals, [p])
  assert.equal(new Set(packet.receipts.map(r => r.id)).size, packet.receipts.length)
  assert.ok(Buffer.byteLength(json({ ...packet, baseline: state.baseline })) > bytes.length)
  freezeIntegration(out); assert.deepEqual(readFileSync(path), bytes)
  writeFileSync(path, json({ ...packet, baseline: { ...packet.baseline, receiptIds: [] } }))
  assert.throws(() => inspectEngine(out), /Integration input changed/)
  writeFileSync(path, bytes)
  writeFileSync(path, json({ ...packet, receipts: packet.receipts.slice(1) }))
  assert.throws(() => inspectEngine(out), /Integration input changed/)
})

test('unknown runtime versions and changed legacy pins fail closed without migrating saved files', t => {
  const f = fixture(t); legacy.prepareEngine(f.out, f.config)
  const path = f.out + '/run-plan.json', original = JSON.parse(readFileSync(path))
  writeFileSync(path, json({ ...original, version: 'repository-engine/unknown' }))
  const unsupported = readFileSync(path)
  assert.throws(() => inspectEngine(f.out), /Unsupported/)
  assert.throws(() => prepareEngine(f.out, f.config), /Unsupported/)
  assert.deepEqual(readFileSync(path), unsupported)
  writeFileSync(path, json({ ...original, engines: { ...original.engines, 'repository-engine.mjs': 'changed' } }))
  assert.throws(() => inspectEngine(f.out), /engine changed/)
})

test('one entry point completes discovery, checkpointed integration, full report and exact replay', t => {
  const f = fixture(t), result = firstRun(f)
  assert.equal(result.status, 'candidate-map-produced'); assert.equal(result.nodes, 1)
  const output = readFileSync(f.out + '/output.json'), html = readFileSync(f.out + '/index.html')
  assert.equal(JSON.parse(output).independentVerification, 'not-performed')
  assert.equal(JSON.parse(output).coverage.eligibleFiles, 2)
  assert.deepEqual(publishEngine(f.out), result)
  assert.deepEqual(readFileSync(f.out + '/output.json'), output); assert.deepEqual(readFileSync(f.out + '/index.html'), html)
  assert.throws(() => engineBroker(f.out, 'A', 'read', ['other.go']), /Saved output seals/)
  assert.throws(() => recordEngineLaunch(f.out, 'A', 'new-host'), /Check host/)
})

test('expansion reconstructs full pinned inventory and withholds cumulative prior evidence and review metadata', t => {
  const f = fixture(t); firstRun(f)
  const original = JSON.parse(readFileSync(f.out + '/output.json'))
  original.graph.reviewStatus = 'accepted'; original.graph.nodes[0].independentVerification = 'verified'; original.graph.nodes[0].claims[0].reviewStatus = 'accepted'
  const baseline = f.root + '/reviewed-original.json'; save(baseline, original)
  const out = f.root + '/expansion', config = { ...f.config, mode: 'expansion', baseline }
  const state = prepareEngine(out, config)
  assert.deepEqual(state.inventory.files.map(f => f.path), ['other.go'])
  assert.deepEqual(state.full.files.map(f => f.path), ['main.go', 'other.go'])
  assert.ok(!readFileSync(out + '/baseline-input.json', 'utf8').includes('verified'))
  assert.ok(!readFileSync(out + '/baseline-input.json', 'utf8').includes('accepted'))
  assert.deepEqual(readFileSync(out + '/history/baseline-output.json'), readFileSync(baseline))
  assert.throws(() => engineBroker(out, 'A', 'read', ['main.go']), /not eligible/)
  const r = engineBroker(out, 'A', 'read', ['other.go']); proposal(out, r); checkpointEngine(out, 'A')
  const result = integrate(out); assert.equal(result.nodes, 2)
  const next = prepareEngine(f.root + '/third', { ...config, baseline: out + '/output.json' })
  assert.equal(next.full.files.length, 2); assert.equal(next.inventory.files.length, 0)
  assert.equal(next.baseline.receipts.length, 2)
})

test('interrupted assignment resumes without inferring liveness, losing receipts or auto-dispatching', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  const r = engineBroker(f.out, 'A', 'read', ['main.go'])
  assert.equal(inspectEngine(f.out).jobs[0].state, 'partial-evidence-needs-explicit-resume')
  recordEngineLaunch(f.out, 'A', 'host-1')
  assert.equal(inspectEngine(f.out).jobs[0].state, 'runtime-check-required')
  assert.throws(() => recordEngineLaunch(f.out, 'A', 'host-2'), /Check host/)
  assert.throws(() => recordEngineTerminal(f.out, 'A', 'wrong-host', 'interrupted'), /handle must match/)
  recordEngineTerminal(f.out, 'A', 'host-1', 'interrupted')
  recordEngineLaunch(f.out, 'A', 'host-2')
  proposal(f.out, r); checkpointEngine(f.out, 'A')
  assert.equal(inspectEngine(f.out).jobs[0].state, 'checkpointed')
  assert.deepEqual(JSON.parse(readFileSync(f.out + '/receipts/A/A-001.json')), r)
  assert.equal(readdirSync(f.out + '/receipts/A').length, 1)
})

test('first invalid raw output remains visible and prevents semantic retry', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  const r = engineBroker(f.out, 'A', 'read', ['main.go']); proposal(f.out, r)
  const path = f.out + '/proposals/A.json'; writeFileSync(path, '{unfinished')
  assert.equal(inspectEngine(f.out).jobs[0].state, 'saved-invalid')
  assert.throws(() => checkpointEngine(f.out, 'A'), /Valid saved output/)
  assert.throws(() => recordEngineLaunch(f.out, 'A', 'retry'), /Check host/)
  assert.equal(readFileSync(path, 'utf8'), '{unfinished')
})

test('receipt bytes, search results, metadata and checkpoint receipt sets are all binding', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  const r = engineBroker(f.out, 'A', 'search', ['main', 'func']), path = f.out + '/receipts/A/A-001.json'
  writeFileSync(path, json({ ...r, totalMatches: 99 }))
  assert.throws(() => inspectEngine(f.out), /differs from immutable/)
  writeFileSync(path, json(r))
  const source = engineBroker(f.out, 'A', 'read', ['main.go']), sourcePath = f.out + '/receipts/A/A-002.json'
  writeFileSync(sourcePath, json({ ...source, crossPartition: true }))
  assert.throws(() => inspectEngine(f.out), /assignment changed/)
  writeFileSync(sourcePath, json(source)); proposal(f.out, source); checkpointEngine(f.out, 'A')
  save(f.out + '/receipts/A/A-003.json', { ...source, id: 'A-003' })
  assert.throws(() => inspectEngine(f.out), /Checkpoint changed/)
})

test('read-only status rejects missing tasks; preparation restores only exact deterministic artifacts', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  rmSync(f.out + '/tasks/A.json')
  assert.throws(() => inspectEngine(f.out), /ENOENT/)
  assert.deepEqual(readdirSync(f.out + '/tasks'), [])
  prepareEngine(f.out, f.config)
  writeFileSync(f.out + '/tasks/A.json', '{}')
  assert.throws(() => inspectEngine(f.out), /Frozen input changed/)
  assert.throws(() => prepareEngine(f.out, f.config), /Refusing changed artifact/)
})

test('integration packet seals every proposal and source receipt and cannot precede checkpoints', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  assert.throws(() => freezeIntegration(f.out), /checkpointed/)
  assert.throws(() => engineBroker(f.out, 'R', 'read', ['main.go']), /packet required/)
  const r = engineBroker(f.out, 'A', 'read', ['main.go']); proposal(f.out, r); checkpointEngine(f.out, 'A'); freezeIntegration(f.out)
  const packet = JSON.parse(readFileSync(f.out + '/integration-input.json')); packet.proposals[0].nodes[0].name = 'Tampered'
  writeFileSync(f.out + '/integration-input.json', json(packet))
  assert.throws(() => inspectEngine(f.out), /Integration input changed/)
})

test('exclusive broker locks never expire by age and leave existing locks untouched', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  save(f.out + '/locks/A.lock', { pid: 999999, ancient: true })
  assert.throws(() => engineBroker(f.out, 'A', 'read', ['main.go']), /EEXIST/)
  assert.equal(JSON.parse(readFileSync(f.out + '/locks/A.lock')).ancient, true)
})

test('interrupted integration preparation is visible and explicitly recoverable without inference', t => {
  const f = fixture(t); prepareEngine(f.out, f.config)
  const r = engineBroker(f.out, 'A', 'read', ['main.go']); proposal(f.out, r); checkpointEngine(f.out, 'A'); freezeIntegration(f.out)
  const packet = readFileSync(f.out + '/integration-input.json'), task = readFileSync(f.out + '/tasks/R.json')
  rmSync(f.out + '/tasks/R.json')
  assert.equal(inspectEngine(f.out).jobs.at(-1).state, 'integration-task-incomplete')
  assert.throws(() => recordEngineLaunch(f.out, 'R', 'host-r'), /Check host/)
  assert.throws(() => engineBroker(f.out, 'R', 'read', ['main.go']), /Valid integration inputs/)
  freezeIntegration(f.out)
  assert.deepEqual(readFileSync(f.out + '/integration-input.json'), packet)
  assert.deepEqual(readFileSync(f.out + '/tasks/R.json'), task)
  assert.equal(inspectEngine(f.out).jobs.at(-1).state, 'ready-to-dispatch')
})

test('empty-receipt baseline still requires the same declared snapshot', t => {
  const f = fixture(t), baseline = f.root + '/empty.json'
  save(baseline, { commitSha: '0'.repeat(40), graph: { nodes: [], edges: [] }, receipts: [] })
  assert.throws(() => prepareEngine(f.root + '/expansion', { ...f.config, mode: 'expansion', baseline }), /declared snapshot mismatch/)
})

test('malformed or mismatched terminal records never authorize another launch', t => {
  const f = fixture(t); prepareEngine(f.out, f.config); recordEngineLaunch(f.out, 'A', 'host-1')
  const path = f.out + '/attempts/A/001.terminal.json'
  for (const value of [{}, { handle: 'other', observation: 'interrupted' }, { handle: 'host-1', observation: 'unknown' }]) {
    writeFileSync(path, json(value))
    assert.throws(() => inspectEngine(f.out), /Invalid terminal/)
    assert.throws(() => recordEngineLaunch(f.out, 'A', 'host-2'), /Invalid terminal/)
  }
  assert.deepEqual(readdirSync(f.out + '/attempts/A'), ['001.json', '001.terminal.json'])
})
