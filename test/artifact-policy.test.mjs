import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { checkTrackedArtifacts, prohibitedTrackedPaths } from '../scripts/check-artifacts.mjs'

test('tracked path policy distinguishes retained synthetic source from private outputs', () => {
  const bad = ['public/atlas.json', 'scratch/raw.json', 'datasets/real.json', 'runs/response.json',
    '.cache/response.json', 'clones/repo/source.js', 'src/.env.local', '.aws/credentials', 'private.key']
  const good = ['test/fixtures/synthetic.json', 'scripts/verification/fixtures.mjs', 'docs/DEVELOPMENT.md',
    'gallery/catalog.json', 'publication/manifest.json', 'publication/assets/approved-example.json']
  assert.deepEqual(prohibitedTrackedPaths([...bad, ...good]), bad)
})

test('tracked audit rejects a force-added output without reading its contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-policy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  mkdirSync(join(root, 'public'))
  writeFileSync(join(root, 'public', 'response.json'), 'synthetic sentinel\n')
  execFileSync('git', ['-C', root, 'add', 'public/response.json'])
  assert.throws(() => checkTrackedArtifacts(root), /Private output or credential paths remain tracked/)
})
