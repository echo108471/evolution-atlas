#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  buildBoundaryIntervals,
  buildEpochs,
  buildFocusSignals,
  clusterProposals,
  detectFocusPeaks,
  EPOCH_METHOD_PREFIX,
} from './lib/epochs.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, proposePhaseBoundaries } from './lib/phase-model.mjs'

function usage() {
  return `Usage: npm run epochs -- [options]

Divides a repository's history into epochs. A model reads raw commit windows and marks
where the work changed character; two deterministic detectors independently measure
where the distribution of touched paths and of subject vocabulary shifts. Neither sees
the other's output. Each boundary is recorded as the interval spanning both readings,
because the two find the same transition at slightly different moments.

Every boundary is a candidate for review. The focus signals beside it are observations.

Options:
  --in <path>            Observed dataset to read (default: public/atlas.json)
  --out <path>           Write the epoch document here (default: stdout)
  --model <id>           OpenRouter model (default: ${DEFAULT_MODEL})
  --window <n>           Commits per request window (default: 200)
  --stride <n>           Commits between window starts (default: 100)
  --peaks <n>            Focus peaks to retain per detector (default: 14)
  --proposals <path>     Reuse saved model proposals instead of calling the model
  --save-proposals <p>   Write raw model proposals here for later reuse
  --compact              Emit compact JSON instead of indented JSON
  --help                 Show this help

Requires ${API_KEY_ENV} unless --proposals supplies an earlier run's output.
Expect roughly 40-180 seconds per window: the model reasons at length over each slice.
`
}

function parseArguments(argv) {
  const options = {
    inputPath: 'public/atlas.json',
    outputPath: null,
    model: DEFAULT_MODEL,
    window: 200,
    stride: 100,
    peaks: 14,
    proposalsPath: null,
    saveProposalsPath: null,
    pretty: true,
  }

  const numeric = new Set(['--window', '--stride', '--peaks'])
  const paths = {
    '--in': 'inputPath',
    '--out': 'outputPath',
    '--proposals': 'proposalsPath',
    '--save-proposals': 'saveProposalsPath',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') {
      options.pretty = false
      continue
    }
    const value = argv[++index]
    if (!value) throw new Error(`${argument} requires a value`)
    if (argument === '--model') {
      options.model = value
      continue
    }
    if (numeric.has(argument)) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${argument} requires a positive number`)
      options[argument.slice(2)] = parsed
      continue
    }
    if (paths[argument]) {
      options[paths[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  return options
}

function summarize(document, stream) {
  const { boundaries, epochs, unpairedFocusPeaks } = document
  const corroborated = boundaries.filter((boundary) => boundary.corroborated).length

  stream.write(`\n${boundaries.length} candidate boundaries, ${epochs.length} epochs\n`)
  stream.write(`  corroborated by a focus shift : ${corroborated}/${boundaries.length}\n`)
  stream.write(`  proposal only                 : ${boundaries.length - corroborated}\n`)
  stream.write(`  focus peaks with no proposal  : ${unpairedFocusPeaks.length}\n\n`)

  stream.write('  span  date        conf  votes  commits  epoch\n')
  for (const epoch of epochs) {
    stream.write(
      `  ${String(epoch.startIndex).padStart(5)}-${String(epoch.endIndex).padEnd(5)} ` +
        `${epoch.firstAuthoredAt.slice(0, 10)} -> ${epoch.lastAuthoredAt.slice(0, 10)} ` +
        `${String(epoch.commitCount).padStart(5)} commits\n`,
    )
  }
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  const dataset = JSON.parse(readFileSync(resolve(options.inputPath), 'utf8'))
  if (dataset.episodes.length === 0) throw new Error('dataset contains no commits')

  let proposals
  let modelReport = null

  if (options.proposalsPath) {
    const saved = JSON.parse(readFileSync(resolve(options.proposalsPath), 'utf8'))
    if (saved.repository && saved.repository !== dataset.repository.name) {
      throw new Error(`${options.proposalsPath} describes ${saved.repository}, not ${dataset.repository.name}`)
    }
    proposals = saved.proposals
    modelReport = { model: saved.model, reused: true }
    process.stderr.write(`Reusing ${proposals.length} proposals from ${options.proposalsPath}\n`)
  } else {
    const apiKey = process.env[API_KEY_ENV]
    if (!apiKey) throw new Error(`${API_KEY_ENV} is not set`)
    process.stderr.write(`Reading ${dataset.episodes.length} commits with ${options.model}\n`)
    const result = await proposePhaseBoundaries(dataset, {
      model: options.model,
      apiKey,
      window: options.window,
      stride: options.stride,
      onProgress: (event) =>
        process.stderr.write(
          event.error
            ? `  ${event.windowPlan.start}-${event.windowPlan.end}: FAILED ${event.error}\n`
            : `  ${event.windowPlan.start}-${event.windowPlan.end}: ${event.found} boundary(ies) in ${event.seconds}s  [${event.order + 1}/${event.total}]\n`,
        ),
    })
    proposals = result.proposals
    modelReport = {
      model: options.model,
      reused: false,
      windowCount: result.windowCount,
      failedWindows: result.failures.length,
      unresolvedCitations: result.unresolved.length,
      usage: result.usage,
    }
    if (result.unresolved.length > 0) {
      process.stderr.write(`Dropped ${result.unresolved.length} citation(s) naming a commit not in the dataset\n`)
    }
    if (options.saveProposalsPath) {
      const savePath = resolve(options.saveProposalsPath)
      mkdirSync(dirname(savePath), { recursive: true })
      writeFileSync(
        savePath,
        `${JSON.stringify({ repository: dataset.repository.name, headSha: dataset.repository.headSha, model: options.model, window: options.window, stride: options.stride, proposals }, null, 2)}\n`,
        'utf8',
      )
      process.stderr.write(`Wrote raw proposals to ${savePath}\n`)
    }
  }

  const signals = buildFocusSignals(dataset.episodes)
  const peaks = [
    ...detectFocusPeaks(signals, 'path', { count: options.peaks }),
    ...detectFocusPeaks(signals, 'language', { count: options.peaks }),
  ]
  const clusters = clusterProposals(proposals)
  const { boundaries, unpairedFocusPeaks } = buildBoundaryIntervals(clusters, peaks, dataset.episodes)
  const epochs = buildEpochs(boundaries, dataset.episodes)

  const document = {
    schemaVersion: '0.1.0',
    repository: dataset.repository.name,
    headSha: dataset.repository.headSha,
    method: `${EPOCH_METHOD_PREFIX}:openrouter:${modelReport.model}`,
    commitCount: dataset.episodes.length,
    model: modelReport,
    boundaries,
    epochs,
    unpairedFocusPeaks,
  }

  const serialized = `${JSON.stringify(document, null, options.pretty ? 2 : 0)}\n`
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, serialized, 'utf8')
    process.stderr.write(`Wrote ${boundaries.length} boundaries and ${epochs.length} epochs to ${outputPath}\n`)
  } else {
    process.stdout.write(serialized)
  }
  summarize(document, process.stderr)
} catch (error) {
  process.stderr.write(`Evolution Atlas epoch detection failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
