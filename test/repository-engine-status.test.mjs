import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as stable from '../scripts/repository-engine.mjs'
import * as current from '../scripts/repository-engine-v3.mjs'
import * as v1 from '../scripts/versions/repository-engine-v1/repository-engine.mjs'
import * as snapshot from '../scripts/versions/repository-engine-v2/snapshot/repository-engine-v2.mjs'
import * as milestone from '../scripts/versions/repository-engine-v2/milestone/repository-engine-v2.mjs'
import * as catalog from '../scripts/versions/repository-engine-v2/catalog/repository-engine-v2.mjs'
import * as history from '../scripts/versions/repository-engine-v2/history/repository-engine-v2.mjs'
import { summarizeExperiment } from '../scripts/experiment-status.mjs'

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
const cli = (script, ...args) => JSON.parse(execFileSync(process.execPath, [resolve('scripts', script), ...args], { env, encoding: 'utf8' }))
function fixture(t, partitionCount = 1) {
  const root = mkdtempSync(join(tmpdir(), 'repository-status-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo'), out = join(root, 'run')
  execFileSync('git', ['init', '-q', repo], { env })
  writeFileSync(join(repo, 'main.js'), 'export const answer = 42\n')
  writeFileSync(join(repo, 'other.js'), 'export const other = 43\n')
  execFileSync('git', ['-C', repo, 'add', '.'], { env })
  execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic source'], { env })
  return { root, out, config: { mode: 'discovery', repo, displayName: 'Synthetic status fixture', partitionCount } }
}
function save(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
function proposal(agent) {
  const marker = `${agent}-private-proposal-body`
  return {
    agent, scopeSummary: marker, coverage: { inspected: [], omissions: [marker] },
    crossPartitionLeads: [marker], nodes: [], edges: [], limitations: [marker],
  }
}
function artifacts(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const path = join(entry.parentPath, entry.name)
      return [path, readFileSync(path).toString('base64')]
    }))
}
function assertMetadata(status, inspected) {
  assert.deepEqual(Object.keys(status).sort(), [
    'status', 'version', 'mode', 'displayName', 'commitSha', 'availableDiscoveryFiles', 'validationIssueCount', 'jobs',
  ].sort())
  assert.equal(status.status, inspected.status)
  assert.equal(status.version, inspected.plan.version)
  assert.equal(status.validationIssueCount, inspected.validationIssues.length)
  assert.deepEqual(status.jobs, inspected.jobs.map(job => ({
    agent: job.agent, state: job.state, handle: job.handle, validationIssueCount: job.validation.length,
  })))
  for (const job of status.jobs) {
    assert.deepEqual(Object.keys(job).sort(), ['agent', 'state', 'handle', 'validationIssueCount'].sort())
  }
}

test('v3 status API and both CLIs omit every worker body while inspect, checkpoint, integrate and publish retain access', t => {
  const f = fixture(t, 2), configPath = join(f.root, 'config.json')
  save(configPath, f.config)
  const prepared = cli('repository-engine.mjs', 'prepare', f.out, configPath)
  assertMetadata(prepared, stable.inspectEngine(f.out))
  const proposals = ['A', 'B'].map(proposal)
  for (const value of proposals) stable.recordEngineLaunch(f.out, value.agent, `worker-${value.agent}`)
  save(join(f.out, 'proposals', 'A.json'), proposals[0])
  stable.recordEngineTerminal(f.out, 'A', 'worker-A', 'completed')
  stable.checkpointEngine(f.out, 'A')

  const before = artifacts(f.out), inspected = stable.inspectEngine(f.out)
  for (const status of [stable.statusEngine(f.out), current.statusEngine(f.out),
    cli('repository-engine.mjs', 'status', f.out), cli('repository-engine-v3.mjs', 'status', f.out)]) {
    assertMetadata(status, inspected)
    assert.deepEqual(status.jobs.map(job => [job.agent, job.state]), [
      ['A', 'checkpointed'], ['B', 'runtime-check-required'], ['R', 'waiting-for-discovery'],
    ])
    assert.doesNotMatch(JSON.stringify(status), /private-proposal-body/)
  }
  const scoped = cli('repository-engine.mjs', 'status', f.out, 'B')
  assert.equal(scoped.assignment, 'B')
  assert.doesNotMatch(JSON.stringify(scoped), /private-proposal-body|worker-A/)
  assert.deepEqual(inspected.jobs[0].value, proposals[0])
  assert.deepEqual(current.inspectEngine(f.out).jobs[0].value, proposals[0])
  assert.deepEqual(artifacts(f.out), before, 'status and inspection do not mutate saved artifacts')

  save(join(f.out, 'proposals', 'B.json'), proposals[1])
  stable.recordEngineTerminal(f.out, 'B', 'worker-B', 'completed')
  stable.checkpointEngine(f.out, 'B')
  stable.freezeIntegration(f.out)
  assert.deepEqual(JSON.parse(readFileSync(join(f.out, 'integration-input.json'))).proposals, proposals)
  stable.recordEngineLaunch(f.out, 'R', 'integrator')
  const result = {
    nodes: [], edges: [], lineage: [], edgeLineage: [], decisions: [], comparisons: [],
    historyLineage: [], historyEdgeLineage: [], limitations: ['private-integrated-result-body'],
  }
  save(join(f.out, 'reconciled.json'), result)
  stable.recordEngineTerminal(f.out, 'R', 'integrator', 'completed')
  stable.checkpointEngine(f.out, 'R')
  stable.publishEngine(f.out)
  for (const inspect of [stable.inspectEngine, current.inspectEngine]) {
    assert.deepEqual(inspect(f.out).jobs.map(job => job.value), [...proposals, result])
  }
  for (const status of [stable.statusEngine(f.out), current.statusEngine(f.out),
    cli('repository-engine.mjs', 'status', f.out), cli('repository-engine-v3.mjs', 'status', f.out)]) {
    assertMetadata(status, stable.inspectEngine(f.out))
    assert.equal(status.status, 'candidate-map-produced')
    assert.doesNotMatch(JSON.stringify(status), /private-proposal-body|private-integrated-result-body/)
  }
  assert.deepEqual(JSON.parse(readFileSync(join(f.out, 'output.json'))).graph, result)
})

test('status validation counts cannot expose authored fields or node identifiers', t => {
  const f = fixture(t, 2), configPath = join(f.root, 'config.json')
  save(configPath, f.config)
  current.prepareEngine(f.out, f.config)
  const value = { ...proposal('A'), 'private-unexpected-field': 'private-unexpected-value',
    nodes: [{ id: 'Aprivate-node-identifier' }] }
  save(join(f.out, 'proposals', 'A.json'), value)
  const inspected = current.inspectEngine(f.out)
  assert.match(JSON.stringify(inspected.validationIssues), /private-unexpected-field/)
  assert.match(JSON.stringify(inspected.validationIssues), /Aprivate-node-identifier/)
  const before = artifacts(f.out)
  for (const status of [stable.statusEngine(f.out), current.statusEngine(f.out),
    cli('repository-engine.mjs', 'status', f.out), cli('repository-engine-v3.mjs', 'status', f.out),
    cli('repository-engine.mjs', 'prepare', f.out, configPath)]) {
    assertMetadata(status, inspected)
    assert.equal(status.jobs[0].state, 'saved-invalid')
    assert.ok(status.jobs[0].validationIssueCount > 0)
    assert.doesNotMatch(JSON.stringify(status), /private-/)
  }
  const experiment = summarizeExperiment(f.out)
  assert.ok(experiment.validationIssueCount > 0)
  assert.equal('validationIssues' in experiment, false)
  assert.equal('validation' in experiment.jobs[0], false)
  assert.doesNotMatch(JSON.stringify(experiment), /private-/)
  assert.deepEqual(artifacts(f.out), before)
})

test('status does not echo proposal snippets from invalid JSON parser diagnostics', t => {
  const f = fixture(t)
  current.prepareEngine(f.out, f.config)
  mkdirSync(join(f.out, 'proposals'))
  writeFileSync(join(f.out, 'proposals', 'A.json'), 'private-invalid-json-body')
  const inspected = current.inspectEngine(f.out)
  assert.match(inspected.validationIssues[0].message, /Invalid JSON/)
  for (const status of [stable.statusEngine(f.out), current.statusEngine(f.out),
    cli('repository-engine.mjs', 'status', f.out), summarizeExperiment(f.out)]) {
    assert.equal(status.jobs[0].state, 'saved-invalid')
    assert.equal(status.jobs[0].validationIssueCount, 1)
    assert.doesNotMatch(JSON.stringify(status), /private-invalid-json-body|Invalid JSON/)
  }
})

for (const [name, runtime] of Object.entries({ v1, snapshot, milestone, catalog, history })) {
  test(`stable status safely projects archived ${name} runs without rewriting their artifacts`, t => {
    const f = fixture(t)
    runtime.prepareEngine(f.out, f.config)
    const value = proposal('A')
    save(join(f.out, 'proposals', 'A.json'), value)
    const before = artifacts(f.out), inspected = stable.inspectEngine(f.out)
    for (const status of [stable.statusEngine(f.out), cli('repository-engine.mjs', 'status', f.out)]) {
      assertMetadata(status, inspected)
      assert.doesNotMatch(JSON.stringify(status), /private-proposal-body/)
    }
    assert.deepEqual(stable.inspectEngine(f.out).jobs[0].value, value)
    assert.deepEqual(artifacts(f.out), before)
  })
}
