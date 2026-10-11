import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fixtureEnvironment, generateSyntheticFixtures, parseFixtureArguments, validateSyntheticFixtures } from '../scripts/synthetic-fixtures.mjs'
import { parseCandidateMapArtifact } from '../src/repositoryMap.ts'
import { matchesDataset, parsePeriodDocument } from '../src/periods.ts'

const CLI_PATH = fileURLToPath(new URL('../scripts/synthetic-fixtures.mjs', import.meta.url))

test('synthetic fixture generation is byte stable across destinations and supports real viewer parsers', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-fixtures-')))
  try {
    const first = generateSyntheticFixtures(join(root, 'first'))
    const second = generateSyntheticFixtures(join(root, 'second'))
    assert.deepEqual(first.manifest, second.manifest)
    assert.equal(first.manifestSha256, second.manifestSha256)
    for (const { path } of first.manifest.files) {
      assert.deepEqual(readFileSync(join(first.root, path)), readFileSync(join(second.root, path)), path)
    }
    const atlas = JSON.parse(readFileSync(join(first.root, 'atlas.json'), 'utf8'))
    const periods = parsePeriodDocument(JSON.parse(readFileSync(join(first.root, 'epochs.json'), 'utf8')))
    assert.ok(periods)
    assert.ok(matchesDataset(periods, atlas.repository))
    const map = await parseCandidateMapArtifact(JSON.parse(readFileSync(join(first.root, 'maps/output.json'), 'utf8')))
    assert.equal(map.graph.nodes.length, 1)
    assert.equal(map.independentVerification, 'not-performed')
    const validation = validateSyntheticFixtures(first.root)
    assert.equal(validation.ok, true)
    assert.equal(validation.headSha, first.manifest.sourceRepository.headSha)
    const observed = JSON.parse(readFileSync(join(first.root, 'observed-atlas.json'), 'utf8'))
    assert.equal(observed.analysis.mode, 'observed-only')
    assert.equal(observed.repository.headSha, validation.headSha)
    assert.equal(observed.episodes.length, 2)
    assert.equal(observed.featureCandidates.length, 0)
    assert.equal(JSON.stringify(observed).includes('ada@example.invalid'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generation preserves existing files and refuses project source or symlink destinations', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-preserve-')))
  try {
    const existing = join(root, 'existing')
    mkdirSync(existing)
    writeFileSync(join(existing, 'user-file.txt'), 'preserve this file')
    assert.throws(() => generateSyntheticFixtures(existing), /new or empty directory/)
    assert.equal(readFileSync(join(existing, 'user-file.txt'), 'utf8'), 'preserve this file')
    assert.throws(() => generateSyntheticFixtures(new URL('../public/unsafe-fixture', import.meta.url).pathname), /outside tracked\/public/)
    symlinkSync(existing, join(root, 'linked'), 'dir')
    assert.throws(() => generateSyntheticFixtures(join(root, 'linked', 'new')), /symlink/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validation rejects changed bytes, extra files, and a changed source checkout', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-validation-')))
  try {
    const generated = generateSyntheticFixtures(join(root, 'fixture'))
    const atlasPath = join(generated.root, 'atlas.json')
    const atlas = readFileSync(atlasPath)
    writeFileSync(atlasPath, '{}\n')
    assert.throws(() => validateSyntheticFixtures(generated.root), /hash mismatch: atlas.json/)
    writeFileSync(atlasPath, atlas)
    writeFileSync(join(generated.root, 'extra.txt'), 'unexpected')
    assert.throws(() => validateSyntheticFixtures(generated.root), /inventory/)
    rmSync(join(generated.root, 'extra.txt'))
    execFileSync('git', ['-C', join(generated.root, 'source-repository'), 'checkout', '--detach', generated.manifest.sourceRepository.headSha], { env: fixtureEnvironment(), stdio: 'ignore' })
    assert.throws(() => validateSyntheticFixtures(generated.root), /source history/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validation rejects an external manifest symlink before reading or disclosing its content', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-manifest-symlink-')))
  try {
    const fixture = generateSyntheticFixtures(join(root, 'fixture'))
    const canary = 'EXTERNAL_MANIFEST_CANARY_DO_NOT_DISCLOSE'
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, canary)
    const manifest = join(fixture.root, 'fixture-manifest.json')
    rmSync(manifest)
    symlinkSync(outside, manifest)
    const result = spawnSync(process.execPath, [CLI_PATH, 'validate', '--out', fixture.root], {
      encoding: 'utf8', env: fixtureEnvironment(), timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stderr).error, /symlink or special file/)
    assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false)
    assert.equal(readFileSync(outside, 'utf8'), canary)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validation rejects a FIFO manifest without blocking', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-manifest-fifo-')))
  try {
    const fixture = generateSyntheticFixtures(join(root, 'fixture'))
    const manifest = join(fixture.root, 'fixture-manifest.json')
    rmSync(manifest)
    execFileSync('mkfifo', [manifest], { env: fixtureEnvironment() })
    const result = spawnSync(process.execPath, [CLI_PATH, 'validate', '--out', fixture.root], {
      encoding: 'utf8', env: fixtureEnvironment(), timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stderr).error, /symlink or special file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed regular manifest errors omit file content', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-synthetic-manifest-json-')))
  try {
    const fixture = generateSyntheticFixtures(join(root, 'fixture'))
    const canary = 'REGULAR_MANIFEST_CANARY_DO_NOT_DISCLOSE'
    writeFileSync(join(fixture.root, 'fixture-manifest.json'), canary)
    assert.throws(() => validateSyntheticFixtures(fixture.root), (error) => {
      assert.equal(error.message, 'Malformed synthetic fixture manifest JSON.')
      assert.equal(error.message.includes(canary), false)
      return true
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fixture commands reject incomplete options and exclude caller credentials and identity configuration', () => {
  assert.equal(parseFixtureArguments(['generate']).command, 'generate')
  assert.equal(parseFixtureArguments(['validate', '--out', '/tmp/synthetic-example']).destination, '/tmp/synthetic-example')
  assert.deepEqual(parseFixtureArguments(['--help']), { help: true })
  for (const args of [[], ['publish'], ['generate', '--out'], ['generate', '--out', '--help'], ['validate', '--force']]) {
    assert.throws(() => parseFixtureArguments(args))
  }
  const env = fixtureEnvironment()
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GIT_AUTHOR_NAME', 'GIT_DIR', 'GIT_CONFIG_COUNT']) {
    assert.equal(key in env, false)
  }
  if (env.NODE_OPTIONS) assert.match(env.NODE_OPTIONS, /^--require=".*\/scripts\/verification\/offline-preload\.cjs"$/)
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null')
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
})
