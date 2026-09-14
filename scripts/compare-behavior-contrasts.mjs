#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { writeImmutable } from './run-behavior-ownership.mjs'
import { contrastFixture, contrastOracle, contrastRequest, contrastDiagnostics, scoreContrasts } from './lib/behavior-contrasts.mjs'
import { ownershipDiagnostics } from './lib/ownership-diagnostics.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
export async function runContrasts(o, { requestProvider = requestHierarchyCriticRequestPayload, apiKey = process.env[API_KEY_ENV] } = {}) {
  const out = resolve(o.out), baseline = read(o.in), packet = read(`${o.prepared}/packet.json`), prior = read(`${o.prior}/output.json`)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  const cases = contrastFixture(), oracle = contrastOracle(cases)
  const sourceIds = ['S71375ea117d2451c', 'S7f89ea5b400deafb', 'S0235cc4de9fc2e84']
  const anchors = sourceIds.map((id) => packet.evidence.find((e) => e.id === id))
  if (anchors.some((e) => !e || e.kind !== 'source')) throw new Error('Missing source inspiration provenance')
  const cells = [['summary', false], ['boundary', false], ['boundary', true], ['summary', true]].map(([condition, reverse]) => ({ condition, order: reverse ? 'reverse' : 'forward', request: contrastRequest(cases, condition, reverse, DEFAULT_MODEL) }))
  const manifest = { protocol: 'behavior-contrasts-v1', baselineSha256: hash(baseline), packetSha256: hash(packet), fixtureSha256: hash(cases), oracleSha256: hash(oracle), model: DEFAULT_MODEL,
    design: 'Eight fixed synthetic contrasts: three refactors, three observable changes, two deliberately missing-helper cases. The root agent authored fixtures and probes before inference, independent of the deciding model but not an independent research team. Two representation conditions each see identical code in forward/reverse order. Calls interleave summary, boundary, boundary reverse, summary reverse. Test inputs/results, provenance anchors, family labels and expected deltas are hidden from every request. No owner labels, prior decisions or accepted candidate summaries are supplied. No live correction calls.',
    limits: { maxRequests: 4, costStopBeforeNextRequest: 0.75, maxPromptCharacters: 30000, maxOutputTokens: 9000, note: 'Recorded-cost guard before another request, not a guaranteed in-flight cap.' },
    limitations: 'Synthetic source-inspired functions, not extracted production units, executed refactors or repository revisions. Badge parser simplifies hook wrapping; feedback models boolean availability without browser events/CSS; batch models only selection and never infers missing writes. Three linked families, repeated related cases, one model, no significance claims. Unchanged means passed finite probes, not general program equivalence; information-gap controls are constructed evidence insufficiency. Boundary condition changes reasoning and output requirements as well as schema. Capability relations remain qualitative and revisable; no gold taxonomy.',
    applicationStatus: 'not-applied' }
  writeImmutable(`${out}/manifest.json`, manifest); writeImmutable(`${out}/fixture.json`, cases); writeImmutable(`${out}/oracle.json`, oracle); writeImmutable(`${out}/source-inspiration.json`, anchors)
  // Offline diagnosis of prior raw answers. No rewriting the historical experiment or buying repairs.
  const old = read(`${o.previous}/output.json`)
  const diagnostics = old.cells.flatMap((c) => ['initial', 'correction'].filter((k) => c[k]?.value).map((k) => ({ condition: c.condition, stage: k, originalStatus: c[k].status, issues: ownershipDiagnostics(c[k].value, prior.nodes, prior.pairs, packet.evidence) })))
  writeImmutable(`${out}/ownership-feedback-v2.json`, { protocol: 'ownership-diagnostics-v2', priorOutputSha256: hash(old), diagnostics, note: 'Exhaustive ownership fields only; does not revalidate treatment extensions or semantically adjudicate claims. Historical requests and results unchanged.' })
  for (const c of cells) writeImmutable(`${out}/planned-${c.condition}-${c.order}.json`, c.request)
  const results = [], receipts = []
  for (const c of cells) {
    const name = `${c.condition}-${c.order}`, request = c.request
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('Prompt budget exceeded')
    const stem = `${resolve(o['replay-from'] ?? out)}/${name}`; let payload, failure
    if (existsSync(`${stem}.request.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('Exact request mismatch')
      if (existsSync(`${stem}.response.json`)) payload = read(`${stem}.response.json`)
      else if (existsSync(`${stem}.failure.json`)) failure = read(`${stem}.failure.json`)
      else throw new Error('Request without outcome; reconcile before retry')
    } else {
      if (o['replay-from']) throw new Error('Replay response missing; no live fallback')
      if (receipts.some((r) => !Number.isFinite(r.usage.cost) || r.usage.cost < 0) || receipts.reduce((n, r) => n + r.usage.cost, 0) >= manifest.limits.costStopBeforeNextRequest) break
      if (!apiKey) throw new Error('Provider key unavailable')
      writeImmutable(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
      try { payload = await requestProvider(request, { apiKey }) }
      catch (e) { failure = { httpStatus: Number(e.message?.match(/^HTTP (\d{3}):/)?.[1]) || null, error: 'Provider failure; no automatic retry. Reconcile before another attempt.' }; writeImmutable(`${stem}.failure.json`, failure) }
      if (payload) writeImmutable(`${stem}.response.json`, payload)
    }
    writeImmutable(`${out}/${name}.request.json`, request)
    if (payload) writeImmutable(`${out}/${name}.response.json`, payload)
    if (failure) writeImmutable(`${out}/${name}.failure.json`, failure)
    let result
    if (failure) result = { status: 'provider_error', ...failure }
    else {
      try { const value = parseResponse(payload), issues = contrastDiagnostics(value, cases, c.condition); result = { status: issues.length ? 'invalid' : 'valid', value, issues } }
      catch (e) { result = { status: 'invalid', issues: [{ path: '$', issue: e.message }] } }
    }
    result = { condition: c.condition, order: c.order, ...result }; result.score = scoreContrasts(result, oracle)
    results.push(result); receipts.push({ name, requestSha256: hash(request), status: result.status, model: payload?.model ?? request.model, usage: payload?.usage ?? {} })
    writeImmutable(`${out}/${name}.result.json`, result); writeImmutable(`${out}/receipts-${receipts.length}.json`, receipts)
    process.stderr.write(`${name}: ${result.status}, ${result.score ? `${result.score.correct}/${result.score.total}` : 'unscored'}\n`)
    if (failure) break
  }
  if (hash(read(o.in)) !== manifest.baselineSha256) throw new Error('Accepted graph changed during experiment')
  const output = { manifest, results, receipts, status: results.length === 4 && results.every((r) => r.status === 'valid') ? 'completed' : 'incomplete', cost: receipts.reduce((n, r) => n + (Number.isFinite(r.usage.cost) ? r.usage.cost : 0), 0), costComplete: receipts.every((r) => Number.isFinite(r.usage.cost)), applicationStatus: 'not-applied' }
  writeImmutable(`${out}/output.json`, output); return output
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), o = {}
    for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prepared', '--prior', '--previous', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
    for (const k of ['in', 'prepared', 'prior', 'previous', 'out']) if (!o[k]) throw new Error(`Missing ${k}`)
    const r = await runContrasts(o); process.stdout.write(JSON.stringify({ status: r.status, cost: r.cost, costComplete: r.costComplete, results: r.results.map((x) => ({ condition: x.condition, order: x.order, status: x.status, score: x.score?.correct })) }) + '\n')
  } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
}
