#!/usr/bin/env node
/** Stable entry point. Existing runs select their pinned runtime; new runs use v2. */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as v1 from './versions/repository-engine-v1/repository-engine.mjs'
import * as v2 from './repository-engine-v2.mjs'

function read(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Regular artifact required: ' + path)
  return JSON.parse(readFileSync(path))
}
function runtime(directory, creating = false) {
  const requested = resolve(directory)
  const out = existsSync(requested) ? realpathSync(requested) : requested
  const path = out + '/run-plan.json'
  if (creating && !existsSync(path)) return v2
  const version = read(path).version
  if (version === 'repository-engine/1') return v1
  if (version === 'repository-engine/2') return v2
  throw new Error('Unsupported repository engine version; no automatic migration: ' + version)
}
export const prepareEngine = (directory, input) => runtime(directory, true).prepareEngine(directory, input)
export const inspectEngine = directory => runtime(directory).inspectEngine(directory)
export const engineBroker = (directory, ...args) => runtime(directory).engineBroker(directory, ...args)
export const checkpointEngine = (directory, ...args) => runtime(directory).checkpointEngine(directory, ...args)
export const freezeIntegration = directory => runtime(directory).freezeIntegration(directory)
export const publishEngine = directory => runtime(directory).publishEngine(directory)
export const recordEngineLaunch = (directory, ...args) => runtime(directory).recordEngineLaunch(directory, ...args)
export const recordEngineTerminal = (directory, ...args) => runtime(directory).recordEngineTerminal(directory, ...args)

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory, ...args] = process.argv.slice(2)
  try {
    if (!directory) throw new Error('Run directory required')
    let result
    if (command === 'prepare' && args.length === 1) result = prepareEngine(directory, read(resolve(args[0])))
    else if (command === 'status' && !args.length) result = inspectEngine(directory)
    else if (command === 'broker') result = engineBroker(directory, ...args.slice(0, 2), args.slice(2))
    else if (command === 'checkpoint' && args.length === 1) result = checkpointEngine(directory, ...args)
    else if (command === 'integrate' && !args.length) result = freezeIntegration(directory)
    else if (command === 'launch' && args.length === 2) result = recordEngineLaunch(directory, ...args)
    else if (command === 'terminal' && args.length === 3) result = recordEngineTerminal(directory, ...args)
    else if (command === 'publish' && !args.length) result = publishEngine(directory)
    else throw new Error('Usage: repository-engine.mjs prepare RUN CONFIG.json | status RUN | broker RUN AGENT list|read|search|receipt|commit-meta|diff|path-history ARGS | checkpoint RUN AGENT | integrate RUN | launch RUN AGENT HANDLE | terminal RUN AGENT HANDLE completed|interrupted|failed | publish RUN')
    if (['prepare', 'status'].includes(command)) result = { status: result.status, version: result.plan.version, mode: result.plan.mode, displayName: result.plan.displayName, commitSha: result.plan.commitSha, availableDiscoveryFiles: result.inventory.eligibleFiles, jobs: result.jobs.map(({ agent, state, handle, validation }) => ({ agent, state, handle, validation })) }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
