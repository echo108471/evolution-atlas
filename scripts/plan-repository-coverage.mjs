#!/usr/bin/env node
/** Host-side metadata routing supplement; does not alter the engine or dispatch models. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectEngine } from './repository-engine.mjs'
import { planRepositoryCoverage } from './lib/repository-coverage.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'
function existing(path) {
  try {
    if (!lstatSync(path).isFile()) throw new Error('Regular coverage artifact required: ' + path)
    return readFileSync(path)
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export function prepareCoverageRouting(directory) {
  const state = inspectEngine(directory), run = state.out, path = run + '/coverage-routing.json'
  if (existsSync(run + '/coverage-tasks') && !lstatSync(run + '/coverage-tasks').isDirectory()) throw new Error('Regular coverage task directory required')
  if (!existsSync(path) && state.jobs.some(job => !['ready-to-dispatch', 'waiting-for-discovery'].includes(job.state))) throw new Error('Freeze coverage routing before discovery starts')
  const plan = planRepositoryCoverage(state.full, state.baseline.receipts, { assignmentCount: state.manifest.partitions.length })
  const packet = { ...plan, provenance: {
    engineRunPlanSha256: hash(readFileSync(run + '/run-plan.json')),
    baselineProjectionSha256: hash(readFileSync(run + '/baseline-input.json')),
    helperSha256: hash(readFileSync(new URL('./lib/repository-coverage.mjs', import.meta.url))),
    wrapperSha256: hash(readFileSync(new URL('./plan-repository-coverage.mjs', import.meta.url))),
  } }
  const eligible = new Set(state.inventory.files.map(file => file.path))
  const artifacts = [{ path, bytes: Buffer.from(json(packet)) }]
  for (const assignment of plan.assignments) {
    const regions = assignment.regions.map(region => ({ id: region.id, pathPrefix: region.pathPrefix, kind: region.kind,
      fileCount: region.fileCount, inspectedFileCount: region.inspectedFileCount,
      unreadFileCount: region.unreadFileCount, unreadFilePaths: region.unreadFilePaths }))
    if (regions.some(region => !Array.isArray(region.unreadFilePaths) || region.unreadFilePaths.some(path => !eligible.has(path)))) throw new Error('Coverage assignment includes unavailable source paths')
    const task = { agent: assignment.agent, coveragePlanSha256: hash(artifacts[0].bytes), regions,
      instruction: 'Start evidence retrieval in these metadata-selected regions. Inspect each region or explain why it could not be inspected; file lists are navigation, not a requirement to read every file. Follow dependencies across regions when needed using the existing broker and remaining budget. These are not proposed capabilities or mandatory grouping boundaries. Follow the unchanged engine task and protocol; no owner labels, prior reviews or semantic targets are supplied.',
      broker: { entryPoint: fileURLToPath(new URL('./repository-engine.mjs', import.meta.url)), runDirectory: run,
        read: 'broker RUN AGENT read PATH START_LINE LINE_COUNT (count, not end line)',
        search: 'broker RUN AGENT search PATH_PREFIX LITERAL', list: 'broker RUN AGENT list PREFIX OFFSET' },
    }
    artifacts.push({ path: run + '/coverage-tasks/' + assignment.agent + '.json', bytes: Buffer.from(json(task)) })
  }
  // Preflight every existing file before writing any missing companion.
  for (const artifact of artifacts) {
    artifact.previous = existing(artifact.path)
    if (artifact.previous && !artifact.previous.equals(artifact.bytes)) throw new Error('Refusing changed coverage artifact: ' + artifact.path)
  }
  for (const artifact of artifacts) if (artifact.previous === null) {
    mkdirSync(dirname(artifact.path), { recursive: true })
    writeFileSync(artifact.path, artifact.bytes, { flag: 'wx' })
  }
  return { plan: path, inventory: plan.inventory, batch: plan.batch,
    assignments: plan.assignments.map(a => ({ agent: a.agent, regions: a.regions.map(r => ({ pathPrefix: r.pathPrefix, unreadFiles: r.unreadFileCount })) })) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [run, ...extra] = process.argv.slice(2)
    if (!run || extra.length) throw new Error('Usage: plan-repository-coverage.mjs RUN')
    console.log(json(prepareCoverageRouting(run)))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
