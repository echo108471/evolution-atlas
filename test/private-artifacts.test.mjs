import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRIVATE_ARTIFACT_ROOTS, preservePrivateArtifacts, verifyPrivateArtifactBackup } from '../scripts/lib/private-artifacts.mjs'

const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sandbox(run) {
  const parent = mkdtempSync(join(tmpdir(), 'atlas-private-artifacts-'))
  const repositoryRoot = join(parent, 'repository')
  mkdirSync(repositoryRoot)
  const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--quiet')
  git('config', 'user.name', 'Synthetic Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const trackedPath = `${PRIVATE_ARTIFACT_ROOTS[0]}/run/output.json`
  mkdirSync(dirname(join(repositoryRoot, trackedPath)), { recursive: true })
  writeFileSync(join(repositoryRoot, trackedPath), 'original synthetic output\n')
  git('add', '--', trackedPath)
  git('commit', '--quiet', '-m', 'synthetic artifact fixture')
  try { run({ parent, repositoryRoot, git, trackedPath }) } finally { rmSync(parent, { recursive: true, force: true }) }
}

test('preservation keeps working edits and untracked bytes outside the repository with verified metadata', () => sandbox(({ parent, repositoryRoot, git, trackedPath }) => {
  const edited = Buffer.from('edited synthetic output\u0000\n')
  writeFileSync(join(repositoryRoot, trackedPath), edited)
  const extraPath = `${PRIVATE_ARTIFACT_ROOTS[1]}/nested/local-only.json`
  mkdirSync(dirname(join(repositoryRoot, extraPath)), { recursive: true })
  writeFileSync(join(repositoryRoot, extraPath), 'untracked synthetic bytes')
  const beforeStatus = git('status', '--porcelain=v1')
  const destination = join(parent, 'private-backup')
  const result = preservePrivateArtifacts({ repositoryRoot, destination })
  assert.equal(result.files, 2)
  assert.equal(result.trackedFiles, 1)
  assert.equal(result.untrackedFiles, 1)
  assert.equal(result.revision, git('rev-parse', 'HEAD').trim())
  assert.deepEqual(readFileSync(join(destination, 'files', trackedPath)), edited)
  assert.deepEqual(readFileSync(join(repositoryRoot, trackedPath)), edited)
  assert.equal(git('status', '--porcelain=v1'), beforeStatus)
  const manifestBytes = readFileSync(result.manifestPath)
  assert.equal(result.manifestSha256, createHash('sha256').update(manifestBytes).digest('hex'))
  assert.equal(manifestBytes.includes(edited), false)
  assert.deepEqual(verifyPrivateArtifactBackup(destination), result)
  // A recovery copy uses manifest paths and leaves the original repository alone.
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.files.find((file) => file.path === extraPath).tracked, false)
}))

test('preservation rejects unsafe destinations and never overwrites an existing backup', () => sandbox(({ parent, repositoryRoot }) => {
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination: join(repositoryRoot, 'public', 'backup') }), /outside and separate/)
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination: parent }), /outside and separate/)
  const destination = join(parent, 'backup')
  preservePrivateArtifacts({ repositoryRoot, destination })
  const before = readFileSync(join(destination, 'manifest.json'))
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination }), /already exists/)
  assert.deepEqual(readFileSync(join(destination, 'manifest.json')), before)
  const alias = join(parent, 'alias')
  symlinkSync(destination, alias)
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination: join(alias, 'child') }), /symlink/)
  assert.throws(() => verifyPrivateArtifactBackup(alias), /symlink/)
}))

test('source symlinks and missing tracked artifacts fail before a backup is created', () => sandbox(({ parent, repositoryRoot, trackedPath }) => {
  const destination = join(parent, 'backup')
  const link = join(repositoryRoot, PRIVATE_ARTIFACT_ROOTS[0], 'linked.json')
  symlinkSync(join(repositoryRoot, trackedPath), link)
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination }), /symlink/)
  assert.equal(existsSync(destination), false)
  rmSync(link)
  rmSync(join(repositoryRoot, trackedPath))
  assert.throws(() => preservePrivateArtifacts({ repositoryRoot, destination }), /tracked artifact is missing/)
  assert.equal(existsSync(destination), false)
}))

test('verification detects changed bytes, unexpected files, and traversal metadata', () => sandbox(({ parent, repositoryRoot, trackedPath }) => {
  const destination = join(parent, 'backup')
  preservePrivateArtifacts({ repositoryRoot, destination })
  const saved = join(destination, 'files', trackedPath)
  const original = readFileSync(saved)
  writeFileSync(saved, 'changed')
  assert.throws(() => verifyPrivateArtifactBackup(destination), /hash mismatch/)
  writeFileSync(saved, original)
  const extra = join(destination, 'files', 'unexpected')
  writeFileSync(extra, 'extra')
  assert.throws(() => verifyPrivateArtifactBackup(destination), /inventory differs/)
  rmSync(extra)
  const manifestPath = join(destination, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.files[0].path = `${PRIVATE_ARTIFACT_ROOTS[0]}/../../outside`
  writeFileSync(manifestPath, JSON.stringify(manifest))
  assert.throws(() => verifyPrivateArtifactBackup(destination), /outside the reviewed/)
}))

test('verification rejects a named-pipe manifest promptly instead of opening it', (context) => sandbox(({ parent, repositoryRoot }) => {
  const destination = join(parent, 'backup')
  preservePrivateArtifacts({ repositoryRoot, destination })
  const manifestPath = join(destination, 'manifest.json')
  rmSync(manifestPath)
  const fifo = spawnSync('mkfifo', [manifestPath], { env: environment })
  if (fifo.error?.code === 'ENOENT') { context.skip('mkfifo is unavailable on this platform'); return }
  assert.equal(fifo.status, 0)
  const verification = spawnSync(process.execPath, [join(projectRoot, 'scripts/preserve-private-artifacts.mjs'), '--verify', '--destination', destination], { env: environment, encoding: 'utf8', timeout: 3000 })
  assert.equal(verification.error, undefined)
  assert.equal(verification.status, 1)
  assert.match(verification.stderr, /Refusing non-regular file/)
}))

test('ignore rules cover real output and credential paths while allowing synthetic fixtures and generators', () => sandbox(({ repositoryRoot }) => {
  writeFileSync(join(repositoryRoot, '.gitignore'), readFileSync(join(projectRoot, '.gitignore')))
  const ignored = [
    `${PRIVATE_ARTIFACT_ROOTS[0]}/run/output.json`, `${PRIVATE_ARTIFACT_ROOTS[1]}/index.html`,
    '.env', '.env.local', 'secrets/private.key', '.aws/credentials', '.codex/hooks.json',
    'data/private.json', 'datasets/private.json', 'runs/model/output.json', 'responses/raw.json',
    'reports/review.html', 'clones/repository/config', 'cache/provider.json', 'caches/repository/config',
    'scratch/test/output.json', '.gallery-cache/repository/config', 'public/raw-responses/raw.json',
  ]
  for (const path of ignored) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: repositoryRoot, env: environment })
    assert.equal(result.status, 0, `Expected ignored path: ${path}`)
  }
  for (const path of ['test/fixtures/synthetic.json', 'scripts/verification/fixtures.mjs', 'scripts/render-experiment-summary.mjs', 'gallery/manifest.json']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd: repositoryRoot, env: environment })
    assert.equal(result.status, 1, `Expected source path: ${path}`)
  }
}))
