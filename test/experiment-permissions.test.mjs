import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildAtlas } from '../scripts/lib/atlas.mjs'
import { mergeInterpretation, validateFeatures, validateSemanticEpisodes } from '../scripts/lib/interpret.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const SOURCE = 'https://example.test/synthetic/fixture.git'

function git(path, args) {
  return execFileSync(REAL_GIT, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', path, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-experiment-permissions-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cache = join(root, 'cache')
  const repository = join(cache, 'fixture')
  const out = join(root, 'output')
  const bin = join(root, 'bin')
  const gitLog = join(root, 'git-calls.jsonl')
  const paidLog = join(root, 'mock-paid.jsonl')
  mkdirSync(repository, { recursive: true })
  mkdirSync(bin)
  git(repository, ['init', '-b', 'main'])
  git(repository, ['config', 'user.name', 'Synthetic Author'])
  git(repository, ['config', 'user.email', 'fixture@example.test'])
  git(repository, ['remote', 'add', 'origin', SOURCE])
  writeFileSync(join(repository, 'module.js'), 'export const value = 1\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'Introduce synthetic module'])
  const pin = git(repository, ['rev-parse', 'HEAD'])
  writeFileSync(join(repository, 'module.js'), 'export const value = 2\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'Expand synthetic module'])
  const current = git(repository, ['rev-parse', 'HEAD'])
  const catalog = join(root, 'catalog.json')
  const subject = { slug: 'fixture', url: SOURCE, commit: pin }
  const catalogSubjects = (subjects) => writeFileSync(catalog, JSON.stringify({ subjects }))
  catalogSubjects([subject])
  // A fake executable records every CLI Git command. Acquisition is simulated with
  // local files only; all real transport protocols are blocked even if a bug lazily
  // requests missing objects inside another Git command.
  const gitWrapper = join(bin, 'git')
  writeFileSync(gitWrapper, `#!${process.execPath}\n` + `
import { appendFileSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
appendFileSync(process.env.ATLAS_TEST_GIT_LOG, JSON.stringify({args, noLazyFetch: process.env.GIT_NO_LAZY_FETCH}) + '\\n')
if (args.includes('checkout') || args.includes('reset')) process.exit(95)
if (args.includes('clone') || args.includes('fetch')) {
  if (process.env.ATLAS_TEST_ACQUISITION !== 'simulate') process.exit(96)
  if (args.includes('clone')) cpSync(process.env.ATLAS_TEST_SOURCE, args.at(-1), { recursive: true })
  process.exit(0)
}
const result = spawnSync(process.env.ATLAS_TEST_REAL_GIT, ['-c', 'protocol.https.allow=never', '-c', 'protocol.http.allow=never', '-c', 'protocol.ssh.allow=never', ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
`)
  chmodSync(gitWrapper, 0o755)
  // Replace only the provider SDK in these subprocesses; a test never constructs a
  // real provider transport or uses an account credential.
  const mockSdk = join(root, 'mock-sdk.mjs')
  writeFileSync(mockSdk, `
import { appendFileSync } from 'node:fs'
export default class SyntheticProvider {
  constructor(options) {
    appendFileSync(process.env.ATLAS_TEST_PAID_LOG, JSON.stringify({ constructor: true, maxRetries: options.maxRetries }) + '\\n')
    this.messages = { stream: (request) => ({ finalMessage: async () => {
      appendFileSync(process.env.ATLAS_TEST_PAID_LOG, JSON.stringify({ request: true, model: request.model, baseURL: options.baseURL ?? null }) + '\\n')
      if (process.env.ATLAS_TEST_PROVIDER_FAIL) throw Object.assign(new Error('Synthetic transient failure'), {status: 503})
      return { content: [{ type: 'text', text: '{"features":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    } }) }
  }
}
`)
  const loader = join(root, 'mock-loader.mjs')
  writeFileSync(loader, `export async function resolve(specifier, context, next) {
    if (specifier === '@anthropic-ai/sdk') return { url: new URL('./mock-sdk.mjs', import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  }\n`)
  const networkGuard = join(root, 'network-guard.mjs')
  writeFileSync(networkGuard, `import { appendFileSync } from 'node:fs'
    globalThis.fetch = async () => {
      appendFileSync(process.env.ATLAS_TEST_PAID_LOG, '{"forbiddenFetch":true}\\n')
      throw new Error('HTTP is forbidden in synthetic CLI tests')
    }\n`)
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    ATLAS_TEST_REAL_GIT: REAL_GIT, ATLAS_TEST_GIT_LOG: gitLog,
    ATLAS_TEST_PAID_LOG: paidLog, ATLAS_TEST_SOURCE: repository,
  }
  for (const key of Object.keys(env)) {
    if (/API_KEY|AUTH_TOKEN|ACCESS_TOKEN/.test(key)) delete env[key]
  }
  const invoke = (script, args, extraEnv = {}) => spawnSync(process.execPath,
    ['--import', networkGuard, '--experimental-loader', loader, join(ROOT, 'scripts', script), ...args],
    { cwd: root, encoding: 'utf8', timeout: 20000, env: { ...env, ...extraEnv } })
  const runGallery = (args = [], extraEnv = {}) => invoke('gallery.mjs',
    ['--catalog', catalog, '--cache', cache, '--out', out, ...args], extraEnv)
  const events = (path) => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  const assertNoEffects = () => {
    assert.equal(existsSync(out), false)
    assert.equal(existsSync(paidLog), false)
    assert.ok(events(gitLog).every(({ args }) => !args.some((arg) => ['fetch', 'clone', 'checkout', 'reset'].includes(arg))))
  }
  const observed = buildAtlas(repository, { ref: pin })
  const dataset = join(root, 'atlas.json')
  writeFileSync(dataset, JSON.stringify(observed))
  return { root, cache, repository, out, bin, pin, current, catalog, subject, catalogSubjects, gitLog, paidLog, invoke, runGallery, events, assertNoEffects, observed, dataset }
}

test('gallery defaults to offline observed analysis at an exact pin without moving cached HEAD', (t) => {
  const f = setup(t)
  f.catalogSubjects([f.subject, { slug: 'unselected', url: SOURCE }])
  const result = f.runGallery(['--only', 'fixture'])
  assert.equal(result.status, 0, result.stderr)
  const dataset = JSON.parse(readFileSync(join(f.out, 'fixture.json'), 'utf8'))
  assert.equal(dataset.analysis.mode, 'observed-only')
  assert.equal(dataset.repository.headSha, f.pin)
  assert.equal(dataset.repository.ref, f.pin)
  assert.equal(dataset.repository.sourceUrl, SOURCE)
  assert.equal(dataset.episodes.length, 1)
  assert.equal(git(f.repository, ['rev-parse', 'HEAD']), f.current)
  assert.equal(readFileSync(join(f.repository, 'module.js'), 'utf8'), 'export const value = 2\n')
  assert.equal(existsSync(f.paidLog), false)
  assert.ok(f.events(f.gitLog).every(({ args, noLazyFetch }) => noLazyFetch === '1' && !args.some((arg) => ['fetch', 'clone', 'checkout', 'reset'].includes(arg))))
})

test('gallery rejects absent caches, missing pins and invalid flags before any output or acquisition', (t) => {
  const cases = [
    { subject: { slug: 'absent', url: SOURCE, commit: 'a'.repeat(40) }, args: [], message: /not cached.*--fetch/ },
    { subject: { slug: 'fixture', url: SOURCE }, args: ['--fetch'], message: /40-character/ },
    { subject: { slug: 'fixture', url: SOURCE, commit: 'abcdef0' }, args: ['--fetch'], message: /40-character/ },
    { args: ['--interpret', '--fetch'], message: /requires --allow-paid/ },
    { args: ['--allow-paid', '--fetch'], message: /require --interpret/ },
    { args: ['--provider', 'openrouter', '--fetch'], message: /require --interpret/ },
    { args: ['--interpret', '--allow-paid', '--skip-interpret', '--fetch'], message: /cannot be combined/ },
    { args: ['--retries', '2x', '--fetch'], message: /positive integer/ },
    { args: ['--retries', '2', '--fetch'], message: /require --interpret/ },
    { args: ['--interpret', '--allow-paid', '--provider', 'invalid', '--fetch'], message: /Unknown provider/ },
    { args: ['--interpret', '--allow-paid', '--provider', 'openrouter', '--fetch'], message: /requires OPENROUTER_API_KEY/ },
  ]
  for (const entry of cases) {
    const f = setup(t)
    if (entry.subject) f.catalogSubjects([entry.subject])
    const result = f.runGallery(entry.args)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, entry.message)
    f.assertNoEffects()
  }
})

test('gallery validates all selected pins before a requested fetch', (t) => {
  const f = setup(t)
  f.catalogSubjects([f.subject, { slug: 'second', url: SOURCE }])
  const result = f.runGallery(['--fetch', '--interpret', '--allow-paid'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /second.*40-character/)
  f.assertNoEffects()
})

test('gallery rejects locally present blob and tag pins before any requested fetch', (t) => {
  for (const kind of ['blob', 'tag']) {
    const f = setup(t)
    let pin = git(f.repository, ['rev-parse', `${f.pin}:module.js`])
    if (kind === 'tag') {
      git(f.repository, ['-c', 'tag.gpgsign=false', 'tag', '-a', 'synthetic-tag', '-m', 'Synthetic tag', f.pin])
      pin = git(f.repository, ['rev-parse', 'synthetic-tag'])
    }
    f.catalogSubjects([{ ...f.subject, commit: pin }])
    const result = f.runGallery(['--fetch', '--interpret', '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /commit object directly/)
    f.assertNoEffects()
  }
})

test('gallery finishes acquisition and pin validation for all subjects before the first paid request', (t) => {
  const f = setup(t)
  f.catalogSubjects([f.subject, { slug: 'absent', url: SOURCE, commit: 'f'.repeat(40) }])
  const result = f.runGallery(['--fetch', '--interpret', '--allow-paid', '--provider', 'openrouter'], {
    OPENROUTER_API_KEY: 'synthetic', ATLAS_TEST_ACQUISITION: 'simulate',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /pinned commit is not available locally/)
  assert.equal(existsSync(f.out), false)
  assert.equal(f.events(f.paidLog).filter((event) => event.request || event.forbiddenFetch).length, 0)
  assert.ok(f.events(f.gitLog).some(({ args }) => args.includes('clone')))
})

test('gallery ignores Git replacement refs when analyzing an exact original pin', (t) => {
  const f = setup(t)
  const replacement = git(f.repository, ['rev-parse', 'HEAD'])
  git(f.repository, ['replace', f.pin, replacement])
  const result = f.runGallery()
  assert.equal(result.status, 0, result.stderr)
  const dataset = JSON.parse(readFileSync(join(f.out, 'fixture.json'), 'utf8'))
  assert.equal(dataset.repository.headSha, f.pin)
  assert.equal(dataset.episodes.length, 1)
  assert.equal(dataset.episodes[0].subject, 'Introduce synthetic module')
})

test('gallery refuses cache origin mismatches, credential-bearing URLs and local changes before fetch', (t) => {
  for (const reason of ['origin', 'credentials', 'dirty']) {
    const f = setup(t)
    if (reason === 'origin') git(f.repository, ['remote', 'set-url', 'origin', 'https://example.test/other'])
    if (reason === 'credentials') f.catalogSubjects([{ ...f.subject, url: 'https://synthetic:secret@example.test/repo' }])
    if (reason === 'dirty') writeFileSync(join(f.repository, 'module.js'), 'local edits preserved\n')
    const result = f.runGallery(['--fetch'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /origin does not match|without credentials|local changes/)
    assert.doesNotMatch(result.stderr, /synthetic:secret/)
    f.assertNoEffects()
  }
})

test('gallery does not silently acquire a missing pinned commit or history object', (t) => {
  for (const missing of ['commit', 'tree', 'blob']) {
    const f = setup(t)
    if (missing === 'commit') f.catalogSubjects([{ ...f.subject, commit: 'f'.repeat(40) }])
    else {
      const object = git(f.repository, ['rev-parse', missing === 'tree' ? `${f.pin}^{tree}` : `${f.pin}:module.js`])
      rmSync(join(f.repository, '.git', 'objects', object.slice(0, 2), object.slice(2)))
      git(f.repository, ['config', 'extensions.partialClone', 'origin'])
      git(f.repository, ['config', 'remote.origin.promisor', 'true'])
      git(f.repository, ['config', 'remote.origin.partialclonefilter', 'blob:none'])
    }
    const result = f.runGallery()
    assert.equal(result.status, 1)
    assert.match(result.stderr, missing === 'commit' ? /not available locally/ : /missing Git objects|bad tree object|unable to read|could not read/)
    f.assertNoEffects()
    assert.ok(f.events(f.gitLog).every(({ noLazyFetch }) => noLazyFetch === '1'))
  }
})

test('gallery acquisition is permitted only by --fetch and is simulated without remote transport', (t) => {
  const f = setup(t)
  const result = f.runGallery(['--fetch'], { ATLAS_TEST_ACQUISITION: 'simulate' })
  assert.equal(result.status, 0, result.stderr)
  const acquisitions = f.events(f.gitLog).filter(({ args }) => args.includes('fetch'))
  assert.equal(acquisitions.length, 1)
  assert.ok(acquisitions[0].args.includes('--no-filter'))
  assert.equal(git(f.repository, ['rev-parse', 'HEAD']), f.current)
  assert.equal(existsSync(f.paidLog), false)
})

test('gallery rejects shallow cached history rather than labeling a truncated log as a complete pinned atlas', (t) => {
  const f = setup(t)
  writeFileSync(join(f.repository, '.git', 'shallow'), `${f.pin}\n`)
  const result = f.runGallery()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cache is shallow.*--fetch/)
  f.assertNoEffects()
})

function savedInterpretation(f) {
  const method = 'llm-induction:openrouter:synthetic-model'
  const features = validateFeatures([{ label: 'Synthetic module', rationale: 'Authored fixture only.', confidence: 0.5, commitShas: [f.pin] }], f.observed, method)
  const lifecycle = validateSemanticEpisodes([], f.observed, features.featureCandidates, method)
  const dataset = mergeInterpretation(f.observed, features, lifecycle)
  const path = join(f.root, 'saved-interpretation.json')
  const bytes = Buffer.from(JSON.stringify(dataset))
  writeFileSync(path, bytes)
  return { path, bytes, dataset }
}

test('saved gallery interpretation is reused offline with exact bytes recorded and references rechecked', (t) => {
  const f = setup(t)
  const saved = savedInterpretation(f)
  const result = f.runGallery(['--reuse-interpretation', saved.path])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(saved.path), saved.bytes)
  const dataset = JSON.parse(readFileSync(join(f.out, 'fixture.json'), 'utf8'))
  assert.deepEqual(dataset.featureCandidates, saved.dataset.featureCandidates)
  assert.equal(dataset.analysis.mode, 'interpreted')
  const entry = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8')).subjects[0]
  assert.equal(entry.interpretation.reusedSha256, createHash('sha256').update(saved.bytes).digest('hex'))
  assert.equal(entry.interpretation.provider, 'openrouter')
  assert.equal(entry.interpretation.model, 'synthetic-model')
  assert.equal(existsSync(f.paidLog), false)
  assert.ok(f.events(f.gitLog).every(({ args }) => !args.includes('fetch')))
})

test('gallery rejects reused repository, revision, citation or relationship mismatches before writes or fetch', (t) => {
  for (const problem of ['head', 'name', 'url', 'citation', 'edge', 'edge-citation']) {
    const f = setup(t)
    const saved = savedInterpretation(f)
    if (problem === 'head') saved.dataset.repository.headSha = f.current
    if (problem === 'name') saved.dataset.repository.name = 'other'
    if (problem === 'url') saved.dataset.repository.sourceUrl = 'https://example.test/other'
    if (problem === 'citation') saved.dataset.featureCandidates[0].evidence[0].commitSha = 'f'.repeat(40)
    if (problem === 'edge') saved.dataset.relationships.push({ kind: 'supports-feature', sourceId: 'absent', targetId: 'also-absent' })
    if (problem === 'edge-citation') {
      const relationship = saved.dataset.relationships.find((entry) => entry.kind === 'supports-feature')
      relationship.evidence = [{ commitSha: 'f'.repeat(40) }]
    }
    writeFileSync(saved.path, JSON.stringify(saved.dataset))
    const result = f.runGallery(['--fetch', '--reuse-interpretation', saved.path])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /head SHA|repository|cites|do not resolve/)
    f.assertNoEffects()
  }
})

test('gallery refuses to overwrite its saved interpretation through a direct, symlink or hardlink output alias', (t) => {
  for (const alias of ['direct', 'symlink', 'hardlink']) {
    const f = setup(t)
    const saved = savedInterpretation(f)
    mkdirSync(f.out)
    const output = join(f.out, 'fixture.json')
    if (alias === 'direct') {
      writeFileSync(output, saved.bytes)
      saved.path = output
    } else if (alias === 'symlink') symlinkSync(saved.path, output)
    else linkSync(saved.path, output)
    const result = f.runGallery(['--reuse-interpretation', saved.path, '--fetch'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Output must be separate/)
    assert.deepEqual(readFileSync(saved.path), saved.bytes)
    assert.equal(existsSync(join(f.out, 'manifest.json')), false)
    assert.equal(existsSync(f.paidLog), false)
    assert.ok(f.events(f.gitLog).every(({ args }) => !args.includes('fetch')))
  }
})

test('an observed gallery run preserves existing expensive interpreted output', (t) => {
  const f = setup(t)
  const saved = savedInterpretation(f)
  mkdirSync(f.out)
  const output = join(f.out, 'fixture.json')
  writeFileSync(output, saved.bytes)
  for (const args of [[], ['--force']]) {
    const result = f.runGallery(args)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /already contains interpretation/)
  }
  assert.deepEqual(readFileSync(output), saved.bytes)
  assert.equal(existsSync(join(f.out, 'manifest.json')), false)
  assert.equal(existsSync(f.paidLog), false)
})

test('gallery preserves expensive output without a trustworthy unchanged manifest even when paid or forced', (t) => {
  for (const reason of ['missing-manifest', 'stale-manifest', 'forced']) {
    const f = setup(t)
    const saved = savedInterpretation(f)
    mkdirSync(f.out)
    const output = join(f.out, 'fixture.json')
    writeFileSync(output, saved.bytes)
    const hash = createHash('sha256').update(saved.bytes).digest('hex')
    if (reason !== 'missing-manifest') {
      writeFileSync(join(f.out, 'manifest.json'), JSON.stringify({ version: 1, subjects: [
        { slug: 'fixture', headSha: f.pin, interpreted: true, sha256: reason === 'forced' ? hash : '0'.repeat(64) },
      ] }))
    }
    const result = f.runGallery(['--interpret', '--allow-paid', '--provider', 'openrouter', ...(reason === 'forced' ? ['--force'] : [])], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Output already exists/)
    assert.deepEqual(readFileSync(output), saved.bytes)
    assert.equal(existsSync(f.paidLog), false)
  }
})

test('gallery skips verified unchanged paid output by exact manifest hash without another inference', (t) => {
  const f = setup(t)
  const args = ['--interpret', '--allow-paid', '--provider', 'openrouter']
  const first = f.runGallery(args, { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(first.status, 0, first.stderr)
  const before = readFileSync(join(f.out, 'fixture.json'))
  const entry = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8')).subjects[0]
  assert.equal(entry.sha256, createHash('sha256').update(before).digest('hex'))
  const next = f.runGallery(args, { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(next.status, 0, next.stderr)
  assert.match(next.stderr, /unchanged; skipping/)
  assert.deepEqual(readFileSync(join(f.out, 'fixture.json')), before)
  assert.equal(f.events(f.paidLog).filter((event) => event.request).length, 1)
})

test('gallery requires a new destination for saved interpretation and regenerates only unambiguous free output', (t) => {
  const f = setup(t)
  const saved = savedInterpretation(f)
  const first = f.runGallery(['--reuse-interpretation', saved.path])
  assert.equal(first.status, 0, first.stderr)
  const before = readFileSync(join(f.out, 'fixture.json'))
  const next = f.runGallery(['--reuse-interpretation', saved.path, '--force'])
  assert.equal(next.status, 1)
  assert.match(next.stderr, /Output already exists/)
  assert.deepEqual(readFileSync(join(f.out, 'fixture.json')), before)
  assert.deepEqual(readFileSync(saved.path), saved.bytes)
  assert.equal(existsSync(f.paidLog), false)

  const free = setup(t)
  const generated = free.runGallery()
  assert.equal(generated.status, 0, generated.stderr)
  const observed = readFileSync(join(free.out, 'fixture.json'))
  const refreshed = free.runGallery(['--force'])
  assert.equal(refreshed.status, 0, refreshed.stderr)
  assert.deepEqual(readFileSync(join(free.out, 'fixture.json')), observed)
  const ambiguous = JSON.parse(observed.toString('utf8'))
  ambiguous.featureCandidates = [{ label: 'Unqualified saved proposal' }]
  writeFileSync(join(free.out, 'fixture.json'), JSON.stringify(ambiguous))
  const refused = free.runGallery(['--force'])
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /not an unambiguous observed-only artifact/)
})

test('gallery rejects an invalid existing manifest and reserved output slug before acquisition', (t) => {
  const f = setup(t)
  mkdirSync(f.out)
  const manifest = join(f.out, 'manifest.json')
  const bytes = Buffer.from('{"saved-expensive-response":true}')
  writeFileSync(manifest, bytes)
  const result = f.runGallery(['--fetch', '--interpret', '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /manifest is invalid/)
  assert.deepEqual(readFileSync(manifest), bytes)
  assert.equal(existsSync(f.paidLog), false)
  assert.ok(f.events(f.gitLog).every(({ args }) => !args.includes('fetch')))

  const reserved = setup(t)
  reserved.catalogSubjects([{ ...reserved.subject, slug: 'manifest' }])
  const rejected = reserved.runGallery(['--fetch'])
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /cannot be manifest/)
  reserved.assertNoEffects()
})

test('explicit gallery inference uses a mock provider with no SDK or whole-pass retries by default', (t) => {
  const f = setup(t)
  const result = f.runGallery(['--interpret', '--allow-paid', '--provider', 'openrouter'], {
    OPENROUTER_API_KEY: 'synthetic', ATLAS_TEST_PROVIDER_FAIL: '1',
  })
  assert.equal(result.status, 1)
  const events = f.events(f.paidLog)
  assert.deepEqual(events[0], { constructor: true, maxRetries: 0 })
  assert.equal(events.filter((event) => event.request).length, 1)
  assert.equal(existsSync(f.out), false)
  assert.match(result.stderr, /existing output and manifest were preserved/)
})

test('interpret requires paid opt-in, while revalidation runs locally without constructing a client', (t) => {
  const f = setup(t)
  const output = join(f.root, 'interpreted.json')
  const rejected = f.invoke('interpret.mjs', ['--in', f.dataset, '--out', output], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /requires --allow-paid/)
  assert.equal(existsSync(output), false)
  assert.equal(existsSync(f.paidLog), false)
  const saved = savedInterpretation(f)
  saved.dataset.semanticEpisodes = [{ id: 'synthetic-lifecycle', label: 'Synthetic introduction', stage: 'introduce', featureIds: [saved.dataset.featureCandidates[0].id], rationale: 'Synthetic only.', confidence: 0.5, evidence: [{ commitSha: f.pin }] }]
  writeFileSync(saved.path, JSON.stringify(saved.dataset))
  const local = f.invoke('interpret.mjs', ['--in', saved.path, '--out', output, '--revalidate'])
  assert.equal(local.status, 0, local.stderr)
  assert.equal(existsSync(output), true)
  assert.equal(existsSync(f.paidLog), false)
})

test('explicit interpret inference disables SDK retries and uses only the mock provider', (t) => {
  const f = setup(t)
  const output = join(f.root, 'interpreted.json')
  const result = f.invoke('interpret.mjs', ['--in', f.dataset, '--out', output, '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(f.events(f.paidLog)[0], { constructor: true, maxRetries: 0 })
  assert.equal(f.events(f.paidLog).filter((event) => event.request).length, 1)
})

test('interpret CLI keeps credential detection, explicit providers and model overrides', (t) => {
  const f = setup(t)
  const cases = [
    { env: { OPENROUTER_API_KEY: 'synthetic' }, args: [], model: 'openai/gpt-6-luna:batch', baseURL: 'https://openrouter.ai/api' },
    { env: { OPENROUTER_API_KEY: 'synthetic', ANTHROPIC_API_KEY: 'synthetic' }, args: [], model: 'claude-opus-5', baseURL: null },
    { env: { ANTHROPIC_API_KEY: 'synthetic' }, args: [], model: 'claude-opus-5', baseURL: null },
    { env: { OPENROUTER_API_KEY: 'synthetic', ANTHROPIC_API_KEY: 'synthetic' }, args: ['--provider', 'openrouter'], model: 'openai/gpt-6-luna:batch', baseURL: 'https://openrouter.ai/api' },
    { env: { OPENROUTER_API_KEY: 'synthetic' }, args: ['--model', 'synthetic/explicit:batch'], model: 'synthetic/explicit:batch', baseURL: 'https://openrouter.ai/api' },
    { env: { OPENROUTER_API_KEY: 'synthetic' }, args: ['--provider', 'anthropic'], model: 'claude-opus-5', baseURL: null },
  ]
  for (const [index, entry] of cases.entries()) {
    const result = f.invoke('interpret.mjs', ['--in', f.dataset, '--out', join(f.root, `interpret-${index}.json`), '--allow-paid', ...entry.args], entry.env)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(f.events(f.paidLog).at(-1), { request: true, model: entry.model, baseURL: entry.baseURL })
  }
})

test('gallery records the shared OpenRouter default including the batch suffix', (t) => {
  const f = setup(t)
  const result = f.runGallery(['--interpret', '--allow-paid'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
  assert.equal(manifest.subjects[0].interpretation.provider, 'openrouter')
  assert.equal(manifest.subjects[0].interpretation.model, 'openai/gpt-6-luna:batch')
  assert.equal(f.events(f.paidLog).at(-1).model, 'openai/gpt-6-luna:batch')
})

test('interpret chooses an immutable sibling output and preserves its source dataset', (t) => {
  const f = setup(t)
  const before = readFileSync(f.dataset)
  const result = f.invoke('interpret.mjs', ['--in', f.dataset, '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(f.dataset), before)
  assert.equal(existsSync(join(f.root, 'atlas.interpreted.json')), true)
  const replay = f.invoke('interpret.mjs', ['--in', f.dataset, '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
  assert.equal(replay.status, 1)
  assert.match(replay.stderr, /Output already exists/)
  assert.equal(f.events(f.paidLog).filter((event) => event.request).length, 1)
})

test('interpret rejects source aliases and existing output before constructing a paid client', (t) => {
  for (const alias of ['direct', 'symlink', 'hardlink', 'existing', 'broken-symlink']) {
    const f = setup(t)
    const before = readFileSync(f.dataset)
    let output = join(f.root, 'interpreted.json')
    if (alias === 'direct') output = f.dataset
    else if (alias === 'symlink') symlinkSync(f.dataset, output)
    else if (alias === 'hardlink') linkSync(f.dataset, output)
    else if (alias === 'broken-symlink') symlinkSync(join(f.root, 'absent.json'), output)
    else writeFileSync(output, 'keep existing artifact\n')
    const result = f.invoke('interpret.mjs', ['--in', f.dataset, '--out', output, '--allow-paid', '--provider', 'openrouter'], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Output must be separate|Output already exists/)
    assert.deepEqual(readFileSync(f.dataset), before)
    assert.equal(existsSync(f.paidLog), false)
  }
})

test('epochs requires paid permission for either missing proposals or period naming', (t) => {
  const f = setup(t)
  const output = join(f.root, 'epochs.json')
  for (const args of [[], ['--no-labels'], ['--proposals', 'missing.json']]) {
    const result = f.invoke('epochs.mjs', ['--in', f.dataset, '--out', output, ...args], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires --allow-paid/)
    assert.equal(existsSync(output), false)
  }
})

test('epochs CLI records its default or explicit model even when history is too short for a window', (t) => {
  const f = setup(t)
  for (const [index, model] of ['openai/gpt-6-luna:batch', 'synthetic/explicit:batch'].entries()) {
    const output = join(f.root, `epochs-${index}.json`)
    const result = f.invoke('epochs.mjs', ['--in', f.dataset, '--out', output, '--allow-paid', '--no-labels', ...(index ? ['--model', model] : [])], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 0, result.stderr)
    const document = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(document.model.model, model)
    assert.equal(document.model.windowCount, 0)
    assert.equal(document.method, `epoch-boundaries:openrouter:${model}`)
  }
  assert.equal(existsSync(f.paidLog), false)
})

test('epochs replay preserves the saved model and source hash despite current defaults or overrides', (t) => {
  const f = setup(t)
  const proposals = join(f.root, 'proposals.json')
  const bytes = Buffer.from(JSON.stringify({ repository: 'fixture', headSha: f.pin, model: 'synthetic-model', proposals: [] }))
  writeFileSync(proposals, bytes)
  for (const [index, args] of [[], ['--model', 'synthetic/other-model']].entries()) {
    const output = join(f.root, `epochs-${index}.json`)
    const result = f.invoke('epochs.mjs', ['--in', f.dataset, '--out', output, '--proposals', proposals, '--no-labels', ...args])
    assert.equal(result.status, 0, result.stderr)
    const document = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(document.headSha, f.pin)
    assert.equal(document.model.model, 'synthetic-model')
    assert.equal(document.method, 'epoch-boundaries:openrouter:synthetic-model')
    assert.equal(document.model.reusedSha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(document.labels, null)
  }
  assert.deepEqual(readFileSync(proposals), bytes)
  assert.equal(existsSync(f.paidLog), false)
})

test('epochs refuses replay/output aliases and invalid numeric flags before any model request', (t) => {
  for (const alias of ['direct', 'symlink', 'hardlink', 'dataset', 'save-proposals', 'fractional-stride', 'depth-too-large']) {
    const f = setup(t)
    const proposals = join(f.root, 'proposals.json')
    const bytes = Buffer.from(JSON.stringify({ repository: 'fixture', headSha: f.pin, model: 'synthetic-model', proposals: [] }))
    writeFileSync(proposals, bytes)
    let output = join(f.root, 'epochs.json')
    let args = ['--proposals', proposals, '--no-labels']
    if (alias === 'direct') output = proposals
    if (alias === 'symlink') symlinkSync(proposals, output)
    if (alias === 'hardlink') linkSync(proposals, output)
    if (alias === 'dataset') output = f.dataset
    if (alias === 'save-proposals') args = ['--allow-paid', '--save-proposals', f.dataset]
    if (alias === 'fractional-stride') args = ['--allow-paid', '--stride', '0.5']
    if (alias === 'depth-too-large') args = ['--allow-paid', '--depth', '4']
    const result = f.invoke('epochs.mjs', ['--in', f.dataset, '--out', output, ...args], { OPENROUTER_API_KEY: 'synthetic' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Output must be separate|positive integer|integer from 0 to 3/)
    assert.deepEqual(readFileSync(proposals), bytes)
    assert.equal(existsSync(f.paidLog), false)
  }
})

test('epochs rejects missing or mismatched saved head, repository and unresolved proposal positions', (t) => {
  for (const patch of [
    { headSha: undefined }, { headSha: 'abcdef0' }, { headSha: 'f'.repeat(40) }, { repository: 'other' },
    { proposals: [{ index: 10 }] }, { proposals: [{ index: 0, shortSha: 'not-a-commit' }] },
  ]) {
    const f = setup(t)
    const proposals = join(f.root, 'proposals.json')
    writeFileSync(proposals, JSON.stringify({ repository: 'fixture', headSha: f.pin, model: 'synthetic-model', proposals: [], ...patch }))
    const output = join(f.root, 'epochs.json')
    const result = f.invoke('epochs.mjs', ['--in', f.dataset, '--out', output, '--proposals', proposals, '--no-labels'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /40-character|head SHA|describes|does not resolve/)
    assert.equal(existsSync(output), false)
  }
})
