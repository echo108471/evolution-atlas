#!/usr/bin/env node

/** Build deterministic evidence packets for a capability hierarchy critic. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildCapabilityHierarchyReviewDataset } from './lib/capability-hierarchy-review.mjs'

function usage() {
  return `Usage: npm run build-capability-hierarchy-review -- [options]

Options:
  --readings <path>       Saved per-commit readings (required)
  --hierarchy <path>      Baseline induced hierarchy (required)
  --alternative <path>    Alternative blind hierarchy; repeat at least once
  --disagreements <path>  Fixed-map disagreement dataset (required)
  --critic <path>         Blind disagreement critic; repeat at least twice
  --out <path>            Write the deterministic review dataset here (required)
  --samples-per-set <n>    Evidence samples per comparison set (default: 2)
  --max-boundary-signals <n> Keep the lowest-overlap boundary signals (default: all)
  --node-exemplars <n>     Stable exemplars retained per current node (default: all)
  --compact               Emit compact JSON
  --help                  Show this help
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, hierarchyPath: null, alternativePaths: [],
    disagreementsPath: null, criticPaths: [], outputPath: null,
    samplesPerSet: 2, maxBoundarySignals: null, nodeExemplarsPerNode: null, pretty: true,
  }
  const strings = {
    '--readings': 'readingsPath', '--hierarchy': 'hierarchyPath',
    '--disagreements': 'disagreementsPath', '--out': 'outputPath',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--alternative' || argument === '--critic') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[argument === '--alternative' ? 'alternativePaths' : 'criticPaths'].push(value)
      continue
    }
    if (['--samples-per-set', '--max-boundary-signals', '--node-exemplars'].includes(argument)) {
      const key = argument === '--samples-per-set'
        ? 'samplesPerSet'
        : argument === '--max-boundary-signals' ? 'maxBoundarySignals' : 'nodeExemplarsPerNode'
      options[key] = Number.parseInt(argv[++index], 10)
      if (!Number.isInteger(options[key]) || options[key] < 1) {
        throw new Error(`${argument} must be a positive integer`)
      }
      continue
    }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  for (const key of ['readingsPath', 'hierarchyPath', 'disagreementsPath', 'outputPath']) {
    if (!options[key]) throw new Error('readings, hierarchy, disagreements, and out are required')
  }
  if (options.alternativePaths.length === 0) throw new Error('at least one alternative is required')
  if (options.criticPaths.length < 2) throw new Error('at least two critics are required')
  return options
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage()); return }
  const dataset = buildCapabilityHierarchyReviewDataset(
    readJson(options.readingsPath),
    readJson(options.hierarchyPath),
    options.alternativePaths.map(readJson),
    readJson(options.disagreementsPath),
    options.criticPaths.map(readJson),
    {
      samplesPerSet: options.samplesPerSet,
      maxBoundarySignals: options.maxBoundarySignals,
      nodeExemplarsPerNode: options.nodeExemplarsPerNode,
    },
  )
  const outputPath = resolve(options.outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(dataset, null, options.pretty ? 2 : 0)}\n`, 'utf8')
  process.stderr.write(
    `${dataset.shape.hierarchyNodes} hierarchy nodes, ${dataset.shape.gapSignals} recurring gaps, ` +
    `${dataset.shape.boundarySignals} boundary comparisons, ` +
    `${dataset.shape.unmatchedAlternativeSignals} unmatched alternatives, ` +
    `${dataset.shape.evidenceReadings} evidence readings\nwrote ${outputPath}\n`,
  )
}

try { main() } catch (error) {
  process.stderr.write(`Hierarchy-review dataset failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
