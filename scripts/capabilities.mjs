#!/usr/bin/env node

/**
 * Group per-commit readings into capabilities, two ways, and compare them.
 *
 * The deterministic arm sees only observed Git facts. The model arm sees only the
 * capability names the readings proposed. Neither sees the other. The comparison is the
 * point: until a baseline exists, nobody can say what interpretation contributes over a
 * simple script.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  clusterByAssignment,
  clusterObserved,
  clusteringShape,
  pairwiseAgreement,
} from './lib/capability-cluster.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, consolidateCapabilities } from './lib/capability-consolidate.mjs'

function usage() {
  return `Usage: npm run capabilities -- [options]

Groups per-commit readings into capabilities and compares two independent methods.

Options:
  --readings <path>   Readings JSON from \`npm run analyze-commits\` (required)
  --atlas <path>      Atlas JSON the readings were produced from (required)
  --out <path>        Write the capabilities document here (default: stdout)
  --model <id>        Consolidation model (default: ${DEFAULT_MODEL})
  --threshold <n>     Baseline similarity floor, 0-1 (default: 0.35)
  --neighbours <n>    Baseline mutual-kNN size (default: 3)
  --baseline-only     Skip the model arm; make no requests
  --compact           Emit compact JSON
  --help              Show this help

Requires ${API_KEY_ENV} unless --baseline-only.
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, atlasPath: null, outputPath: null, model: DEFAULT_MODEL,
    threshold: 0.35, neighbours: 3, baselineOnly: false, pretty: true,
  }
  const strings = { '--readings': 'readingsPath', '--atlas': 'atlasPath', '--out': 'outputPath', '--model': 'model' }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--baseline-only') { options.baselineOnly = true; continue }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    if (argument === '--threshold') {
      options.threshold = Number.parseFloat(argv[++index])
      if (!(options.threshold >= 0 && options.threshold <= 1)) throw new Error('--threshold must be between 0 and 1')
      continue
    }
    if (argument === '--neighbours') {
      options.neighbours = Number.parseInt(argv[++index], 10)
      if (!Number.isInteger(options.neighbours) || options.neighbours < 1) throw new Error('--neighbours must be a positive integer')
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  if (!options.readingsPath || !options.atlasPath) throw new Error('--readings and --atlas are both required')
  return options
}

/** A capability is only useful if it can be traced back to commits. */
function describeCluster(members, readings, name) {
  const dates = members.map((index) => readings[index].authoredAt).sort()
  const kinds = {}
  for (const index of members) {
    const kind = readings[index].tier1.kind
    kinds[kind] = (kinds[kind] ?? 0) + 1
  }
  return {
    name,
    commitCount: members.length,
    firstAuthoredAt: dates[0] ?? null,
    lastAuthoredAt: dates.at(-1) ?? null,
    kinds,
    interpretationStatus: 'candidate',
    evidence: members.map((index) => ({
      commitSha: readings[index].commitSha,
      shortSha: readings[index].shortSha,
      authoredAt: readings[index].authoredAt,
      subject: readings[index].subject,
      reading: readings[index].tier1.summary,
    })),
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const apiKey = process.env[API_KEY_ENV]
  if (!apiKey && !options.baselineOnly) throw new Error(`${API_KEY_ENV} is not set`)

  const readingsDocument = JSON.parse(readFileSync(resolve(options.readingsPath), 'utf8'))
  const atlas = JSON.parse(readFileSync(resolve(options.atlasPath), 'utf8'))
  const readings = readingsDocument.readings
  const report = (line) => process.stderr.write(`${line}\n`)

  const bySha = new Map(atlas.episodes.map((episode) => [episode.commitSha, episode]))
  const episodes = readings.map((reading) => bySha.get(reading.commitSha))
  if (episodes.some((episode) => !episode)) throw new Error('a reading cites a commit absent from the atlas')

  report(`${readingsDocument.repository}: ${readings.length} readings`)

  // --- deterministic arm ---
  const baselineClusters = clusterObserved(episodes, {
    threshold: options.threshold,
    neighbours: options.neighbours,
  })
  const baselineShape = clusteringShape(baselineClusters, readings.length)
  report(`\nbaseline  paths and subject words only, mutual-kNN k=${options.neighbours} floor=${options.threshold}`)
  report(`          ${baselineShape.clusters} clusters, largest ${baselineShape.largest}, ${baselineShape.singletons} singletons, ${(baselineShape.groupedShare * 100).toFixed(0)}% grouped`)

  const names = readings.map((reading) => reading.tier1.capability ?? reading.subject)
  const distinct = new Set(names.map((name) => name.toLowerCase().trim())).size
  report(`\nnames     ${distinct} distinct across ${names.length} readings`)

  let modelClusters = null
  let consolidation = null

  if (!options.baselineOnly) {
    report(`\nmodel     consolidating with ${options.model}`)
    consolidation = await consolidateCapabilities(names, {
      model: options.model,
      apiKey,
      onProgress: ({ round, order, total, groups }) =>
        report(`          round ${round}, batch ${order + 1}/${total}: ${groups} groups`),
    })
    const assignment = new Map()
    for (const group of consolidation.groups) {
      for (const index of group.members) assignment.set(index, group.name)
    }
    modelClusters = clusterByAssignment(readings.length, assignment).map((entry) => entry.members)
    const modelShape = clusteringShape(modelClusters, readings.length)
    report(`          ${modelShape.clusters} capabilities, largest ${modelShape.largest}, ${modelShape.singletons} singletons, ${(modelShape.groupedShare * 100).toFixed(0)}% grouped`)
    if (consolidation.dropped > 0) report(`          ${consolidation.dropped} names dropped by the model and kept as singletons`)
    report(`          $${consolidation.usage.cost.toFixed(4)}`)
  }

  const agreement = modelClusters
    ? pairwiseAgreement(baselineClusters, modelClusters, readings.length)
    : null
  if (agreement) {
    report(`\nagreement over commit pairs, neither treated as truth`)
    report(`          together in both      ${agreement.pairsTogetherInBoth}`)
    report(`          baseline only         ${agreement.pairsOnlyInFirst}`)
    report(`          model only            ${agreement.pairsOnlyInSecond}`)
    report(`          F1 ${agreement.f1.toFixed(3)}  (precision ${agreement.precision.toFixed(3)}, recall ${agreement.recall.toFixed(3)})`)
  }

  const namesByGroup = new Map((consolidation?.groups ?? []).map((group) => [group.members.join(','), group.name]))
  const document = {
    schemaVersion: '0.1.0',
    repository: readingsDocument.repository,
    headSha: readingsDocument.headSha,
    readingCount: readings.length,
    method: {
      baseline: `observed-mutual-knn/k=${options.neighbours}/floor=${options.threshold}`,
      model: options.baselineOnly ? null : `capability-consolidation/${options.model}`,
    },
    baseline: {
      shape: baselineShape,
      capabilities: baselineClusters.map((members) =>
        describeCluster(members, readings, null),
      ),
    },
    model: modelClusters
      ? {
          shape: clusteringShape(modelClusters, readings.length),
          droppedNames: consolidation.dropped,
          rounds: consolidation.rounds,
          usage: consolidation.usage,
          capabilities: modelClusters.map((members) =>
            describeCluster(members, readings, namesByGroup.get(members.join(',')) ?? names[members[0]]),
          ),
        }
      : null,
    agreement,
  }

  const serialized = `${JSON.stringify(document, null, options.pretty ? 2 : 0)}\n`
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, serialized, 'utf8')
    report(`\nwrote ${outputPath}`)
  } else {
    process.stdout.write(serialized)
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`Capability grouping failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
