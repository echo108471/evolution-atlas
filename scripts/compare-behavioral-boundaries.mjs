#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { boundaryNeighborhood, boundaryRequest, boundaryReviewContext, validateBoundaries, validateBoundaryReview, validateBoundaryAudit } from './lib/behavioral-boundaries.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, v) => { const text = JSON.stringify(v, null, 2) + '\n'; if (existsSync(p)) { if (readFileSync(p, 'utf8') !== text) throw new Error(`refusing overwrite ${p}`); return } mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' }) }
async function main() {
  const args = process.argv.slice(2), o = {}
  for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prior', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
  for (const k of ['in', 'prior', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
  const baseline = read(o.in), prior = read(`${o.prior}/output.json`), packet = read(`${o.prior}/packets.json`).enriched, out = resolve(o.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (hash(baseline) !== prior.manifest.baselineSha256 || !prior.reviews.some((r) => r.condition === 'enriched') || prior.reviews.filter((r) => r.condition === 'enriched').some((r) => r.packetSha256 !== hash(packet))) throw new Error('input fingerprint mismatch')
  const { nodes, pairs } = boundaryNeighborhood(prior.graph, prior.claims)
  const manifest = { protocol: 'behavioral-boundaries-v1', baselineSha256: hash(baseline), priorSha256: hash(prior), packetSha256: hash(packet), headSha: baseline.headSha, model: DEFAULT_MODEL,
    limits: { maxRequests: 7, maxPromptCharacters: 430000, costStopBeforeNextRequest: 1.75 },
    selection: 'Prior tracing endpoints plus their direct contains children; all unordered pairs. Graph links determine selection only and are not supplied to definition or pair reviewers. This is a selected existing neighborhood, not blind capability discovery.',
    design: 'One behavioral-definition pass; same candidates/evidence for current-summary and behavioral conditions, each reviewed in forward/reverse pair order with identical instructions. No semantic approval gate removes a condition. Two condition-masked comparative audits see both repeats with X/Y swapped and pair order reversed. No graph patch, new retrieval, owner examples, expected labels or earlier verdicts. No repairs or automatic retry.',
    limitations: 'Five existing candidates in one repository; one definition generation and two reviews per condition. Treatment combines structured representation, extra reasoning, revised wording and greater length; it cannot isolate schema alone. All cells retain source access and may infer boundaries without structured cards. Same-model masked audit is not independent accuracy; wording may reveal condition. Shared-behavior identity is not graph containment or historical lineage. No runtime verification or complete source/history coverage.' }
  write(`${out}/manifest.json`, manifest); write(`${out}/packet.json`, packet)
  const stages = []
  async function stage(name, request, validate) {
    const stem = `${resolve(o['replay-from'] ?? out)}/${name}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt budget exceeded')
    let payload
    const failed = (failure) => {
      const result = { status: 'provider_error', error: failure.error, httpStatus: failure.httpStatus ?? null }
      stages.push({ name, requestSha256: hash(request), usage: {}, ...result })
      write(`${out}/${name}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
      process.stderr.write(`${name}: provider_error (${result.httpStatus ?? 'unknown status'})\n`)
      return result
    }
    if (existsSync(`${stem}.response.json`)) { if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact request mismatch'); payload = read(`${stem}.response.json`) }
    else if (existsSync(`${stem}.failure.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact failed request mismatch')
      return failed(read(`${stem}.failure.json`))
    }
    else {
      if (o['replay-from'] || existsSync(`${stem}.request.json`)) throw new Error('missing response; reconcile provider outcome before retry')
      if (stages.length >= 7 || stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= 1.75) throw new Error('recorded cost guard')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
      try { payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] }) }
      catch (e) {
        // Persist only status/category, never provider account links or credential metadata.
        const httpStatus = Number(e.message.match(/^HTTP (\d{3}):/)?.[1]) || null
        const failure = { httpStatus, error: /Key limit exceeded/.test(e.message) ? 'Provider key spending limit exceeded; no automatic retry.' : 'Provider request failed; reconcile before retry.', usage: null }
        write(`${stem}.failure.json`, failure); return failed(failure)
      }
      write(`${stem}.response.json`, payload)
    }
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } } catch (e) { result = { status: 'invalid', error: e.message } }
    stages.push({ name, requestSha256: hash(request), model: payload.model, usage: payload.usage ?? {}, status: result.status, ...(result.error ? { error: result.error } : {}) })
    write(`${out}/${name}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${name}: ${result.status}${result.error ? ` (${result.error})` : ''}\n`); return result
  }
  const definitions = await stage('definitions', boundaryRequest('define', { headSha: baseline.headSha, candidates: nodes, retrievedEvidence: packet.evidence, searchReceipts: packet.searches }, DEFAULT_MODEL), (r) => validateBoundaries(r, nodes, packet.evidence))
  const reviews = [], audits = []
  for (const [condition, order] of [['summary', 'forward'], ['boundary', 'forward'], ['boundary', 'reverse'], ['summary', 'reverse']]) {
    if (condition === 'boundary' && definitions.status !== 'valid') continue
    const context = boundaryReviewContext(nodes, pairs, condition === 'boundary' ? definitions.value.definitions : null, packet, baseline.headSha, order === 'reverse')
    const result = await stage(`${condition}-${order}`, boundaryRequest('review', context, DEFAULT_MODEL), (r) => validateBoundaryReview(r, pairs, packet.evidence))
    reviews.push({ condition, order, packetSha256: hash(packet), representationSha256: hash(context.candidates), ...result })
  }
  if (reviews.length === 4 && reviews.every((r) => r.status === 'valid')) {
    for (const reverse of [false, true]) {
      const mapping = reverse ? { X: 'boundary', Y: 'summary' } : { X: 'summary', Y: 'boundary' }
      const explanations = Object.fromEntries(Object.entries(mapping).map(([k, condition]) => [k, ['forward', 'reverse'].map((order) => reviews.find((r) => r.condition === condition && r.order === order).value)]))
      const result = await stage(`audit-${reverse ? 'reverse' : 'forward'}`, boundaryRequest('audit', { headSha: baseline.headSha, candidates: nodes.map(({ id, name }) => ({ id, name })), pairs: reverse ? [...pairs].reverse() : pairs, explanations, retrievedEvidence: packet.evidence, searchReceipts: packet.searches }, DEFAULT_MODEL), (r) => validateBoundaryAudit(r, pairs, packet.evidence))
      audits.push({ mapping, ...result })
      if (result.status === 'provider_error') break
    }
  }
  const cost = stages.reduce((n, s) => n + (typeof s.usage.cost === 'number' ? s.usage.cost : 0), 0)
  const costComplete = stages.every((s) => typeof s.usage.cost === 'number')
  write(`${out}/output.json`, { manifest, nodes, pairs, definitions, reviews, audits, stages, cost, costComplete, applicationStatus: 'not-applied' })
  process.stdout.write(JSON.stringify({ out, cost, costComplete, invalidResponses: stages.filter((s) => s.status === 'invalid').length, providerFailures: stages.filter((s) => s.status === 'provider_error').length }) + '\n')
}
try { await main() } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
