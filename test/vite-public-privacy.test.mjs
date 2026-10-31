import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'vite'

import viteConfig from '../vite.config.ts'
import { loadPublicationAssets } from '../scripts/lib/build-publication.mjs'
import { syntheticAtlas } from '../scripts/verification/fixtures.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-build-publication-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, 'index.html', '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>')
  write(root, 'main.js', 'document.body.dataset.app = "synthetic-build-test"\n')
  manifest(root, [])
  return root
}

function write(root, path, bytes) {
  const absolute = join(root, path)
  mkdirSync(resolve(absolute, '..'), { recursive: true })
  writeFileSync(absolute, bytes)
  return absolute
}

function manifest(root, assets) {
  write(root, 'publication/manifest.json', JSON.stringify({ version: 1, assets }))
}

function approvedFixture(root) {
  const bytes = `${JSON.stringify(syntheticAtlas())}\n`
  const asset = {
    source: 'publication/assets/synthetic-atlas.json',
    path: 'approved-snapshots/synthetic-atlas.json',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType: 'application/json',
    approval: 'Synthetic fixture for this disposable test only; no real snapshot approval.',
  }
  write(root, asset.source, bytes)
  return { asset, bytes }
}

function snapshotTree(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory()
      ? snapshotTree(join(directory, entry.name), path)
      : [{ path, bytes: readFileSync(join(directory, entry.name)) }]
  })
}

async function productionBuild(root, overrides = {}) {
  const config = await viteConfig({ command: 'build', mode: 'production' })
  return build({ ...config, ...overrides, root, configFile: false, logLevel: 'silent' })
}

test('production disables wholesale public copying and development retains local viewing', async () => {
  assert.equal((await viteConfig({ command: 'build', mode: 'production' })).publicDir, false)
  assert.equal((await viteConfig({ command: 'serve', mode: 'development' })).publicDir, 'public')
})

test('actual empty-approval production build excludes root and nested local artifacts even with a gallery manifest', async t => {
  const root = fixture(t)
  const marker = 'PRIVATE-SYNTHETIC-BUILD-SENTINEL-EMPTY'
  for (const path of [
    'public/atlas.private.json',
    'public/arbitrary-dataset.json',
    'public/gallery/manifest.json',
    'public/gallery/private.json',
    'public/sweep/nested/dataset.json',
    'public/graph-reviews/local-run/index.html',
    'public/graph-reviews/local-run/raw-response.json',
    'public/nested/responses/model.json',
    'public/nested/cache/entry.json',
    'public/nested/clones/example/source.txt',
    'scratch/private-run/output.json',
    '.gallery-cache/example/source.txt',
    'publication/assets/unapproved.json',
  ]) write(root, path, marker)
  write(root, 'dist/stale-private-output.json', marker)

  await productionBuild(root)
  const output = snapshotTree(join(root, 'dist'))
  assert.ok(output.some(file => file.path === 'index.html'))
  assert.ok(output.every(file => file.path === 'index.html' || /^assets\/.+\.js$/.test(file.path)))
  assert.ok(output.every(file => !file.bytes.includes(marker)))
  assert.equal(readFileSync(join(root, 'public/atlas.private.json'), 'utf8'), marker)
})

test('actual production build emits only an explicitly approved synthetic fixture with exact bytes', async t => {
  const root = fixture(t)
  const { asset, bytes } = approvedFixture(root)
  manifest(root, [asset])
  const marker = 'PRIVATE-SYNTHETIC-BUILD-SENTINEL-APPROVED'
  for (const path of ['public/atlas.json', 'public/gallery/manifest.json', 'public/raw/response.json', 'public/reports/nested/index.html', 'public/cache/entry.json', 'public/clones/example/file.txt', 'publication/assets/unapproved.json']) {
    write(root, path, marker)
  }

  await productionBuild(root)
  const output = snapshotTree(join(root, 'dist'))
  assert.equal(readFileSync(join(root, 'dist', asset.path), 'utf8'), bytes)
  assert.deepEqual(output.filter(file => file.path !== 'index.html' && !file.path.startsWith('assets/')).map(file => file.path), [asset.path])
  assert.ok(output.every(file => !file.bytes.includes(marker)))
})

test('approval manifest rejects unsafe paths, arbitrary local sources, collisions, hashes and file types', t => {
  const root = fixture(t)
  const { asset } = approvedFixture(root)
  for (const change of [
    { source: '../secret.json' }, { source: '/tmp/secret.json' }, { source: 'publication/assets/../secret.json' },
    { source: 'publication/assets/a\\secret.json' }, { source: 'publication/assets/a%2fsecret.json' },
    { source: 'public/atlas.json' }, { source: 'scratch/run/output.json' }, { source: '.gallery-cache/response.json' },
    { path: '../secret.json' }, { path: '/gallery/secret.json' }, { path: 'gallery//secret.json' },
    { path: 'assets/secret.json' }, { path: 'index.html' }, { path: 'approved-snapshots/.env' },
    { sha256: 'a'.repeat(64) }, { sha256: 'abc' }, { mediaType: 'application/octet-stream' },
    { mediaType: 'text/html' }, { approval: '' },
  ]) {
    manifest(root, [{ ...asset, ...change }])
    assert.throws(() => loadPublicationAssets(root), /Publication manifest:/)
  }
  manifest(root, [asset, asset])
  assert.throws(() => loadPublicationAssets(root), /conflicting output/)
  manifest(root, [asset, { ...asset, path: asset.path.toUpperCase().replace('APPROVED-SNAPSHOTS/', 'approved-snapshots/') }])
  assert.throws(() => loadPublicationAssets(root), /conflicting output/)
  manifest(root, [{ ...asset, extra: 'ignored fields must not grant approval' }])
  assert.throws(() => loadPublicationAssets(root), /invalid asset entry/)
})

test('approval manifest refuses a symlinked asset, source directory or manifest', t => {
  for (const target of ['asset', 'directory', 'manifest']) {
    const root = fixture(t)
    const { asset, bytes } = approvedFixture(root)
    manifest(root, [asset])
    if (target === 'asset') {
      const original = join(root, asset.source)
      rmSync(original)
      symlinkSync(write(root, 'outside/asset.json', bytes), original)
    } else if (target === 'directory') {
      rmSync(join(root, 'publication/assets'), { recursive: true })
      write(root, 'outside/synthetic-atlas.json', bytes)
      symlinkSync(join(root, 'outside'), join(root, 'publication/assets'))
    } else {
      rmSync(join(root, 'publication/manifest.json'))
      symlinkSync(write(root, 'outside/manifest.json', JSON.stringify({ version: 1, assets: [asset] })), join(root, 'publication/manifest.json'))
    }
    assert.throws(() => loadPublicationAssets(root), /symlinks are forbidden/)
  }
})

test('actual production build fails closed before emitting an unapproved or changed snapshot', async t => {
  const root = fixture(t)
  const { asset } = approvedFixture(root)
  manifest(root, [{ ...asset, sha256: '0'.repeat(64) }])
  write(root, 'dist/stale-private-output.json', 'PRIVATE-SYNTHETIC-STALE-FAILED-BUILD')
  await assert.rejects(productionBuild(root), /SHA-256 mismatch/)
  assert.equal(existsSync(join(root, 'dist')), false)
})

test('production refuses unsafe output cleanup targets and public-copy overrides without deleting user files', async t => {
  const root = fixture(t)
  const protectedPath = write(root, 'outside/user-file.txt', 'preserved synthetic user file')
  symlinkSync(join(root, 'outside'), join(root, 'dist'))
  await assert.rejects(productionBuild(root), /owned dist output must be a real directory/)
  assert.equal(readFileSync(protectedPath, 'utf8'), 'preserved synthetic user file')
  rmSync(join(root, 'dist'))
  await assert.rejects(productionBuild(root, { build: { copyPublicDir: false, emptyOutDir: true, outDir: 'outside' } }), /owned dist output directory/)
  assert.equal(readFileSync(protectedPath, 'utf8'), 'preserved synthetic user file')
  for (const bundler of ['rolldownOptions', 'rollupOptions']) {
    await assert.rejects(productionBuild(root, { build: { copyPublicDir: false, emptyOutDir: true, outDir: 'dist', [bundler]: { output: [{ dir: 'dist' }, { dir: 'outside' }] } } }), /owned dist output directory/)
    assert.equal(readFileSync(protectedPath, 'utf8'), 'preserved synthetic user file')
  }
  await assert.rejects(productionBuild(root, { publicDir: 'public' }), /disable public directory copying/)
  await assert.rejects(productionBuild(root, { build: { copyPublicDir: false, emptyOutDir: false } }), /clear stale output/)
  const alias = join(root, 'alias-root')
  symlinkSync(root, alias)
  await assert.rejects(productionBuild(alias), /root and its ancestors must be real directories/)
  assert.equal(readFileSync(protectedPath, 'utf8'), 'preserved synthetic user file')
})

test('missing or malformed publication manifests fail closed', t => {
  const root = fixture(t)
  rmSync(join(root, 'publication/manifest.json'))
  assert.throws(() => loadPublicationAssets(root), /ENOENT/)
  for (const value of [{ version: 2, assets: [] }, { version: 1 }, { version: 1, assets: [], files: [] }]) {
    write(root, 'publication/manifest.json', JSON.stringify(value))
    assert.throws(() => loadPublicationAssets(root), /expected version 1/)
  }
  write(root, 'publication/manifest.json', 'not-json-sensitive-synthetic-marker')
  assert.throws(() => loadPublicationAssets(root), error => /manifest must contain valid JSON/.test(error.message)
    && !error.message.includes('sensitive-synthetic-marker'))
  const { asset } = approvedFixture(root)
  const bytes = '{invalid-json}'
  write(root, asset.source, bytes)
  manifest(root, [{ ...asset, sha256: createHash('sha256').update(bytes).digest('hex') }])
  assert.throws(() => loadPublicationAssets(root), /invalid JSON asset/)
})

test('approval manifest accepts an approved candidate map under maps/ and nothing broader', t => {
  const root = fixture(t)
  const { asset } = approvedFixture(root)
  manifest(root, [{ ...asset, path: 'maps/synthetic/reviewed-output.json' }])
  assert.equal(loadPublicationAssets(root)[0].path, 'maps/synthetic/reviewed-output.json')
  for (const path of ['maps', 'mapsx/output.json', 'maps/../gallery/x.json', 'maps/.hidden/output.json']) {
    manifest(root, [{ ...asset, path }])
    assert.throws(() => loadPublicationAssets(root), /Publication manifest:/)
  }
})
