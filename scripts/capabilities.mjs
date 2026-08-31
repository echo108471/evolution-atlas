#!/usr/bin/env node

/**
 * Group per-commit readings into capabilities several ways, and compare them.
 *
 * Three arms share one clustering algorithm and differ only in which evidence they may
 * look at: observed paths and subjects, the readings' own capability names and summaries,
 * or both. A fourth hands the names to a model to group. Holding the algorithm fixed is
 * what makes the first three interpretable - the original two-arm comparison changed the
 * evidence and the method at once, so a difference between them could not be assigned to
 * either.
 *
 * No arm is shown another's output. The comparison is the point: until a baseline exists,
 * nobody can say what interpretation contributes over a simple script.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  COMBINED_CHANNELS,
  OBSERVED_CHANNELS,
  READING_CHANNELS,
  clusterByAssignment,
  clusterFeatures,
  clusteringShape,
  evidenceChannels,
  groupingStability,
  pairwiseAgreement,
} from './lib/capability-cluster.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, consolidateCapabilities } from './lib/capability-consolidate.mjs'
import { evaluateArm } from './lib/capability-naming.mjs'
import { mapWithConcurrency } from './lib/commit-analysis.mjs'

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
  --baseline-only     Skip the model arm; the three deterministic arms still run
  --model-runs <n>    Run consolidation n times and report how stable its grouping is
                      across runs (default: 1). Each run costs the same as the first.
  --evaluate          Name every multi-commit group in every arm with one blind prompt
                      and report how many could not be named
  --evaluate-readings Repeat the naming pass showing the readings, and again showing the
                      paths. No view is neutral - each favours the arms that group on it -
                      so all three are reported and their agreement is the finding.
  --compact           Emit compact JSON
  --help              Show this help

Requires ${API_KEY_ENV} unless --baseline-only.
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, atlasPath: null, outputPath: null, model: DEFAULT_MODEL,
    threshold: 0.35, neighbours: 3, baselineOnly: false, evaluate: false, pretty: true,
    modelRuns: 1, evaluateReadings: false,
  }
  const strings = { '--readings': 'readingsPath', '--atlas': 'atlasPath', '--out': 'outputPath', '--model': 'model' }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--baseline-only') { options.baselineOnly = true; continue }
    if (argument === '--evaluate') { options.evaluate = true; continue }
    if (argument === '--evaluate-readings') { options.evaluate = true; options.evaluateReadings = true; continue }
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
    if (argument === '--model-runs') {
      options.modelRuns = Number.parseInt(argv[++index], 10)
      if (!Number.isInteger(options.modelRuns) || options.modelRuns < 1) throw new Error('--model-runs must be a positive integer')
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
function describeCluster(members, readings, episodes, name) {
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
      ...(episodes[index].body ? { body: episodes[index].body.slice(0, 200) } : {}),
      reading: readings[index].tier1.summary,
      paths: (episodes[index].changes ?? []).slice(0, 4).map((change) => change.path),
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
  if (!apiKey && !(options.baselineOnly && !options.evaluate)) throw new Error(`${API_KEY_ENV} is not set`)

  const readingsDocument = JSON.parse(readFileSync(resolve(options.readingsPath), 'utf8'))
  const atlas = JSON.parse(readFileSync(resolve(options.atlasPath), 'utf8'))
  const readings = readingsDocument.readings
  const report = (line) => process.stderr.write(`${line}\n`)

  const bySha = new Map(atlas.episodes.map((episode) => [episode.commitSha, episode]))
  const episodes = readings.map((reading) => bySha.get(reading.commitSha))
  if (episodes.some((episode) => !episode)) throw new Error('a reading cites a commit absent from the atlas')

  report(`${readingsDocument.repository}: ${readings.length} readings`)

  // --- deterministic arms ---
  //
  // Three of them, differing only in which evidence channels the similarity may look at.
  // The clustering code, the neighbour count and the floor are identical across all three,
  // so any difference between them is attributable to the evidence and to nothing else.
  const shaping = { threshold: options.threshold, neighbours: options.neighbours }
  const channelArms = [
    ['baseline', OBSERVED_CHANNELS, 'paths and subject words'],
    ['reading', READING_CHANNELS, 'capability names and summaries'],
    ['combined', COMBINED_CHANNELS, 'both, mixed evenly'],
  ]

  const features = readings.map((reading, index) => evidenceChannels(episodes[index], reading.tier1))
  const arms = []
  report(`\nevidence  same mutual-kNN, k=${options.neighbours}, floor=${options.threshold}; only the channels differ`)
  for (const [name, weights, description] of channelArms) {
    const clusters = clusterFeatures(features, { ...shaping, weights })
    const shape = clusteringShape(clusters, readings.length)
    arms.push({ name, description, clusters, shape })
    report(
      `          ${name.padEnd(9)} ${String(shape.clusters).padStart(4)} groups  largest ${String(shape.largest).padStart(3)}  ` +
        `${String(shape.singletons).padStart(3)} singletons  ${(shape.groupedShare * 100).toFixed(0).padStart(3)}% grouped  (${description})`,
    )
  }

  const names = readings.map((reading) => reading.tier1.capability ?? reading.subject)
  const distinct = new Set(names.map((name) => name.toLowerCase().trim())).size
  report(`\nnames     ${distinct} distinct across ${names.length} readings`)

  let consolidation = null
  let stability = null

  if (!options.baselineOnly) {
    // Runs are sequential and independent. The first is the arm that gets reported and
    // named; the rest exist only to measure how much of it survives being asked again.
    // Averaging them into a consensus would invent a method nobody proposed, and would
    // hide exactly the instability the repeat is there to expose.
    const runs = []
    for (let run = 1; run <= options.modelRuns; run += 1) {
      report(`\nmodel     consolidating with ${options.model}${options.modelRuns > 1 ? `, run ${run} of ${options.modelRuns}` : ''}`)
      const result = await consolidateCapabilities(names, {
        model: options.model,
        apiKey,
        onProgress: ({ round, order, total, groups, notice }) =>
          report(
            notice
              ? `          round ${round}, batch ${order + 1}/${total}: ${notice}`
              : `          round ${round}, batch ${order + 1}/${total}: ${groups} groups`,
          ),
      })
      const assignment = new Map()
      for (const group of result.groups) {
        for (const index of group.members) assignment.set(index, group.name)
      }
      const clusters = clusterByAssignment(readings.length, assignment).map((entry) => entry.members)
      const shape = clusteringShape(clusters, readings.length)
      runs.push({ result, clusters, shape })
      report(`          ${shape.clusters} capabilities, largest ${shape.largest}, ${shape.singletons} singletons, ${(shape.groupedShare * 100).toFixed(0)}% grouped`)
      if (result.dropped > 0) report(`          ${result.dropped} names dropped by the model and kept as singletons`)
      report(`          $${result.usage.cost.toFixed(4)}`)
    }

    consolidation = runs[0].result
    arms.push({
      name: 'model',
      description: 'capability names, grouped by a model',
      clusters: runs[0].clusters,
      shape: runs[0].shape,
    })

    if (runs.length > 1) {
      stability = groupingStability(runs.map((run) => run.clusters))
      const betweenRuns = []
      for (let left = 0; left < runs.length; left += 1) {
        for (let right = left + 1; right < runs.length; right += 1) {
          betweenRuns.push(pairwiseAgreement(runs[left].clusters, runs[right].clusters, readings.length).f1)
        }
      }
      stability.betweenRunF1 = betweenRuns
      stability.shapes = runs.map((run) => run.shape)
      stability.cost = runs.reduce((sum, run) => sum + run.result.usage.cost, 0)
      report(`\nstability ${stability.runs} runs of the same prompt over the same names`)
      report(`          ${stability.alwaysPaired} of ${stability.everPaired} pairs grouped by any run were grouped by all (${(stability.alwaysShare * 100).toFixed(0)}%)`)
      report(`          pairs by how many runs grouped them: ${stability.pairsByRunCount.slice(1).map((count, order) => `${order + 1}x ${count}`).join('  ')}`)
      report(`          F1 between runs: ${betweenRuns.map((value) => value.toFixed(3)).join(', ')}`)
      report(`          group counts: ${stability.shapes.map((shape) => shape.clusters).join(', ')}; largest: ${stability.shapes.map((shape) => shape.largest).join(', ')}`)
    }
  }

  // Every pair, with neither arm treated as truth. Reporting only against the baseline
  // would hide the most informative comparison: whether the two arms that both read
  // interpretation agree with each other more than either agrees with the paths.
  const agreements = []
  for (let left = 0; left < arms.length; left += 1) {
    for (let right = left + 1; right < arms.length; right += 1) {
      agreements.push({
        arms: [arms[left].name, arms[right].name],
        ...pairwiseAgreement(arms[left].clusters, arms[right].clusters, readings.length),
      })
    }
  }
  report('\nagreement over commit pairs, neither arm treated as truth')
  for (const entry of agreements) {
    report(
      `          ${`${entry.arms[0]} vs ${entry.arms[1]}`.padEnd(24)} F1 ${entry.f1.toFixed(3)}` +
        `  (precision ${entry.precision.toFixed(3)}, recall ${entry.recall.toFixed(3)}, together in both ${entry.pairsTogetherInBoth})`,
    )
  }

  const namesByGroup = new Map((consolidation?.groups ?? []).map((group) => [group.members.join(','), group.name]))
  for (const arm of arms) {
    arm.capabilities = arm.clusters.map((members) =>
      describeCluster(members, readings, episodes, arm.name === 'model' ? namesByGroup.get(members.join(',')) ?? names[members[0]] : null),
    )
  }

  let evaluation = null
  if (options.evaluate) {
    report('\nnaming    the same blind prompt names every multi-commit group in every arm')
    let cost = 0
    evaluation = {}
    const passes = options.evaluateReadings
      ? [['message', []], ['readings', ['reading']], ['paths', ['paths']]]
      : [['message', []]]
    for (const [pass, show] of passes) {
      if (show.length > 0) report(`          and again showing each commit's ${pass} - no view is neutral, so all are reported`)
      evaluation[pass] = {}
      for (const arm of arms) {
        const naming = await evaluateArm(arm.capabilities, { apiKey, mapper: mapWithConcurrency, show })
        cost += naming.cost
        evaluation[pass][arm.name] = { ...naming, namings: undefined }
        report(
          `          ${arm.name.padEnd(9)} ${String(naming.coherent).padStart(3)}/${String(naming.groupsJudged).padEnd(4)} nameable ` +
            `(${(naming.coherentShare * 100).toFixed(0)}%)`,
        )
      }
    }
    report(`          $${cost.toFixed(4)}`)
  }

  const document = {
    schemaVersion: '0.2.0',
    repository: readingsDocument.repository,
    headSha: readingsDocument.headSha,
    readingCount: readings.length,
    shaping: { method: 'mutual-knn', neighbours: options.neighbours, threshold: options.threshold },
    channels: { baseline: OBSERVED_CHANNELS, reading: READING_CHANNELS, combined: COMBINED_CHANNELS },
    consolidationModel: options.baselineOnly ? null : options.model,
    arms: arms.map((arm) => ({
      name: arm.name,
      description: arm.description,
      shape: arm.shape,
      ...(arm.name === 'model'
        ? { droppedNames: consolidation.dropped, rounds: consolidation.rounds, usage: consolidation.usage }
        : {}),
      capabilities: arm.capabilities,
    })),
    agreements,
    stability,
    evaluation,
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
