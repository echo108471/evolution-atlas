#!/usr/bin/env node

/** Ask an evidence-bounded critic for provisional hierarchy changes. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  buildHierarchyCriticRequest,
  fingerprintHierarchyCriticRequest,
  parseHierarchyCriticPayload,
  requestHierarchyCriticPayload,
} from './lib/capability-hierarchy-critic.mjs'
import { withRetry } from './lib/retry.mjs'

function usage() {
  return `Usage: npm run critic-capability-hierarchy -- [options]

Options:
  --review <path>    Dataset from build-capability-hierarchy-review (required)
  --out <path>       Write the parsed critic document here (required)
  --model <id>       Critic model (default: ${DEFAULT_MODEL})
  --response <path>  Parse an already-saved provider response; make no request
  --raw-out <path>   Save a new provider response here (default: <out>.response.json)
  --dry-run          Report request size and make no request
  --compact          Emit compact JSON
  --help             Show this help

Requires ${API_KEY_ENV} unless --response or --dry-run is used.
`
}

function parseArguments(argv) {
  const options = {
    reviewPath: null, outputPath: null, model: DEFAULT_MODEL,
    responsePath: null, rawOutputPath: null, dryRun: false, pretty: true,
  }
  const strings = {
    '--review': 'reviewPath', '--out': 'outputPath', '--model': 'model',
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
  if (!options.reviewPath || !options.outputPath) throw new Error('--review and --out are required')
  if (options.responsePath && options.rawOutputPath) {
    throw new Error('--response and --raw-out cannot be combined')
  }
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
  if (options.help) { process.stdout.write(usage()); return }
  const dataset = JSON.parse(readFileSync(resolve(options.reviewPath), 'utf8'))
  const request = buildHierarchyCriticRequest(dataset, { model: options.model })
  const prompt = request.messages.map((message) => message.content).join('\n')
  process.stderr.write(
    `${dataset.repository}: ${dataset.shape?.hierarchyNodes ?? 0} nodes, ` +
    `${dataset.shape?.gapSignals ?? 0} recurring gaps, ` +
    `${dataset.shape?.boundarySignals ?? 0} boundary comparisons, ` +
    `${prompt.length} prompt characters\n`,
  )
  if (options.dryRun) { process.stderr.write('dry run: no request made\n'); return }

  let payload
  if (options.responsePath) {
    payload = JSON.parse(readFileSync(resolve(options.responsePath), 'utf8'))
    process.stderr.write(`replaying ${resolve(options.responsePath)}\n`)
  } else {
    const apiKey = process.env[API_KEY_ENV]
    if (!apiKey) throw new Error(`${API_KEY_ENV} is not set`)
    payload = await withRetry(
      () => requestHierarchyCriticPayload(dataset, { model: options.model, apiKey }),
      { onNotice: (notice) => process.stderr.write(`${notice}\n`) },
    )
    const rawPath = options.rawOutputPath ?? `${options.outputPath}.response.json`
    process.stderr.write(`saved raw response ${writeJson(rawPath, payload, options.pretty)}\n`)
  }

  const criticized = parseHierarchyCriticPayload(payload, dataset)
  const document = {
    schemaVersion: '0.1.0',
    method: `capability-hierarchy-critic:openrouter:${options.model}`,
    repository: dataset.repository,
    headSha: dataset.headSha,
    source: { hierarchyReviewContentSha256: dataset.protocol?.contentSha256 ?? null },
    protocol: {
      model: options.model,
      requestSha256: fingerprintHierarchyCriticRequest(dataset, { model: options.model }),
    },
    ...criticized,
  }
  const outputPath = writeJson(options.outputPath, document, options.pretty)
  process.stderr.write(
    `${criticized.shape.proposals} supported proposals: ${criticized.shape.addNodes} add, ` +
    `${criticized.shape.merges} merge, ${criticized.shape.splits} split, ` +
    `${criticized.shape.reparents} reparent, ${criticized.shape.removals} remove; ` +
    `${criticized.shape.accountedSignals}/${criticized.shape.signals} signals accounted\n` +
    `wrote ${outputPath}` +
    `${criticized.usage?.cost != null ? ` ($${criticized.usage.cost.toFixed(4)})` : ''}\n`,
  )
}

try { await main() } catch (error) {
  process.stderr.write(`Capability hierarchy critic failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
