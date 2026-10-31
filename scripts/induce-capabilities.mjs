#!/usr/bin/env node

/** Blindly infer a hierarchical, overlapping capability map from saved readings. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  MAX_INDUCTION_DEPTH,
  buildInductionRequest,
  fingerprintInductionRequest,
  parseInductionPayload,
  requestInductionPayload,
} from './lib/capability-induction.mjs'
import { withRetry } from './lib/retry.mjs'

function usage() {
  return `Usage: npm run induce-capabilities -- [options]

Infer a hierarchical, overlapping capability map without a maintainer taxonomy or target
count. The paid provider response is saved before parsing so it can be replayed for free.

Options:
  --readings <path>  Readings JSON from npm run analyze-commits (required)
  --out <path>       Write the parsed capability document here (required)
  --model <id>       Induction model (default: ${DEFAULT_MODEL})
  --response <path>  Parse an already-saved provider response; make no request
  --raw-out <path>   Save a new provider response here
                     (default: <out>.response.json)
  --dry-run          Report request size and make no request
  --compact          Emit compact JSON
  --help             Show this help

Requires ${API_KEY_ENV} unless --response or --dry-run is used.
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, outputPath: null, model: DEFAULT_MODEL, responsePath: null,
    rawOutputPath: null, dryRun: false, pretty: true,
  }
  const strings = {
    '--readings': 'readingsPath', '--out': 'outputPath', '--model': 'model',
    '--response': 'responsePath', '--raw-out': 'rawOutputPath',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (argument === '--compact') { options.pretty = false; continue }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  if (!options.readingsPath || !options.outputPath) throw new Error('--readings and --out are required')
  if (options.responsePath && options.rawOutputPath) throw new Error('--response and --raw-out cannot be combined')
  return options
}

const writeJson = (path, value, pretty = true) => {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8')
  return absolute
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  const readingsDocument = JSON.parse(readFileSync(resolve(options.readingsPath), 'utf8'))
  const readings = readingsDocument.readings ?? []
  const request = buildInductionRequest(readings, { model: options.model })
  const prompt = request.messages.map((message) => message.content).join('\n')
  process.stderr.write(`${readingsDocument.repository}: ${readings.length} readings, ${prompt.length} prompt characters\n`)

  if (options.dryRun) {
    process.stderr.write('dry run: no request made\n')
    return
  }

  let payload
  if (options.responsePath) {
    payload = JSON.parse(readFileSync(resolve(options.responsePath), 'utf8'))
    process.stderr.write(`replaying ${resolve(options.responsePath)}\n`)
  } else {
    const apiKey = process.env[API_KEY_ENV]
    if (!apiKey) throw new Error(`${API_KEY_ENV} is not set`)
    payload = await withRetry(
      () => requestInductionPayload(readings, { model: options.model, apiKey }),
      { onNotice: (notice) => process.stderr.write(`${notice}\n`) },
    )
    const rawPath = options.rawOutputPath ?? `${options.outputPath}.response.json`
    process.stderr.write(`saved raw response ${writeJson(rawPath, payload, options.pretty)}\n`)
  }

  const induced = parseInductionPayload(payload, readings)
  const document = {
    schemaVersion: '0.2.0',
    method: `hierarchical-capability-induction:openai:${options.model}`,
    protocol: {
      model: options.model,
      maxDepth: MAX_INDUCTION_DEPTH,
      requestSha256: fingerprintInductionRequest(request),
    },
    repository: readingsDocument.repository,
    headSha: readingsDocument.headSha,
    readingCount: readings.length,
    commits: Object.fromEntries(readings.map((reading) => [reading.commitSha, {
      shortSha: reading.shortSha,
      authoredAt: reading.authoredAt,
      subject: reading.subject,
      reading: (reading.tier2 ?? reading.tier1)?.summary ?? null,
    }])),
    ...induced,
  }
  const outputPath = writeJson(options.outputPath, document, options.pretty)
  process.stderr.write(
    `${induced.shape.topLevelCapabilities} umbrellas, ${induced.shape.totalCapabilities} total; ` +
    `${(induced.shape.coverage * 100).toFixed(0)}% assigned, ${induced.shape.overlappingCommits} overlapping commits\n` +
    `wrote ${outputPath}${induced.usage?.cost != null ? ` ($${induced.usage.cost.toFixed(4)})` : ''}\n`,
  )
}

try {
  await main()
} catch (error) {
  process.stderr.write(`Capability induction failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
