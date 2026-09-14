#!/usr/bin/env node
/** Independent bounded cases, historical retrieval, saved paid responses and exact replay. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { sourceReader, retrieveGraphEvidence } from './lib/capability-graph-evidence.mjs'
import { selectCases, comparisonRequest, validateComparison } from './lib/capability-alternatives.mjs'
import { structureRequest, validateStructureComparison, retrieveContrastEvidence, validateAudit } from './lib/capability-structures.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, data) => {
  const body = JSON.stringify(data, null, 2) + '\n'
  if (existsSync(path)) { if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing overwrite: ${path}`); return }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { flag: 'wx' })
}
async function main() {
  const args = process.argv.slice(2), opts = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--in', '--repo', '--out', '--replay-from', '--reuse-from', '--annotated', '--planner-model', '--model', '--protocol'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments')
    opts[args[i].slice(2)] = args[i + 1]
  }
  for (const key of ['in', 'repo', 'out', 'annotated']) if (!opts[key]) throw new Error(`missing --${key}`)
  const outputDir = resolve(opts.out)
  execFileSync('git', ['check-ignore', '-q', `${outputDir}/output.json`])
  const baseline = read(opts.in), baselineSha256 = hash(baseline)
  const cases = selectCases(baseline.graph, opts.annotated.split(','))
  const source = sourceReader(resolve(opts.repo), baseline.headSha, baseline.readingRegistry, { allowParents: true })
  const planner = opts['planner-model'] ?? 'google/gemini-2.5-flash-lite', model = opts.model ?? DEFAULT_MODEL
  const protocol = opts.protocol ?? 'alternatives-history-v1'
  if (!['alternatives-history-v1', 'structures-v2', 'structures-v2.1'].includes(protocol)) throw new Error('unknown protocol')
  const structured = protocol.startsWith('structures-'), buildRequest = structured ? structureRequest : comparisonRequest
  const config = { protocol, baselineSha256, cases, planner, model,
    limits: { cases: cases.length, stagesPerCase: structured ? 4 : 3, maxSourceWindows: 6, maxEvidenceBytes: 24000, maxPromptCharacters: 160000 },
    selection: 'Annotated IDs only; no ratings, notes, suggested labels, or cohort supplied to models. Two remaining IDs ordered by SHA256(ID). Blind means unannotated selection, not an unseen repository.',
    ...(opts['reuse-from'] ? { reuseFrom: resolve(opts['reuse-from']) } : {}) }
  write(`${outputDir}/manifest.json`, config)
  const stages = []
  async function stage(caseId, phase, request, validator = (x) => x) {
    const prefix = resolve(opts['replay-from'] ?? outputDir), name = `${caseId}.${phase}`
    const chars = request.messages.reduce((n, m) => n + m.content.length, 0)
    if (chars > 160000) throw new Error(`prompt too large: ${chars}`)
    const requestPath = `${prefix}/${name}.request.json`, responsePath = `${prefix}/${name}.response.json`
    const reuseRequest = opts['reuse-from'] ? `${resolve(opts['reuse-from'])}/${name}.request.json` : null
    const reuseResponse = opts['reuse-from'] ? `${resolve(opts['reuse-from'])}/${name}.response.json` : null
    const canReuse = reuseRequest && existsSync(reuseRequest) && existsSync(reuseResponse) && hash(read(reuseRequest)) === hash(request)
    let payload
    if (existsSync(responsePath)) {
      if (!existsSync(requestPath) || hash(read(requestPath)) !== hash(request)) throw new Error(`request mismatch: ${name}`)
      payload = read(responsePath)
    } else if (canReuse && !opts['replay-from']) {
      payload = read(reuseResponse)
      write(requestPath, request); write(responsePath, payload)
    } else {
      if (opts['replay-from']) throw new Error(`missing replay: ${name}`)
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(requestPath, request)
      process.stderr.write(`${name}: ${chars} prompt characters\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(responsePath, payload)
    }
    const receipt = { caseId, phase, requestSha256: hash(request), usage: payload.usage ?? {}, providerModel: payload.model,
      ...(opts['reuse-from'] ? { reused: Boolean(canReuse) } : {}) }
    stages.push(receipt)
    try { return validator(parseResponse(payload)) } catch (error) {
      receipt.validationError = error.message
      if (phase.endsWith('-repair')) throw error
      const repair = structuredClone(request)
      repair.messages.push({ role: 'user', content: `Previous response rejected: ${error.message}. Return a short complete JSON object matching the required schema. No repeated items. Use only supplied evidence. This is the only repair attempt.` })
      return stage(caseId, `${phase}-repair`, repair, validator)
    }
  }
  const results = []
  for (const experimentCase of cases) {
    const focus = baseline.graph.nodes.find((n) => n.id === experimentCase.nodeId)
    const graph = { nodes: baseline.graph.nodes.map(({ id, name, summary, evidenceIds }) => ({ id, name, summary, evidenceIds })), edges: baseline.graph.edges }
    const common = { focusNodeId: focus.id, graph }
    const readingPlan = await stage(focus.id, 'readings', buildRequest('readings', { ...common,
      readingCatalog: baseline.readingRegistry.map((r) => [r.id, r.subject]) }, planner), (plan) => {
      if (!Array.isArray(plan.readingIds) || !Array.isArray(plan.searches) || !Array.isArray(plan.sources)) throw new Error('invalid retrieval plan')
      return plan
    })
    const initial = retrieveGraphEvidence({ ...readingPlan, sources: [] }, baseline.readingRegistry, source)
    const historicalCatalog = [], catalogOmissions = []
    for (const reading of initial.evidence) {
      const changed = new Set(source.changedPaths(reading.id))
      for (const revision of [reading.id, `${reading.id}^`]) {
        try {
          const catalog = source.catalog(revision)
          // Changed paths are a bounded index, not a whitelist; head paths remain available too.
          const candidates = catalog.paths.filter((path) => changed.has(path))
          historicalCatalog.push({ revision, commitSha: catalog.commitSha, paths: candidates.slice(0, 70),
            omittedPaths: Math.max(0, candidates.length - 70) })
        } catch (error) { catalogOmissions.push({ revision, reason: error.message }) }
      }
    }
    const anchors = structured ? baseline.evidence.filter((e) => e.kind === 'source' && e.commitSha === baseline.headSha && focus.evidenceIds.includes(e.id))
      .map((e) => ({ revision: 'head', path: e.path, startLine: e.startLine })) : []
    const sourcePlan = await stage(focus.id, 'sources', buildRequest('sources', { ...common,
      retrievedEvidence: initial.evidence, searchResults: initial.searchResults,
      historicalCatalog, catalogOmissions, headPaths: source.paths,
      ...(structured ? { currentAnchors: anchors } : {}) }, planner))
    const retrieval = structured ? retrieveContrastEvidence(sourcePlan, initial.evidence, source, anchors, { normalizeHead: protocol === 'structures-v2.1' }) :
      retrieveGraphEvidence({ readingIds: initial.evidence.map((e) => e.id), searches: [], sources: sourcePlan.sources }, baseline.readingRegistry, source)
    const comparison = await stage(focus.id, 'compare', buildRequest('compare', { ...common,
      retrievedEvidence: retrieval.evidence, omitted: retrieval.omitted,
      ...(structured ? { evidenceGaps: retrieval.gaps } : {}),
      temporalScope: 'Historical source is pinned to the recorded revision. A first-parent snapshot is not itself proof of replacement or introduction.' }, model),
    (value) => structured ? validateStructureComparison(value, retrieval.evidence, graph) : validateComparison(value, retrieval.evidence))
    let audit
    if (structured) {
      const { candidateGraph: _snapshot, ...selectedAlternative } = comparison.alternatives.find((a) => a.id === comparison.selectedId)
      audit = await stage(focus.id, 'audit', buildRequest('audit', { ...common, selectedAlternative,
        links: comparison.links, retrievedEvidence: retrieval.evidence, evidenceGaps: retrieval.gaps,
        omitted: retrieval.omitted }, model), (value) => validateAudit(value, retrieval.evidence))
    }
    const result = { ...experimentCase, name: focus.name, readingPlan, initial, historicalCatalog, catalogOmissions,
      sourcePlan, retrieval, comparison, ...(structured ? { audit } : {}) }
    write(`${outputDir}/${focus.id}.json`, result); results.push(result)
    process.stderr.write(`${focus.id}: selected ${comparison.alternatives.find((a) => a.id === comparison.selectedId).type}; ${retrieval.sourceCount} source windows\n`)
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  const output = { ...config, repository: baseline.repository, headSha: baseline.headSha,
    interpretationStatus: 'candidate', applicationStatus: 'proposal-only', results, stages, cost,
    ...(opts['reuse-from'] ? { newInferenceCost: stages.filter((s) => !s.reused).every((s) => typeof s.usage.cost === 'number') ? stages.filter((s) => !s.reused).reduce((n, s) => n + s.usage.cost, 0) : null } : {}) }
  write(`${outputDir}/output.json`, output)
  process.stdout.write(JSON.stringify({ outputDir, cases: results.length, cost }) + '\n')
}
try { await main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
