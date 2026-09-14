#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { invariantRequest, ownershipFeedback, correctionRequest } from './lib/implementation-invariance.mjs'
import { writeImmutable } from './run-behavior-ownership.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const args = process.argv.slice(2), o = {}
for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prepared', '--prior', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
for (const k of ['in', 'prepared', 'prior', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
const out = resolve(o.out), plan = read(`${o.prepared}/plan.json`), packet = read(`${o.prepared}/packet.json`), prior = read(`${o.prior}/output.json`), baseline = read(o.in)
execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
if (hash(baseline) !== plan.baselineSha256 || hash(prior) !== plan.priorSha256 || hash(packet) !== plan.packetSha256) throw new Error('input fingerprint mismatch')
const base = read(`${o.prepared}/planned-forward.json`)
if (hash(base) !== plan.requests.find((r) => r.order === 'forward').requestSha256) throw new Error('prepared request mismatch')
const manifest = { protocol: 'implementation-invariance-v1', baselineSha256: hash(baseline), packetSha256: hash(packet), planSha256: hash(plan), headSha: baseline.headSha, model: base.model,
  design: 'Control exactly reuses the prepared ownership-forward request. Treatment appends behavior-contract and hypothetical implementation-change checks. Same candidates, evidence, pair order, model and output ceiling. Both initial calls precede any correction; each invalid answer gets at most one deterministic-feedback correction. No previous run answers, owner examples, expected pair labels or assistant semantic audit enter either initial request.',
  limits: { maxCalls: 4, maxPromptCharacters: 490000, costStopBeforeNextRequest: 1.5 },
  limitations: 'One initial sample per condition; no order counterbalance or repeatability measurement. Treatment adds instructions and reasoning/output demands, so this is not schema-only causality. Correction is conditional on invalidity and may change semantic decisions. Hypothetical self-checks are model claims, not executed implementation mutations or an independent accuracy judge. Fixed evidence remains partial and includes candidate readings. No new retrieval or graph edits.', applicationStatus: 'not-applied' }
writeImmutable(`${out}/manifest.json`, manifest); writeImmutable(`${out}/packet.json`, packet)
const stages = [], cells = []
async function stage(name, request, treatment) {
  if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt budget exceeded')
  const stem = `${resolve(o['replay-from'] ?? out)}/${name}`; let payload, failure
  if (existsSync(`${stem}.request.json`)) {
    if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact request mismatch')
    if (existsSync(`${stem}.response.json`)) payload = read(`${stem}.response.json`)
    else if (existsSync(`${stem}.failure.json`)) failure = read(`${stem}.failure.json`)
    else throw new Error('request without response; reconcile before retry')
  } else {
    if (o['replay-from']) throw new Error('missing replay response; no live fallback')
    if (stages.length >= 4 || stages.some((s) => !Number.isFinite(s.usage.cost)) || stages.reduce((n, s) => n + s.usage.cost, 0) >= 1.5) return { status: 'not_run', reason: 'cost or call guard' }
    if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
    writeImmutable(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
    try { payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] }) }
    catch (e) { failure = { httpStatus: Number(e.message?.match(/^HTTP (\d{3}):/)?.[1]) || null, error: 'Provider failure; no automatic retry.', usage: null }; writeImmutable(`${stem}.failure.json`, failure) }
    if (payload) writeImmutable(`${stem}.response.json`, payload)
  }
  writeImmutable(`${out}/${name}.request.json`, request)
  if (payload) writeImmutable(`${out}/${name}.response.json`, payload)
  if (failure) writeImmutable(`${out}/${name}.failure.json`, failure)
  let result
  if (failure) result = { status: 'provider_error', ...failure }
  else {
    try { const value = parseResponse(payload), issues = ownershipFeedback(value, prior.nodes, prior.pairs, packet.evidence, treatment); result = { status: issues.length ? 'invalid' : 'valid', value, issues } }
    catch (e) { result = { status: 'invalid', issues: [{ path: '$', issue: e.message }] } }
  }
  stages.push({ name, status: result.status, requestSha256: hash(request), usage: payload?.usage ?? {} })
  writeImmutable(`${out}/${name}.result.json`, result); writeImmutable(`${out}/receipts-${stages.length}.json`, stages)
  process.stderr.write(`${name}: ${result.status}\n`); return result
}
for (const condition of ['control', 'challenge']) {
  const request = condition === 'control' ? base : invariantRequest(base)
  const initial = await stage(`${condition}-initial`, request, condition === 'challenge')
  cells.push({ condition, initial })
  if (initial.status === 'provider_error' || initial.status === 'not_run') break
}
if (!cells.some((c) => ['provider_error', 'not_run'].includes(c.initial.status))) for (const c of cells) {
  if (c.initial.status !== 'invalid') { c.correction = { status: 'not_needed' }; continue }
  const payload = read(`${out}/${c.condition}-initial.response.json`)
  const request = c.condition === 'control' ? base : invariantRequest(base)
  c.correction = await stage(`${c.condition}-correction`, correctionRequest(request, payload.choices?.[0]?.message?.content ?? '', c.initial.issues), c.condition === 'challenge')
  c.semanticChanges = prior.pairs.flatMap((p) => { const before = c.initial.value?.decisions?.find((d) => d.id === p.id)?.relation, after = c.correction.value?.decisions?.find((d) => d.id === p.id)?.relation; return before && after && before !== after ? [{ pairId: p.id, before, after }] : [] })
  if (['provider_error', 'not_run'].includes(c.correction.status)) break
}
const output = { manifest, nodes: prior.nodes, pairs: prior.pairs, cells, stages, cost: stages.reduce((n, s) => n + (Number.isFinite(s.usage.cost) ? s.usage.cost : 0), 0), costComplete: stages.every((s) => Number.isFinite(s.usage.cost)), applicationStatus: 'not-applied' }
writeImmutable(`${out}/output.json`, output)
process.stdout.write(JSON.stringify({ out, cost: output.cost, cells: cells.map((c) => ({ condition: c.condition, initial: c.initial.status, correction: c.correction?.status, semanticChanges: c.semanticChanges })) }) + '\n')
