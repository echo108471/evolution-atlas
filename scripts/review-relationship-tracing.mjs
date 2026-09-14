#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { sourceReader } from './lib/capability-graph-evidence.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { validateTracePlan, traceEvidence, traceRequest, validateTraceReview } from './lib/relationship-tracing.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, v) => { const text = JSON.stringify(v, null, 2) + '\n'; if (existsSync(p)) { if (readFileSync(p, 'utf8') !== text) throw new Error(`refusing overwrite ${p}`); return } mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' }) }
async function main() {
  const args = process.argv.slice(2), o = {}
  for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prior', '--repo', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
  for (const k of ['in', 'prior', 'repo', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
  const baseline = read(o.in), prior = read(`${o.prior}/output.json`), original = read(`${o.prior}/packets.json`).enriched, out = resolve(o.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (hash(baseline) !== prior.manifest.baselineSha256 || prior.reviews.filter((r) => r.condition === 'enriched').some((r) => r.evidenceSha256 !== hash(original))) throw new Error('input fingerprint mismatch')
  const claims = prior.claims.filter((c) => ['L2', 'L7'].includes(c.id)), graph = prior.graph, source = sourceReader(o.repo, baseline.headSha, baseline.readingRegistry)
  if (claims.length !== 2) throw new Error('missing target claims')
  const manifest = { protocol: 'relationship-tracing-v1', baselineSha256: hash(baseline), priorSha256: hash(prior), originalEvidenceSha256: hash(original), headSha: baseline.headSha, model: DEFAULT_MODEL,
    limits: { retrievalRounds: 2, maxSearchesPerRound: 4, maxFilesPerSearch: 140, maxWindowsPerFile: 20, maxMatchesPerSearch: 8, maxSourcesPerRound: 8, maxSourceBytesPerRound: 42000, maxPromptCharacters: 340000, costStopBeforeNextRequest: 1.25 },
    design: 'Two bounded model retrieval plans and deterministic pinned literal searches, then two original and two enriched dual-axis reviews. Original packet is the prior enriched evidence, not prior verdicts. Outcome membership, current wiring, and historical observations are separate. No new nodes or applied edges. No automatic correction or retry.',
    limitations: 'Two selected professor claims in one repository. Fixed endpoints and descriptions remain anchors. Literal search is not a call graph or execution test; prefix, extension, file, window and evidence limits apply. Two snapshots do not establish continuity or removal. Changed instructions prevent causal comparison against prior experiments. Ordering and sampling are confounded; same-model agreement is not accuracy.' }
  write(`${out}/manifest.json`, manifest)
  const stages = [], plans = [], registry = new Map(original.map((e) => [e.id, e])), searchRegistry = new Map()
  async function stage(name, request, validate) {
    const stem = `${resolve(o['replay-from'] ?? out)}/${name}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt budget exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) { if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact request mismatch'); payload = read(`${stem}.response.json`) }
    else {
      if (o['replay-from'] || existsSync(`${stem}.request.json`)) throw new Error('missing response; reconcile provider outcome before retry')
      if (stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= 1.25) throw new Error('recorded cost guard')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] }); write(`${stem}.response.json`, payload)
    }
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } } catch (e) { result = { status: 'invalid', error: e.message } }
    stages.push({ name, requestSha256: hash(request), model: payload.model, usage: payload.usage ?? {}, ...('error' in result ? { error: result.error } : {}), status: result.status })
    write(`${out}/${name}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${name}: ${result.status}${result.error ? ` (${result.error})` : ''}\n`)
    return result
  }
  const context = (evidence, searches, reverse = false) => ({ graph, claims: reverse ? [...claims].reverse() : claims, headSha: baseline.headSha, retrievedEvidence: evidence, searchReceipts: searches })
  const retrievals = []
  for (let round = 1; round <= 2; round++) {
    const plan = await stage(`plan-${round}`, traceRequest('plan', { ...context([...registry.values()], [...searchRegistry.values()]), round, availablePaths: source.paths,
      registeredReadings: baseline.readingRegistry.map(({ id, commitSha, subject }) => ({ id, commitSha, subject })) }, DEFAULT_MODEL), validateTracePlan)
    plans.push(plan)
    if (plan.status !== 'valid') break
    const retrieval = traceEvidence(plan.value, source); write(`${out}/retrieval-${round}.json`, retrieval); retrievals.push(retrieval)
    for (const e of retrieval.evidence) { if (registry.has(e.id) && hash(registry.get(e.id)) !== hash(e)) throw new Error('evidence collision'); registry.set(e.id, e) }
    for (const s of retrieval.searches) { if (searchRegistry.has(s.id) && hash(searchRegistry.get(s.id)) !== hash(s)) throw new Error('search collision'); searchRegistry.set(s.id, s) }
  }
  const packets = { original: { evidence: original, searches: [] }, enriched: { evidence: [...registry.values()], searches: [...searchRegistry.values()] } }
  write(`${out}/packets.json`, packets)
  const reviews = []
  if (plans.length === 2 && plans.every((p) => p.status === 'valid')) {
    for (const [condition, order] of [['original', 'forward'], ['enriched', 'forward'], ['enriched', 'reverse'], ['original', 'reverse']]) {
      const packet = packets[condition]
      const result = await stage(`${condition}-${order}`, traceRequest('review', context(packet.evidence, packet.searches, order === 'reverse'), DEFAULT_MODEL), (r) => validateTraceReview(r, claims, packet.evidence, packet.searches, baseline.headSha))
      reviews.push({ condition, order, packetSha256: hash(packet), ...result })
    }
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  write(`${out}/output.json`, { manifest, graph, claims, plans, reviews, stages, cost, retrievalSummary: retrievals.map((r) => ({ sources: r.evidence.length, searches: r.searches.length, bytes: r.bytes, omissions: r.omitted.length })), applicationStatus: 'not-composed' })
  process.stdout.write(JSON.stringify({ out, cost, failures: stages.filter((s) => s.status === 'invalid').length }) + '\n')
}
try { await main() } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
