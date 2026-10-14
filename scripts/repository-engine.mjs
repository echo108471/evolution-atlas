#!/usr/bin/env node
/** Stable entry point. Existing runs select their pinned runtime; new runs use v3. */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import * as v1 from './versions/repository-engine-v1/repository-engine.mjs'
import * as snapshot from './versions/repository-engine-v2/snapshot/repository-engine-v2.mjs'
import * as milestone from './versions/repository-engine-v2/milestone/repository-engine-v2.mjs'
import * as catalog from './versions/repository-engine-v2/catalog/repository-engine-v2.mjs'
import * as history from './versions/repository-engine-v2/history/repository-engine-v2.mjs'
import * as v3 from './repository-engine-v3.mjs'
import { engineStatusMetadata } from './lib/repository-engine-status.mjs'

const archived = { snapshot, milestone, catalog, history }
const archivedPins = JSON.parse(readFileSync(new URL('./versions/repository-engine-v2/runtimes.json', import.meta.url)))

function read(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Regular artifact required: ' + path)
  return JSON.parse(readFileSync(path))
}
function runtime(directory, creating = false) {
  const requested = resolve(directory)
  const out = existsSync(requested) ? realpathSync(requested) : requested
  const path = out + '/run-plan.json'
  if (creating && !existsSync(path)) return v3
  const plan = read(path), version = plan.version
  if (version === 'repository-engine/1') return v1
  if (version === 'repository-engine/2') {
    const match = archivedPins.find(entry => isDeepStrictEqual(entry.engines, plan.engines))
    if (!match) throw new Error('Unknown version 2 runtime pins; preserve this run without migrating it')
    return archived[match.name]
  }
  if (version === 'repository-engine/3') return v3
  throw new Error('Unsupported repository engine version; no automatic migration: ' + version)
}
export const prepareEngine = (directory, input) => runtime(directory, true).prepareEngine(directory, input)
export const inspectEngine = directory => runtime(directory).inspectEngine(directory)
export const statusEngine = directory => {
  const selected = runtime(directory)
  return selected.statusEngine ? selected.statusEngine(directory) : engineStatusMetadata(selected.inspectEngine(directory))
}
export const engineBroker = (directory, ...args) => runtime(directory).engineBroker(directory, ...args)
export const checkpointEngine = (directory, ...args) => runtime(directory).checkpointEngine(directory, ...args)
export const freezeIntegration = directory => runtime(directory).freezeIntegration(directory)
export const publishEngine = directory => runtime(directory).publishEngine(directory)
export const recordEngineLaunch = (directory, ...args) => runtime(directory).recordEngineLaunch(directory, ...args)
export const recordEngineTerminal = (directory, ...args) => runtime(directory).recordEngineTerminal(directory, ...args)
function currentHostRuntime(directory) {
  const selected = runtime(directory)
  if (selected !== v3) throw new Error('Reserved dispatch and scoped worker status require a version 3 run')
  return selected
}
export const reserveEngineLaunch = (directory, ...args) => currentHostRuntime(directory).reserveEngineLaunch(directory, ...args)
export const bindEngineLaunch = (directory, ...args) => currentHostRuntime(directory).bindEngineLaunch(directory, ...args)
export const readEngineWorkerStatus = (directory, ...args) => currentHostRuntime(directory).readEngineWorkerStatus(directory, ...args)

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory, ...args] = process.argv.slice(2)
  try {
    if (!directory) throw new Error('Run directory required')
    let result
    if (command === 'prepare' && args.length === 1) result = engineStatusMetadata(prepareEngine(directory, read(resolve(args[0]))))
    else if (command === 'status' && !args.length) result = statusEngine(directory)
    else if (command === 'status' && args.length === 1) result = readEngineWorkerStatus(directory, args[0])
    else if (command === 'broker') result = engineBroker(directory, ...args.slice(0, 2), args.slice(2))
    else if (command === 'checkpoint' && args.length === 1) result = checkpointEngine(directory, ...args)
    else if (command === 'integrate' && !args.length) result = freezeIntegration(directory)
    else if (command === 'launch' && args.length === 2) result = recordEngineLaunch(directory, ...args)
    else if (command === 'reserve' && args.length === 1) result = reserveEngineLaunch(directory, ...args)
    else if (command === 'bind' && args.length === 3) result = bindEngineLaunch(directory, ...args)
    else if (command === 'terminal' && args.length === 3) result = recordEngineTerminal(directory, ...args)
    else if (command === 'publish' && !args.length) result = publishEngine(directory)
    else throw new Error('Usage: repository-engine.mjs prepare RUN CONFIG.json | status RUN [AGENT] | broker RUN AGENT ACTION ARGS | checkpoint RUN AGENT | integrate RUN | reserve RUN AGENT | bind RUN AGENT RESERVATION_ID HANDLE | launch RUN AGENT HANDLE | terminal RUN AGENT HANDLE completed|interrupted|failed | publish RUN')
    console.log(JSON.stringify(result, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
