import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

const privacyPlugin = viteConfig.plugins
  .flat(Infinity)
  .find((plugin) => plugin?.name === 'evolution-atlas:exclude-local-datasets')

assert.ok(privacyPlugin?.closeBundle, 'Vite config exposes the gallery privacy plugin')

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-vite-privacy-'))
  const previousCwd = process.cwd()
  process.chdir(root)
  t.after(() => {
    process.chdir(previousCwd)
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function write(root, relativePath, content = 'synthetic fixture\n') {
  const path = join(root, relativePath)
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}

function initializeGit(root) {
  execFileSync('git', ['init', '-q', root], { env: gitEnv, stdio: 'ignore' })
}

function invokePrivacyPlugin(logs = []) {
  privacyPlugin.closeBundle.call({ info: (message) => logs.push(message) })
}

function makeGalleryGitFixture(root) {
  initializeGit(root)
  write(root, 'public/gallery/manifest.json', '{"runs":[]}\n')
  write(root, 'public/.gitignore', [
    '/graph-reviews/consolidated-engine/larger-demonstration/local-only.json',
    '/graph-reviews/unapproved-run/',
    '',
  ].join('\n'))
  write(root, 'public/graph-reviews/consolidated-engine/larger-demonstration/index.html', 'published demo\n')
  write(root, 'public/graph-reviews/experiment-summary/index.html', 'published summary\n')
  write(root, 'public/graph-reviews/consolidated-engine/larger-demonstration/local-only.json', 'private nested data\n')
  write(root, 'public/graph-reviews/unapproved-run/index.html', 'unapproved synthetic run\n')

  execFileSync('git', ['-C', root, 'add', 'public'], { env: gitEnv, stdio: 'ignore' })
  for (const ignoredPath of [
    'public/graph-reviews/consolidated-engine/larger-demonstration/local-only.json',
    'public/graph-reviews/unapproved-run/index.html',
  ]) {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', ignoredPath], {
      env: gitEnv,
      stdio: 'ignore',
    })
  }

  write(root, 'dist/gallery/manifest.json', '{"runs":[]}\n')
  write(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/index.html', 'published demo\n')
  write(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/local-only.json', 'private nested data\n')
  write(root, 'dist/graph-reviews/experiment-summary/index.html', 'published summary\n')
  write(root, 'dist/graph-reviews/unapproved-run/index.html', 'unapproved synthetic run\n')
  write(root, 'dist/atlas.synthetic-private.json', '{"private":true}\n')
}

test('gallery closeBundle keeps tracked published files and removes ignored local output', (t) => {
  const root = createRoot(t)
  makeGalleryGitFixture(root)
  const logs = []

  invokePrivacyPlugin(logs)

  assert.equal(
    readFileSync(join(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/index.html'), 'utf8'),
    'published demo\n',
  )
  assert.equal(
    readFileSync(join(root, 'dist/graph-reviews/experiment-summary/index.html'), 'utf8'),
    'published summary\n',
  )
  assert.equal(
    existsSync(join(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/local-only.json')),
    false,
  )
  assert.equal(existsSync(join(root, 'dist/graph-reviews/unapproved-run')), false)
  assert.equal(existsSync(join(root, 'dist/atlas.synthetic-private.json')), false)
  assert.deepEqual(readdirSync(join(root, 'dist/graph-reviews')), [
    'consolidated-engine',
    'experiment-summary',
  ])
  assert.ok(logs.includes('gallery build: excluded 1 local dataset(s)'))
  assert.ok(logs.every((message) => !message.includes('atlas.synthetic-private.json')))
})

test('gallery closeBundle rejects a tracked source symlink before trusting its copied output', (t) => {
  const root = createRoot(t)
  initializeGit(root)
  write(root, 'public/gallery/manifest.json', '{"runs":[]}\n')
  write(root, 'public/graph-reviews/consolidated-engine/larger-demonstration/index.html')
  write(root, 'public/secret-outside-gallery.html', 'private symlink target\n')
  const symlinkPath = join(root, 'public/graph-reviews/experiment-summary/index.html')
  mkdirSync(resolve(symlinkPath, '..'), { recursive: true })
  symlinkSync(join(root, 'public/secret-outside-gallery.html'), symlinkPath)
  execFileSync('git', ['-C', root, 'add', 'public/gallery/manifest.json', 'public/graph-reviews'], {
    env: gitEnv,
    stdio: 'ignore',
  })

  write(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/index.html')
  write(root, 'dist/graph-reviews/experiment-summary/index.html', 'dereferenced private content\n')

  assert.throws(invokePrivacyPlugin, /could not determine tracked graph-review assets/)
  assert.equal(existsSync(join(root, 'dist/graph-reviews')), false)
})

test('personal build without a gallery manifest retains local graph and dataset output', (t) => {
  const root = createRoot(t)
  write(root, 'dist/index.html', 'personal viewer\n')
  write(root, 'dist/graph-reviews/local-run/output.json', '{"local":true}\n')
  write(root, 'dist/atlas.personal.json', '{"personal":true}\n')

  invokePrivacyPlugin()

  assert.equal(readFileSync(join(root, 'dist/index.html'), 'utf8'), 'personal viewer\n')
  assert.equal(
    readFileSync(join(root, 'dist/graph-reviews/local-run/output.json'), 'utf8'),
    '{"local":true}\n',
  )
  assert.equal(readFileSync(join(root, 'dist/atlas.personal.json'), 'utf8'), '{"personal":true}\n')
})

test('gallery build without Git fails closed and removes copied local output', (t) => {
  const root = createRoot(t)
  write(root, 'public/gallery/manifest.json', '{"runs":[]}\n')
  write(root, 'dist/graph-reviews/consolidated-engine/larger-demonstration/index.html')
  write(root, 'dist/graph-reviews/unapproved-run/index.html')
  write(root, 'dist/atlas.no-git.json', '{"private":true}\n')

  assert.throws(invokePrivacyPlugin, /could not determine tracked graph-review assets/)
  assert.equal(existsSync(join(root, 'dist/graph-reviews')), false)
  assert.equal(existsSync(join(root, 'dist/atlas.no-git.json')), false)
})
