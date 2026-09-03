#!/usr/bin/env node

/** Compare repeated hierarchy critics without using labels as identity. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { compareHierarchyCritics } from './lib/capability-hierarchy-critic-comparison.mjs'

function usage() {
  return `Usage: npm run compare-capability-hierarchy-critics -- [options] <critic.json> <critic.json> [...]

Options:
  --out <path>  Write the comparison report here (required)
  --compact     Emit compact JSON
  --help        Show this help
`
}

function parseArguments(argv) {
  const options = { outputPath: null, inputs: [], pretty: true }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--out') {
      options.outputPath = argv[++index]
      if (!options.outputPath) throw new Error('--out requires a value')
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    options.inputs.push(argument)
  }
  if (!options.outputPath) throw new Error('--out is required')
  if (options.inputs.length < 2) throw new Error('at least two critics are required')
  return options
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage()); return }
  const paths = options.inputs.map((path) => resolve(path))
  const documents = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  const report = compareHierarchyCritics(documents, {
    runIds: paths.map((path) => basename(path, '.json')),
  })
  const outputPath = resolve(options.outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, 'utf8')
  const exactAcrossAll = report.proposalRecurrence.filter(
    (proposal) => proposal.runCount === report.runs.length,
  ).length
  const meanF1 = report.aggregate.operationTargetF1?.mean
  process.stderr.write(
    `${report.aggregate.comparisons} comparisons; ${exactAcrossAll} proposal targets recur ` +
    `in all ${report.runs.length} runs; operation-target F1 ` +
    `${meanF1 == null ? 'n/a' : `${(meanF1 * 100).toFixed(1)}%`}; ` +
    `quality gate ${report.qualityGate.allRunsComplete ? 'passed' : 'FAILED'}\n` +
    `wrote ${outputPath}\n`,
  )
}

try { main() } catch (error) {
  process.stderr.write(`Hierarchy critic comparison failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
