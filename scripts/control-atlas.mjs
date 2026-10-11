#!/usr/bin/env node
import {
  cleanupRun,
  doctor,
  listFeatures,
  verifyFeatures,
  verifyPreview,
} from './verification/control-atlas.mjs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const USAGE = `Evolution Atlas isolated UI verifier

Usage:
  node scripts/control-atlas.mjs doctor [--json]
  node scripts/control-atlas.mjs list [--json]
  node scripts/control-atlas.mjs verify --feature FEATURE [--trace] [--json]
  node scripts/control-atlas.mjs verify --all [--trace] [--json]
  node scripts/control-atlas.mjs verify-preview --directory ABS_PATH --inventory ABS_PATH [--json]
  node scripts/control-atlas.mjs cleanup --run-id ID [--dry-run | --apply] [--json]

JSON is the default output format. Default verification uses synthetic fixtures;
verify-preview explicitly inspects an inventoried ignored private production build
on an owned loopback static server. Neither command approves publication.
Both use fresh Chromium profiles. Browser screenshots,
DOM snapshots, action logs, browser events, and a source manifest remain under
scratch/control-atlas-evidence/ after the runtime server and browser are closed.
`

function usageError(message) {
  const error = new Error(message)
  error.exitCode = 2
  return error
}

function parseOptions(args) {
  const options = { featureIds: [], all: false, trace: false, json: false, dryRun: false, apply: false, runId: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--json') {
      options.json = true
    } else if (argument === '--trace') {
      options.trace = true
    } else if (argument === '--all') {
      options.all = true
    } else if (argument === '--feature') {
      const feature = args[index + 1]
      if (!feature || feature.startsWith('--')) throw usageError('--feature requires a feature ID.')
      options.featureIds.push(feature)
      index += 1
    } else if (argument === '--run-id') {
      const runId = args[index + 1]
      if (!runId || runId.startsWith('--')) throw usageError('--run-id requires an ID.')
      options.runId = runId
      index += 1
    } else if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--apply') {
      options.apply = true
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw usageError(`Unknown option: ${argument}`)
    }
  }
  return options
}

export function parseControlCommand(args) {
  if (!Array.isArray(args) || args.length === 0) throw usageError('Choose doctor, list, verify, or cleanup.')
  const [command, ...rest] = args
  if (command === 'verify-preview') {
    const options = { directory: null, inventory: null, json: false }
    for (let index = 0; index < rest.length; index += 1) {
      const option = rest[index]
      if (option === '--json') { options.json = true; continue }
      if (!['--directory', '--inventory'].includes(option)) throw usageError('verify-preview accepts only --directory, --inventory, and --json.')
      const key = option.slice(2), value = rest[++index]
      if (!value || !isAbsolute(value) || options[key] !== null) throw usageError(`${option} requires one absolute local path.`)
      options[key] = value
    }
    if (!options.directory || !options.inventory) throw usageError('verify-preview requires --directory and --inventory.')
    return { command, options }
  }
  if (command === '--help' || command === '-h' || command === 'help') return { command: 'help', options: {} }
  if (!['doctor', 'list', 'verify', 'cleanup'].includes(command)) throw usageError(`Unknown command: ${command}`)
  const options = parseOptions(rest)
  if (options.help) return { command: 'help', options: {} }

  if (command === 'doctor' || command === 'list') {
    if (options.featureIds.length || options.all || options.trace || options.runId || options.dryRun || options.apply) {
      throw usageError(`${command} accepts only the optional --json flag.`)
    }
  }
  if (command === 'verify') {
    if (options.runId || options.dryRun || options.apply) throw usageError('verify does not accept cleanup options.')
    if (options.all && options.featureIds.length) throw usageError('Use either --all or --feature, not both.')
    if (!options.all && options.featureIds.length !== 1) throw usageError('Use exactly one --feature NAME or --all.')
  }
  if (command === 'cleanup') {
    if (!options.runId) throw usageError('cleanup requires --run-id ID.')
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(options.runId)) throw usageError('--run-id must be a verifier run ID using lowercase letters, digits, and hyphens.')
    if (options.featureIds.length || options.all || options.trace) throw usageError('cleanup does not accept feature or trace options.')
    if (options.dryRun && options.apply) throw usageError('Choose either --dry-run or --apply.')
  }
  return { command, options }
}

export async function runControlCommand(args) {
  const parsed = parseControlCommand(args)
  if (parsed.command === 'help') return { ok: true, command: 'help', usage: USAGE }
  if (parsed.command === 'doctor') return doctor()
  if (parsed.command === 'list') return listFeatures()
  if (parsed.command === 'verify-preview') return verifyPreview(parsed.options)
  if (parsed.command === 'verify') {
    return verifyFeatures({ featureIds: parsed.options.featureIds, all: parsed.options.all, trace: parsed.options.trace })
  }
  return {
    command: 'cleanup',
    ...cleanupRun({ runId: parsed.options.runId, apply: parsed.options.apply }),
    note: 'Cleanup operates only on the exact verifier-owned runtime directory. Evidence under scratch/control-atlas-evidence is retained.',
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runControlCommand(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.ok === false) process.exitCode = 1
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, usage: USAGE })}\n`)
    process.exitCode = error.exitCode ?? 1
  })
}
