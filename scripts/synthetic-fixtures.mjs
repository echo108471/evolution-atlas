#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { syntheticAtlas, syntheticCandidateMap, syntheticGallery, syntheticPeriods } from './verification/fixtures.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_FIXTURE_ROOT = join(REPOSITORY_ROOT, 'scratch', 'synthetic-fixtures')
const MANIFEST_FILE = 'fixture-manifest.json'
const SOURCE_REVISIONS = {
  firstSha: '6c6d5169a24fcf0cf6ece0a13922f0abfa1c256b',
  headSha: '2fcdaac559467e56b224b3686fe0927f51c9bb2c',
}
const LIMITS = [
  'All identities, source code, dates, and candidate labels are fictitious and authored for development.',
  'Viewer snapshots reuse the browser verification fixtures; their illustrative SHA values do not identify the separate synthetic source repository.',
  'observed-atlas.json is extracted from the generated local Git history and contains only raw observations.',
  'Fixture validation checks deterministic bytes and evidence mechanics, not semantic accuracy, model quality, contributor performance, or real-repository acceptance.',
]
const SOURCE_FILES = {
  'source-repository/src/catalog.ts': "const catalog = new Map([['example', 'Synthetic entry']])\n\nexport function lookup(key: string) {\n  return catalog.get(key)\n}\n",
  'source-repository/test/catalog.test.ts': "// Fictitious source evidence for a local Git extraction fixture.\n// This file is not a project test or a claim of independent verification.\nexport const expectedEntry = 'Synthetic entry'\n",
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** No caller credentials, Git author defaults, global config, hooks, or signing. */
export function fixtureEnvironment() {
  const trustedPreload = join(REPOSITORY_ROOT, 'scripts', 'verification', 'offline-preload.cjs')
  return {
    PATH: process.env.PATH ?? '',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_TERMINAL_PROMPT: '0',
    ...(existsSync(trustedPreload) ? { NODE_OPTIONS: `--require=${JSON.stringify(trustedPreload)}` } : {}),
  }
}

function git(repository, args, extraEnvironment = {}) {
  return execFileSync('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', 'core.filemode=false', '-c', 'core.fsmonitor=false',
    '-C', repository, ...args,
  ], { encoding: 'utf8', env: { ...fixtureEnvironment(), ...extraEnvironment }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function fixtureDocuments() {
  const dataset = syntheticAtlas()
  return {
    'atlas.json': serialize(dataset),
    'epochs.json': serialize(syntheticPeriods(dataset)),
    'gallery/manifest.json': serialize(syntheticGallery(dataset)),
    'gallery/synthetic-atlas.json': serialize(dataset),
    'maps/output.json': serialize(syntheticCandidateMap()),
    'LIMITATIONS.txt': `${LIMITS.join('\n\n')}\n`,
    ...SOURCE_FILES,
  }
}

function ensureSafeDestination(destination) {
  const resolved = resolve(destination)
  const projectRelative = relative(REPOSITORY_ROOT, resolved)
  const insideProject = projectRelative === '' || (!isAbsolute(projectRelative) && projectRelative !== '..' && !projectRelative.startsWith(`..${sep}`))
  if (insideProject && !projectRelative.startsWith(`scratch${sep}`)) {
    throw new Error('Fixture output must stay outside tracked/public/build source paths; use scratch/.')
  }
  // Refuse symlink parents as well as a symlink destination. Never overwrite user files.
  let ancestor = resolved
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  if (realpathSync(ancestor) !== ancestor) throw new Error('Fixture output must not traverse a symlink.')
  if (existsSync(resolved) && (!lstatSync(resolved).isDirectory() || readdirSync(resolved).length)) {
    throw new Error('Fixture output must be a new or empty directory; existing files are preserved.')
  }
  return resolved
}

export function generateSyntheticFixtures(destination = DEFAULT_FIXTURE_ROOT) {
  const root = ensureSafeDestination(destination)
  mkdirSync(root, { recursive: true })
  const files = fixtureDocuments()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content, { flag: 'wx' })
  }
  const sourceRepository = join(root, 'source-repository')
  git(sourceRepository, ['init', '--object-format=sha1', '--initial-branch=main'])
  const identity = {
    GIT_AUTHOR_NAME: 'Ada Example', GIT_AUTHOR_EMAIL: 'ada@example.invalid',
    GIT_COMMITTER_NAME: 'Ada Example', GIT_COMMITTER_EMAIL: 'ada@example.invalid',
  }
  git(sourceRepository, ['add', 'src/catalog.ts'])
  git(sourceRepository, ['commit', '-m', 'Add synthetic catalog'], {
    ...identity, GIT_AUTHOR_DATE: '2025-01-02T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-02T12:00:00Z',
  })
  const firstSha = git(sourceRepository, ['rev-parse', 'HEAD'])
  git(sourceRepository, ['add', 'test/catalog.test.ts'])
  git(sourceRepository, ['commit', '-m', 'Add synthetic catalog check'], {
    ...identity, GIT_AUTHOR_DATE: '2025-02-03T12:00:00Z', GIT_COMMITTER_DATE: '2025-02-03T12:00:00Z',
  })
  const headSha = git(sourceRepository, ['rev-parse', 'HEAD'])
  if (firstSha !== SOURCE_REVISIONS.firstSha || headSha !== SOURCE_REVISIONS.headSha) {
    throw new Error('Synthetic Git identities are not deterministic under the current tooling.')
  }
  // Run extraction in a child with the same sanitized environment, including Git reads.
  const observed = execFileSync(process.execPath, [join(REPOSITORY_ROOT, 'scripts', 'analyze.mjs'), '--repo', sourceRepository], {
    encoding: 'utf8', env: fixtureEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  files['observed-atlas.json'] = observed
  writeFileSync(join(root, 'observed-atlas.json'), observed, { flag: 'wx' })
  const manifest = {
    schemaVersion: 'synthetic-fixtures/1',
    source: 'scripts/verification/fixtures.mjs',
    synthetic: true,
    limitations: LIMITS,
    sourceRepository: { path: 'source-repository', ref: 'main', firstSha, headSha, commitCount: 2 },
    files: Object.keys(files).sort().map((path) => ({ path, bytes: Buffer.byteLength(files[path]), sha256: digest(files[path]) })),
  }
  writeFileSync(join(root, MANIFEST_FILE), serialize(manifest), { flag: 'wx' })
  return { ok: true, root, manifest, manifestSha256: digest(serialize(manifest)) }
}

function inventory(root, prefix = '') {
  const paths = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (path === 'source-repository/.git') {
      if (!entry.isDirectory()) throw new Error('Synthetic Git metadata must be a local directory.')
      continue
    }
    if (entry.isDirectory()) paths.push(...inventory(root, path))
    else if (entry.isFile()) paths.push(path)
    else throw new Error(`Fixture must not contain a symlink or special file: ${path}`)
  }
  return paths.sort()
}

function assertNoSymlinks(path) {
  for (let current = resolve(path);; current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) throw new Error('Fixture validation must not traverse a symlink.')
    if (dirname(current) === current) break
  }
}

function readFixtureFile(root, path) {
  const absolute = join(root, path)
  assertNoSymlinks(absolute)
  if (!lstatSync(absolute).isFile()) throw new Error(`Fixture must be a regular file: ${path}`)
  // Refuse a changed final symlink and avoid blocking if replaced with a FIFO.
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`Fixture must be a regular file: ${path}`)
    if (stat.size > 1024 * 1024) throw new Error(`Fixture file exceeds the development fixture limit: ${path}`)
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function validateSyntheticFixtures(destination = DEFAULT_FIXTURE_ROOT) {
  const root = resolve(destination)
  assertNoSymlinks(root)
  if (!lstatSync(root).isDirectory()) throw new Error('Fixture root must be a directory.')
  if (realpathSync(root) !== root) throw new Error('Fixture validation must not traverse a symlink.')
  const expectedDocuments = fixtureDocuments()
  const expectedPaths = [...Object.keys(expectedDocuments), 'observed-atlas.json'].sort()
  // Establish types and the complete non-Git inventory before reading any content.
  if (serialize(inventory(root)) !== serialize([...expectedPaths, MANIFEST_FILE].sort())) {
    throw new Error('Fixture inventory does not match the expected relative paths.')
  }
  const manifestBytes = readFixtureFile(root, MANIFEST_FILE)
  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new Error('Malformed synthetic fixture manifest JSON.')
  }
  if (manifest.schemaVersion !== 'synthetic-fixtures/1' || manifest.synthetic !== true
    || manifest.source !== 'scripts/verification/fixtures.mjs' || serialize(manifest.limitations) !== serialize(LIMITS)
    || !Array.isArray(manifest.files)) throw new Error('Unrecognized synthetic fixture manifest.')
  if (serialize(manifest.files.map(({ path }) => path)) !== serialize(expectedPaths)) {
    throw new Error('Fixture inventory does not match the expected relative paths.')
  }
  for (const { path, bytes, sha256 } of manifest.files) {
    if (isAbsolute(path) || path.split('/').includes('..')) throw new Error('Unsafe fixture manifest path.')
    const content = readFixtureFile(root, path)
    if (content.length !== bytes || digest(content) !== sha256) throw new Error(`Fixture hash mismatch: ${path}`)
    if (path in expectedDocuments && content.toString('utf8') !== expectedDocuments[path]) {
      throw new Error(`Fixture differs from its synthetic source: ${path}`)
    }
  }
  const repository = join(root, 'source-repository')
  const revisions = git(repository, ['log', '--reverse', '--format=%H']).split('\n')
  if (manifest.sourceRepository?.path !== 'source-repository' || manifest.sourceRepository.ref !== 'main'
    || manifest.sourceRepository.commitCount !== 2 || revisions.length !== 2
    || manifest.sourceRepository.firstSha !== SOURCE_REVISIONS.firstSha || manifest.sourceRepository.headSha !== SOURCE_REVISIONS.headSha
    || revisions[0] !== manifest.sourceRepository.firstSha || revisions[1] !== manifest.sourceRepository.headSha
    || git(repository, ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main'
    || git(repository, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new Error('Synthetic source history or working tree does not match its manifest.')
  }
  const observed = execFileSync(process.execPath, [join(REPOSITORY_ROOT, 'scripts', 'analyze.mjs'), '--repo', repository], {
    encoding: 'utf8', env: fixtureEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (readFixtureFile(root, 'observed-atlas.json').toString('utf8') !== observed) {
    throw new Error('Observed atlas no longer matches synthetic Git extraction.')
  }
  const dataset = JSON.parse(observed)
  if (dataset.analysis.mode !== 'observed-only' || dataset.episodes.length !== 2 || dataset.featureCandidates.length !== 0) {
    throw new Error('Synthetic extraction does not preserve the observation boundary.')
  }
  return { ok: true, root, files: manifest.files.length, firstSha: revisions[0], headSha: revisions[1], manifestSha256: digest(serialize(manifest)), limitations: LIMITS }
}

export function parseFixtureArguments(argv) {
  const [command, ...args] = argv
  if (command === '--help' || command === 'help') return { help: true }
  if (command !== 'generate' && command !== 'validate') throw new Error('Choose generate or validate; use --help for usage.')
  let destination = DEFAULT_FIXTURE_ROOT
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--out' || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${args[index]}`)
    destination = resolve(args[++index])
  }
  return { command, destination }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseFixtureArguments(process.argv.slice(2))
    const result = options.help
      ? { usage: 'node scripts/synthetic-fixtures.mjs <generate|validate> [--out PATH]\nDefault: scratch/synthetic-fixtures; generation refuses nonempty destinations. No remote fetch or model call.' }
      : options.command === 'generate' ? generateSyntheticFixtures(options.destination) : validateSyntheticFixtures(options.destination)
    process.stdout.write(serialize(result))
  } catch (error) {
    process.stderr.write(serialize({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
