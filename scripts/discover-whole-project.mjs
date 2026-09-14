#!/usr/bin/env node
/** Combined graph investigation with all-node coverage and source refinement. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { hash, parseResponse, graphShape, investigationCoverage } from './lib/capability-graph.mjs'
import { sourceReader, retrieveGraphEvidence } from './lib/capability-graph-evidence.mjs'
import { wholeAgenda, deepeningAgenda, wholeRequest, validateWholeDecision } from './lib/whole-project.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => {
  const body = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(path)) { if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing overwrite ${path}`); return }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { flag: 'wx' })
}
async function main() {
  const args = process.argv.slice(2), opts = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--in', '--repo', '--out', '--priority', '--rounds', '--replay-from', '--protocol', '--source-prefix'].includes(args[i]) || !args[i + 1]) throw new Error('invalid argument')
    opts[args[i].slice(2)] = args[i + 1]
  }
  for (const key of ['in', 'repo', 'out', 'priority']) if (!opts[key]) throw new Error(`missing ${key}`)
  const outputDir = resolve(opts.out), baseline = read(opts.in), rounds = Number(opts.rounds ?? 14)
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('round limit must be 1–20')
  execFileSync('git', ['check-ignore', '-q', `${outputDir}/output.json`])
  const priorityIds = opts.priority.split(',')
  if (new Set(priorityIds).size !== priorityIds.length || priorityIds.some((id) => !baseline.graph.nodes.some((n) => n.id === id))) throw new Error('invalid priority IDs')
  const readings = baseline.readingRegistry, source = sourceReader(resolve(opts.repo), baseline.headSha, readings, { allowParents: true })
  const planner = 'google/gemini-2.5-flash-lite', model = DEFAULT_MODEL
  const protocol = opts.protocol ?? 'whole-project-v1', focused = protocol === 'whole-project-v2'
  if (!['whole-project-v1', 'whole-project-v2'].includes(protocol)) throw new Error('invalid protocol')
  const extending = Boolean(opts['source-prefix'])
  if (extending && (!focused || !Array.isArray(baseline.history) || !baseline.protocol?.priorityIds)) throw new Error('deepening requires a whole-project-v2 baseline')
  if (extending && !source.paths.some((p) => p.startsWith(opts['source-prefix'] + '/'))) throw new Error('source prefix absent at pinned head')
  const manifest = { protocol, baselineSha256: hash(baseline), priorityIds,
    priorityMeaning: 'Coverage priority only, no requested parent names or membership; all baseline nodes are queued.',
    model, planner, rounds, evidenceByteLimit: 46000, sourceWindowsPerRound: 8, semanticDepthLimit: null,
    ...(extending ? { sourcePrefix: opts['source-prefix'], inheritedRounds: baseline.history.length } : {}) }
  write(`${outputDir}/manifest.json`, manifest)
  const stages = extending ? structuredClone(baseline.stages) : [], history = extending ? structuredClone(baseline.history) : [], registry = new Map(baseline.evidence.map((e) => [e.id, e]))
  const roundOffset = history.length
  let graph = structuredClone(baseline.graph)
  async function stage(round, phase, request, validator = (v) => v) {
    const prefix = resolve(opts['replay-from'] ?? outputDir), stem = `${prefix}/round-${round}.${phase}`
    const chars = request.messages.reduce((n, m) => n + m.content.length, 0)
    if (chars > 190000) throw new Error(`prompt preflight ${chars} exceeds 190000`)
    let payload
    if (existsSync(`${stem}.response.json`)) {
      if (!existsSync(`${stem}.request.json`) || hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact replay request mismatch')
      payload = read(`${stem}.response.json`)
    } else {
      if (opts['replay-from']) throw new Error(`missing replay stage ${stem}`)
      if (!process.env[API_KEY_ENV]) throw new Error('provider key missing')
      write(`${stem}.request.json`, request)
      process.stderr.write(`round ${round} ${phase}: ${chars} prompt characters\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(`${stem}.response.json`, payload)
    }
    const receipt = { round, phase, requestSha256: hash(request), usage: payload.usage ?? {}, model: payload.model }
    stages.push(receipt)
    try { return { raw: validator(parseResponse(payload)), requestSha256: receipt.requestSha256 } } catch (error) {
      receipt.validationError = error.message
      if (phase.endsWith('-repair')) throw error
      const repair = structuredClone(request)
      repair.messages.push({ role: 'user', content: `Previous response rejected: ${error.message}. Return a short complete JSON matching all required fields. For uncertain nodes explicitly defer with unresolved assessments. Cite only supplied evidence. This is the only correction attempt.` })
      return stage(round, `${phase}-repair`, repair, validator)
    }
  }
  const validPlan = (plan) => {
    if (!Array.isArray(plan.readingIds) || !Array.isArray(plan.searches) || !Array.isArray(plan.sources)) throw new Error('readingIds, searches, sources arrays required')
    return plan
  }
  for (let step = 1; step <= rounds; step++) {
    const round = roundOffset + step
    const agenda = extending ? deepeningAgenda(graph, history, priorityIds, step, rounds) : wholeAgenda(graph, history, priorityIds)
    if (!extending && focused && history.length === 1) {
      const weak = history[0].result.assessments.filter((a) => priorityIds.includes(a.nodeId) && a.status !== 'supported').map((a) => a.nodeId)
      if (weak.length) { agenda.requiredNodeIds = weak.slice(0, 4); agenda.mode = 'data-followup' }
    }
    if (agenda.complete && !extending) break
    const common = { graph, requiredNodeIds: agenda.requiredNodeIds, mode: agenda.mode,
      remainingRounds: rounds - step, unreviewedNodeIds: agenda.pending,
      priorUnresolved: history.at(-1)?.result.unresolved ?? [],
      priorAssessments: history.at(-1)?.result.assessments ?? [],
      ...(extending ? { investigationPurpose: 'Discover important responsibilities missing from broad summaries by following executable entry points and their data producers/consumers. Bookkeeping models alone do not explain loading. Do not merely reconfirm baseline citations. Prefer substantive children under existing broad capabilities when supported, without inventing a target hierarchy.' } : {}) }
    // Keep the planner focused on the queued area; the full graph remains available to decisions.
    const plannerContext = focused ? {
      focusNodes: graph.nodes.filter((n) => agenda.requiredNodeIds.includes(n.id)),
      requiredNodeIds: agenda.requiredNodeIds, mode: agenda.mode,
      instruction: 'Investigate THESE focusNodes. The project catalog is navigation only, not a request to investigate its first entry. For reconciliation, choose consequential unresolved structure across the full catalog.',
      priorUnresolved: common.priorUnresolved, priorAssessments: common.priorAssessments,
      projectCatalog: graph.nodes.map(({ id, name, summary }) => ({ id, name, summary })),
      ...(extending ? { investigationPurpose: common.investigationPurpose, prioritySourcePaths: source.paths.filter((p) => p.startsWith(opts['source-prefix'] + '/')) } : {}),
    } : common
    const plan = await stage(round, 'plan', wholeRequest('plan', { ...plannerContext,
      readingCatalog: readings.map((r) => [r.id, r.subject]),
      priorSearchResults: history.at(-1)?.retrieval.searchResults ?? [] }, planner), validPlan)
    const readingIds = new Set(readings.map((r) => r.id))
    const anchors = agenda.requiredNodeIds.flatMap((id) => {
      const refs = graph.nodes.find((n) => n.id === id).evidenceIds.filter((id) => readingIds.has(id))
      return refs.length ? [refs.find((ref) => plan.raw.readingIds.includes(ref)) ?? refs[0]] : []
    })
    const initial = retrieveGraphEvidence({ ...plan.raw, readingIds: [...new Set([...anchors, ...plan.raw.readingIds])], sources: [] }, readings, source)
    const historicalCatalog = [], catalogOmissions = []
    for (const reading of initial.evidence) {
      const changed = new Set(source.changedPaths(reading.id))
      for (const revision of [reading.id, `${reading.id}^`]) {
        try { const c = source.catalog(revision), paths = c.paths.filter((p) => changed.has(p)); historicalCatalog.push({ revision, commitSha: c.commitSha, paths: paths.slice(0, 70), omittedPaths: Math.max(0, paths.length - 70) }) }
        catch (error) { catalogOmissions.push({ revision, reason: error.message }) }
      }
    }
    const currentAnchors = agenda.requiredNodeIds.flatMap((id) => graph.nodes.find((n) => n.id === id).evidenceIds
      .map((ref) => registry.get(ref)).filter((e) => e?.kind === 'source' && e.commitSha === baseline.headSha)
      .slice(0, 1).map((e) => ({ revision: 'head', path: e.path, startLine: e.startLine })))
    const sourcePlan = await stage(round, 'sources', wholeRequest('sources', { ...plannerContext,
      retrievedEvidence: initial.evidence, historicalCatalog, catalogOmissions, headPaths: source.paths,
      currentAnchors, priorOmissions: history.at(-1)?.retrieval.omitted ?? [] }, planner), validPlan)
    const requested = [...sourcePlan.raw.sources, ...currentAnchors].map((s) => s.revision === 'HEAD' ? { ...s, revision: 'head' } : s)
    // Current fallback anchors cannot be crowded out by a long historical request list.
    const ordered = [...(extending ? requested.filter((s) => s.revision === 'head' && s.path.startsWith(opts['source-prefix'] + '/')).slice(0, 6) : []), ...(focused ? currentAnchors : []), ...requested.filter((s) => s.revision === 'head').slice(0, focused ? Math.max(0, 4 - currentAnchors.length) : 4),
      ...requested.filter((s) => s.revision !== 'head').slice(0, 2), ...requested]
    const uniqueRequests = [...new Map(ordered.map((s) => [JSON.stringify([s.revision, s.path, s.startLine ?? 1]), s])).values()]
    const retrieval = retrieveGraphEvidence({ readingIds: initial.evidence.map((e) => e.id), searches: [], sources: uniqueRequests }, readings, source, { maxSources: 8, maxBytes: 46000 })
    retrieval.searchResults = initial.searchResults
    for (const e of retrieval.evidence) registry.set(e.id, e)
    const request = wholeRequest('decision', { ...common, retrievedEvidence: retrieval.evidence, omitted: retrieval.omitted }, model)
    const before = graph
    const decision = await stage(round, 'decision', request, (raw) => { validateWholeDecision(raw, before, retrieval.evidence, agenda.requiredNodeIds, round); return raw })
    const result = validateWholeDecision(decision.raw, before, retrieval.evidence, agenda.requiredNodeIds, round)
    graph = result.graph
    const entry = { round, investigationMode: agenda.mode, requiredNodeIds: agenda.requiredNodeIds, plan, sourcePlan, historicalCatalog, catalogOmissions, retrieval, decision, result }
    history.push(entry); write(`${outputDir}/round-${round}.json`, entry)
    const coverage = investigationCoverage(graph, history)
    process.stderr.write(`round ${round}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, depth ${result.shape.maxDepth}, ${coverage.pending.length} pending, ${coverage.reconciliationRounds} reconciliations\n`)
  }
  const coverage = investigationCoverage(graph, history)
  const usage = { cost: stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((sum, s) => sum + s.usage.cost, 0) : null }
  const output = { schemaVersion: '0.1.0', method: 'whole-project-investigation', protocol: manifest,
    repository: baseline.repository, headSha: baseline.headSha, interpretationStatus: 'candidate',
    baselineSha256: hash(baseline), initialShape: graphShape(baseline.graph), graph, shape: graphShape(graph),
    coverage, unreviewedNodeIds: coverage.pending, stopReason: coverage.complete ? 'coverage-and-reconciliation-complete' : 'round-budget',
    readingRegistry: readings, evidence: [...registry.values()], history, stages, usage }
  write(`${outputDir}/output.json`, output)
  process.stdout.write(JSON.stringify({ outputDir, shape: output.shape, coverage, usage }) + '\n')
}
try { await main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
