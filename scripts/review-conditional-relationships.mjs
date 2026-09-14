#!/usr/bin/env node
// Explicit experiment entry point; intentionally outside the test filename pattern.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { sourceReader, retrieveGraphEvidence } from './lib/capability-graph-evidence.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { conditionalContext, conditionalRequest, validateConditionalPlan, validateConditionalReview, conditionalCandidates } from './lib/conditional-relationships.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, v) => { const s = JSON.stringify(v, null, 2) + '\n'; if (existsSync(p)) { if (readFileSync(p, 'utf8') !== s) throw new Error(`refusing overwrite ${p}`); return } mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, { flag: 'wx' }) }
async function main() {
  const args = process.argv.slice(2), o = {}
  for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prior', '--repo', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
  for (const k of ['in', 'prior', 'repo', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
  const baseline = read(o.in), prior = read(`${o.prior}/output.json`), evidence = read(`${o.prior}/evidence.json`), out = resolve(o.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (hash(baseline) !== prior.manifest.baselineSha256 || hash(evidence) !== prior.manifest.evidenceSha256) throw new Error('input fingerprint mismatch')
  const claims = prior.proposal.value.edges.filter((e) => ['L2', 'L6', 'L7'].includes(e.id)).map(({ id, from, to, type }) => ({ id, from, to, type }))
  if (claims.length !== 3) throw new Error('missing target claims')
  const source = sourceReader(o.repo, baseline.headSha, baseline.readingRegistry), graph = prior.graph
  const manifest = { protocol: 'conditional-relationships-v1', baselineSha256: hash(baseline), priorSha256: hash(prior), evidenceSha256: hash(evidence), pathsSha256: hash(source.paths), headSha: baseline.headSha, model: DEFAULT_MODEL, claimIds: claims.map((c) => c.id), limits: { maxPromptCharacters: 230000, maxSources: 12, maxEvidenceBytes: 52000, costStopBeforeNextRequest: 1 }, design: 'One model retrieval plan, deterministic pinned-source broker, original/enriched evidence each reviewed forward/reverse. Same review instructions in all four cells; no earlier reasons, verdicts or owner judgments. No automatic correction or retry. Conditions are non-executable claims, not composed into any graph.', limitations: 'Three selected disputed claims, one repository, same model. New schema and instructions confound comparison with old experiment. Order and sampling confounded. Repeated decisions are not correctness. Negative source search is not exhaustive. Fixed endpoint meanings remain anchors.' }
  write(`${out}/manifest.json`, manifest)
  const stages = []
  async function stage(name, request, validate) {
    const stem = `${resolve(o['replay-from'] ?? out)}/${name}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt budget exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) { if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('replay request mismatch'); payload = read(`${stem}.response.json`) }
    else {
      if (o['replay-from'] || existsSync(`${stem}.request.json`)) throw new Error('missing response; reconcile before retry')
      if (stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= 1) throw new Error('recorded cost guard')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] }); write(`${stem}.response.json`, payload)
    }
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } } catch (e) { result = { status: 'invalid', error: e.message } }
    stages.push({ name, requestSha256: hash(request), model: payload.model, usage: payload.usage ?? {}, status: result.status, ...(result.error ? { error: result.error } : {}) })
    write(`${out}/${name}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${name}: ${result.status}${result.error ? ` (${result.error})` : ''}\n`)
    return result
  }
  const plan = await stage('plan', conditionalRequest('plan', { ...conditionalContext(graph, claims, evidence, baseline.headSha), availablePaths: source.paths }, DEFAULT_MODEL), (r) => validateConditionalPlan(r, source, evidence, baseline.readingRegistry))
  const reviews = []
  if (plan.status === 'valid') {
    const retrieval = retrieveGraphEvidence(plan.value, baseline.readingRegistry, source, { maxReadings: 4, maxSources: 12, maxBytes: 52000 })
    write(`${out}/retrieval.json`, retrieval)
    const registry = new Map(evidence.map((e) => [e.id, e]))
    for (const e of retrieval.evidence) { if (registry.has(e.id) && hash(registry.get(e.id)) !== hash(e)) throw new Error('evidence identity conflict'); registry.set(e.id, e) }
    const packets = { original: evidence, enriched: [...registry.values()] }; write(`${out}/packets.json`, packets)
    // Interleave conditions to avoid putting every enriched call later in time.
    for (const [condition, order] of [['original', 'forward'], ['enriched', 'forward'], ['enriched', 'reverse'], ['original', 'reverse']]) {
      const packet = packets[condition]
      const result = await stage(`${condition}-${order}`, conditionalRequest('review', conditionalContext(graph, claims, packet, baseline.headSha, order === 'reverse'), DEFAULT_MODEL), (r) => validateConditionalReview(r, claims, packet, baseline.headSha))
      reviews.push({ condition, order, evidenceSha256: hash(packet), ...result, ...(result.status === 'valid' ? { candidates: conditionalCandidates(claims, result.value) } : {}) })
    }
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  write(`${out}/output.json`, { manifest, graph, claims, plan, reviews, stages, cost, applicationStatus: 'not-composed' })
  process.stdout.write(JSON.stringify({ out, cost, failures: stages.filter((s) => s.status !== 'valid').length }) + '\n')
}
try { await main() } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
