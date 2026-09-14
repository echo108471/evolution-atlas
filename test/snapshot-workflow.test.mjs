import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { sha, readJson } from '../scripts/vscode-snapshot-evidence.mjs'
import { prepareWorkflow, inspectWorkflow, checkpointJob, recordLaunch, recordTerminal, integrationPacket, workflowBroker, freezeWorkflow } from '../scripts/snapshot-workflow.mjs'

const save = (p, x) => { mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(x, null, 2) + '\n') }
function fixture(t) {
  const previousCwd = process.cwd(), brokerText = readFileSync(new URL('../scripts/vscode-snapshot-evidence.mjs', import.meta.url), 'utf8')
  const root = mkdtempSync(resolve(tmpdir(), 'snapshot-workflow-test-'))
  t.after(() => { process.chdir(previousCwd); rmSync(root, { recursive: true, force: true }) })
  execFileSync('git', ['init', '-q', root])
  writeFileSync(root + '/.gitignore', '*\n')
  process.chdir(root)
  const repo = root + '/source.git', out = root + '/run'
  execFileSync('git', ['init', '--bare', '-q', repo])
  const git = (args, input) => execFileSync('git', ['--git-dir=' + repo, ...args], { encoding: 'utf8', input })
  const text = 'export function example() { return 1 }\n', blobSha = git(['hash-object', '-w', '--stdin'], text).trim()
  const inventory = { commitSha: 'a'.repeat(40), allTrackedEntries: 2, eligibleFiles: 2, omitted: [], files: [
    { path: 'alpha.ts', size: Buffer.byteLength(text), blobSha, mode: '100644', partition: 'A' },
    { path: 'beta.ts', size: Buffer.byteLength(text), blobSha, mode: '100644', partition: 'F' }
  ] }
  const manifest = { repo, commitSha: inventory.commitSha, inventorySha256: sha(inventory), partitions: ['A'], limitations: ['Synthetic evidence only'],
    brokerSha256: sha(brokerText) }
  save(root + '/inventory.json', inventory); save(root + '/manifest.json', manifest)
  writeFileSync(root + '/protocol.md', '# Synthetic fixed test protocol\n')
  const config = { mode: 'discovery', inventory: root + '/inventory.json', manifest: root + '/manifest.json', protocol: root + '/protocol.md' }
  prepareWorkflow(out, config)
  const proposal = () => ({ agent: 'A', scopeSummary: 'Synthetic result', nodes: [{ id: 'A1', name: 'Example', summary: 'Return one', actor: 'Caller', inputs: [], outcomes: ['One'], conditions: [], exclusions: [], implementations: ['alpha.ts'], evidenceIds: ['A-001'], assessment: 'partial', uncertainty: [], claims: [{ text: 'Returns one', evidenceIds: ['A-001'], assessment: 'partial' }] }], edges: [], coverage: { limitations: ['Synthetic'] }, crossPartitionLeads: [] })
  const discover = () => { workflowBroker(out, 'A', 'read', ['alpha.ts', '1', '2']); save(out + '/proposals/A.json', proposal()); checkpointJob(out, 'A') }
  return { root, out, config, inventory, manifest, proposal, discover }
}
test('preparation is exact and recoverable without rewriting frozen inputs', t => {
  const f = fixture(t), before = readFileSync(f.out + '/run-plan.json', 'utf8')
  assert.equal(prepareWorkflow(f.out, f.config).eligibleFiles, 2)
  assert.equal(readFileSync(f.out + '/run-plan.json', 'utf8'), before)
  unlinkSync(f.out + '/tasks/A.json')
  assert.throws(() => inspectWorkflow(f.out), /incomplete preparation/)
  prepareWorkflow(f.out, f.config); assert.ok(existsSync(f.out + '/tasks/A.json'))
  assert.throws(() => prepareWorkflow(f.out, { ...f.config, mode: 'expansion' }), /baseline/)
  const m = readJson(f.out + '/manifest.json'); m.budgets.perAgent.windows++
  save(f.out + '/manifest.json', m); assert.throws(() => inspectWorkflow(f.out), /changed artifact/)
})
test('saved handles are not liveness and missing results do not permit automatic redispatch', t => {
  const f = fixture(t)
  recordLaunch(f.out, 'A', '/root/synthetic')
  const status = inspectWorkflow(f.out)
  assert.equal(status.jobs[0].state, 'runtime-check-required'); assert.match(status.liveness, /Unknown/)
  assert.throws(() => recordLaunch(f.out, 'A', '/root/duplicate'), /cannot be dispatched/)
  assert.throws(() => recordTerminal(f.out, 'A', 'wrong', 'failed'), /matching handle/)
  recordTerminal(f.out, 'A', '/root/synthetic', 'failed')
  assert.equal(inspectWorkflow(f.out).jobs[0].state, 'retry-needs-explicit-dispatch')
  recordLaunch(f.out, 'A', '/root/explicit-retry')
  assert.equal(inspectWorkflow(f.out).jobs[0].handle, '/root/explicit-retry')
})
test('partial evidence retains budget and sequence across restart', t => {
  const f = fixture(t)
  assert.equal(workflowBroker(f.out, 'A', 'read', ['alpha.ts', '1', '1']).id, 'A-001')
  assert.equal(inspectWorkflow(f.out).jobs[0].state, 'partial-evidence-needs-explicit-resume')
  prepareWorkflow(f.out, f.config)
  assert.equal(workflowBroker(f.out, 'A', 'read', ['beta.ts', '1', '1']).id, 'A-002')
  unlinkSync(f.out + '/receipts/A/A-001.json')
  assert.throws(() => workflowBroker(f.out, 'A', 'read', ['alpha.ts', '1', '1']), /invalid prior receipts/)
})
test('saved malformed results and wrong assignment identity cannot trigger retry or integration', t => {
  const f = fixture(t); mkdirSync(f.out + '/proposals')
  writeFileSync(f.out + '/proposals/A.json', '{')
  assert.equal(inspectWorkflow(f.out).jobs[0].state, 'saved-invalid')
  assert.throws(() => recordLaunch(f.out, 'A', '/root/retry'), /cannot be dispatched/)
  assert.throws(() => integrationPacket(f.out), /checkpointed/)
  assert.equal(readFileSync(f.out + '/proposals/A.json', 'utf8'), '{')
  save(f.out + '/proposals/A.json', { ...f.proposal(), agent: 'B' })
  assert.ok(inspectWorkflow(f.out).jobs[0].validation.includes('assignment identity mismatch'))
  save(f.out + '/proposals/R.json', f.proposal())
  assert.ok(inspectWorkflow(f.out).issues.some(x => x.includes('unexpected proposal')))
})
test('checkpoint freezes raw output and receipt set, and blocks further source reads', t => {
  const f = fixture(t); f.discover()
  assert.equal(inspectWorkflow(f.out).jobs[0].state, 'checkpointed')
  assert.equal(checkpointJob(f.out, 'A'), 'verified-existing')
  assert.throws(() => workflowBroker(f.out, 'A', 'read', ['alpha.ts']), /already saved/)
  const p = readJson(f.out + '/proposals/A.json'); p.nodes[0].summary = 'Changed'
  save(f.out + '/proposals/A.json', p)
  assert.ok(inspectWorkflow(f.out).issues.some(x => x.includes('completed job changed')))
})
test('integration freezes full input set, rejects additions and tampered packet content', t => {
  const f = fixture(t); f.discover(); integrationPacket(f.out)
  const before = readFileSync(f.out + '/reconciliation-input.json', 'utf8')
  integrationPacket(f.out); assert.equal(readFileSync(f.out + '/reconciliation-input.json', 'utf8'), before)
  const packet = readJson(f.out + '/reconciliation-input.json'); packet.proposals[0].nodes[0].summary = 'Different'
  save(f.out + '/reconciliation-input.json', packet)
  assert.ok(inspectWorkflow(f.out).issues.some(x => x.includes('packet content changed')))
  writeFileSync(f.out + '/reconciliation-input.json', before)
  const r = readJson(f.out + '/receipts/A/A-001.json'); r.id = 'A-002'
  save(f.out + '/receipts/A/A-002.json', r)
  assert.ok(inspectWorkflow(f.out).issues.some(x => x.includes('input set changed')))
})
test('complete workflow can resume HTML creation without inference and rejects invalid final graphs', t => {
  const f = fixture(t); f.discover(); integrationPacket(f.out)
  const p = f.proposal(), graph = { nodes: p.nodes, edges: [], lineage: [{ originalId: 'A1', successorIds: ['A1'], decision: 'retain', reason: 'Preserve' }], decisions: [], limitations: [] }
  save(f.out + '/reconciled.json', { ...graph, lineage: [] })
  assert.throws(() => checkpointJob(f.out, 'R'), /valid saved output/)
  save(f.out + '/reconciled.json', graph); checkpointJob(f.out, 'R')
  assert.equal(inspectWorkflow(f.out).complete, true)
  assert.deepEqual(freezeWorkflow(f.out), { output: 'created', report: 'created' })
  const before = readFileSync(f.out + '/output.json', 'utf8'); unlinkSync(f.out + '/index.html')
  assert.deepEqual(freezeWorkflow(f.out), { output: 'verified-existing', report: 'created' })
  assert.equal(readFileSync(f.out + '/output.json', 'utf8'), before)
  assert.equal(readJson(f.out + '/output.json').automaticPromotion, false)
})
test('expansion excludes every cumulative inspected file without exposing baseline to task packets', t => {
  const f = fixture(t); f.discover()
  save(f.root + '/baseline.json', { graph: { nodes: f.proposal().nodes, edges: [] }, receipts: [readJson(f.out + '/receipts/A/A-001.json')] })
  const out = f.root + '/expansion', result = prepareWorkflow(out, { ...f.config, mode: 'expansion', baseline: f.root + '/baseline.json' })
  assert.equal(result.excludedFiles, 1); assert.equal(result.eligibleFiles, 1)
  assert.deepEqual(readJson(out + '/inventory.json').files.map(f => f.path), ['beta.ts'])
  assert.equal(readJson(out + '/baseline-input.json').graph.nodes[0].id, 'old:A1')
  assert.equal(readJson(out + '/tasks/A.json').baseline, undefined)
  assert.throws(() => workflowBroker(out, 'A', 'read', ['alpha.ts']), /not eligible/)
  assert.equal(existsSync(out + '/broker-A.lock'), false)
})
test('broker refuses concurrent or abandoned lock without deleting it', t => {
  const f = fixture(t), lock = f.out + '/broker-A.lock'
  writeFileSync(lock, '999999')
  assert.throws(() => workflowBroker(f.out, 'A', 'list', []), /EEXIST/)
  assert.equal(readFileSync(lock, 'utf8'), '999999')
})
test('baseline excerpts must match immutable source, not merely valid citation IDs', t => {
  const f = fixture(t); f.discover()
  const receipt = readJson(f.out + '/receipts/A/A-001.json'); receipt.text = 'Invented source'
  save(f.root + '/baseline.json', { graph: { nodes: f.proposal().nodes, edges: [] }, receipts: [receipt] })
  assert.throws(() => prepareWorkflow(f.root + '/expansion', { ...f.config, mode: 'expansion', baseline: f.root + '/baseline.json' }), /baseline source bytes/)
})
test('integration task and instruction drift fail before dispatch or checkpoint', t => {
  const f = fixture(t); f.discover(); integrationPacket(f.out)
  const original = readFileSync(f.out + '/tasks/R.json', 'utf8'), task = readJson(f.out + '/tasks/R.json'); task.instruction = 'Other task'
  save(f.out + '/tasks/R.json', task)
  assert.ok(inspectWorkflow(f.out).issues.includes('integration task changed'))
  assert.throws(() => recordLaunch(f.out, 'R', '/root/wrong-prompt'), /cannot be dispatched/)
  assert.throws(() => workflowBroker(f.out, 'R', 'list', []), /valid frozen integration task/)
  writeFileSync(f.out + '/tasks/R.json', original)
  const packet = readJson(f.out + '/reconciliation-input.json'); packet.instruction = 'Other task'
  save(f.out + '/reconciliation-input.json', packet)
  assert.ok(inspectWorkflow(f.out).issues.includes('integration packet envelope changed'))
})
test('discovery namespaces cannot collide with baseline or other assignments', t => {
  const f = fixture(t)
  workflowBroker(f.out, 'A', 'read', ['alpha.ts', '1', '1'])
  const p = f.proposal(); p.nodes[0].id = 'old:A1'; save(f.out + '/proposals/A.json', p)
  assert.ok(inspectWorkflow(f.out).jobs[0].validation.includes('node IDs must use the assigned namespace'))
  assert.throws(() => checkpointJob(f.out, 'A'), /valid saved/)
  p.nodes[0].id = 'B1'; save(f.out + '/proposals/A.json', p)
  assert.ok(inspectWorkflow(f.out).jobs[0].validation.includes('node IDs must use the assigned namespace'))
})
test('JSON primitives are invalid saved responses rather than pending work', t => {
  const f = fixture(t)
  for (const value of [null, false, 0, [], 'text']) {
    save(f.out + '/proposals/A.json', value)
    assert.equal(inspectWorkflow(f.out).jobs[0].state, 'saved-invalid')
    assert.throws(() => checkpointJob(f.out, 'A'), /valid saved/)
  }
})
