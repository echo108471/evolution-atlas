import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { parseControlCommand } from '../scripts/control-atlas.mjs'
import { loadPreviewBuild, startPreviewServer } from '../scripts/verification/preview.mjs'
import { prepareControlRoots } from '../scripts/verification/control-atlas.mjs'
import { syntheticAtlas, syntheticGallery } from '../scripts/verification/fixtures.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-preview-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore', env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  writeFileSync(join(root, '.gitignore'), '/scratch/\n')
  const directory = join(root, 'scratch', 'preview', 'dist'), inventory = join(root, 'scratch', 'preview', 'inventory.json')
  const data = syntheticAtlas()
  const files = { 'index.html': '<!doctype html><html><body>synthetic preview</body></html>',
    'assets/app.js': 'document.body.dataset.fixture="preview"',
    'gallery/manifest.json': JSON.stringify(syntheticGallery(data)), 'gallery/synthetic-atlas.json': JSON.stringify(data) }
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), bytes)
  }
  const entries = Object.entries(files).map(([path, bytes]) => ({ path, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) }))
  writeFileSync(inventory, JSON.stringify({ version: 1, sourceRevision: 'a'.repeat(40), files: entries }))
  return { root, directory, inventory, entries }
}

test('private preview CLI requires explicit local directory and inventory and rejects server URLs or unrelated options', () => {
  assert.deepEqual(parseControlCommand(['verify-preview', '--directory', '/ignored/dist', '--inventory', '/ignored/inventory.json']),
    { command: 'verify-preview', options: { directory: '/ignored/dist', inventory: '/ignored/inventory.json', json: false } })
  for (const args of [[], ['--directory', 'https://example.com'], ['--directory', 'relative'], ['--directory', '/x'],
    ['--directory', '/x', '--inventory', '/i', '--all'], ['--directory', '/x', '--inventory', '/i', '--directory', '/y']]) {
    assert.throws(() => parseControlCommand(['verify-preview', ...args]), { exitCode: 2 })
  }
})

test('private preview inventory binds exact prepared bytes and sole-subject counts without granting publication approval', t => {
  const fixturePaths = fixture(t), preview = loadPreviewBuild(fixturePaths)
  assert.equal(preview.expected.headSha, 'b'.repeat(40))
  assert.equal(preview.expected.counts.commits, 2)
  assert.equal(preview.build.files.length, 4)
  assert.match(preview.build.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(preview.allowedMissingEpochs, true)
})

test('private preview rejects changed bytes and uninventoried files before browser setup', t => {
  const paths = fixture(t)
  writeFileSync(join(paths.directory, 'assets/app.js'), 'changed synthetic bundle')
  assert.throws(() => loadPreviewBuild(paths), /size mismatch|hash mismatch/)
  const extra = fixture(t)
  writeFileSync(join(extra.directory, 'unexpected.txt'), 'unlisted synthetic artifact')
  assert.throws(() => loadPreviewBuild(extra), /exactly match the inventory/)
})

test('private preview binds notice and provenance links to inventoried same-origin metadata', t => {
  const paths = fixture(t), galleryPath = join(paths.directory, 'gallery/manifest.json')
  const gallery = JSON.parse(readFileSync(galleryPath, 'utf8'))
  const metadata = [['notice', 'approved-snapshots/fixture-LICENSE.txt', 'Synthetic fixture notice'], ['provenance', 'approved-snapshots/fixture-PROVENANCE.json', '{"fixture":true}']]
  for (const [field, path, bytes] of metadata) {
    mkdirSync(dirname(join(paths.directory, path)), { recursive: true })
    writeFileSync(join(paths.directory, path), bytes)
    gallery.subjects[0][field] = `/${path}`
    paths.entries.push({ path, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) })
  }
  const saveManifest = () => {
    const bytes = JSON.stringify(gallery)
    writeFileSync(galleryPath, bytes)
    Object.assign(paths.entries.find(entry => entry.path === 'gallery/manifest.json'), { sha256: sha(bytes), bytes: Buffer.byteLength(bytes) })
    writeFileSync(paths.inventory, JSON.stringify({ version: 1, sourceRevision: 'a'.repeat(40), files: paths.entries }))
  }
  saveManifest()
  assert.equal(loadPreviewBuild(paths).expected.metadata.length, 2)
  gallery.subjects[0].notice = 'https://example.com/uninventoried.txt'
  saveManifest()
  assert.throws(() => loadPreviewBuild(paths), /inventoried same-origin metadata/)
})

test('private preview rejects traversal, unsupported namespaces and duplicate inventory entries', t => {
  const paths = fixture(t)
  for (const path of ['../secret.json', '/secret.json', 'gallery/a%2fsecret.json', 'raw/response.json', '.env']) {
    writeFileSync(paths.inventory, JSON.stringify({ version: 1, sourceRevision: 'a'.repeat(40), files: [{ ...paths.entries[0], path }] }))
    assert.throws(() => loadPreviewBuild(paths), /invalid inventory|unexpected/)
  }
  writeFileSync(paths.inventory, JSON.stringify({ version: 1, sourceRevision: 'a'.repeat(40), files: [...paths.entries, paths.entries[0]] }))
  assert.throws(() => loadPreviewBuild(paths), /duplicate/)
})

test('private preview rejects symlink input and nonignored input while preserving local files', t => {
  const paths = fixture(t), target = join(paths.directory, 'assets/app.js')
  const saved = readFileSync(target)
  const outside = join(paths.root, 'saved.js')
  writeFileSync(outside, saved)
  rmSync(target)
  symlinkSync(outside, target)
  assert.throws(() => loadPreviewBuild(paths), /symlinks/)
  assert.deepEqual(readFileSync(outside), saved)
  const other = fixture(t), inventory = join(other.root, 'inventory.json')
  writeFileSync(inventory, readFileSync(other.inventory))
  assert.throws(() => loadPreviewBuild({ ...other, inventory }), /ignored local paths/)
})

test('private preview server serves only validated bytes and reports the scoped missing epochs response', async t => {
  const paths = fixture(t), preview = loadPreviewBuild(paths), hosted = await startPreviewServer(preview)
  t.after(() => new Promise(resolve => hosted.server.close(resolve)))
  assert.equal((await fetch(`${hosted.baseUrl}/`)).status, 200)
  assert.equal(sha(await (await fetch(`${hosted.baseUrl}/gallery/synthetic-atlas.json`)).bytes()), preview.expected.datasetSha256)
  assert.equal((await fetch(`${hosted.baseUrl}/epochs.json`)).status, 404)
  assert.equal((await fetch(`${hosted.baseUrl}/unlisted.txt`)).status, 404)
  assert.equal((await fetch(`${hosted.baseUrl}/assets/app.js?secret=value`)).status, 400)
  assert.ok(hosted.requests.some(request => request.path === '/epochs.json' && request.status === 404))
})

test('verifier output guards refuse symlinked scratch, evidence or runtime before writing outside ignored roots', t => {
  for (const name of ['scratch', 'control-atlas-evidence', 'control-atlas-runtime']) {
    const paths = fixture(t)
    const outside = join(paths.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'sentinel.txt'), 'preserve this synthetic file')
    const link = name === 'scratch' ? join(paths.root, 'scratch') : join(paths.root, 'scratch', name)
    if (name === 'scratch') rmSync(link, { recursive: true })
    symlinkSync(outside, link)
    assert.throws(() => prepareControlRoots({ repositoryRoot: paths.root }), /must be real directories/)
    assert.deepEqual(readdirSync(outside), ['sentinel.txt'])
    assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), 'preserve this synthetic file')
  }
})
