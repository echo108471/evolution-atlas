#!/usr/bin/env node
/** Frozen rival set, matched evidence/order comparisons, no automatic repair. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { sourceReader, retrieveGraphEvidence } from './lib/capability-graph-evidence.mjs'
import { umbrellaPacket, umbrellaSeed } from './lib/umbrella-experiment.mjs'
import { scopeCases, scopeRequest, validateScopePlan, judgeContext, validateScopeJudgment } from './lib/umbrella-scopes.mjs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, value) => {
  const body = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(p)) { if (readFileSync(p, 'utf8') !== body) throw new Error(`refusing overwrite ${p}`); return }
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body, { flag: 'wx' })
}
async function main() {
  const opts = {}, args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 2) {
    if (!['--in', '--prior', '--repo', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments')
    opts[args[i].slice(2)] = args[i + 1]
  }
  for (const k of ['in', 'prior', 'repo', 'out']) if (!opts[k]) throw new Error(`missing --${k}`)
  const out = resolve(opts.out), baseline = read(opts.in), prior = read(`${opts.prior}/output.json`)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (prior.manifest.baselineSha256 !== hash(baseline)) throw new Error('prior baseline mismatch')
  const priorRuns = prior.runs.map(({ runId }) => ({ runId, ...read(`${opts.prior}/${runId}/output.json`) }))
  const selection = scopeCases(baseline.graph, priorRuns), graph = umbrellaSeed(baseline.graph, 'linked'), packet = umbrellaPacket(baseline)
  const source = sourceReader(resolve(opts.repo), baseline.headSha, baseline.readingRegistry)
  const manifest = { protocol: 'umbrella-scopes-v1', baselineSha256: hash(baseline), priorSha256: hash(prior),
    priorGraphHashes: priorRuns.map((r) => ({ runId: r.runId, sha256: hash(r.graph) })), model: DEFAULT_MODEL,
    selection, conditions: ['existing-evidence', 'enriched-evidence'], orders: ['forward', 'reverse'],
    selectionRule: 'Connected components of overlapping seed descendants in all prior new-parent proposals. Select two components with most distinct memberships (hash-ID tie break), then the remaining component whose closest existing covering parent has most additional responsibilities.',
    limits: { maxSources: 6, maxReadings: 4, maxRetrievalBytes: 28000, maxPromptCharacters: 190000, costStopBeforeNextRequest: 1.5 },
    design: 'One model proposes 3-5 rivals and discriminating evidence requests per case. Freeze rivals before retrieval. Judge the same rivals with old evidence or old plus newly retrieved evidence, in forward and reverse order. Each judgment is a fresh call; no prior verdict/rationale supplied. No automatic correction or transport retry. Invalid responses are failures, not rewritten decisions. All graphs are proposals only.',
    limitations: 'Selected disagreement neighborhoods, one repository, same model proposes and judges. Order and sampling variability are not isolated with one call per cell. Frozen labels and containment limit possible revisions. Requested evidence is not guaranteed novel or decisive. No semantic accuracy claim, no winner by vote, no automatic application. Cost guard is not a hard billing cap.' }
  write(`${out}/manifest.json`, manifest)
  const stages = [], results = []
  async function stage(id, phase, request, validate) {
    const stem = `${resolve(opts['replay-from'] ?? out)}/${id}/${phase}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt preflight exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('replay fingerprint mismatch')
      payload = read(`${stem}.response.json`)
    } else {
      if (opts['replay-from']) throw new Error(`missing replay ${stem}`)
      if (existsSync(`${stem}.request.json`)) throw new Error('request without response: reconcile provider outcome before retry')
      if (stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= manifest.limits.costStopBeforeNextRequest) throw new Error('cost guard: review saved receipts')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request)
      process.stderr.write(`${id} ${phase}: requesting\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(`${stem}.response.json`, payload)
    }
    const receipt = { caseId: id, phase, requestSha256: hash(request), usage: payload.usage ?? {}, model: payload.model }
    stages.push(receipt)
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } }
    catch (error) { result = { status: 'invalid', validationError: error.message }; receipt.validationError = error.message }
    write(`${out}/${id}/${phase}.result.json`, result)
    write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${id} ${phase}: ${result.status}${result.validationError ? ` (${result.validationError})` : ''}\n`)
    return result
  }
  for (const [caseIndex, c] of selection.selected.entries()) {
    const oldIds = new Set(packet.coverage.filter((e) => c.seedIds.includes(e.nodeId)).flatMap((e) => e.evidenceIds))
    const oldEvidence = packet.evidence.filter((e) => oldIds.has(e.id))
    const plan = await stage(c.id, 'plan', scopeRequest('plan', { graph, neighborhoodSeedIds: c.seedIds,
      priorScopeHypotheses: c.alternatives, retrievedEvidence: oldEvidence, headPaths: source.paths,
      readingCatalog: baseline.readingRegistry.map(({ id, subject }) => ({ id, subject })) }, DEFAULT_MODEL),
    (raw) => validateScopePlan(raw, graph, c))
    if (plan.status !== 'valid') { results.push({ case: c, plan, judgments: [] }); continue }
    const retrievalPath = `${resolve(opts['replay-from'] ?? out)}/${c.id}/retrieval.json`
    const requestPlan = { readingIds: plan.value.readingIds, sources: plan.value.sources, searches: [] }
    let retrieval
    if (existsSync(retrievalPath)) {
      retrieval = read(retrievalPath)
      if (retrieval.planSha256 !== hash(requestPlan) || retrieval.headSha !== baseline.headSha) throw new Error('retrieval fingerprint mismatch')
    } else {
      if (opts['replay-from']) throw new Error('missing replay retrieval')
      retrieval = { ...retrieveGraphEvidence(requestPlan, baseline.readingRegistry, source, {
        maxReadings: 4, maxSources: 6, maxBytes: 28000 }), planSha256: hash(requestPlan), headSha: baseline.headSha }
    }
    write(`${out}/${c.id}/retrieval.json`, retrieval)
    const addedEvidence = retrieval.evidence.filter((e) => !oldIds.has(e.id)), enriched = [...oldEvidence, ...addedEvidence]
    const packets = { 'existing-evidence': oldEvidence, 'enriched-evidence': enriched }
    write(`${out}/${c.id}/packets.json`, { oldEvidence, addedEvidence, enriched })
    const judgments = []
    for (const order of ['forward', 'reverse']) {
      const conditions = ((caseIndex + (order === 'reverse' ? 1 : 0)) % 2 === 0) ? manifest.conditions : [...manifest.conditions].reverse()
      for (const condition of conditions) {
        const evidence = packets[condition], phase = `${condition}-${order}`
        const result = await stage(c.id, phase, scopeRequest('judge', judgeContext(graph, plan.value.alternatives, evidence, order === 'reverse'), DEFAULT_MODEL),
          (raw) => validateScopeJudgment(raw, plan.value.alternatives, evidence, graph))
        judgments.push({ condition, order, ...result })
      }
    }
    const result = { case: c, plan, retrieval: { sources: retrieval.sourceCount, readings: retrieval.readingCount, omitted: retrieval.omitted,
      addedEvidenceIds: addedEvidence.map((e) => e.id), addedSourceCount: addedEvidence.filter((e) => e.kind === 'source').length }, judgments }
    results.push(result); write(`${out}/${c.id}/output.json`, result)
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  const output = { manifest, repository: baseline.repository, headSha: baseline.headSha, graph, results, stages, cost,
    interpretationStatus: 'candidate', applicationStatus: 'proposal-only' }
  write(`${out}/output.json`, output)
  process.stdout.write(JSON.stringify({ out, cost, invalid: stages.filter((s) => s.validationError).length }) + '\n')
}
try { await main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
