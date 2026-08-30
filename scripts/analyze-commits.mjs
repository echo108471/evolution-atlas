#!/usr/bin/env node

/**
 * Per-commit analysis: read every substantive commit, not a sample of them.
 *
 * Runs three tiers. Tier 0 is deterministic and free; tier 1 reads what survives with a
 * small model; tier 2 re-reads whatever tier 1 asked to have re-read. Readings are
 * cached by commit SHA, so a second run over a repository that gained ten commits pays
 * for ten requests rather than all of them - the property whole-corpus interpretation
 * structurally cannot have.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { triage } from './lib/triage.mjs'
import { buildContextIndex, situate, renderContext } from './lib/commit-context.mjs'
import { readCommitDiff, DEFAULT_MAX_LINES } from './lib/commit-diff.mjs'
import {
  API_KEY_ENV,
  DEFAULT_TIER1_MODEL,
  DEFAULT_TIER2_MODEL,
  buildTier1Request,
  buildTier2Request,
  compareReadings,
  mapWithConcurrency,
  requestReading,
} from './lib/commit-analysis.mjs'
import { withRetry } from './lib/retry.mjs'

const TIER2_MAX_LINES = 1200

function usage() {
  return `Usage: npm run analyze-commits -- [options]

Reads every substantive commit individually and reports what each accomplishes.

Options:
  --in <path>            Atlas JSON from \`npm run analyze\` (required)
  --repo <path>          Repository the atlas was built from (default: current directory)
  --out <path>           Write readings JSON here (default: stdout)
  --cache <path>         SHA-keyed reading cache (default: <out>.cache.jsonl)
  --tier1-model <id>     Volume tier (default: ${DEFAULT_TIER1_MODEL})
  --tier2-model <id>     Depth tier (default: ${DEFAULT_TIER2_MODEL})
  --concurrency <n>      Requests in flight (default: 8)
  --max-lines <n>        Tier 1 diff budget (default: ${DEFAULT_MAX_LINES})
  --tier2-max-lines <n>  Tier 2 diff budget (default: ${TIER2_MAX_LINES})
  --sample <n>           Analyze n commits spread evenly across history
  --all-commits          Analyze every commit rather than the first-parent chain.
                         Double-counts anything merged, since a merge now carries the
                         same changes as the branch commits behind it.
  --no-tier2             Stop after tier 1
  --dry-run              Report triage and the planned request count; make no requests
  --compact              Emit compact JSON
  --help                 Show this help

Requires ${API_KEY_ENV} unless --dry-run.
`
}

function parseArguments(argv) {
  const options = {
    atlasPath: null,
    repositoryPath: '.',
    outputPath: null,
    cachePath: null,
    tier1Model: DEFAULT_TIER1_MODEL,
    tier2Model: DEFAULT_TIER2_MODEL,
    concurrency: 8,
    maxLines: DEFAULT_MAX_LINES,
    tier2MaxLines: TIER2_MAX_LINES,
    sample: null,
    firstParent: true,
    tier2: true,
    dryRun: false,
    pretty: true,
  }

  const numbers = {
    '--concurrency': 'concurrency',
    '--max-lines': 'maxLines',
    '--tier2-max-lines': 'tier2MaxLines',
    '--sample': 'sample',
  }
  const strings = {
    '--in': 'atlasPath',
    '--repo': 'repositoryPath',
    '--out': 'outputPath',
    '--cache': 'cachePath',
    '--tier1-model': 'tier1Model',
    '--tier2-model': 'tier2Model',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--no-tier2') { options.tier2 = false; continue }
    if (argument === '--all-commits') { options.firstParent = false; continue }
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    if (numbers[argument]) {
      const value = Number.parseInt(argv[++index], 10)
      if (!Number.isInteger(value) || value < 1) throw new Error(`${argument} requires a positive integer`)
      options[numbers[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  if (!options.atlasPath) throw new Error('--in is required')
  return options
}

/** Evenly spaced rather than the first n, so a sample spans the whole history. */
function spread(indices, count) {
  if (count >= indices.length) return indices
  const step = indices.length / count
  return Array.from({ length: count }, (_, order) => indices[Math.floor(order * step)])
}

function loadCache(path) {
  const cache = new Map()
  if (!path || !existsSync(path)) return cache
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      cache.set(record.key, record.reading)
    } catch {
      // A partially written final line is expected after an interrupted run.
    }
  }
  return cache
}

const cacheKey = (sha, tier, model) => `${sha}:${tier}:${model}`

function addUsage(total, usage) {
  if (!usage) return
  total.promptTokens += usage.prompt_tokens ?? 0
  total.completionTokens += usage.completion_tokens ?? 0
  if (typeof usage.cost === 'number') total.cost += usage.cost
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const apiKey = process.env[API_KEY_ENV]
  if (!apiKey && !options.dryRun) throw new Error(`${API_KEY_ENV} is not set`)

  const dataset = JSON.parse(readFileSync(resolve(options.atlasPath), 'utf8'))
  const episodes = dataset.episodes
  const report = (line) => process.stderr.write(`${line}\n`)

  const tier0 = triage(episodes)
  report(`${dataset.repository.name}: ${episodes.length} commits`)
  report(`tier 0  kept ${tier0.substantiveCount}, filtered ${tier0.filteredCount} (${(tier0.filteredShare * 100).toFixed(1)}%)`)
  for (const [className, count] of Object.entries(tier0.counts).sort((left, right) => right[1] - left[1])) {
    report(`          ${className.padEnd(14)} ${count}`)
  }

  // The first-parent chain is the history of the branch itself. Commits off it are states
  // main never had, and in a merge-PR workflow they outnumber it three to one - 2,693
  // commits collapse to 739 units on the pilot. It is also the only correct unit once
  // merges carry their own diff: analyzing a merge and its branch commits together counts
  // every merged change twice.
  const hasChain = episodes.some((episode) => episode.firstParent !== undefined)
  const useChain = options.firstParent && hasChain
  if (options.firstParent && !hasChain) {
    report('note: this atlas predates first-parent marking; analyzing every commit')
  }

  let indices = []
  tier0.results.forEach((result, index) => {
    if (!result.substantive) return
    if (useChain && episodes[index].firstParent !== true) return
    indices.push(index)
  })

  if (useChain) {
    const chainCommits = episodes.filter((episode) => episode.firstParent === true).length
    report(`unit    first-parent chain: ${chainCommits} of ${episodes.length} commits (${((chainCommits / episodes.length) * 100).toFixed(1)}%), ${indices.length} substantive`)
  }
  if (options.sample) indices = spread(indices, options.sample)

  const contextIndex = buildContextIndex(episodes)
  const repositoryPath = resolve(options.repositoryPath)

  if (options.dryRun) {
    report(`\ntier 1  would request ${indices.length} commits with ${options.tier1Model}`)
    report('dry run: no requests made')
    return
  }

  const cachePath = options.cachePath
    ? resolve(options.cachePath)
    : options.outputPath
      ? `${resolve(options.outputPath)}.cache.jsonl`
      : null
  if (cachePath) mkdirSync(dirname(cachePath), { recursive: true })
  const cache = loadCache(cachePath)
  const remember = (key, reading) => {
    cache.set(key, reading)
    if (cachePath) appendFileSync(cachePath, `${JSON.stringify({ key, reading })}\n`, 'utf8')
  }

  const totals = { promptTokens: 0, completionTokens: 0, cost: 0 }
  const failures = []
  let done = 0
  let cached = 0

  const readCommit = async (index, { tier, model, maxLines }) => {
    const episode = episodes[index]
    const key = cacheKey(episode.commitSha, tier, model)
    const hit = cache.get(key)
    if (hit) { cached += 1; return hit }

    const diff = readCommitDiff(repositoryPath, episode.commitSha, { maxLines })
    const contextText = renderContext(situate(dataset, contextIndex, index))
    const body = tier === 1
      ? buildTier1Request({ repositoryName: dataset.repository.name, contextText, subject: episode.subject, diff, model })
      : buildTier2Request({ repositoryName: dataset.repository.name, contextText, subject: episode.subject, diff, model })

    const { reading, usage } = await withRetry(
      () => requestReading(body, { apiKey, tier }),
      { onNotice: (notice) => report(`  ${episode.shortSha}: ${notice}`) },
    )
    addUsage(totals, usage)
    const enriched = { ...reading, diffLines: diff.totalLines, diffTruncated: diff.truncated, model }
    remember(key, enriched)
    return enriched
  }

  report(`\ntier 1  ${indices.length} commits, ${options.tier1Model}, ${options.concurrency} in flight`)
  const startedAt = Date.now()

  const tier1 = await mapWithConcurrency(indices, options.concurrency, async (index) => {
    try {
      const reading = await readCommit(index, { tier: 1, model: options.tier1Model, maxLines: options.maxLines })
      done += 1
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - startedAt) / 1000)
        report(`          ${done}/${indices.length}  ${rate.toFixed(1)}/s  $${totals.cost.toFixed(3)}`)
      }
      return { index, reading }
    } catch (error) {
      failures.push({ index, shortSha: episodes[index].shortSha, tier: 1, message: error.message })
      return { index, reading: null }
    }
  })

  report(`          ${tier1.filter((row) => row.reading).length} read, ${failures.length} failed, ${cached} from cache`)

  const promoted = tier1.filter((row) => row.reading?.needsDepth)
  const promotionCauses = {}
  for (const row of promoted) {
    const cause = row.reading.depthCause ?? 'unclear'
    promotionCauses[cause] = (promotionCauses[cause] ?? 0) + 1
  }
  let tier2 = []

  if (options.tier2 && promoted.length > 0) {
    report(`\ntier 2  ${promoted.length} promoted (${((promoted.length / Math.max(1, tier1.length)) * 100).toFixed(1)}%), ${options.tier2Model}`)
    for (const [cause, count] of Object.entries(promotionCauses).sort((left, right) => right[1] - left[1])) {
      report(`          because ${cause.padEnd(14)} ${count}`)
    }
    tier2 = await mapWithConcurrency(promoted, options.concurrency, async (row) => {
      try {
        const reading = await readCommit(row.index, {
          tier: 2,
          model: options.tier2Model,
          maxLines: options.tier2MaxLines,
        })
        return { index: row.index, reading }
      } catch (error) {
        failures.push({ index: row.index, shortSha: episodes[row.index].shortSha, tier: 2, message: error.message })
        return { index: row.index, reading: null }
      }
    })
    report(`          ${tier2.filter((row) => row.reading).length} read`)
  } else if (options.tier2) {
    report('\ntier 2  nothing promoted')
  }

  const deeper = new Map(tier2.filter((row) => row.reading).map((row) => [row.index, row.reading]))
  const readings = tier1
    .filter((row) => row.reading)
    .map((row) => ({
      commitSha: episodes[row.index].commitSha,
      shortSha: episodes[row.index].shortSha,
      index: row.index,
      authoredAt: episodes[row.index].authoredAt,
      subject: episodes[row.index].subject,
      tier1: row.reading,
      tier2: deeper.get(row.index) ?? null,
      agreement: compareReadings(row.reading, deeper.get(row.index) ?? null),
    }))

  const compared = readings.filter((reading) => reading.agreement)
  const agreement = compared.length === 0 ? null : {
    commits: compared.length,
    meanCapabilityOverlap:
      compared.reduce((sum, reading) => sum + reading.agreement.capabilityOverlap, 0) / compared.length,
    kindAgreementRate: compared.filter((reading) => reading.agreement.kindAgrees).length / compared.length,
    meanSignificanceDelta:
      compared.reduce((sum, reading) => sum + reading.agreement.significanceDelta, 0) / compared.length,
  }

  const elapsed = (Date.now() - startedAt) / 1000
  const document = {
    schemaVersion: '0.1.0',
    repository: dataset.repository.name,
    headSha: dataset.repository.headSha,
    commitCount: episodes.length,
    method: `commit-readings/${useChain ? 'first-parent' : 'all-commits'}/tier1=${options.tier1Model}/tier2=${options.tier2Model}`,
    unit: useChain ? 'first-parent' : 'all-commits',
    triage: { counts: tier0.counts, substantive: tier0.substantiveCount, filtered: tier0.filteredCount },
    coverage: {
      analyzed: readings.length,
      ofSubstantive: tier0.substantiveCount === 0 ? 0 : readings.length / tier0.substantiveCount,
      ofHistory: episodes.length === 0 ? 0 : readings.length / episodes.length,
    },
    promotionCauses,
    agreement,
    run: { seconds: Math.round(elapsed), ...totals, failures: failures.length, cachedReadings: cached },
    failures,
    readings,
  }

  report(`\ncoverage ${readings.length}/${tier0.substantiveCount} substantive, ${(document.coverage.ofHistory * 100).toFixed(1)}% of history`)
  if (agreement) {
    report(`agreement ${agreement.commits} commits read twice, blind: capability overlap ${agreement.meanCapabilityOverlap.toFixed(2)}, same kind ${(agreement.kindAgreementRate * 100).toFixed(0)}%, mean significance gap ${agreement.meanSignificanceDelta.toFixed(2)}`)
  }
  report(`tokens   ${totals.promptTokens} in, ${totals.completionTokens} out`)
  report(`cost     $${totals.cost.toFixed(4)}   elapsed ${Math.round(elapsed)}s`)

  const serialized = `${JSON.stringify(document, null, options.pretty ? 2 : 0)}\n`
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, serialized, 'utf8')
    report(`wrote ${outputPath}`)
  } else {
    process.stdout.write(serialized)
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`Commit analysis failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
