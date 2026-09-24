#!/usr/bin/env node
/** Repository-neutral inventory preparation only. Does not launch models or read source bodies. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { inventorySnapshot } from './lib/repository-snapshot.mjs'

const bytes = value => JSON.stringify(value, null, 2) + '\n'
const hash = value => createHash('sha256').update(value).digest('hex')
const implementations = () => Object.fromEntries(['repository-run-plan.mjs', 'lib/repository-snapshot.mjs'].map(file => [file, hash(readFileSync(new URL(file, import.meta.url)))]))
function read(file) {
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Expected regular artifact: ' + file)
  return readFileSync(file)
}
function createExact(file, content) {
  if (existsSync(file)) {
    if (!read(file).equals(Buffer.from(content))) throw new Error('Existing artifact differs: ' + file)
  } else writeFileSync(file, content, { flag: 'wx' })
}
function configuration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration object required')
  const fields = ['repo', 'revision', 'displayName', 'partitionCount', 'maxFileBytes']
  for (const k of Object.keys(input)) if (!fields.includes(k)) throw new Error('Unknown inventory configuration field: ' + k)
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 200 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input.displayName)) throw new Error('displayName must be nonempty plain text up to 200 characters')
  return { repo: input.repo, revision: input.revision ?? 'HEAD', displayName: input.displayName, partitionCount: input.partitionCount ?? 3, maxFileBytes: input.maxFileBytes ?? 1048576 }
}
function reconstruct(plan, out) {
  if (plan.schemaVersion !== 'repository-inventory-plan/1' || plan.stage !== 'inventory-prepared' || plan.outputDirectory !== out) throw new Error('Run plan identity mismatch')
  if (!isDeepStrictEqual(plan.implementationSha256, implementations())) throw new Error('Inventory implementation changed; preserve this run and create a new version')
  const snapshot = inventorySnapshot({ repo: plan.repo, revision: plan.commitSha, partitionCount: plan.partitionCount, maxFileBytes: plan.maxFileBytes })
  if (snapshot.repo !== plan.repo || hash(bytes(snapshot.inventory)) !== plan.inventorySha256) throw new Error('Pinned tree inventory does not match run plan')
  return snapshot
}
function summary(plan, inventory) {
  return { stage: 'inventory-prepared', displayName: plan.displayName, commitSha: plan.commitSha,
    allTrackedEntries: inventory.allTrackedEntries, eligibleFiles: inventory.eligibleFiles, omittedEntries: inventory.omitted.length,
    assignments: Array.from({ length: plan.partitionCount }, (_, i) => String.fromCharCode(65 + i)).map(id => ({ id, files: inventory.files.filter(f => f.partition === id).length })),
    sourceBodiesRead: 0, modelExecution: 'not-started', candidateMap: 'not-produced', independentVerification: 'not-performed',
    limitations: ['Metadata-only preparation, not an end-to-end discovery engine.', 'Path and extension filters can omit legitimate code and cannot certify source content.', 'Assignments route evidence work; they do not define capabilities.'] }
}

export function prepareRepositoryRun(input, directory) {
  const config = configuration(input)
  if (typeof directory !== 'string' || !directory) throw new Error('Output directory required')
  const requested = resolve(directory)
  mkdirSync(requested, { recursive: true })
  const out = realpathSync(requested), planFile = out + '/run-plan.json'
  let plan, snapshot
  if (existsSync(planFile)) {
    plan = JSON.parse(read(planFile)); snapshot = reconstruct(plan, out)
    const candidate = inventorySnapshot({ ...config, revision: plan.commitSha })
    if (candidate.repo !== plan.repo || config.revision !== plan.requestedRevision || config.displayName !== plan.displayName || config.partitionCount !== plan.partitionCount || config.maxFileBytes !== plan.maxFileBytes) throw new Error('Configuration changed; use a new run directory')
  } else {
    if (readdirSync(out).length) throw new Error('New run requires an empty output directory')
    snapshot = inventorySnapshot(config)
    plan = { schemaVersion: 'repository-inventory-plan/1', stage: 'inventory-prepared', outputDirectory: out, repo: snapshot.repo,
      requestedRevision: config.revision, commitSha: snapshot.inventory.commitSha, displayName: config.displayName,
      partitionCount: config.partitionCount, maxFileBytes: config.maxFileBytes,
      inventorySha256: hash(bytes(snapshot.inventory)), implementationSha256: implementations() }
    createExact(planFile, bytes(plan))
  }
  // An interrupted preparation can reconstruct a missing inventory from its pinned tree.
  // Conflicting or partial bytes are never silently replaced.
  createExact(out + '/inventory.json', bytes(snapshot.inventory))
  return summary(plan, snapshot.inventory)
}

export function inspectRepositoryRun(directory) {
  const out = realpathSync(resolve(directory)), plan = JSON.parse(read(out + '/run-plan.json')), snapshot = reconstruct(plan, out)
  if (hash(read(out + '/inventory.json')) !== plan.inventorySha256) throw new Error('Saved inventory changed')
  return summary(plan, snapshot.inventory)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, input, out] = process.argv.slice(2)
  try {
    if (command === 'prepare' && input && out && process.argv.length === 5) console.log(JSON.stringify(prepareRepositoryRun(JSON.parse(read(resolve(input))), out), null, 2))
    else if (command === 'status' && input && process.argv.length === 4) console.log(JSON.stringify(inspectRepositoryRun(input), null, 2))
    else throw new Error('Usage: node scripts/repository-run-plan.mjs prepare CONFIG.json OUTPUT_DIR | status OUTPUT_DIR')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
