#!/usr/bin/env node

/** Compare blind induction runs by cited evidence, never by label wording. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import { compareInductionRuns } from './lib/capability-stability.mjs'

function usage() {
  return `Usage: npm run compare-capability-inductions -- [options] <run.json> <run.json> [...]

Compare two or more hierarchical capability documents. Runs must describe the same commit
universe and carry a shared comparison-protocol fingerprint. Induction runs require the
same request; fixed-hierarchy assignment runs may intentionally use different hierarchies.

Options:
  --out <path>              Write the stability report here (required)
  --allow-mixed-protocols   Allow legacy/exploratory comparison without claiming an
                            identical protocol
  --compact                 Emit compact JSON
  --help                    Show this help
`
}

function parseArguments(argv) {
  const options = { outputPath: null, inputs: [], pretty: true, allowMixedProtocols: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--allow-mixed-protocols') { options.allowMixedProtocols = true; continue }
    if (argument === '--out') {
      options.outputPath = argv[++index]
      if (!options.outputPath) throw new Error('--out requires a value')
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    options.inputs.push(argument)
  }
  if (!options.outputPath) throw new Error('--out is required')
  if (options.inputs.length < 2) throw new Error('at least two run documents are required')
  return options
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const paths = options.inputs.map((path) => resolve(path))
  const documents = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  const report = compareInductionRuns(documents, {
    runIds: paths.map((path) => basename(path, '.json')),
    allowMixedProtocols: options.allowMixedProtocols,
  })
  const outputPath = resolve(options.outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`, 'utf8')

  const format = (summary) => summary ? `${(summary.mean * 100).toFixed(1)}%` : 'n/a'
  process.stderr.write(
    `${report.aggregate.comparisons} pairwise comparisons; ` +
    `umbrella membership F1 ${format(report.aggregate.umbrellaCoMembershipF1)}, ` +
    `child membership F1 ${format(report.aggregate.childCoMembershipF1)}, ` +
    `parent agreement ${format(report.aggregate.parentRelationshipIntersectionWeightedShare)} (evidence-weighted)\n` +
    `wrote ${outputPath}\n`,
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`Capability stability comparison failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
