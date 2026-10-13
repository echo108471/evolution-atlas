import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parseControlCommand } from '../scripts/control-atlas.mjs'
import { cleanupRun, doctor, sourceManifest, selectedBrowserExecutable } from '../scripts/verification/control-atlas.mjs'
import { FEATURE_IDS } from '../scripts/verification/features.mjs'
import { buildRunnerArgs, discoverTestFiles } from '../scripts/test.mjs'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CLI_PATH = join(REPOSITORY_ROOT, 'scripts', 'control-atlas.mjs')

test('control CLI parses the documented commands and feature IDs', () => {
  assert.deepEqual(parseControlCommand(['doctor', '--json']), { command: 'doctor', options: { featureIds: [], all: false, trace: false, json: true, dryRun: false, apply: false, runId: null } })
  assert.deepEqual(parseControlCommand(['list']), { command: 'list', options: { featureIds: [], all: false, trace: false, json: false, dryRun: false, apply: false, runId: null } })
  assert.equal(parseControlCommand(['verify', '--feature', 'candidate-map', '--trace']).options.featureIds[0], 'candidate-map')
  assert.equal(parseControlCommand(['verify', '--all', '--json']).options.all, true)
  assert.equal(parseControlCommand(['cleanup', '--run-id', '20261011-a1b2', '--dry-run']).options.dryRun, true)
  assert.deepEqual(FEATURE_IDS, ['overview', 'repository', 'periods', 'features', 'people', 'identity', 'candidate-map', 'gallery'])
})

test('control CLI rejects ambiguous or unsafe command shapes before browser startup', () => {
  for (const args of [
    [],
    ['verify'],
    ['verify', '--feature', 'overview', '--all'],
    ['verify', '--feature', 'overview', '--feature', 'people'],
    ['cleanup'],
    ['cleanup', '--run-id', '../outside', '--apply'],
    ['cleanup', '--run-id', 'valid-123', '--apply', '--dry-run'],
    ['doctor', '--trace'],
  ]) {
    assert.throws(() => parseControlCommand(args), { exitCode: 2 }, args.join(' '))
  }

  const invalidFeature = spawnSync(process.execPath, [CLI_PATH, 'verify', '--feature', 'not-a-feature'], { encoding: 'utf8' })
  assert.notEqual(invalidFeature.status, 0)
  const failure = JSON.parse(invalidFeature.stderr)
  assert.equal(failure.ok, false)
  assert.match(failure.error, /Unknown feature id/)
})

test('help and list are JSON commands and list matches the registry', () => {
  const help = spawnSync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(JSON.parse(help.stdout).usage, /verify --feature FEATURE/)

  const list = spawnSync(process.execPath, [CLI_PATH, 'list', '--json'], { encoding: 'utf8' })
  assert.equal(list.status, 0)
  const result = JSON.parse(list.stdout)
  assert.equal(result.ok, true)
  assert.deepEqual(result.features.map(({ id }) => id), FEATURE_IDS)
})

function snapshotFiles(root) {
  const result = {}
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = join(prefix, entry.name)
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute, relativePath)
      else if (entry.isFile()) result[relativePath] = readFileSync(absolute).toString('base64')
    }
  }
  visit(root)
  return result
}

test('test runner defaults to project test files, excludes scratch sentinels, and preserves explicit selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-test-discovery-'))
  const testRoot = join(root, 'test')
  const scratchRoot = join(root, 'scratch')
  const first = join(testRoot, 'a.test.mjs')
  const second = join(testRoot, 'nested', 'b.test.ts')
  const sentinel = join(scratchRoot, 'run-bounded-luna-test.mjs')
  try {
    mkdirSync(join(testRoot, 'nested'), { recursive: true })
    mkdirSync(scratchRoot)
    writeFileSync(first, 'throw new Error("test discovery executed a fixture")\n')
    writeFileSync(second, 'throw new Error("test discovery executed a fixture")\n')
    writeFileSync(join(testRoot, 'support.mjs'), 'export {}\n')
    writeFileSync(sentinel, 'throw new Error("scratch sentinel must never be run")\n')

    assert.deepEqual(discoverTestFiles(testRoot), [first, second])
    assert.deepEqual(buildRunnerArgs(testRoot, []), ['--import', 'tsx', '--test', first, second])
    assert.deepEqual(buildRunnerArgs(testRoot, [first], root), ['--import', 'tsx', '--test', first])
    assert.equal(buildRunnerArgs(testRoot, []).includes(sentinel), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('doctor command exit status follows prerequisite readiness and reports the browser setup command', () => {
  const doctor = spawnSync(process.execPath, [CLI_PATH, 'doctor', '--json'], { encoding: 'utf8' })
  assert.ok(doctor.status === 0 || doctor.status === 1)
  const result = JSON.parse(doctor.stdout)
  assert.equal(result.command, 'doctor')
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/)
  assert.ok(result.checks.some(({ id }) => id === 'playwright-chromium'))
  assert.equal(doctor.status, result.ok ? 0 : 1)
  const chromium = result.checks.find(({ id }) => id === 'playwright-chromium')
  if (!chromium.ok) assert.match(chromium.detail, /PLAYWRIGHT_BROWSERS_PATH=scratch\/verification-browsers npx playwright install chromium/)
})

test('doctor reads an isolated repository fixture without creating or changing files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-doctor-read-only-'))
  try {
    for (const entry of sourceManifest().files) {
      const sourcePath = join(REPOSITORY_ROOT, entry.path)
      const targetPath = join(root, entry.path)
      mkdirSync(resolve(targetPath, '..'), { recursive: true })
      copyFileSync(sourcePath, targetPath)
    }
    for (const dependency of ['vite', 'playwright']) {
      const dependencyPath = join(root, 'node_modules', dependency, 'package.json')
      mkdirSync(resolve(dependencyPath, '..'), { recursive: true })
      writeFileSync(dependencyPath, JSON.stringify({ name: dependency, version: 'fixture' }))
    }

    const before = snapshotFiles(root)
    const oldBrowserPath = process.env.PLAYWRIGHT_BROWSERS_PATH
    const result = await doctor({ repositoryRoot: root })
    assert.deepEqual(snapshotFiles(root), before)
    assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, oldBrowserPath)
    assert.equal(result.repositoryRoot, root)
    assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/)
    assert.ok(result.checks.every((check) => check.id === 'playwright-chromium' ? check.ok === false : check.ok === true))
    assert.match(result.checks.find(({ id }) => id === 'playwright-chromium').detail, /PLAYWRIGHT_BROWSERS_PATH=scratch\/verification-browsers npx playwright install chromium/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cleanup dry-run preserves an owned runtime; apply removes only that exact run directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-atlas-cleanup-test-'))
  const runId = 'test-run-42'
  const runtime = join(root, runId)
  try {
    mkdirSync(runtime)
    writeFileSync(join(runtime, '.control-atlas-owner.json'), JSON.stringify({ kind: 'control-atlas-runtime', runId, createdAt: '2026-10-11T00:00:00.000Z' }))
    writeFileSync(join(runtime, 'fixture.txt'), 'owned test data')
    const preview = cleanupRun({ runtimeRoot: root, runId })
    assert.equal(preview.status, 'dry-run')
    assert.equal(existsSync(join(runtime, 'fixture.txt')), true)
    assert.equal(readFileSync(join(runtime, 'fixture.txt'), 'utf8'), 'owned test data')

    const applied = cleanupRun({ runtimeRoot: root, runId, apply: true })
    assert.equal(applied.status, 'cleaned')
    assert.equal(existsSync(runtime), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cleanup refuses unmarked directories and leaves them intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-atlas-unmarked-test-'))
  const runtime = join(root, 'unmarked-run')
  try {
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'user-file.txt'), 'do not delete')
    assert.throws(() => cleanupRun({ runtimeRoot: root, runId: 'unmarked-run', apply: true }), /ownership marker/)
    assert.equal(readFileSync(join(runtime, 'user-file.txt'), 'utf8'), 'do not delete')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cleanup reports live owners in dry-run and refuses to remove their runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-atlas-live-test-'))
  const runId = 'live-run'
  const runtime = join(root, runId)
  try {
    mkdirSync(runtime)
    writeFileSync(join(runtime, '.control-atlas-owner.json'), JSON.stringify({ kind: 'control-atlas-runtime', runId, pid: process.pid }))
    const preview = cleanupRun({ runtimeRoot: root, runId })
    assert.equal(preview.status, 'active')
    assert.throws(() => cleanupRun({ runtimeRoot: root, runId, apply: true }), /may still own this runtime/)
    assert.equal(existsSync(runtime), true)
    assert.equal(cleanupRun({ runtimeRoot: root, runId, apply: true, allowCurrentProcess: true }).status, 'cleaned')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('explicit browser selection requires an absolute executable regular file', () => {
  assert.equal(selectedBrowserExecutable(''), undefined)
  assert.throws(() => selectedBrowserExecutable('chromium'), /absolute executable path/)
  assert.throws(() => selectedBrowserExecutable('/no-such-atlas-browser'))
  assert.throws(() => selectedBrowserExecutable('/tmp'), /regular file/)
  assert.equal(selectedBrowserExecutable(process.execPath), realpathSync(process.execPath))
})
