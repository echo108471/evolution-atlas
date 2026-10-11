import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createFreshCheckoutEvidenceDirectory, createRegistryInstallEnvironment, localRevisionFetchArguments, parseFreshCheckoutArguments, readCheckoutTooling, readPinnedNodeVersion } from '../scripts/fresh-checkout.mjs'
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

test('explicit registry installation restores routing and CA trust while preserving TLS and offline validation', () => {
  const offline = {
    PATH: '/synthetic/tools',
    HOME: '/synthetic/empty-home',
    USERPROFILE: '/synthetic/empty-home',
    XDG_CONFIG_HOME: '/synthetic/empty-home',
    NODE_OPTIONS: '--require="/synthetic/offline-preload.cjs"',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ALLOW_PROTOCOL: 'file',
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_USERCONFIG: '/synthetic/empty-home/.npmrc',
    NPM_CONFIG_GLOBALCONFIG: '/synthetic/empty-home/global-npmrc',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  }
  const routing = {
    HTTP_PROXY: 'http://upper-http.example.invalid:8080',
    HTTPS_PROXY: 'http://upper-https.example.invalid:8080',
    ALL_PROXY: 'http://upper-all.example.invalid:8080',
    NO_PROXY: 'upper-local.example.invalid',
    http_proxy: 'http://lower-http.example.invalid:8080',
    https_proxy: 'http://lower-https.example.invalid:8080',
    all_proxy: 'http://lower-all.example.invalid:8080',
    no_proxy: 'lower-local.example.invalid',
  }
  const trust = {
    NODE_EXTRA_CA_CERTS: '/synthetic/trust/extra-ca.pem',
    SSL_CERT_FILE: '/synthetic/trust/ca-bundle.pem',
    SSL_CERT_DIR: '/synthetic/trust/certificates',
  }
  const credentials = {
    ANTHROPIC_API_KEY: 'synthetic-provider-key', OPENAI_API_KEY: 'synthetic-provider-key',
    OPENROUTER_API_KEY: 'synthetic-provider-key', GITHUB_TOKEN: 'synthetic-github-key',
    GH_TOKEN: 'synthetic-github-key', NPM_TOKEN: 'synthetic-npm-key', NODE_AUTH_TOKEN: 'synthetic-npm-key',
    NPM_CONFIG__AUTH: 'synthetic-npm-key', npm_config__auth: 'synthetic-npm-key',
    NPM_CONFIG_USERCONFIG: '/synthetic/caller/auth-npmrc', NODE_OPTIONS: '--require=/synthetic/caller/preload.cjs',
    NODE_TLS_REJECT_UNAUTHORIZED: '0', NPM_CONFIG_STRICT_SSL: 'false', npm_config_strict_ssl: 'false',
  }
  const original = { ...offline }
  const registry = createRegistryInstallEnvironment(offline, { ...routing, ...trust, ...credentials })
  assert.deepEqual(offline, original)
  assert.equal(registry.NODE_OPTIONS, undefined)
  assert.equal(registry.NPM_CONFIG_OFFLINE, undefined)
  for (const [key, value] of Object.entries({ ...routing, ...trust })) {
    assert.equal(registry[key], value)
    assert.equal(key in offline, false)
  }
  for (const key of Object.keys(credentials).filter(key => !['NODE_OPTIONS', 'NPM_CONFIG_USERCONFIG'].includes(key))) {
    assert.equal(key in registry, false, key)
  }
  for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_ALLOW_PROTOCOL', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG', 'NPM_CONFIG_UPDATE_NOTIFIER']) {
    assert.equal(registry[key], offline[key], key)
  }
  assert.equal(offline.NODE_OPTIONS, original.NODE_OPTIONS)
  assert.equal(offline.NPM_CONFIG_OFFLINE, 'true')
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
