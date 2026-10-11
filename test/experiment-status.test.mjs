import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { summarizeExperiment } from '../scripts/experiment-status.mjs'

const engine = resolve('scripts/repository-engine.mjs')
const statusScript = resolve('scripts/experiment-status.mjs')
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1',
}
const engineCommand = (...args) => JSON.parse(execFileSync(process.execPath, [engine, ...args], { env, encoding: 'utf8' }))

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' }).trim()
}

test('current engine CLI prepares a pinned run and exposes a read-only experiment summary', t => {
  const root = mkdtempSync(join(tmpdir(), 'experiment-status-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo'), out = join(root, 'run'), configPath = join(root, 'config.json')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'main.js'), 'export const answer = 42\n')
  git(repo, 'add', 'main.js')
  git(repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Initial source')
  const commitSha = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(configPath, JSON.stringify({ mode: 'discovery', repo, revision: commitSha, displayName: 'CLI fixture', partitionCount: 1 }))

  const prepared = engineCommand('prepare', out, configPath)
  assert.equal(prepared.version, 'repository-engine/3')
  assert.equal(prepared.commitSha, commitSha)
  const before = readFileSync(join(out, 'run-plan.json'))
  const directStatus = engineCommand('status', out)
  const summary = JSON.parse(execFileSync(process.execPath, [statusScript, out], { env, encoding: 'utf8' }))
  assert.equal(directStatus.status, 'incomplete')
  assert.equal(summary.status, directStatus.status)
  assert.equal(summary.commitSha, commitSha)
  assert.equal(summary.candidateMap, null)
  assert.equal(summary.artifacts.output, null)
  assert.deepEqual(summary.jobs.map(job => [job.agent, job.state]), [['A', 'ready-to-dispatch'], ['R', 'waiting-for-discovery']])
  assert.deepEqual(readFileSync(join(out, 'run-plan.json')), before)

  const invalid = spawnSync(process.execPath, [engine, 'unknown', out], { env, encoding: 'utf8' })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /Usage:/)
  assert.deepEqual(readFileSync(join(out, 'run-plan.json')), before)

  const worker = engineCommand('reserve', out, 'A')
  engineCommand('bind', out, 'A', worker.reservationId, 'fixture-worker')
  mkdirSync(join(out, 'proposals'))
  writeFileSync(join(out, 'proposals', 'A.json'), JSON.stringify({
    agent: 'A', scopeSummary: 'Synthetic CLI fixture',
    coverage: { inspected: [], omissions: ['No files inspected in this CLI fixture'] },
    crossPartitionLeads: [], nodes: [], edges: [], limitations: ['Synthetic fixture'],
  }), { flag: 'wx' })
  engineCommand('terminal', out, 'A', 'fixture-worker', 'completed')
  engineCommand('checkpoint', out, 'A')
  engineCommand('integrate', out)
  const integrator = engineCommand('reserve', out, 'R')
  engineCommand('bind', out, 'R', integrator.reservationId, 'fixture-integrator')
  writeFileSync(join(out, 'reconciled.json'), JSON.stringify({
    nodes: [], edges: [], lineage: [], edgeLineage: [], decisions: [], comparisons: [],
    historyLineage: [], historyEdgeLineage: [], limitations: ['Synthetic fixture'],
  }), { flag: 'wx' })
  engineCommand('terminal', out, 'R', 'fixture-integrator', 'completed')
  engineCommand('checkpoint', out, 'R')
  engineCommand('publish', out)

  const published = summarizeExperiment(out)
  assert.equal(published.status, 'candidate-map-produced')
  assert.equal(published.candidateMap.nodes, 0)
  assert.equal(published.candidateMap.historyClaims, 0)
  assert.equal(published.candidateMap.independentVerification, 'not-performed')
  assert.equal(published.artifacts.output, join(realpathSync(out), 'output.json'))
  assert.equal(published.artifacts.report, join(realpathSync(out), 'index.html'))

  writeFileSync(join(out, 'output.json'), JSON.stringify({ version: 'repository-engine/3', commitSha }))
  assert.throws(() => summarizeExperiment(out), /Published output does not match/)
})
