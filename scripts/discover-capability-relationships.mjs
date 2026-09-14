#!/usr/bin/env node
/** Claim-wise coexistence pilot, with immutable inputs and no semantic repair. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { umbrellaPacket, umbrellaSeed } from './lib/umbrella-experiment.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { relationshipRequest, validateRelationshipPool, reviewRelationshipContext, validateRelationshipReview, composeRelationships } from './lib/capability-relationships.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, value) => {
  const body = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(p)) { if (readFileSync(p, 'utf8') !== body) throw new Error(`refusing overwrite ${p}`); return }
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body, { flag: 'wx' })
}
async function main() {
  const opts = {}, args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 2) {
    if (!['--in', '--prior', '--out', '--replay-from', '--reuse-proposal-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments')
    opts[args[i].slice(2)] = args[i + 1]
  }
  for (const k of ['in', 'prior', 'out']) if (!opts[k]) throw new Error(`missing --${k}`)
  const baseline = read(opts.in), prior = read(`${opts.prior}/output.json`), out = resolve(opts.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (hash(baseline) !== prior.manifest.baselineSha256) throw new Error('baseline mismatch')
  const cases = prior.results.filter((r) => r.plan.status === 'valid'), graph = umbrellaSeed(baseline.graph, 'linked')
  const packetInputs = cases.map((r) => ({ caseId: r.case.id, packet: read(`${opts.prior}/${r.case.id}/packets.json`) }))
  const registry = new Map()
  for (const e of [...umbrellaPacket(baseline).evidence, ...packetInputs.flatMap((p) => p.packet.enriched)]) {
    if (registry.has(e.id) && hash(registry.get(e.id)) !== hash(e)) throw new Error('conflicting evidence identity')
    registry.set(e.id, e)
  }
  const evidence = [...registry.values()], focusNodeIds = [...new Set(cases.flatMap((r) => r.case.seedIds))].sort()
  const manifest = { protocol: opts['reuse-proposal-from'] ? 'relationship-coexistence-v1.1' : 'relationship-coexistence-v1', baselineSha256: hash(baseline), priorSha256: hash(prior), model: DEFAULT_MODEL,
    evidenceSha256: hash(evidence), packetHashes: packetInputs.map((p) => ({ caseId: p.caseId, sha256: hash(p.packet) })), focusNodeIds,
    limits: { maxPromptCharacters: 190000, maxOutputTokens: 7500, costStopBeforeNextRequest: 1.0 },
    ...(opts['reuse-proposal-from'] ? { reusedProposalFrom: resolve(opts['reuse-proposal-from']), reconciliation: 'Original proposal failed v1 duplicate-edge validation. In v1.1 identical existing typed links are recorded as existing claims, never additions. Exact proposal request and response are reused unchanged; no semantic rewrite or new proposal inference. Reviews still assess all raw claims.' } : {}),
    design: `${opts['reuse-proposal-from'] ? 'One proposal pool' : 'One fresh proposal pool'}, two fresh claim-wise reviews in forward/reverse order, same evidence. No prior alternatives, verdicts, reasons or human labels supplied. Include compatible claims independently; no winner. Raw inherited graph preserved; display-only transitive reduction distinguishes shortcuts from independent shared parents. No automatic correction or transport retries.`,
    limitations: 'Two previously completed neighborhoods, one repository, one proposal call and same-model reviews. Fixed node descriptions and inherited baseline relationships remain anchors and are not newly verified. Three relation types are a provisional vocabulary, not exhaustive. No new retrieval; cached enriched evidence includes incomplete windows and mixed revisions. Order and sampling variability are confounded. Supports is non-transitive and is not a weak catch-all. Candidate composition is not application or independent semantic validation.' }
  write(`${out}/manifest.json`, manifest); write(`${out}/evidence.json`, evidence)
  const stages = []
  async function stage(phase, request, validate) {
    const stem = `${resolve(opts['replay-from'] ?? out)}/${phase}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt preflight exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact request mismatch')
      payload = read(`${stem}.response.json`)
    } else if (phase === 'propose' && opts['reuse-proposal-from'] && !opts['replay-from']) {
      const previous = `${resolve(opts['reuse-proposal-from'])}/propose`
      if (hash(read(`${previous}.request.json`)) !== hash(request)) throw new Error('reused proposal request mismatch')
      payload = read(`${previous}.response.json`)
      write(`${stem}.request.json`, request); write(`${stem}.response.json`, payload)
    } else {
      if (opts['replay-from']) throw new Error('missing replay response')
      if (existsSync(`${stem}.request.json`)) throw new Error('request without response: reconcile provider outcome before retry')
      if (stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= manifest.limits.costStopBeforeNextRequest) throw new Error('cost guard')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request)
      process.stderr.write(`${phase}: requesting\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(`${stem}.response.json`, payload)
    }
    const receipt = { phase, requestSha256: hash(request), model: payload.model, usage: payload.usage ?? {},
      ...(opts['reuse-proposal-from'] ? { reused: phase === 'propose' } : {}) }
    stages.push(receipt)
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } }
    catch (error) { receipt.validationError = error.message; result = { status: 'invalid', validationError: error.message } }
    write(`${out}/${phase}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${phase}: ${result.status}${result.validationError ? ` (${result.validationError})` : ''}\n`)
    return result
  }
  const proposal = await stage('propose', relationshipRequest('propose', { graph, focusNodeIds, retrievedEvidence: evidence }, DEFAULT_MODEL),
    (raw) => validateRelationshipPool(raw, graph, evidence, { allowExistingClaims: Boolean(opts['reuse-proposal-from']) }))
  const reviews = []
  if (proposal.status === 'valid') {
    for (const order of ['forward', 'reverse']) {
      const result = await stage(`review-${order}`, relationshipRequest('review', reviewRelationshipContext(graph, proposal.value, evidence, order === 'reverse'), DEFAULT_MODEL),
        (raw) => validateRelationshipReview(raw, proposal.value, graph, evidence))
      reviews.push({ order, ...result, ...(result.status === 'valid' ? { composition: composeRelationships(graph, proposal.value, result.value) } : {}) })
    }
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  const newStages = stages.filter((s) => !s.reused), newInferenceCost = newStages.every((s) => typeof s.usage.cost === 'number') ? newStages.reduce((n, s) => n + s.usage.cost, 0) : null
  write(`${out}/output.json`, { manifest, repository: baseline.repository, headSha: baseline.headSha, graph, proposal, reviews, stages, cost,
    ...(opts['reuse-proposal-from'] ? { newInferenceCost } : {}), applicationStatus: 'proposal-only' })
  process.stdout.write(JSON.stringify({ out, cost, newInferenceCost, failures: stages.filter((s) => s.validationError).length }) + '\n')
}
try { await main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
