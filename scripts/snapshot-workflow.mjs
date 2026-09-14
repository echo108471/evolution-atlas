#!/usr/bin/env node
// Artifact-based orchestration. Model dispatch/liveness belongs to the host, never a stale file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { sha, readJson, broker } from './vscode-snapshot-evidence.mjs'
import { unseenInventory, prefixBaseline } from './vscode-expansion.mjs'
import { graphIssues, intervalCoverage, render } from './report-vscode-discovery.mjs'
import { integrationIssues, changeSummary, renderExpansion } from './report-vscode-expansion.mjs'

const json = x => JSON.stringify(x, null, 2) + '\n'
const bytesHash = path => sha(readFileSync(path, 'utf8'))
const codeFiles = ['snapshot-workflow.mjs', 'vscode-snapshot-evidence.mjs', 'vscode-expansion.mjs', 'report-vscode-discovery.mjs', 'report-vscode-expansion.mjs']
const engines = () => Object.fromEntries(codeFiles.map(p => [p, bytesHash(new URL(p, import.meta.url))]))
const integrationInstruction = 'Integrate once using the frozen protocol. Prior review labels and owner feedback are withheld. All semantic choices remain yours; preserve meaningful detail and explicit lineage. Additional retrieval uses agent R and the full inventory through the workflow broker.'
function sourceIssue(r, inventory, manifest) {
  const f = inventory.files.find(f => f.path === r.path)
  if (!f || r.blobSha !== f.blobSha || r.commitSha !== manifest.commitSha || !Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine || typeof r.text !== 'string') return 'source identity/range mismatch: ' + r.id
  const lines = execFileSync('git', ['--git-dir=' + manifest.repo, 'cat-file', 'blob', r.blobSha], { encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 }).split('\n')
  if (r.totalLines !== lines.length || r.endLine > lines.length || lines.slice(r.startLine - 1, r.endLine).join('\n') !== r.text) return 'source bytes/range mismatch: ' + r.id
  return null
}
export function writeExact(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) throw new Error('refusing changed artifact: ' + path)
    return 'verified-existing'
  }
  writeFileSync(path, content, { flag: 'wx' }); return 'created'
}
function ignoredOutput(out) {
  if (resolve(out) === resolve('.')) throw new Error('run directory must not be workspace root')
  execFileSync('git', ['check-ignore', '-q', resolve(out, 'manifest.json')])
}
function sourceRecords(paths) {
  return Object.fromEntries(Object.entries(paths).filter(([, path]) => path).map(([key, path]) => [key, { path: resolve(path), sha256: bytesHash(resolve(path)) }]))
}
function verifySources(records) {
  for (const r of Object.values(records)) if (bytesHash(r.path) !== r.sha256) throw new Error('frozen source changed: ' + r.path)
}
export function prepareWorkflow(out, config) {
  out = resolve(out); ignoredOutput(out)
  if (!['discovery', 'expansion'].includes(config.mode)) throw new Error('mode must be discovery or expansion')
  if (config.mode === 'discovery' && config.baseline) throw new Error('blind initial discovery must not include a baseline')
  const paths = { inventory: config.inventory, manifest: config.manifest, protocol: config.protocol, ...(config.baseline ? { baseline: config.baseline } : {}) }
  if (config.mode === 'expansion' && !config.baseline) throw new Error('expansion requires a baseline')
  const records = sourceRecords(paths), inv = readJson(records.inventory.path), parent = readJson(records.manifest.path)
  if (inv.commitSha !== parent.commitSha || sha(inv) !== parent.inventorySha256) throw new Error('source inventory identity mismatch')
  if (parent.brokerSha256 !== engines()['vscode-snapshot-evidence.mjs']) throw new Error('frozen broker changed')
  const source = config.baseline ? readJson(records.baseline.path) : null
  if (source && (!source.graph || !Array.isArray(source.receipts))) throw new Error('baseline graph and receipts required')
  if (source && source.receipts.some(r => r.commitSha !== inv.commitSha)) throw new Error('baseline snapshot mismatch')
  if (source && graphIssues(source.graph, source.receipts).length) throw new Error('invalid baseline graph')
  if (source) {
    if (new Set(source.receipts.map(r => r.id)).size !== source.receipts.length) throw new Error('duplicate baseline receipt IDs')
    for (const r of source.receipts.filter(r => r.kind === 'source')) {
      const issue = sourceIssue(r, inv, parent); if (issue) throw new Error('baseline ' + issue)
    }
  }
  const expected = { version: 'snapshot-workflow-v1', mode: config.mode, sources: records, engines: engines(),
    out, baselineGraphSha256: source ? sha(source.graph) : null }
  // The plan is written first, so partial preparation reuses the original timestamp.
  const planPath = out + '/run-plan.json'
  const plan = existsSync(planPath) ? readJson(planPath) : { ...expected, frozenAt: new Date().toISOString() }
  if (!isDeepStrictEqual({ ...plan, frozenAt: undefined }, { ...expected, frozenAt: undefined })) throw new Error('run plan differs; use a new run directory')
  writeExact(planPath, json(plan))
  const inventory = source ? unseenInventory(inv, source.receipts) : inv
  if (source) inventory.omitted = inventory.omitted.map(f => f.reason.startsWith('previously inspected') ? { ...f, reason: 'previously inspected in frozen cumulative baseline; excluded from discovery' } : f)
  const partitions = source ? ['A', 'B', 'C'] : parent.partitions
  if (!Array.isArray(partitions) || !partitions.length || partitions.some(a => !/^[A-F]$/.test(a)) || new Set(partitions).size !== partitions.length) throw new Error('invalid assignments')
  const protocolText = readFileSync(records.protocol.path, 'utf8')
  const manifest = { ...parent, protocol: source ? 'snapshot-resumable-expansion-v1' : 'snapshot-resumable-discovery-v1',
    frozenAt: plan.frozenAt, partitions, inventorySha256: sha(inventory), instructionSha256: sha(protocolText),
    budgets: { perAgent: { windows: 20, searches: 8, evidenceBytes: 72000, linesPerWindow: 160, bytesPerWindow: 16000 },
      reconciler: { windows: source ? 16 : 12, searches: 4, evidenceBytes: source ? 64000 : 48000, linesPerWindow: 160, bytesPerWindow: 16000 } },
    initialization: 'Fresh discovery; no previous map, findings or owner labels. Cumulative inspected files excluded in expansion.',
    statusPolicy: 'Candidate map, proposer support and fresh review remain separate; runtime verification not performed.' }
  writeExact(out + '/protocol.md', protocolText)
  writeExact(out + '/inventory.json', json(inventory))
  writeExact(out + '/manifest.json', json(manifest))
  writeExact(out + '/reconciliation-evidence/inventory.json', json(inv))
  writeExact(out + '/reconciliation-evidence/manifest.json', json({ ...manifest, inventorySha256: sha(inv) }))
  if (source) writeExact(out + '/baseline-input.json', json(prefixBaseline({ nodes: source.graph.nodes, edges: source.graph.edges }, source.receipts)))
  for (const agent of partitions) writeExact(out + '/tasks/' + agent + '.json', json({ agent, runDirectory: out, protocol: out + '/protocol.md',
    stage: 'blind-discovery', output: out + '/proposals/' + agent + '.json',
    permittedInputs: ['protocol.md', 'manifest.json', 'inventory.json', 'receipts/' + agent + '/'],
    withheld: ['baseline-input.json', 'reconciliation-evidence/', 'other agents outputs', 'previous maps and owner feedback'],
    instruction: 'One fresh-context agent. Read required workspace guidance, then protocol and this assignment only. All broker calls sequential through snapshot-workflow.mjs broker. Save the first complete proposal once with apply_patch. Do not overwrite an existing proposal or launch recursive agents. Saved raw output is not acceptance.' }))
  return { mode: plan.mode, assignments: partitions, eligibleFiles: inventory.eligibleFiles, excludedFiles: inv.files.length - inventory.files.length }
}
export function loadWorkflow(out) {
  const plan = readJson(out + '/run-plan.json'); verifySources(plan.sources)
  if (plan.out !== resolve(out) || !isDeepStrictEqual(plan.engines, engines())) throw new Error('run location or frozen engine changed')
  const manifest = readJson(out + '/manifest.json'), inventory = readJson(out + '/inventory.json'), full = readJson(plan.sources.inventory.path)
  for (const p of ['protocol.md', 'reconciliation-evidence/inventory.json', 'reconciliation-evidence/manifest.json', ...manifest.partitions.map(a => 'tasks/' + a + '.json'), ...(plan.mode === 'expansion' ? ['baseline-input.json'] : [])]) {
    if (!existsSync(out + '/' + p)) throw new Error('incomplete preparation; rerun prepare: ' + p)
  }
  if (sha(inventory) !== manifest.inventorySha256 || bytesHash(out + '/protocol.md') !== manifest.instructionSha256) throw new Error('frozen input changed')
  // Reconstruct setup to reject manifest/budget/task edits, not just inventory drift.
  prepareWorkflow(out, { mode: plan.mode, ...Object.fromEntries(Object.entries(plan.sources).map(([k, v]) => [k, v.path])) })
  return { plan, manifest, inventory, full, baseline: plan.mode === 'expansion' ? readJson(out + '/baseline-input.json') : { graph: { nodes: [], edges: [] }, receipts: [] } }
}
function receiptFiles(out, agent) {
  const root = agent === 'R' ? out + '/reconciliation-evidence' : out, dir = root + '/receipts/' + agent
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => dir + '/' + f) : []
}
function readProposal(path) {
  try { return { value: readJson(path), issues: [] } } catch (e) { return { value: null, issues: ['invalid JSON: ' + e.message] } }
}
function jobReceipts(out, agent, context) {
  const files = receiptFiles(out, agent), receipts = [], issues = [], budget = agent === 'R' ? context.manifest.budgets.reconciler : context.manifest.budgets.perAgent
  const eligible = new Map((agent === 'R' ? context.full : context.inventory).files.map(f => [f.path, f]))
  for (const [index, file] of files.entries()) {
    const r = readJson(file), expected = agent + '-' + String(index + 1).padStart(3, '0'); receipts.push(r)
    if (r.id !== expected || !file.endsWith('/' + expected + '.json') || r.commitSha !== context.manifest.commitSha) issues.push('receipt identity/order mismatch: ' + file)
    if (r.kind === 'source') {
      const f = eligible.get(r.path)
      if (!f || f.blobSha !== r.blobSha || !Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine || r.endLine - r.startLine + 1 > budget.linesPerWindow || Buffer.byteLength(r.text) > budget.bytesPerWindow) { issues.push('invalid source: ' + r.id); continue }
      const lines = execFileSync('git', ['--git-dir=' + context.manifest.repo, 'cat-file', 'blob', r.blobSha], { encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 }).split('\n')
      if (lines.length !== r.totalLines || r.endLine > lines.length || lines.slice(r.startLine - 1, r.endLine).join('\n') !== r.text) issues.push('source bytes/range mismatch: ' + r.id)
    } else if (r.kind !== 'search') issues.push('unknown receipt kind: ' + r.id)
  }
  if (receipts.filter(r => r.kind === 'source').length > budget.windows || receipts.filter(r => r.kind === 'search').length > budget.searches || receipts.reduce((s, r) => s + Buffer.byteLength(JSON.stringify(r)), 0) > budget.evidenceBytes) issues.push('retrieval budget exceeded: ' + agent)
  return { receipts, issues, fingerprints: Object.fromEntries(files.map(f => [f.slice(out.length + 1), bytesHash(f)])) }
}
function attempts(out, agent) {
  const dir = out + '/attempts/' + agent
  return existsSync(dir) ? readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort().map(f => readJson(dir + '/' + f)) : []
}
export function inspectWorkflow(out) {
  out = resolve(out); const context = loadWorkflow(out), jobs = [], receipts = [], fingerprints = {}, issues = []
  if (existsSync(out + '/proposals')) for (const p of readdirSync(out + '/proposals').filter(p => p.endsWith('.json'))) {
    if (!context.manifest.partitions.some(a => p === a + '.json')) issues.push('unexpected proposal: ' + p)
  }
  for (const agent of [...context.manifest.partitions, 'R']) {
    const r = jobReceipts(out, agent, context); receipts.push(...r.receipts); Object.assign(fingerprints, r.fingerprints); issues.push(...r.issues)
    const path = agent === 'R' ? out + '/reconciled.json' : out + '/proposals/' + agent + '.json'
    const past = attempts(out, agent), last = past.at(-1), completion = out + '/completed/' + agent + '.json'
    const parsed = existsSync(path) ? readProposal(path) : null
    let validation = parsed?.issues ?? [], value = parsed?.value
    if (parsed && (!value || typeof value !== 'object' || Array.isArray(value))) validation.push('response object required')
    if (value && agent !== 'R') {
      try { validation = [...validation, ...graphIssues(value, r.receipts).map(x => x.message)] } catch (e) { validation.push('malformed proposal: ' + e.message) }
      if (value.agent !== agent) validation.push('assignment identity mismatch')
      if (Array.isArray(value.nodes) && value.nodes.some(n => typeof n.id !== 'string' || !new RegExp('^' + agent + '[A-Za-z0-9_-]+$').test(n.id))) validation.push('node IDs must use the assigned namespace')
      if (!value.scopeSummary || !value.coverage || !Array.isArray(value.crossPartitionLeads)) validation.push('coverage/scope metadata missing')
    }
    const receiptPins = r.fingerprints
    if (existsSync(completion)) {
      const saved = readJson(completion)
      if (!parsed || saved.outputSha256 !== bytesHash(path) || !isDeepStrictEqual(saved.receipts, receiptPins)) issues.push('completed job changed: ' + agent)
    }
    const terminal = last && existsSync(out + '/attempts/' + agent + '/' + last.sequence + '.terminal.json')
    const state = parsed ? (validation.length ? 'saved-invalid' : existsSync(completion) ? 'checkpointed' : 'saved-uncheckpointed')
      : last && !terminal ? 'runtime-check-required' : last ? 'retry-needs-explicit-dispatch' : agent === 'R' && !existsSync(out + '/reconciliation-input.json') ? 'waiting-for-discovery' : r.receipts.length ? 'partial-evidence-needs-explicit-resume' : 'ready-to-dispatch'
    jobs.push({ agent, state, handle: last?.handle ?? null, value, validation, path, receiptPins })
    if (parsed) fingerprints[path.slice(out.length + 1)] = bytesHash(path)
  }
  const proposals = jobs.filter(j => j.agent !== 'R' && j.value).map(j => j.value), graph = jobs.find(j => j.agent === 'R').value
  const originalIds = [...context.baseline.graph.nodes, ...proposals.flatMap(p => Array.isArray(p.nodes) ? p.nodes : [])].map(n => n.id)
  if (new Set(originalIds).size !== originalIds.length) issues.push('colliding baseline/discovery node IDs')
  const allReceipts = [...context.baseline.receipts, ...receipts]
  if (graph) {
    const job = jobs.find(j => j.agent === 'R')
    try { job.validation.push(...(context.plan.mode === 'expansion' ? integrationIssues(graph, context.baseline.graph, proposals, allReceipts) : graphIssues(graph, allReceipts, proposals.flatMap(p => p.nodes.map(n => n.id)))).map(x => x.message)) }
    catch (e) { job.validation.push('malformed reconciliation: ' + e.message) }
    if (job.validation.length) job.state = 'saved-invalid'
  }
  if (existsSync(out + '/reconciliation-input.json')) {
    const packet = readJson(out + '/reconciliation-input.json')
    const current = Object.fromEntries(Object.entries(fingerprints).filter(([p]) => !p.startsWith('reconciliation-evidence/') && p !== 'reconciled.json'))
    if (!isDeepStrictEqual(packet.inputFingerprints, current)) issues.push('integration discovery input set changed')
    if (packet.graphSha256 !== sha(context.baseline.graph)) issues.push('integration baseline changed')
    if (!isDeepStrictEqual(packet.baseline, context.baseline) || !isDeepStrictEqual(packet.proposals, proposals) || !isDeepStrictEqual(packet.receipts, allReceipts.filter(r => !r.id.startsWith('R-')))) issues.push('integration packet content changed')
    if (!isDeepStrictEqual(packet, packetValue(context, proposals, allReceipts, current))) issues.push('integration packet envelope changed')
    if (existsSync(out + '/tasks/R.json') && !isDeepStrictEqual(readJson(out + '/tasks/R.json'), integrationTask(out, packet))) issues.push('integration task changed')
  }
  return { context, jobs, receipts: allReceipts, proposals, graph, fingerprints, issues,
    complete: jobs.every(j => j.state === 'checkpointed' && !j.validation.length) && !issues.length && existsSync(out + '/tasks/R.json'),
    liveness: 'Unknown from artifacts. Check recorded handles with host tools before any retry.' }
}
export function checkpointJob(out, agent) {
  out = resolve(out); const state = inspectWorkflow(out), job = state.jobs.find(j => j.agent === agent)
  if (!job || !job.value || job.validation.length || state.issues.length) throw new Error('valid saved output and provenance required')
  if (agent === 'R' && state.jobs.some(j => j.agent !== 'R' && j.state !== 'checkpointed')) throw new Error('discovery checkpoints required')
  if (agent === 'R' && !existsSync(out + '/reconciliation-input.json')) throw new Error('frozen integration packet required')
  if (agent === 'R' && !existsSync(out + '/tasks/R.json')) throw new Error('frozen integration task required')
  return writeExact(out + '/completed/' + agent + '.json', json({ agent, outputSha256: bytesHash(job.path), receipts: job.receiptPins }))
}
export function recordLaunch(out, agent, handle) {
  out = resolve(out); if (typeof handle !== 'string' || !handle.trim()) throw new Error('host handle required')
  const state = inspectWorkflow(out), job = state.jobs.find(j => j.agent === agent)
  if (agent === 'R' && !existsSync(out + '/tasks/R.json')) throw new Error('integration task missing; rerun packet')
  if (!job || state.issues.length || !['ready-to-dispatch', 'retry-needs-explicit-dispatch', 'partial-evidence-needs-explicit-resume'].includes(job.state)) throw new Error('job cannot be dispatched; inspect saved output or host handle')
  const sequence = String(attempts(out, agent).length + 1).padStart(3, '0')
  return writeExact(out + '/attempts/' + agent + '/' + sequence + '.json', json({ sequence, handle, recordedAt: new Date().toISOString(), runtimeStatus: 'not-inferred' }))
}
export function recordTerminal(out, agent, handle, observation) {
  out = resolve(out); loadWorkflow(out)
  const last = attempts(out, agent).at(-1)
  if (!last || last.handle !== handle || !['completed', 'failed', 'interrupted', 'missing'].includes(observation)) throw new Error('matching handle and authoritative terminal observation required')
  return writeExact(out + '/attempts/' + agent + '/' + last.sequence + '.terminal.json', json({ handle, observation, source: 'explicit host-tool observation supplied by orchestrator' }))
}
export function integrationPacket(out) {
  out = resolve(out); const s = inspectWorkflow(out)
  if (s.issues.length || s.jobs.some(j => j.agent !== 'R' && j.state !== 'checkpointed')) throw new Error('clean checkpointed discovery required')
  const pins = Object.fromEntries(Object.entries(s.fingerprints).filter(([p]) => !p.startsWith('reconciliation-evidence/') && p !== 'reconciled.json'))
  const packet = packetValue(s.context, s.proposals, s.receipts, pins)
  writeExact(out + '/reconciliation-input.json', json(packet))
  writeExact(out + '/tasks/R.json', json(integrationTask(out, packet)))
  return { nodes: packet.baseline.graph.nodes.length + packet.proposals.reduce((n, p) => n + p.nodes.length, 0), receipts: packet.receipts.length }
}
function packetValue(context, proposals, receipts, pins) {
  return { mode: context.plan.mode, graphSha256: sha(context.baseline.graph), inputFingerprints: pins,
    baseline: context.baseline, proposals, receipts: receipts.filter(r => !r.id.startsWith('R-')), instruction: integrationInstruction }
}
function integrationTask(out, packet) {
  return { agent: 'R', stage: 'integration', runDirectory: out, protocol: out + '/protocol.md',
    input: out + '/reconciliation-input.json', inputSha256: sha(packet), output: out + '/reconciled.json', instruction: packet.instruction }
}
export function workflowBroker(out, agent, action, args) {
  out = resolve(out); const c = loadWorkflow(out)
  if (![...c.manifest.partitions, 'R'].includes(agent)) throw new Error('unknown assignment')
  if (existsSync(out + '/completed/' + agent + '.json') || existsSync(agent === 'R' ? out + '/reconciled.json' : out + '/proposals/' + agent + '.json')) throw new Error('job output already saved; evidence is frozen')
  if (agent === 'R' && !existsSync(out + '/reconciliation-input.json')) throw new Error('integration packet required')
  if (agent === 'R') {
    const s = inspectWorkflow(out)
    if (s.issues.length || !existsSync(out + '/tasks/R.json')) throw new Error('valid frozen integration task required')
  }
  // Exclusive per-assignment lock serializes the unchanged broker's budget and receipt numbering.
  const lock = out + '/broker-' + agent + '.lock'; writeFileSync(lock, String(process.pid), { flag: 'wx' })
  try {
    const existing = jobReceipts(out, agent, c)
    if (existing.issues.length) throw new Error('invalid prior receipts: ' + existing.issues.join('; '))
    return broker(agent === 'R' ? out + '/reconciliation-evidence' : out, agent, action, args)
  } finally { unlinkSync(lock) }
}
export function workflowOutput(out) {
  const s = inspectWorkflow(resolve(out)); if (!s.complete) throw new Error('complete valid checkpoints required')
  const { manifest, inventory, full, baseline, plan } = s.context
  const fresh = s.receipts.filter(r => !r.id.startsWith('old:')), discovery = fresh.filter(r => !r.id.startsWith('R-'))
  return { protocol: manifest.protocol, manifest, status: 'candidate-map-produced', completeAssignments: true,
    graph: s.graph, baselineGraph: baseline.graph, proposals: s.proposals, receipts: s.receipts,
    proposalIssues: [], graphIssues: [], provenanceIssues: [], inputFingerprints: s.fingerprints,
    independentVerification: 'not-performed', interpretationStatus: 'candidate', externalModelApiCalls: 0,
    subscriptionUsage: 'shared allowance; no per-agent cost receipt', amendments: [], limitations: manifest.limitations,
    priorMapUnchanged: true, baselineUnchanged: true, runtimeVerified: false, automaticPromotion: false,
    coverage: { ...intervalCoverage(s.receipts), eligibleFiles: full.eligibleFiles, allTrackedEntries: full.allTrackedEntries,
      baseline: intervalCoverage(baseline.receipts), discovery: intervalCoverage(discovery),
      assignments: manifest.partitions.map(a => ({ agent: a, eligibleFiles: inventory.files.filter(f => f.partition === a).length, ...intervalCoverage(discovery.filter(r => r.id.startsWith(a + '-'))) })) },
    changes: plan.mode === 'expansion' ? changeSummary(s.graph, baseline.graph, s.proposals) : null }
}
export function freezeWorkflow(out) {
  out = resolve(out); const output = workflowOutput(out)
  const html = (output.changes ? renderExpansion(output) : render(output))
    .replaceAll('What changed from the first map', 'What changed from the frozen baseline')
    .replaceAll('VS Code: discovery beyond the first map', 'VS Code: resumable discovery and integration')
    .replace('href="../vscode-discovery-1/index.html#map">Explore the unchanged first map', 'href="baseline-input.json">Inspect the frozen baseline')
  return { output: writeExact(out + '/output.json', json(output)), report: writeExact(out + '/index.html', html) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, out, ...args] = process.argv.slice(2)
  try {
    let result
    if (mode === 'prepare') result = prepareWorkflow(out, readJson(args[0]))
    else if (mode === 'broker') result = workflowBroker(out, args[0], args[1], args.slice(2))
    else if (mode === 'checkpoint') result = checkpointJob(out, args[0])
    else if (mode === 'launch') result = recordLaunch(out, args[0], args[1])
    else if (mode === 'terminal') result = recordTerminal(out, args[0], args[1], args[2])
    else if (mode === 'packet') result = integrationPacket(out)
    else if (mode === 'freeze') result = freezeWorkflow(out)
    else if (mode === 'status') { const s = inspectWorkflow(out); result = { complete: s.complete, liveness: s.liveness, issues: s.issues, jobs: s.jobs.map(({ agent, state, handle, validation }) => ({ agent, state, handle, validation })) } }
    else throw new Error('unknown workflow action')
    console.log(JSON.stringify(result, null, 2))
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
