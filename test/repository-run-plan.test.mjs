import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { prepareRepositoryRun, inspectRepositoryRun } from '../scripts/repository-run-plan.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repository-plan-test-'))), repo = resolve(root, 'source'), out = resolve(root, 'run')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync('git', ['init', '-q', repo], { env })
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'test@example.invalid'])
  const commit = text => { writeFileSync(repo + '/main.go', text); git(['add', 'main.go']); git(['commit', '-qm', 'Synthetic source']); return git(['rev-parse', 'HEAD']) }
  commit('package main\n')
  return { root, repo, out, commit, config: { repo, displayName: 'Synthetic source', partitionCount: 2 } }
}

test('preparation is exact, repository-neutral and resumes its pinned snapshot after branch movement', t => {
  const f = fixture(t), first = prepareRepositoryRun(f.config, f.out)
  const plan = readFileSync(f.out + '/run-plan.json'), inventory = readFileSync(f.out + '/inventory.json')
  assert.equal(first.stage, 'inventory-prepared'); assert.equal(first.sourceBodiesRead, 0)
  assert.equal(first.candidateMap, 'not-produced'); assert.equal(first.eligibleFiles, 1)
  assert.deepEqual(prepareRepositoryRun(f.config, f.out), first)
  f.commit('package main\n// Next snapshot\n')
  assert.deepEqual(prepareRepositoryRun(f.config, f.out), first)
  assert.deepEqual(inspectRepositoryRun(f.out), first)
  assert.deepEqual(readFileSync(f.out + '/run-plan.json'), plan); assert.deepEqual(readFileSync(f.out + '/inventory.json'), inventory)
  assert.notEqual(prepareRepositoryRun(f.config, f.out + '-new').commitSha, first.commitSha)
})

test('status is read-only; prepare restores missing deterministic inventory but never conflicting bytes', t => {
  const f = fixture(t), first = prepareRepositoryRun(f.config, f.out)
  rmSync(f.out + '/inventory.json')
  assert.throws(() => inspectRepositoryRun(f.out), /ENOENT/)
  assert.deepEqual(readdirSync(f.out), ['run-plan.json'])
  assert.deepEqual(prepareRepositoryRun(f.config, f.out), first)
  writeFileSync(f.out + '/inventory.json', '{partial')
  assert.throws(() => inspectRepositoryRun(f.out), /Saved inventory changed/)
  assert.throws(() => prepareRepositoryRun(f.config, f.out), /Existing artifact differs/)
  assert.equal(readFileSync(f.out + '/inventory.json', 'utf8'), '{partial')
})

test('configuration changes and forged inventory bindings are rejected', t => {
  const f = fixture(t); prepareRepositoryRun(f.config, f.out)
  for (const patch of [{ displayName: 'Different' }, { partitionCount: 3 }, { revision: 'HEAD~1' }, { maxFileBytes: 2 }]) assert.throws(() => prepareRepositoryRun({ ...f.config, ...patch }, f.out), /Configuration changed/)
  const plan = JSON.parse(readFileSync(f.out + '/run-plan.json'))
  plan.inventorySha256 = '0'.repeat(64); writeFileSync(f.out + '/run-plan.json', JSON.stringify(plan))
  assert.throws(() => inspectRepositoryRun(f.out), /Pinned tree inventory/)
})

test('changed implementation, symlink artifacts and unknown configuration fail closed', t => {
  const f = fixture(t); prepareRepositoryRun(f.config, f.out)
  assert.throws(() => prepareRepositoryRun({ ...f.config, apiKey: 'synthetic' }, f.out), /Unknown/)
  assert.throws(() => prepareRepositoryRun({ ...f.config, displayName: '\n' }, f.out), /displayName/)
  const plan = JSON.parse(readFileSync(f.out + '/run-plan.json'))
  plan.implementationSha256['repository-run-plan.mjs'] = '0'.repeat(64)
  writeFileSync(f.out + '/run-plan.json', JSON.stringify(plan))
  assert.throws(() => inspectRepositoryRun(f.out), /implementation changed/)
  rmSync(f.out + '/run-plan.json'); symlinkSync(f.out + '/inventory.json', f.out + '/run-plan.json')
  assert.throws(() => inspectRepositoryRun(f.out), /regular artifact/)
})
