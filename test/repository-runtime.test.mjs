import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import * as stable from '../scripts/repository-engine.mjs'
import * as snapshot from '../scripts/versions/repository-engine-v2/snapshot/repository-engine-v2.mjs'
import * as milestone from '../scripts/versions/repository-engine-v2/milestone/repository-engine-v2.mjs'
import * as catalog from '../scripts/versions/repository-engine-v2/catalog/repository-engine-v2.mjs'
import * as history from '../scripts/versions/repository-engine-v2/history/repository-engine-v2.mjs'

const archivedV2 = [
  { name: 'snapshot', engine: snapshot },
  { name: 'milestone', engine: milestone },
  { name: 'catalog', engine: catalog },
  { name: 'history', engine: history },
]
const runtimePins = JSON.parse(readFileSync(new URL('../scripts/versions/repository-engine-v2/runtimes.json', import.meta.url), 'utf8'))
const json = value => JSON.stringify(value, null, 2) + '\n'

function fixture(t, partitionCount = 1) {
  const root = mkdtempSync(resolve(tmpdir(), 'repository-runtime-test-'))
  const repo = resolve(root, 'source'), out = resolve(root, 'initial')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  }
  execFileSync('git', ['init', '-q', repo], { env })
  const git = args => execFileSync('git', ['-C', repo, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  git(['config', 'user.name', 'Synthetic'])
  git(['config', 'user.email', 'test@example.invalid'])
  writeFileSync(resolve(repo, 'main.go'), 'package main\nfunc main() {}\n')
  writeFileSync(resolve(repo, 'other.go'), 'package main\nfunc other() {}\n')
  git(['add', '--all'])
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', repo, 'commit', '-qm', 'Synthetic source'], { env })
  const config = { mode: 'discovery', repo, displayName: 'Synthetic project', partitionCount }
  return { root, repo, out, config }
}

function save(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, json(value), { flag: 'wx' })
}

function proposal(agent, receipt, marker = `Synthetic ${agent}`) {
  const evidenceIds = [receipt.id]
  const capability = {
    id: `${agent}1`, name: marker, summary: 'Synthetic observable responsibility', actor: 'Synthetic caller',
    inputs: [], outcomes: ['Synthetic result'], conditions: [], exclusions: [], implementations: [], uncertainty: [],
    evidenceIds, assessment: 'partial', claims: [{ text: marker, evidenceIds, assessment: 'partial' }],
  }
  return {
    agent, scopeSummary: 'Synthetic fixture; not model inference',
    coverage: { inspected: [receipt.path], omissions: ['Other behavior not examined'] },
    crossPartitionLeads: [], nodes: [capability], edges: [], limitations: ['Synthetic fixture'],
  }
}

function snapshotFiles(root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else {
        assert.ok(entry.isFile(), `Expected a regular file in archived run: ${path}`)
        files.push({ path: relative(root, path), bytes: readFileSync(path) })
      }
    }
  }
  visit(root)
  return files
}

function assertFilesUnchanged(root, before) {
  const after = snapshotFiles(root)
  assert.deepEqual(after.map(file => file.path), before.map(file => file.path), 'saved file set changed')
  for (let index = 0; index < before.length; index++) {
    assert.deepEqual(after[index].bytes, before[index].bytes, `saved bytes changed: ${before[index].path}`)
  }
}

for (const { name, engine } of archivedV2) {
  test(`stable entry point reopens the exact archived v2 ${name} runtime without rewriting the run`, t => {
    const f = fixture(t)
    const expectedPins = runtimePins.find(runtime => runtime.name === name)?.engines
    assert.ok(expectedPins, `missing frozen pins for ${name}`)

    const created = engine.prepareEngine(f.out, f.config)
    assert.equal(created.plan.version, 'repository-engine/2')
    assert.deepEqual(created.plan.engines, expectedPins)
    const runPlan = readFileSync(resolve(f.out, 'run-plan.json'))
    const before = snapshotFiles(f.out)

    const inspected = stable.inspectEngine(f.out)
    assert.equal(inspected.plan.version, 'repository-engine/2')
    assert.deepEqual(inspected.plan.engines, expectedPins)
    assert.deepEqual(readFileSync(resolve(f.out, 'run-plan.json')), runPlan)
    assertFilesUnchanged(f.out, before)

    const resumed = stable.prepareEngine(f.out, f.config)
    assert.equal(resumed.plan.version, 'repository-engine/2')
    assert.deepEqual(resumed.plan.engines, expectedPins)
    assertFilesUnchanged(f.out, before)
  })
}

test('stable entry point rejects unknown v2 pins without changing the saved run', t => {
  const f = fixture(t)
  history.prepareEngine(f.out, f.config)
  const planPath = resolve(f.out, 'run-plan.json')
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const [firstEngine] = Object.keys(plan.engines)
  plan.engines[firstEngine] = '0'.repeat(64)
  writeFileSync(planPath, json(plan))
  const before = snapshotFiles(f.out)

  assert.throws(() => stable.inspectEngine(f.out), /Unknown version 2 runtime pins/)
  assert.throws(() => stable.prepareEngine(f.out, f.config), /Unknown version 2 runtime pins/)
  assertFilesUnchanged(f.out, before)
})

test('stable entry point selects repository-engine/3 for a new run', t => {
  const f = fixture(t)
  const created = stable.prepareEngine(f.out, f.config)
  assert.equal(created.plan.version, 'repository-engine/3')
  assert.equal(stable.inspectEngine(f.out).plan.version, 'repository-engine/3')
})

test('stable v3 gates evidence, resumes a bounded assignment, isolates worker status, and requires completed terminal state to checkpoint', t => {
  const f = fixture(t, 2)
  stable.prepareEngine(f.out, f.config)
  const inventory = JSON.parse(readFileSync(resolve(f.out, 'inventory.json'), 'utf8'))
  const aPath = inventory.files.find(file => file.partition === 'A')?.path
  const bPath = inventory.files.find(file => file.partition === 'B')?.path
  assert.ok(aPath && bPath, 'synthetic source files should populate both discovery assignments')

  const firstA = stable.reserveEngineLaunch(f.out, 'A')
  const reservedA = stable.readEngineWorkerStatus(f.out, 'A')
  assert.equal(reservedA.state, 'dispatch-reserved')
  assert.equal(reservedA.outputSaved, false)
  assert.equal(reservedA.checkpointed, false)
  assert.throws(() => stable.engineBroker(f.out, 'A', 'read', [aPath]), /blocked until A has a bound active host dispatch/)

  stable.bindEngineLaunch(f.out, 'A', firstA.reservationId, 'worker-A-1')
  assert.equal(stable.readEngineWorkerStatus(f.out, 'A').handle, 'worker-A-1')
  assert.throws(() => stable.reserveEngineLaunch(f.out, 'A'), /Fresh read-only dispatch authorization is required/)
  const aReceipts = []
  for (let index = 0; index < 20; index++) aReceipts.push(stable.engineBroker(f.out, 'A', 'read', [aPath]))
  assert.equal(aReceipts.at(-1).id, 'A-020')

  stable.recordEngineTerminal(f.out, 'A', 'worker-A-1', 'interrupted')
  assert.equal(stable.inspectEngine(f.out).jobs.find(job => job.agent === 'A').state, 'partial-evidence-needs-explicit-resume')
  const resumedA = stable.reserveEngineLaunch(f.out, 'A')
  assert.equal(resumedA.sequence, '002')
  assert.equal(Object.keys(stable.inspectEngine(f.out).jobs.find(job => job.agent === 'A').receiptPins).length, 20)
  stable.bindEngineLaunch(f.out, 'A', resumedA.reservationId, 'worker-A-2')
  assert.throws(() => stable.engineBroker(f.out, 'A', 'read', [aPath]), /Retrieval count budget reached/)

  const firstB = stable.reserveEngineLaunch(f.out, 'B')
  stable.bindEngineLaunch(f.out, 'B', firstB.reservationId, 'worker-B')
  const bReceipt = stable.engineBroker(f.out, 'B', 'read', [bPath])
  const otherProposalMarker = 'B-only proposal content'
  save(resolve(f.out, 'proposals', 'B.json'), proposal('B', bReceipt, otherProposalMarker))
  stable.recordEngineTerminal(f.out, 'B', 'worker-B', 'completed')
  stable.checkpointEngine(f.out, 'B')

  const aStatus = stable.readEngineWorkerStatus(f.out, 'A')
  assert.deepEqual(Object.keys(aStatus).sort(), [
    'assignment', 'canReadEvidence', 'checkpointed', 'handle', 'observation', 'outputSaved', 'reservationId', 'sequence', 'state',
  ].sort())
  assert.equal(aStatus.handle, 'worker-A-2')
  assert.equal(aStatus.outputSaved, false)
  assert.equal(JSON.stringify(aStatus).includes(otherProposalMarker), false)
  assert.equal(JSON.stringify(aStatus).includes('B1'), false)

  save(resolve(f.out, 'proposals', 'A.json'), proposal('A', aReceipts[0]))
  assert.throws(() => stable.engineBroker(f.out, 'A', 'read', [aPath]), /Saved output seals this assignment evidence/)
  assert.equal(stable.readEngineWorkerStatus(f.out, 'A').outputSaved, true)
  assert.throws(() => stable.reserveEngineLaunch(f.out, 'A'), /Fresh read-only dispatch authorization is required/)
  assert.throws(() => stable.checkpointEngine(f.out, 'A'), /Explicit completed host observation required before checkpoint/)
  stable.recordEngineTerminal(f.out, 'A', 'worker-A-2', 'completed')
  assert.deepEqual(stable.checkpointEngine(f.out, 'A'), { agent: 'A', state: 'checkpointed' })
  assert.equal(stable.readEngineWorkerStatus(f.out, 'A').checkpointed, true)
})
