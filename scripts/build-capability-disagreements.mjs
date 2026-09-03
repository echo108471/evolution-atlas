#!/usr/bin/env node

/** Build a deterministic disagreement dataset from repeated fixed-map assignments. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildCapabilityDisagreementDataset } from './lib/capability-disagreement.mjs'

function usage() {
  return `Usage: npm run build-capability-disagreements -- [options]

Options:
  --readings <path>       Saved per-commit readings (required)
  --capabilities <path>   Fixed hierarchy used by every assignment (required)
  --assignment <path>     Repeated assignment document; provide at least twice
  --out <path>            Write the disagreement dataset here (required)
  --exemplars <count>     Stable reference examples per capability (default: 3)
  --compact               Emit compact JSON
  --help                  Show this help
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, capabilitiesPath: null, assignmentPaths: [], outputPath: null,
    exemplars: 3, pretty: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--assignment') {
      const value = argv[++index]
      if (!value) throw new Error('--assignment requires a value')
      options.assignmentPaths.push(value)
      continue
    }
    if (argument === '--readings') options.readingsPath = argv[++index]
    else if (argument === '--capabilities') options.capabilitiesPath = argv[++index]
    else if (argument === '--out') options.outputPath = argv[++index]
    else if (argument === '--exemplars') options.exemplars = Number.parseInt(argv[++index], 10)
    else throw new Error(`Unknown option: ${argument}`)
  }
  if (!options.readingsPath || !options.capabilitiesPath || !options.outputPath) {
    throw new Error('--readings, --capabilities, and --out are required')
  }
  if (options.assignmentPaths.length < 2) throw new Error('provide --assignment at least twice')
  if (!Number.isInteger(options.exemplars) || options.exemplars < 0) {
    throw new Error('--exemplars must be a non-negative integer')
  }
  return options
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage()); return }
  const dataset = buildCapabilityDisagreementDataset(
    readJson(options.readingsPath),
    readJson(options.capabilitiesPath),
    options.assignmentPaths.map(readJson),
    { exemplarsPerCapability: options.exemplars },
  )
  const outputPath = resolve(options.outputPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(dataset, null, options.pretty ? 2 : 0)}\n`, 'utf8')
  process.stderr.write(
    `${dataset.shape.disagreementCommits} disagreements from ${dataset.shape.totalCommits} commits; ` +
    `${dataset.shape.stableExemplars} stable exemplars\nwrote ${outputPath}\n`,
  )
}

try { main() } catch (error) {
  process.stderr.write(`Capability disagreement build failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
