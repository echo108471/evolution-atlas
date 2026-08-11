#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildAtlas } from './lib/atlas.mjs'

function usage() {
  return `Usage: npm run analyze -- [options]

Options:
  --repo <path>   Git repository to analyze (default: current directory)
  --out <path>    Write JSON to a file instead of stdout
  --compact       Emit compact JSON instead of indented JSON
  --help          Show this help
`
}

function parseArguments(argv) {
  const options = { repositoryPath: '.', outputPath: null, pretty: true }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') {
      options.pretty = false
      continue
    }
    if (argument === '--repo' || argument === '--out') {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a path`)
      if (argument === '--repo') options.repositoryPath = value
      else options.outputPath = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  return options
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  const dataset = buildAtlas(options.repositoryPath)
  const serialized = `${JSON.stringify(dataset, null, options.pretty ? 2 : 0)}\n`

  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, serialized, 'utf8')
    process.stderr.write(
      `Wrote ${dataset.repository.commitCount} commits from ${dataset.repository.name} to ${outputPath}\n`,
    )
  } else {
    process.stdout.write(serialized)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Evolution Atlas analysis failed: ${message}\n`)
  process.exitCode = 1
}
