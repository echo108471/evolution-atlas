import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createFreshCheckoutEvidenceDirectory, localRevisionFetchArguments, parseFreshCheckoutArguments, readCheckoutTooling, readPinnedNodeVersion } from '../scripts/fresh-checkout.mjs'
import { fixtureEnvironment } from '../scripts/synthetic-fixtures.mjs'

const CLI_PATH = fileURLToPath(new URL('../scripts/fresh-checkout.mjs', import.meta.url))

test('fresh-checkout defaults to cached offline installation and exact local source selection', () => {
  const options = parseFreshCheckoutArguments([])
  assert.equal(options.installMode, 'offline')
  assert.equal(options.revision, null)
  assert.match(options.cache, /scratch\/npm-cache$/)
  const pinned = parseFreshCheckoutArguments(['--revision', 'a'.repeat(40), '--cache', '/tmp/cache', '--install-mode', 'registry'])
  assert.equal(pinned.revision, 'a'.repeat(40))
  assert.equal(pinned.installMode, 'registry')
  assert.equal(pinned.cache, '/tmp/cache')
})

test('fresh-checkout rejects implicit network modes and moving or external revision selectors', () => {
  for (const args of [
    ['--revision', 'main'], ['--revision', 'abc123'], ['--revision', 'https://example.invalid/repo'],
    ['--install-mode', 'automatic'], ['--cache'], ['--cache', '--help'], ['--force'],
  ]) assert.throws(() => parseFreshCheckoutArguments(args))
  assert.deepEqual(parseFreshCheckoutArguments(['--help']), { help: true })
})

test('fresh-checkout preserves existing evidence and refuses symlink parents into public assets', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-evidence-')))
  try {
    const repository = join(root, 'repository')
    mkdirSync(repository)
    const owned = createFreshCheckoutEvidenceDirectory(repository, 'owned-run')
    writeFileSync(join(owned, 'user-note.txt'), 'preserve this evidence')
    assert.throws(() => createFreshCheckoutEvidenceDirectory(repository, 'owned-run'), /EEXIST/)
    assert.equal(readFileSync(join(owned, 'user-note.txt'), 'utf8'), 'preserve this evidence')
    assert.throws(() => createFreshCheckoutEvidenceDirectory(repository, '../outside'), /Unsafe/)
    const unsafe = join(root, 'unsafe-repository')
    mkdirSync(join(unsafe, 'public'), { recursive: true })
    symlinkSync(join(unsafe, 'public'), join(unsafe, 'scratch'), 'dir')
    assert.throws(() => createFreshCheckoutEvidenceDirectory(unsafe, 'new-run'), /symlink/)
    assert.equal(existsSync(join(unsafe, 'public', 'fresh-checkout-evidence')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('local revision acquisition transfers a reflog-only commit without changing source refs or files', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-local-revision-')))
  const environment = fixtureEnvironment()
  const git = (cwd, args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  try {
    const source = join(root, 'source')
    const checkout = join(root, 'checkout')
    mkdirSync(source)
    git(source, ['init', '--initial-branch=main'])
    git(source, ['config', 'user.name', 'Synthetic Example'])
    git(source, ['config', 'user.email', 'synthetic@example.invalid'])
    writeFileSync(join(source, 'source.txt'), 'base synthetic content\n')
    git(source, ['add', 'source.txt'])
    git(source, ['commit', '-m', 'Synthetic base'])
    git(source, ['checkout', '--detach'])
    writeFileSync(join(source, 'source.txt'), 'detached synthetic content\n')
    git(source, ['add', 'source.txt'])
    git(source, ['commit', '-m', 'Synthetic detached revision'])
    const revision = git(source, ['rev-parse', 'HEAD'])
    git(source, ['checkout', 'main'])
    const sourceRefs = git(source, ['show-ref'])
    const sourceHead = git(source, ['rev-parse', 'HEAD'])
    assert.equal(git(source, ['rev-list', '--all']).includes(revision), false)
    git(root, ['clone', '--no-local', '--no-checkout', source, checkout])
    assert.throws(() => git(checkout, ['cat-file', '-e', `${revision}^{commit}`]))
    git(checkout, localRevisionFetchArguments(source, revision))
    git(checkout, ['checkout', '--detach', revision])
    assert.equal(git(checkout, ['rev-parse', 'HEAD']), revision)
    assert.equal(readFileSync(join(checkout, 'source.txt'), 'utf8'), 'detached synthetic content\n')
    assert.equal(git(source, ['show-ref']), sourceRefs)
    assert.equal(git(source, ['rev-parse', 'HEAD']), sourceHead)
    assert.equal(git(source, ['status', '--porcelain']), '')
    assert.equal(readFileSync(join(source, 'source.txt'), 'utf8'), 'base synthetic content\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fresh-checkout rejects symlink Node metadata before reading or disclosing an external canary', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-node-symlink-')))
  try {
    const repository = join(root, 'repository')
    mkdirSync(repository)
    const canary = 'EXTERNAL_NODE_VERSION_CANARY_DO_NOT_DISCLOSE'
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, canary)
    symlinkSync(outside, join(repository, '.node-version'))
    const result = spawnSync(process.execPath, [CLI_PATH, '--repo', repository], {
      encoding: 'utf8', env: fixtureEnvironment(), timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stderr).error, /must not traverse a symlink/)
    assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false)
    assert.equal(readFileSync(outside, 'utf8'), canary)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fresh-checkout rejects FIFO Node metadata without blocking', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-node-fifo-')))
  try {
    const repository = join(root, 'repository')
    mkdirSync(repository)
    execFileSync('mkfifo', [join(repository, '.node-version')], { env: fixtureEnvironment() })
    const result = spawnSync(process.execPath, [CLI_PATH, '--repo', repository], {
      encoding: 'utf8', env: fixtureEnvironment(), timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(JSON.parse(result.stderr).error, /must be a regular file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('tooling metadata rejects symlinks, oversized and malformed content without echoing bytes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-tooling-metadata-')))
  try {
    const canary = 'MALFORMED_TOOLING_CANARY_DO_NOT_DISCLOSE'
    writeFileSync(join(root, '.node-version'), canary)
    assert.throws(() => readPinnedNodeVersion(root), { message: 'Invalid pinned Node version metadata.' })
    writeFileSync(join(root, '.node-version'), 'x'.repeat(65))
    assert.throws(() => readPinnedNodeVersion(root), /size limit/)
    writeFileSync(join(root, '.node-version'), `${process.versions.node}\n`)
    writeFileSync(join(root, 'package.json'), canary)
    assert.throws(() => readCheckoutTooling(root), { message: 'Malformed package tooling metadata JSON.' })
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, canary)
    rmSync(join(root, 'package.json'))
    symlinkSync(outside, join(root, 'package.json'))
    assert.throws(() => readCheckoutTooling(root), /must not traverse a symlink/)
    assert.equal(readFileSync(outside, 'utf8'), canary)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checkout tooling rejects FIFO package metadata without blocking', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-fresh-package-fifo-')))
  try {
    writeFileSync(join(root, '.node-version'), `${process.versions.node}\n`)
    execFileSync('mkfifo', [join(root, 'package.json')], { env: fixtureEnvironment() })
    const source = `import { readCheckoutTooling } from ${JSON.stringify(new URL('../scripts/fresh-checkout.mjs', import.meta.url).href)}; try { readCheckoutTooling(process.argv[1]) } catch (error) { process.stderr.write(error.message); process.exitCode = 1 }`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, root], {
      encoding: 'utf8', env: fixtureEnvironment(), timeout: 5000,
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /must be a regular file: package.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
