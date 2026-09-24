import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareEngine, engineBroker, reserveEngineLaunch, bindEngineLaunch, recordEngineTerminal, checkpointEngine, freezeIntegration, publishEngine } from '../scripts/repository-engine.mjs'
import { prepareCoverageRouting } from '../scripts/plan-repository-coverage.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'coverage-plan-'))), repo = join(root, 'source'), run = join(root, 'run')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = args => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env, stdio: 'pipe', encoding: 'utf8' }).trim()
  git(['init', '-q', repo]); git(['-C', repo, 'config', 'user.name', 'Synthetic']); git(['-C', repo, 'config', 'user.email', 'test@example.invalid'])
  mkdirSync(join(repo, 'lib'))
  writeFileSync(join(repo, 'lib/a.go'), 'package lib\n'); writeFileSync(join(repo, 'lib/b.go'), 'package lib\n')
  git(['-C', repo, 'add', '--all']); git(['-C', repo, 'commit', '-qm', 'Synthetic'])
  const config = { mode: 'discovery', repo, displayName: 'Synthetic', partitionCount: 1 }
  prepareEngine(run, config)
  return { root, repo, run, config }
}
function dispatch(run, agent) {
  const reservation = reserveEngineLaunch(run, agent)
  bindEngineLaunch(run, agent, reservation.reservationId, 'synthetic-' + agent)
}

test('pins metadata routing before inference and replays exact companions without modifying engine tasks', t => {
  const f = fixture(t), task = readFileSync(f.run + '/tasks/A.json'), protocol = readFileSync(f.run + '/protocol.md')
  const result = prepareCoverageRouting(f.run), saved = readFileSync(result.plan), routingTask = readFileSync(f.run + '/coverage-tasks/A.json')
  assert.deepEqual(prepareCoverageRouting(f.run), result)
  assert.deepEqual(readFileSync(result.plan), saved)
  assert.deepEqual(readFileSync(f.run + '/tasks/A.json'), task)
  assert.deepEqual(readFileSync(f.run + '/protocol.md'), protocol)
  assert.equal(JSON.parse(saved).provenance.helperSha256.length, 64)
  dispatch(f.run, 'A')
  engineBroker(f.run, 'A', 'read', ['lib/a.go'])
  rmSync(f.run + '/coverage-tasks/A.json')
  prepareCoverageRouting(f.run)
  assert.deepEqual(readFileSync(f.run + '/coverage-tasks/A.json'), routingTask)
})

test('rejects late routing and conflicting artifacts without replacing saved contents', t => {
  const f = fixture(t)
  dispatch(f.run, 'A')
  engineBroker(f.run, 'A', 'read', ['lib/a.go'])
  assert.throws(() => prepareCoverageRouting(f.run), /before discovery/)
  assert.equal(existsSync(f.run + '/coverage-routing.json'), false)
  const other = join(f.root, 'other'); prepareEngine(other, f.config); prepareCoverageRouting(other)
  writeFileSync(other + '/coverage-routing.json', '{}')
  rmSync(other + '/coverage-tasks/A.json')
  assert.throws(() => prepareCoverageRouting(other), /Refusing changed/)
  assert.equal(readFileSync(other + '/coverage-routing.json', 'utf8'), '{}')
  assert.equal(existsSync(other + '/coverage-tasks/A.json'), false)
})

test('worker supplements omit previously read paths while aggregate plan retains region accounting', t => {
  const f = fixture(t)
  dispatch(f.run, 'A')
  const receipt = engineBroker(f.run, 'A', 'read', ['lib/a.go'])
  mkdirSync(f.run + '/proposals', { recursive: true })
  writeFileSync(f.run + '/proposals/A.json', JSON.stringify({ agent: 'A', scopeSummary: 'Synthetic navigation only',
    coverage: { inspected: [receipt.path], omissions: ['No semantic discovery'] }, crossPartitionLeads: [], nodes: [], edges: [], limitations: ['Synthetic fixture'] }))
  recordEngineTerminal(f.run, 'A', 'synthetic-A', 'completed'); checkpointEngine(f.run, 'A')
  freezeIntegration(f.run); dispatch(f.run, 'R')
  writeFileSync(f.run + '/reconciled.json', JSON.stringify({ nodes: [], edges: [], lineage: [], edgeLineage: [], comparisons: [], decisions: [], limitations: ['Synthetic fixture'], historyLineage: [], historyEdgeLineage: [] }))
  recordEngineTerminal(f.run, 'R', 'synthetic-R', 'completed'); checkpointEngine(f.run, 'R'); publishEngine(f.run)
  const baseline = f.run + '/output.json'
  const run = join(f.root, 'expansion'); prepareEngine(run, { ...f.config, mode: 'expansion', baseline })
  const result = prepareCoverageRouting(run), task = JSON.parse(readFileSync(run + '/coverage-tasks/A.json'))
  assert.equal(result.inventory.inspectedFileCount, 1)
  assert.deepEqual(task.regions.flatMap(r => r.unreadFilePaths), ['lib/b.go'])
  assert.equal(task.regions[0].fileCount, 2)
  assert.ok(!JSON.stringify(task).includes('lib/a.go'))
})

test('rejects symlinked task directories rather than writing through them', t => {
  const f = fixture(t), target = join(f.root, 'outside'); mkdirSync(target)
  symlinkSync(target, f.run + '/coverage-tasks')
  assert.throws(() => prepareCoverageRouting(f.run), /Regular coverage task directory/)
  assert.equal(existsSync(target + '/A.json'), false)
})
