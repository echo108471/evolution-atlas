#!/usr/bin/env node

/** Reassign saved readings against a fixed, already-discovered capability hierarchy. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  buildCapabilityAssignmentRequest,
  fingerprintAssignmentComparison,
  parseCapabilityAssignmentPayload,
  requestCapabilityAssignmentPayload,
} from './lib/capability-assignment.mjs'
import { fingerprintInductionRequest } from './lib/capability-induction.mjs'
import { withRetry } from './lib/retry.mjs'

function usage() {
  return `Usage: npm run assign-capability-evidence -- [options]

Reconsider every saved reading against a fixed candidate hierarchy. Original evidence
memberships are not shown to the assignment model.

Options:
  --readings <path>      Readings JSON from npm run analyze-commits (required)
  --capabilities <path>  Hierarchy from npm run induce-capabilities (required)
  --out <path>           Write the reassigned capability document here (required)
  --model <id>           Assignment model (default: ${DEFAULT_MODEL})
  --response <path>      Parse an already-saved provider response; make no request
  --raw-out <path>       Save a new provider response here
                         (default: <out>.response.json)
  --dry-run              Report request size and make no request
  --compact              Emit compact JSON
  --help                 Show this help

Requires ${API_KEY_ENV} unless --response or --dry-run is used.
`
}

function parseArguments(argv) {
  const options = {
    readingsPath: null, capabilitiesPath: null, outputPath: null, model: DEFAULT_MODEL,
    responsePath: null, rawOutputPath: null, dryRun: false, pretty: true,
  }
  const strings = {
    '--readings': 'readingsPath', '--capabilities': 'capabilitiesPath', '--out': 'outputPath',
    '--model': 'model', '--response': 'responsePath', '--raw-out': 'rawOutputPath',
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
  if (!options.readingsPath || !options.capabilitiesPath || !options.outputPath) {
    throw new Error('--readings, --capabilities, and --out are required')
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
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const readingsDocument = JSON.parse(readFileSync(resolve(options.readingsPath), 'utf8'))
  const capabilityDocument = JSON.parse(readFileSync(resolve(options.capabilitiesPath), 'utf8'))
  if (capabilityDocument.repository !== readingsDocument.repository) {
    throw new Error('readings and capability hierarchy describe different repositories')
  }
  if (capabilityDocument.headSha !== readingsDocument.headSha) {
    throw new Error('readings and capability hierarchy describe different repository heads')
  }
  const readings = readingsDocument.readings ?? []
  const request = buildCapabilityAssignmentRequest(readings, capabilityDocument, { model: options.model })
  const prompt = request.messages.map((message) => message.content).join('\n')
  process.stderr.write(
    `${readingsDocument.repository}: ${readings.length} readings, ` +
    `${capabilityDocument.shape?.totalCapabilities ?? 0} fixed capabilities, ` +
    `${prompt.length} prompt characters\n`,
  )
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
      () => requestCapabilityAssignmentPayload(
        readings,
        capabilityDocument,
        { model: options.model, apiKey },
      ),
      { onNotice: (notice) => process.stderr.write(`${notice}\n`) },
    )
    const rawPath = options.rawOutputPath ?? `${options.outputPath}.response.json`
    process.stderr.write(`saved raw response ${writeJson(rawPath, payload, options.pretty)}\n`)
  }

  const assigned = parseCapabilityAssignmentPayload(payload, readings, capabilityDocument)
  const document = {
    schemaVersion: '0.3.0',
    method: `fixed-hierarchy-evidence-assignment:openai:${options.model}`,
    repository: readingsDocument.repository,
    headSha: readingsDocument.headSha,
    readingCount: readings.length,
    sourceHierarchy: {
      method: capabilityDocument.method ?? null,
      requestSha256: capabilityDocument.protocol?.requestSha256 ?? null,
    },
    protocol: {
      kind: 'fixed-hierarchy-capability-evidence-assignment',
      model: options.model,
      requestSha256: fingerprintInductionRequest(request),
      comparisonSha256: fingerprintAssignmentComparison(readings, { model: options.model }),
    },
    commits: Object.fromEntries(readings.map((reading) => [reading.commitSha, {
      shortSha: reading.shortSha,
      authoredAt: reading.authoredAt,
      subject: reading.subject,
      reading: (reading.tier2 ?? reading.tier1)?.summary ?? null,
    }])),
    ...assigned,
  }
  const outputPath = writeJson(options.outputPath, document, options.pretty)
  process.stderr.write(
    `${assigned.shape.topLevelCapabilities} fixed umbrellas, ` +
    `${(assigned.shape.coverage * 100).toFixed(0)}% assigned, ` +
    `${assigned.shape.overlappingCommits} overlapping commits; ` +
    `${assigned.diagnostics.emptyCapabilities.length} empty capabilities, ` +
    `${assigned.diagnostics.removedRedundantAncestorAssignments} redundant ancestor assignments removed\n` +
    `wrote ${outputPath}${assigned.usage?.cost != null ? ` ($${assigned.usage.cost.toFixed(4)})` : ''}\n`,
  )
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `Capability evidence assignment failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}
