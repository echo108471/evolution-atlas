#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildAtlas } from './lib/atlas.mjs'
import {
  createClient,
  detectProvider,
  interpretAtlas,
  interpretationMethod,
  resolveProvider,
} from './lib/interpret.mjs'
import { DEFAULT_RETRIES, isPaymentError, withRetry } from './lib/retry.mjs'

const DEFAULT_CATALOG = 'gallery/catalog.json'
const DEFAULT_OUT = 'public/gallery'
const DEFAULT_CACHE = '.gallery-cache'
const GIT_MAX_BUFFER = 64 * 1024 * 1024

function usage() {
  return `Usage: npm run gallery -- [options]

Builds one atlas per catalog subject and writes a manifest describing the set.
Repositories are fetched into a local cache; only public repositories belong in
a catalog, because generated datasets are published.

Options:
  --catalog <path>   Catalog to read (default: ${DEFAULT_CATALOG})
  --out <dir>        Directory for datasets and manifest (default: ${DEFAULT_OUT})
  --cache <dir>      Directory for repository clones (default: ${DEFAULT_CACHE})
  --only <slug>      Build one subject; repeatable
  --skip-interpret   Produce observed datasets only; no model credential needed
  --reuse-interpretation <path>
                     Promote an already-interpreted dataset instead of calling a
                     model. Requires a single subject, and the dataset must match
                     that subject's name and head commit. No credential needed.
  --provider <name>  Interpretation provider (default: auto-detected)
  --model <id>       Override the provider's default model
  --retries <n>      Attempts per interpretation before giving up (default: ${DEFAULT_RETRIES})
  --force            Rebuild subjects whose head commit is unchanged
  --compact          Emit compact JSON
  --help             Show this help

A whole gallery should be interpreted by one provider and model. Candidates
produced by different models are not comparable across subjects, so the
manifest records which route produced each dataset.
`
}

function parseArguments(argv) {
  const options = {
    catalogPath: DEFAULT_CATALOG,
    outputDir: DEFAULT_OUT,
    cacheDir: DEFAULT_CACHE,
    only: [],
    skipInterpret: false,
    provider: null,
    model: null,
    force: false,
    pretty: true,
    retries: DEFAULT_RETRIES,
    reuseInterpretation: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--skip-interpret') {
      options.skipInterpret = true
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
        const parsed = Number.parseInt(value, 10)
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
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** `llm-induction:openrouter:x-ai/grok-4.6` -> provider and model, model may contain colons. */
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
function loadReusedInterpretation(path, subject, headSha) {
  const reused = JSON.parse(readFileSync(path, 'utf8'))
  if (reused.analysis?.mode !== 'interpreted') {
    throw new Error(`${path} is not an interpreted dataset`)
  }
  if (reused.repository?.headSha !== headSha) {
    throw new Error(
      `${path} describes ${reused.repository?.headSha?.slice(0, 8)} but ${subject.slug} is at ${headSha.slice(0, 8)}`,
    )
  }
  return reused
}

function readCatalog(catalogPath) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const subjects = catalog.subjects ?? []
  if (subjects.length === 0) throw new Error(`No subjects in ${catalogPath}`)

  const seen = new Set()
  for (const subject of subjects) {
    if (!subject.slug || !subject.url) {
      throw new Error(`Catalog entries need a slug and a url: ${JSON.stringify(subject)}`)
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(subject.slug)) {
      throw new Error(`Slug must be lowercase kebab-case: ${subject.slug}`)
    }
    if (seen.has(subject.slug)) throw new Error(`Duplicate slug: ${subject.slug}`)
    seen.add(subject.slug)
  }

  return subjects
}

/** Clones a subject on first use and fast-forwards it afterwards. */
function syncRepository(subject, cacheDir) {
  const target = resolve(cacheDir, subject.slug)
  if (!existsSync(target)) {
    mkdirSync(cacheDir, { recursive: true })
    process.stderr.write(`  cloning ${subject.url}\n`)
    git(['clone', '--filter=blob:none', '--quiet', subject.url, target])
  } else {
    process.stderr.write('  fetching updates\n')
    git(['fetch', '--quiet', '--filter=blob:none', 'origin'], target)
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], target).trim()
    git(['reset', '--hard', '--quiet', `origin/${branch}`], target)
  }
  return target
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return { version: 1, subjects: [] }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { version: 1, subjects: [] }
  }
}

async function buildSubject(subject, options, context) {
  process.stderr.write(`${subject.slug}\n`)
  const repositoryPath = syncRepository(subject, options.cacheDir)
  const headSha = git(['rev-parse', 'HEAD'], repositoryPath).trim()

  const datasetPath = resolve(options.outputDir, `${subject.slug}.json`)
  const previous = context.previousBySlug.get(subject.slug)
  if (
    !options.force &&
    !options.reuseInterpretation &&
    previous?.headSha === headSha &&
    previous?.interpreted === !options.skipInterpret &&
    existsSync(datasetPath)
  ) {
    process.stderr.write('  unchanged; skipping\n')
    return previous
  }

  process.stderr.write('  analyzing\n')
  let dataset = buildAtlas(repositoryPath)

  let interpretation = null
  if (options.reuseInterpretation) {
    process.stderr.write(`  reusing interpretation from ${options.reuseInterpretation}\n`)
    dataset = loadReusedInterpretation(options.reuseInterpretation, subject, headSha)
    const { provider, model } = splitInterpretationMethod(dataset.featureCandidates?.[0]?.method)
    interpretation = {
      provider,
      model,
      method: dataset.featureCandidates?.[0]?.method ?? null,
      featureCandidateCount: dataset.featureCandidates?.length ?? 0,
      semanticEpisodeCount: dataset.semanticEpisodes?.length ?? 0,
      reusedFrom: options.reuseInterpretation,
    }
  } else if (!options.skipInterpret) {
    const provider = options.provider ?? detectProvider()
    const resolved = resolveProvider(provider, options.model)
    process.stderr.write(`  interpreting with ${provider} (${resolved.model})\n`)
    const result = await withRetry(
      () =>
        interpretAtlas(dataset, {
          client: createClient(Anthropic, provider),
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
  writeFileSync(datasetPath, `${JSON.stringify(dataset, null, options.pretty ? 2 : 0)}\n`, 'utf8')

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
    interpreted: !options.skipInterpret,
    interpretation,
    bytes: statSync(datasetPath).size,
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
  if (options.reuseInterpretation && subjects.length !== 1) {
    throw new Error('--reuse-interpretation applies to one subject; narrow it with --only')
  }
  if (options.reuseInterpretation && options.skipInterpret) {
    throw new Error('--reuse-interpretation and --skip-interpret are mutually exclusive')
  }

  const manifestPath = resolve(options.outputDir, 'manifest.json')
  const previousManifest = readManifest(manifestPath)
  const context = {
    previousBySlug: new Map((previousManifest.subjects ?? []).map((entry) => [entry.slug, entry])),
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
