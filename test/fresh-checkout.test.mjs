import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFreshCheckoutEvidenceDirectory, parseFreshCheckoutArguments } from '../scripts/fresh-checkout.mjs'

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
  const root = mkdtempSync(join(tmpdir(), 'atlas-fresh-evidence-'))
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
