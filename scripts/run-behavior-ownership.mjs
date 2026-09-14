#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { ownershipRequest, validateOwnership, scopeTensions } from './lib/behavior-ownership.mjs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
export function writeImmutable(p, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(p)) { if (readFileSync(p, 'utf8') !== text) throw new Error(`refusing overwrite ${p}`); return }
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' })
}
export async function runOwnership(o, { requestProvider = requestHierarchyCriticRequestPayload, apiKey = process.env[API_KEY_ENV] } = {}) {
  const plan = read(`${o.prepared}/plan.json`), packet = read(`${o.prepared}/packet.json`), prior = read(`${o.prior}/output.json`), baseline = read(o.in), out = resolve(o.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (plan.status !== 'prepared-not-run' || hash(baseline) !== plan.baselineSha256 || hash(prior) !== plan.priorSha256 || hash(packet) !== plan.packetSha256) throw new Error('prepared input fingerprint mismatch')
  if (plan.requests.length !== 2 || plan.requests.map((r) => r.order).join(',') !== 'forward,reverse') throw new Error('expected two prepared orders')
  const requests = plan.requests.map((r) => {
    const request = read(`${o.prepared}/${r.file}`)
    if (hash(request) !== r.requestSha256 || hash(request) !== hash(ownershipRequest(prior.nodes, prior.pairs, packet, baseline.headSha, request.model, r.order === 'reverse'))) throw new Error('prepared request mismatch')
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > 430000 || request.max_tokens > 12000) throw new Error('request budget exceeded')
    return { order: r.order, request }
  })
  const manifest = { protocol: 'behavior-ownership-v1', planSha256: hash(plan), baselineSha256: hash(baseline), priorSha256: hash(prior), packetSha256: hash(packet), headSha: baseline.headSha,
    limits: { maxRequests: 2, costStopBeforeNextRequest: 1.25, maxOutputTokens: 12000, note: 'Recorded-cost guard before another request, not a guaranteed in-flight spending ceiling.' },
    design: plan.design, instructionCorrection: plan.instructionCorrection,
    limitations: 'Two repeats of a selected five-candidate neighborhood from one repository. Changed instructions, representation, reasoning and output budget together; not a schema-only effect. Prior comparison was not independently audited. Structural validity and repeatability do not establish semantic accuracy. No runtime tests, new evidence, owner labels, prior decisions or diagnostics supplied to the model.', applicationStatus: 'not-applied' }
  writeImmutable(`${out}/manifest.json`, manifest); writeImmutable(`${out}/packet.json`, packet)
  const stages = [], reviews = []
  for (const { order, request } of requests) {
    const name = `ownership-${order}`, stem = `${resolve(o['replay-from'] ?? out)}/${name}`
    let payload, failure
    if (existsSync(`${stem}.request.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('saved request mismatch')
      if (existsSync(`${stem}.response.json`)) payload = read(`${stem}.response.json`)
      else if (existsSync(`${stem}.failure.json`)) failure = read(`${stem}.failure.json`)
      else throw new Error('request without response: reconcile outcome before retry')
    } else {
      if (o['replay-from']) throw new Error('replay response missing; live fallback forbidden')
      if (!apiKey) throw new Error('provider key unavailable')
      if (stages.some((s) => !Number.isFinite(s.usage?.cost) || s.usage.cost < 0) || stages.reduce((n, s) => n + s.usage.cost, 0) >= manifest.limits.costStopBeforeNextRequest) break
      writeImmutable(`${stem}.request.json`, request)
      process.stderr.write(`${name}: requesting\n`)
      try { payload = await requestProvider(request, { apiKey }) }
      catch (e) {
        failure = { httpStatus: Number(e.message?.match(/^HTTP (\d{3}):/)?.[1]) || null, error: 'Provider request failed; no automatic retry. Reconcile before another attempt.', usage: null }
        writeImmutable(`${stem}.failure.json`, failure)
      }
      if (payload) writeImmutable(`${stem}.response.json`, payload)
    }
    writeImmutable(`${out}/${name}.request.json`, request)
    if (payload) writeImmutable(`${out}/${name}.response.json`, payload)
    if (failure) writeImmutable(`${out}/${name}.failure.json`, failure)
    let result
    if (failure) result = { status: 'provider_error', error: failure.error, httpStatus: failure.httpStatus }
    else {
      try { result = { status: 'valid', value: validateOwnership(parseResponse(payload), prior.nodes, prior.pairs, packet.evidence) } }
      catch (e) { result = { status: 'invalid', error: e.message } }
    }
    reviews.push({ order, ...result })
    stages.push({ name, requestSha256: hash(request), status: result.status, model: payload?.model ?? request.model, usage: payload?.usage ?? {}, ...(result.error ? { error: result.error } : {}) })
    writeImmutable(`${out}/${name}.result.json`, result); writeImmutable(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${name}: ${result.status}${result.error ? ` (${result.error})` : ''}\n`)
    if (failure) break
  }
  const complete = reviews.length === 2 && reviews.every((r) => r.status === 'valid')
  const comparison = prior.pairs.map((p) => ({ ...p,
    prior: prior.reviews.map((r) => ({ condition: r.condition, order: r.order, relation: r.status === 'valid' ? r.value.decisions.find((d) => d.id === p.id)?.relation : null })),
    ownership: reviews.map((r) => ({ order: r.order, status: r.status, relation: r.status === 'valid' ? r.value.decisions.find((d) => d.id === p.id)?.relation : null })) }))
  const output = { manifest, nodes: prior.nodes, pairs: prior.pairs, reviews, stages, comparison,
    agreement: complete ? { sameLabels: comparison.filter((c) => c.ownership[0].relation === c.ownership[1].relation).length, totalPairs: prior.pairs.length } : null,
    diagnostics: reviews.map((r) => ({ order: r.order, status: r.status, tensions: r.status === 'valid' ? scopeTensions(prior.pairs, r.value) : null })),
    cost: stages.reduce((n, s) => n + (Number.isFinite(s.usage.cost) ? s.usage.cost : 0), 0), costComplete: stages.every((s) => Number.isFinite(s.usage.cost)),
    status: complete ? 'completed' : 'incomplete', applicationStatus: 'not-applied' }
  writeImmutable(`${out}/output.json`, output)
  return output
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), o = {}
    for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prepared', '--prior', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
    for (const k of ['in', 'prepared', 'prior', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
    const result = await runOwnership(o)
    process.stdout.write(JSON.stringify({ out: resolve(o.out), status: result.status, cost: result.cost, costComplete: result.costComplete, agreement: result.agreement }) + '\n')
  } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
}
