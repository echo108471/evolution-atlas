#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { buildAtlas } from './lib/atlas.mjs'
import {
  createClient,
  detectProvider,
  interpretAtlas,
  interpretationMethod,
  resolveProvider,
} from './lib/interpret.mjs'
import { isPaymentError, withRetry } from './lib/retry.mjs'
import { requireSynchronousModel } from './lib/openai-provider.mjs'
import { requireNewOutput, requirePaidPermission, requirePinnedCommit, requireSeparateOutput } from './lib/experiment-permissions.mjs'

const DEFAULT_CATALOG = 'gallery/catalog.json'
const DEFAULT_OUT = 'scratch/gallery'
const DEFAULT_CACHE = 'scratch/repositories/gallery'
const DEFAULT_ATTEMPTS = 1
const GIT_MAX_BUFFER = 64 * 1024 * 1024

function usage() {
  return `Usage: npm run gallery -- [options]

Builds one atlas per catalog subject and writes a manifest describing the set.
Every selected catalog subject must carry a full 40-character "commit" SHA.
The default analyzes that revision in an existing local cache without fetching
or model calls. Generated artifacts are private local output; this command does
not approve or publish a snapshot.

Options:
  --catalog <path>   Catalog to read (default: ${DEFAULT_CATALOG})
  --out <dir>        Directory for datasets and manifest (default: ${DEFAULT_OUT})
  --cache <dir>      Directory for repository clones (default: ${DEFAULT_CACHE})
  --only <slug>      Build one subject; repeatable
  --fetch            Explicitly permit repository clone/fetch into the cache
  --interpret        Request candidate interpretation (also needs --allow-paid)
  --allow-paid       Explicitly permit model requests; SDK retries are disabled
  --skip-interpret   Produce observed datasets only (the default)
  --reuse-interpretation <path>
                     Graft an existing interpretation onto a freshly analyzed
                     atlas instead of calling a model. The dataset must describe
                     the same head commit. Lets an analyzer fix reach a published
                     subject without paying for interpretation again.
                     Use a fresh --out directory; the saved input stays unchanged.
  --provider <name>  Interpretation provider (default: auto-detected)
  --model <id>       Override the provider's default model
  --retries <n>      Explicit maximum paid attempts (default: ${DEFAULT_ATTEMPTS})
                     Repeating an interpretation may repay a completed first pass
  --force            Rebuild unchanged observed output; paid/reused output requires
                     a fresh --out directory, preserving earlier artifacts
  --compact          Emit compact JSON
  --help             Show this help

A whole gallery should be interpreted by one provider and model. Candidates
produced by different models are not comparable across subjects, so the
manifest records which route produced each dataset.
Gallery interpretation uses live requests; :batch models fail before acquisition
or interpretation. Pass --model gpt-6-luna, or use interpret for batch runs.
`
}

function parseArguments(argv) {
  const options = {
    catalogPath: DEFAULT_CATALOG,
    outputDir: DEFAULT_OUT,
    cacheDir: DEFAULT_CACHE,
    only: [],
    interpret: false,
    skipInterpret: false,
    fetch: false,
    allowPaid: false,
    provider: null,
    model: null,
    force: false,
    pretty: true,
    retries: DEFAULT_ATTEMPTS,
    reuseInterpretation: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--skip-interpret') {
      options.skipInterpret = true
      continue
    }
    if (argument === '--interpret' || argument === '--fetch' || argument === '--allow-paid') {
      options[argument === '--allow-paid' ? 'allowPaid' : argument.slice(2)] = true
      continue
    }
    if (argument === '--force') {
      options.force = true
      continue
    }
    if (argument === '--compact') {
      options.pretty = false
      continue
    }
    if (
      argument === '--catalog' ||
      argument === '--out' ||
      argument === '--cache' ||
      argument === '--only' ||
      argument === '--provider' ||
      argument === '--model' ||
      argument === '--retries' ||
      argument === '--reuse-interpretation'
    ) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--catalog') options.catalogPath = value
      else if (argument === '--out') options.outputDir = value
      else if (argument === '--cache') options.cacheDir = value
      else if (argument === '--only') options.only.push(value)
      else if (argument === '--provider') options.provider = value
      else if (argument === '--model') options.model = value
      else if (argument === '--reuse-interpretation') options.reuseInterpretation = value
      else {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--retries requires a positive integer')
        }
        options.retries = parsed
      }
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  return options
}

function git(args, cwd = undefined) {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
  })
}

function sourceIdentity(source) {
  if (typeof source !== 'string' || /[\x00-\x1f]/.test(source)) {
    throw new Error('Repository source must be an HTTPS URL or an absolute local path')
  }
  if (isAbsolute(source)) return resolve(source)
  if (/\s/.test(source)) throw new Error('Repository source URL cannot contain whitespace')
  let url
  try { url = new URL(source) } catch {
    throw new Error('Repository source must be an HTTPS URL or an absolute local path')
  }
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:') {
    throw new Error('Repository source must use HTTPS without credentials, query parameters or fragments')
  }
  return `${url.origin}${url.pathname.replace(/\/?(?:\.git)?\/?$/, '')}`
}

/** `llm-induction:openai:gpt-6-luna:batch` -> provider and model, model may contain colons. */
function splitInterpretationMethod(method) {
  const parts = String(method ?? '').split(':')
  if (parts.length < 3) return { provider: null, model: null }
  return { provider: parts[1], model: parts.slice(2).join(':') }
}

/**
 * Promotes a dataset interpreted by an earlier run. Provenance only stays meaningful if
 * the reused dataset describes the same repository at the same commit, so mismatches are
 * refused rather than recorded.
 */
/**
 * Relationship kinds an interpretation produces; the rest are observed from Git. An
 * observed-only dataset carries `authored` and `touched` and nothing else, which is what
 * makes this list checkable rather than a guess.
 */
const INTERPRETED_RELATIONSHIP_KINDS = new Set([
  'supports-feature',
  'supports-lifecycle',
  'evolves-feature',
  'affects-area',
])

/**
 * Grafts a previously paid-for interpretation onto a freshly analyzed observed layer.
 *
 * Replacing the fresh dataset outright would be simpler, but it would also freeze the
 * observed layer at whatever the analyzer produced on the day the model ran — so a fix to
 * identity matching, code areas, or rename handling could never reach a published subject
 * without paying for interpretation again. Both layers describe the same commit, which the
 * head check below enforces, so the interpretation is portable across analyzer versions.
 *
 * Every cited commit is re-checked against the fresh atlas rather than trusted. The head
 * check makes a miss unlikely, but "every claim resolves to a real commit" is the property
 * the whole evidence model rests on, and it is cheap to verify.
 */
function loadReusedInterpretation(path, reused, subject, headSha, dataset) {
  if (reused.analysis?.mode !== 'interpreted') {
    throw new Error(`${path} is not an interpreted dataset`)
  }
  if (reused.repository?.headSha !== headSha) {
    throw new Error(
      `${path} describes ${reused.repository?.headSha?.slice(0, 8)} but ${subject.slug} is at ${headSha.slice(0, 8)}`,
    )
  }
  if (reused.repository?.name !== subject.slug ||
      (reused.repository.sourceUrl && sourceIdentity(reused.repository.sourceUrl) !== sourceIdentity(subject.url))) {
    throw new Error(`${path} does not describe the catalog repository ${subject.slug}`)
  }
  for (const key of ['episodes', 'contributors', 'codeAreas', 'relationships', 'featureCandidates', 'semanticEpisodes']) {
    if (reused[key] !== undefined && !Array.isArray(reused[key])) {
      throw new Error(`${path} has an invalid ${key} array`)
    }
  }
  if (!Array.isArray(reused.episodes) || !Array.isArray(reused.contributors) || !Array.isArray(reused.codeAreas)) {
    throw new Error(`${path} needs its saved observed layer to verify interpretation provenance`)
  }

  const knownShas = new Set(dataset.episodes.map((episode) => episode.commitSha))
  const interpretedRelationships = (reused.relationships ?? []).filter((relationship) =>
    INTERPRETED_RELATIONSHIP_KINDS.has(relationship.kind),
  )
  const claims = [...(reused.featureCandidates ?? []), ...(reused.semanticEpisodes ?? []), ...interpretedRelationships]
  const unresolved = claims.flatMap((claim) =>
    (claim.evidence ?? [])
      .map((entry) => entry.commitSha)
      .filter((sha) => !knownShas.has(sha)),
  )
  if (unresolved.length > 0) {
    throw new Error(
      `${path} cites ${unresolved.length} commit(s) absent from the re-analyzed history, ` +
        `starting with ${unresolved[0].slice(0, 8)}`,
    )
  }

  const observedRelationships = dataset.relationships.filter(
    (relationship) => !INTERPRETED_RELATIONSHIP_KINDS.has(relationship.kind),
  )

  const grafted = {
    ...dataset,
    analysis: { ...dataset.analysis, mode: 'interpreted' },
    featureCandidates: reused.featureCandidates ?? [],
    semanticEpisodes: reused.semanticEpisodes ?? [],
    relationships: [...observedRelationships, ...interpretedRelationships],
  }

  // Interpretation-derived relationships point at code areas and episodes the previous
  // analyzer produced. A change to how either is identified would leave them dangling, and
  // a dangling edge is worse than a missing one because the viewer renders it as evidence.
  const knownIds = new Set([
    ...grafted.episodes.map((episode) => episode.id),
    ...grafted.contributors.map((contributor) => contributor.id),
    ...grafted.codeAreas.map((area) => area.id),
    ...grafted.featureCandidates.map((feature) => feature.id),
    ...grafted.semanticEpisodes.map((episode) => episode.id),
  ])
  const dangling = grafted.relationships.filter(
    (relationship) => !knownIds.has(relationship.sourceId) || !knownIds.has(relationship.targetId),
  )
  if (dangling.length > 0) {
    throw new Error(
      `${path} produced ${dangling.length} relationship(s) that do not resolve against the ` +
        `re-analyzed atlas, starting with ${dangling[0].kind} ${dangling[0].sourceId} -> ${dangling[0].targetId}. ` +
        'Re-run interpretation instead of reusing it.',
    )
  }

  return grafted
}

function readCatalog(catalogPath) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const subjects = catalog.subjects ?? []
  if (subjects.length === 0) throw new Error(`No subjects in ${catalogPath}`)

  const seen = new Set()
  for (const subject of subjects) {
    if (!subject.slug || !subject.url) {
      throw new Error('Catalog entries need a slug and a url')
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(subject.slug) || subject.slug === 'manifest') {
      throw new Error(`Slug must be lowercase kebab-case and cannot be manifest: ${subject.slug}`)
    }
    if (seen.has(subject.slug)) throw new Error(`Duplicate slug: ${subject.slug}`)
    seen.add(subject.slug)
  }

  return subjects
}

/**
 * Acquisition is explicit and does not reset or check out a user's cached repository.
 * Full clones avoid turning later local analysis into an implicit lazy network fetch.
 */
function syncRepository(subject, cacheDir, fetch) {
  const target = resolve(cacheDir, subject.slug)
  if (!existsSync(target)) {
    if (!fetch) throw new Error(`${subject.slug} is not cached; acquire it explicitly with --fetch`)
    mkdirSync(cacheDir, { recursive: true })
    process.stderr.write(`  cloning ${subject.url}\n`)
    git(['clone', '--quiet', '--', subject.url, target])
  } else if (fetch) {
    process.stderr.write('  fetching updates\n')
    const unshallow = git(['rev-parse', '--is-shallow-repository'], target).trim() === 'true' ? ['--unshallow'] : []
    git(['fetch', '--quiet', '--refetch', '--no-filter', ...unshallow, 'origin'], target)
  }
  return target
}

function assertLocalPinnedHistory(subject, target) {
  if (git(['rev-parse', '--is-shallow-repository'], target).trim() === 'true') {
    throw new Error(`${subject.slug} cache is shallow; acquire full history explicitly with --fetch before analysis`)
  }
  let type
  try { type = git(['cat-file', '-t', subject.commit], target).trim() } catch {
    throw new Error(`${subject.slug} pinned commit is not available locally; acquire it explicitly with --fetch`)
  }
  if (type !== 'commit') throw new Error(`${subject.slug} pin must name a commit object directly`)
  const objects = git(['rev-list', '--objects', '--missing=print', subject.commit], target)
  if (/^\?/m.test(objects)) {
    throw new Error(`${subject.slug} pinned history has missing Git objects; acquire them explicitly with --fetch`)
  }
}

/** Validate the entire selected plan before any acquisition, output, or paid request. */
function preflight(subjects, options) {
  if (options.interpret && (options.skipInterpret || options.reuseInterpretation)) {
    throw new Error('--interpret cannot be combined with --skip-interpret or --reuse-interpretation')
  }
  if (options.reuseInterpretation && (subjects.length !== 1 || options.skipInterpret)) {
    throw new Error('--reuse-interpretation requires one selected subject and cannot use --skip-interpret')
  }
  if (!options.interpret && (options.allowPaid || options.provider || options.model || options.retries !== DEFAULT_ATTEMPTS)) {
    throw new Error('--allow-paid, --provider, --model and --retries require --interpret')
  }
  if (options.interpret) requirePaidPermission(options.allowPaid, 'Gallery interpretation')
  requireSeparateOutput(resolve(options.outputDir, 'manifest.json'), [options.catalogPath, options.reuseInterpretation])
  const previousManifest = readManifest(resolve(options.outputDir, 'manifest.json'))
  const previousBySlug = new Map(previousManifest.subjects.map((entry) => [entry.slug, entry]))

  let reused = null
  if (options.reuseInterpretation) {
    const raw = readFileSync(options.reuseInterpretation)
    reused = { dataset: JSON.parse(raw.toString('utf8')), sha256: createHash('sha256').update(raw).digest('hex') }
  }
  for (const subject of subjects) {
    requirePinnedCommit(subject.commit, `Catalog subject ${subject.slug}`)
    const identity = sourceIdentity(subject.url)
    if (reused) {
      if (reused.dataset.analysis?.mode !== 'interpreted') throw new Error('Saved dataset is not interpreted')
      if (reused.dataset.repository?.headSha !== subject.commit) throw new Error('Saved interpretation head SHA does not match the catalog pin')
      if (reused.dataset.repository?.name !== subject.slug ||
          (reused.dataset.repository.sourceUrl && sourceIdentity(reused.dataset.repository.sourceUrl) !== identity)) {
        throw new Error('Saved interpretation repository does not match the catalog subject')
      }
      loadReusedInterpretation(options.reuseInterpretation, reused.dataset, subject, subject.commit, reused.dataset)
    }
    const datasetPath = resolve(options.outputDir, `${subject.slug}.json`)
    requireSeparateOutput(datasetPath, [options.catalogPath, options.reuseInterpretation])
    if (options.reuseInterpretation) requireNewOutput(datasetPath)
    else if (existsSync(datasetPath)) {
      const file = lstatSync(datasetPath)
      if (!file.isFile() || file.nlink > 1) throw new Error(`${subject.slug} output must be an unshared regular file; choose a fresh --out directory`)
      const raw = readFileSync(datasetPath)
      const existing = JSON.parse(raw.toString('utf8'))
      subject.existingOutputHash = createHash('sha256').update(raw).digest('hex')
      if (options.interpret) {
        const previous = previousBySlug.get(subject.slug)
        const unchanged = !options.force && previous?.headSha === subject.commit && previous?.interpreted === true &&
          previous?.sha256 === subject.existingOutputHash && existing.analysis?.mode === 'interpreted' &&
          existing.repository?.headSha === subject.commit && existing.repository?.name === subject.slug
        if (!unchanged) requireNewOutput(datasetPath)
      } else if (existing.analysis?.mode === 'interpreted') {
        throw new Error(`${subject.slug} output already contains interpretation; choose a new --out directory and reuse the saved input`)
      } else if (existing.analysis?.mode !== 'observed-only' || existing.repository?.name !== subject.slug ||
                 (existing.featureCandidates?.length ?? 0) > 0 || (existing.semanticEpisodes?.length ?? 0) > 0 ||
                 existing.relationships?.some((entry) => INTERPRETED_RELATIONSHIP_KINDS.has(entry.kind))) {
        throw new Error(`${subject.slug} output is not an unambiguous observed-only artifact; choose a fresh --out directory`)
      }
    } else {
      requireNewOutput(datasetPath)
    }
    const target = resolve(options.cacheDir, subject.slug)
    if (!existsSync(target)) {
      if (!options.fetch) throw new Error(`${subject.slug} is not cached; acquire it explicitly with --fetch`)
      continue
    }
    if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== git(['rev-parse', '--show-toplevel'], target).trim()) {
      throw new Error(`${subject.slug} cache must be its own repository directory`)
    }
    if (sourceIdentity(git(['remote', 'get-url', 'origin'], target).trim()) !== identity) {
      throw new Error(`${subject.slug} cached origin does not match the catalog source`)
    }
    if (git(['status', '--porcelain'], target).trim()) {
      throw new Error(`${subject.slug} cache has local changes; preserve them before running the gallery`)
    }
    if (options.fetch) {
      // If the object is already present, --fetch cannot excuse a blob or tag pin.
      let type = null
      try { type = git(['cat-file', '-t', subject.commit], target).trim() } catch { /* Explicit acquisition may supply a missing commit. */ }
      if (type && type !== 'commit') throw new Error(`${subject.slug} pin must name a commit object directly`)
    } else {
      assertLocalPinnedHistory(subject, target)
      // Analyze read-only here so missing objects or invalid reused references cannot
      // cause a partial multi-subject output or a later paid request.
      subject.preparedDataset = buildAtlas(target, { ref: subject.commit })
      if (reused) subject.preparedDataset = loadReusedInterpretation(options.reuseInterpretation, reused.dataset, subject, subject.commit, subject.preparedDataset)
    }
  }
  let provider = null
  let resolved = null
  let client = null
  if (options.interpret) {
    provider = options.provider ?? detectProvider()
    resolved = resolveProvider(provider, options.model)
    client = createClient(Anthropic, provider, process.env, { maxRetries: 0 })
    requireSynchronousModel(resolved.model)
  }
  return { reused, provider, resolved, client, previousManifest }
}

function prepareSubjects(subjects, options, context) {
  for (const subject of subjects) {
    if (subject.preparedDataset) continue
    const target = syncRepository(subject, options.cacheDir, options.fetch)
    assertLocalPinnedHistory(subject, target)
    if (sourceIdentity(git(['remote', 'get-url', 'origin'], target).trim()) !== sourceIdentity(subject.url)) {
      throw new Error(`${subject.slug} acquired origin does not match the catalog source`)
    }
    subject.preparedDataset = buildAtlas(target, { ref: subject.commit })
    if (context.reused) {
      subject.preparedDataset = loadReusedInterpretation(options.reuseInterpretation, context.reused.dataset, subject, subject.commit, subject.preparedDataset)
    }
  }
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    requireNewOutput(manifestPath)
    return { version: 1, subjects: [] }
  }
  const file = lstatSync(manifestPath)
  if (!file.isFile() || file.nlink > 1) throw new Error('Existing gallery manifest must be an unshared regular file; choose a fresh --out directory')
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.subjects)) throw new Error('Invalid manifest')
    return parsed
  } catch {
    throw new Error('Existing gallery manifest is invalid; choose a fresh --out directory to preserve its artifacts')
  }
}

async function buildSubject(subject, options, context) {
  process.stderr.write(`${subject.slug}\n`)
  const headSha = subject.preparedDataset.repository.headSha

  const datasetPath = resolve(options.outputDir, `${subject.slug}.json`)
  const previous = context.previousBySlug.get(subject.slug)
  if (
    !options.force &&
    !options.reuseInterpretation &&
    previous?.headSha === headSha &&
    previous?.interpreted === options.interpret &&
    previous?.sha256 === subject.existingOutputHash &&
    existsSync(datasetPath)
  ) {
    process.stderr.write('  unchanged; skipping\n')
    return previous
  }

  process.stderr.write('  analyzing\n')
  let dataset = subject.preparedDataset
  dataset = { ...dataset, repository: { ...dataset.repository, sourceUrl: subject.url } }

  let interpretation = null
  if (options.reuseInterpretation) {
    process.stderr.write(`  reusing interpretation from ${options.reuseInterpretation}\n`)
    const { provider, model } = splitInterpretationMethod(dataset.featureCandidates?.[0]?.method)
    interpretation = {
      provider,
      model,
      method: dataset.featureCandidates?.[0]?.method ?? null,
      featureCandidateCount: dataset.featureCandidates?.length ?? 0,
      semanticEpisodeCount: dataset.semanticEpisodes?.length ?? 0,
      reusedFrom: options.reuseInterpretation,
      reusedSha256: context.reused.sha256,
    }
  } else if (options.interpret) {
    const { provider, resolved, client } = context
    process.stderr.write(`  interpreting with ${provider} (${resolved.model})\n`)
    const result = await withRetry(
      () =>
        interpretAtlas(dataset, {
          client,
          provider,
          model: options.model,
          onProgress: (message) => process.stderr.write(`    ${message}\n`),
        }),
      {
        attempts: options.retries,
        onNotice: (notice) => process.stderr.write(`    ${notice}\n`),
      },
    )
    dataset = result.dataset
    interpretation = {
      provider,
      model: resolved.model,
      method: interpretationMethod(provider, resolved.model),
      featureCandidateCount: dataset.featureCandidates?.length ?? 0,
      semanticEpisodeCount: dataset.semanticEpisodes?.length ?? 0,
    }
  }

  mkdirSync(options.outputDir, { recursive: true })
  // Periods are optional and generated separately (`npm run epochs -- --out
  // <out>/<slug>-epochs.json`). Only a document actually present beside the dataset is
  // advertised; the viewer requests nothing for a subject without one.
  const periodsFile = `${subject.slug}-epochs.json`
  const periods = existsSync(resolve(options.outputDir, periodsFile)) ? `/gallery/${periodsFile}` : undefined
  const serialized = `${JSON.stringify(dataset, null, options.pretty ? 2 : 0)}\n`
  writeFileSync(datasetPath, serialized, { encoding: 'utf8', flag: options.interpret || options.reuseInterpretation ? 'wx' : 'w' })

  return {
    slug: subject.slug,
    title: subject.title ?? subject.slug,
    description: subject.description ?? null,
    why: subject.why ?? null,
    url: subject.url,
    license: subject.license ?? null,
    dataset: `${subject.slug}.json`,
    headSha,
    ref: dataset.repository.ref ?? null,
    commitCount: dataset.repository.commitCount,
    contributorCount: dataset.contributors?.length ?? 0,
    codeAreaCount: dataset.codeAreas?.length ?? 0,
    structuralEpisodeCount: dataset.structuralEpisodes?.length ?? 0,
    firstAuthoredAt: dataset.timeRange?.firstAuthoredAt ?? null,
    lastAuthoredAt: dataset.timeRange?.lastAuthoredAt ?? null,
    interpreted: dataset.analysis.mode === 'interpreted',
    interpretation,
    ...(periods ? { periods } : {}),
    bytes: statSync(datasetPath).size,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    generatedAt: new Date().toISOString(),
  }
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  const subjects = readCatalog(options.catalogPath).filter(
    (subject) => options.only.length === 0 || options.only.includes(subject.slug),
  )
  if (subjects.length === 0) throw new Error(`No catalog subject matched --only`)
  // buildAtlas uses its own Git subprocesses. Prevent a partial clone from silently
  // acquiring missing history objects during an otherwise offline invocation.
  process.env.GIT_NO_LAZY_FETCH = '1'
  process.env.GIT_NO_REPLACE_OBJECTS = '1'
  process.env.GIT_TERMINAL_PROMPT = '0'
  const prepared = preflight(subjects, options)
  // Acquisition and source validation finish for the whole selection before the
  // first paid request or output file; a later bad pin cannot spend on an earlier one.
  prepareSubjects(subjects, options, prepared)

  const manifestPath = resolve(options.outputDir, 'manifest.json')
  const previousManifest = prepared.previousManifest
  const context = {
    ...prepared,
    previousBySlug: new Map((previousManifest.subjects ?? []).map((entry) => [entry.slug, entry])),
  }
  if (options.retries > DEFAULT_ATTEMPTS) {
    process.stderr.write(`Explicitly permitted up to ${options.retries} paid attempts per subject; a retry may repeat completed discovery.\n`)
  }

  const entries = []
  const failures = []
  for (const subject of subjects) {
    try {
      entries.push(await buildSubject(subject, options, context))
    } catch (error) {
      // One unreachable or unanalyzable subject should not discard the rest.
      failures.push({ slug: subject.slug, message: error.message })
      process.stderr.write(`  failed: ${error.message}\n`)
      if (isPaymentError(error)) {
        process.stderr.write(
          '  This is a billing failure, not a transient one. Check the provider balance\n' +
            '  before rerunning; each attempt re-pays for feature discovery.\n',
        )
      }
    }
  }

  // Subjects excluded by --only keep their previous manifest entries.
  const bySlug = new Map((previousManifest.subjects ?? []).map((entry) => [entry.slug, entry]))
  for (const entry of entries) bySlug.set(entry.slug, entry)
  const catalogOrder = readCatalog(options.catalogPath).map((subject) => subject.slug)
  const merged = catalogOrder.map((slug) => bySlug.get(slug)).filter(Boolean)

  if (entries.length === 0 && failures.length > 0) {
    throw new Error('No subjects completed; existing output and manifest were preserved')
  }

  mkdirSync(options.outputDir, { recursive: true })
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), subjects: merged }, null, 2)}\n`,
    'utf8',
  )

  process.stderr.write(`\nWrote ${merged.length} subject(s) to ${manifestPath}\n`)
  if (failures.length > 0) {
    process.stderr.write(`${failures.length} subject(s) failed: ${failures.map((f) => f.slug).join(', ')}\n`)
    process.exit(1)
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
