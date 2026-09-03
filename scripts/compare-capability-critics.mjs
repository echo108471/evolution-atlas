#!/usr/bin/env node

/** Compare repeated critics of the same fixed-map disagreement dataset. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { compareCapabilityCritics } from './lib/capability-critic-comparison.mjs'

function usage() {
  return `Usage: npm run compare-capability-critics -- [options] <critic.json> <critic.json> [...]

Options:
  --disagreements <path>  Source disagreement dataset (required)
  --out <path>            Write the comparison report here (required)
  --compact               Emit compact JSON
  --help                  Show this help
`
}

function parseArguments(argv) {
  const options = { disagreementsPath: null, outputPath: null, inputs: [], pretty: true }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--disagreements') options.disagreementsPath = argv[++index]
    else if (argument === '--out') options.outputPath = argv[++index]
    else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    else options.inputs.push(argument)
  }
  if (!options.disagreementsPath || !options.outputPath) {
    throw new Error('--disagreements and --out are required')
  }
  if (options.inputs.length < 2) throw new Error('at least two critic documents are required')
  return options
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage()); return }
  const paths = options.inputs.map((path) => resolve(path))
  const report = compareCapabilityCritics(
    readJson(options.disagreementsPath),
    paths.map(readJson),
    { ids: paths.map((path) => basename(path, '.json')) },
  )
  const outputPath = resolve(options.outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, 'utf8')
  const format = (summary) => summary ? `${(summary.mean * 100).toFixed(1)}%` : 'n/a'
  process.stderr.write(
    `${report.aggregate.comparisons} pairwise comparisons; ` +
    `${format(report.aggregate.exactDecisionShare)} exact agreement, ` +
    `${format(report.aggregate.selectedEdgeF1)} selected-edge F1\n` +
    `wrote ${outputPath}\n`,
  )
}

try { main() } catch (error) {
  process.stderr.write(`Capability critic comparison failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
