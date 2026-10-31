#!/usr/bin/env node

/** Audit a saved capability-assignment disagreement dataset with an independent pass. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  buildCapabilityCriticRequest,
  fingerprintCapabilityCriticRequest,
  parseCapabilityCriticPayload,
  requestCapabilityCriticPayload,
} from './lib/capability-critic.mjs'
import { withRetry } from './lib/retry.mjs'

function usage() {
  return `Usage: npm run critic-capability-disagreements -- [options]

Options:
  --disagreements <path>  Dataset from build-capability-disagreements (required)
  --out <path>            Write the parsed critic document here (required)
  --model <id>            Critic model (default: ${DEFAULT_MODEL})
  --response <path>       Parse an already-saved provider response; make no request
  --raw-out <path>        Save a new provider response here (default: <out>.response.json)
  --show-candidate-union  Show prior proposed IDs as an anchoring ablation
  --dry-run               Report request size and make no request
  --compact               Emit compact JSON
  --help                  Show this help

Requires ${API_KEY_ENV} unless --response or --dry-run is used.
`
}

function parseArguments(argv) {
  const options = {
    disagreementsPath: null, outputPath: null, model: DEFAULT_MODEL, responsePath: null,
    rawOutputPath: null, showCandidateUnion: false, dryRun: false, pretty: true,
  }
  const strings = {
    '--disagreements': 'disagreementsPath', '--out': 'outputPath', '--model': 'model',
    '--response': 'responsePath', '--raw-out': 'rawOutputPath',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (argument === '--compact') { options.pretty = false; continue }
    if (argument === '--show-candidate-union') { options.showCandidateUnion = true; continue }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  if (!options.disagreementsPath || !options.outputPath) {
    throw new Error('--disagreements and --out are required')
  }
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
  const dataset = JSON.parse(readFileSync(resolve(options.disagreementsPath), 'utf8'))
  const request = buildCapabilityCriticRequest(
    dataset,
    { model: options.model, showCandidateUnion: options.showCandidateUnion },
  )
  const prompt = request.messages.map((message) => message.content).join('\n')
  process.stderr.write(
    `${dataset.repository}: ${dataset.shape?.disagreementCommits ?? 0} disagreements, ` +
    `${dataset.shape?.stableExemplars ?? 0} exemplars, ${prompt.length} prompt characters; ` +
    `candidate union ${options.showCandidateUnion ? 'visible' : 'hidden'}\n`,
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
      () => requestCapabilityCriticPayload(dataset, {
        model: options.model,
        apiKey,
        showCandidateUnion: options.showCandidateUnion,
      }),
      { onNotice: (notice) => process.stderr.write(`${notice}\n`) },
    )
    const rawPath = options.rawOutputPath ?? `${options.outputPath}.response.json`
    process.stderr.write(`saved raw response ${writeJson(rawPath, payload, options.pretty)}\n`)
  }

  const criticized = parseCapabilityCriticPayload(payload, dataset)
  const document = {
    schemaVersion: '0.1.0',
    method: `capability-assignment-disagreement-critic:openai:${options.model}`,
    repository: dataset.repository,
    headSha: dataset.headSha,
    source: {
      disagreementContentSha256: dataset.protocol?.contentSha256 ?? null,
      assignmentRequestSha256: dataset.source?.assignmentRequestSha256 ?? null,
    },
    protocol: {
      model: options.model,
      candidateUnionVisible: options.showCandidateUnion,
      requestSha256: fingerprintCapabilityCriticRequest(dataset, {
        model: options.model,
        showCandidateUnion: options.showCandidateUnion,
      }),
    },
    ...criticized,
  }
  const outputPath = writeJson(options.outputPath, document, options.pretty)
  process.stderr.write(
    `${criticized.shape.assigned} assigned, ${criticized.shape.unassigned} unassigned, ` +
    `${criticized.shape.ambiguous} ambiguous, ${criticized.shape.mapInsufficient} map-insufficient; ` +
    `${criticized.shape.missing} missing\nwrote ${outputPath}` +
    `${criticized.usage?.cost != null ? ` ($${criticized.usage.cost.toFixed(4)})` : ''}\n`,
  )
}

try { await main() } catch (error) {
  process.stderr.write(`Capability disagreement critic failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
