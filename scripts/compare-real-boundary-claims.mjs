#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { writeImmutable } from './run-behavior-ownership.mjs'
import { SOURCE_IDS, realClaimCases, parserObservations, claimsRequest, claimsDiagnostics, qualifyClaimIds } from './lib/real-boundary-claims.mjs'
const read = p => JSON.parse(readFileSync(p, 'utf8'))

export function prepareClaims(packet, repo) {
  const initial = SOURCE_IDS.map(id => packet.evidence.find(e => e.id === id))
  const caller = packet.evidence.find(e => e.id === 'S750eacab8e39ecb6')
  if ([...initial, caller].some(e => !e || e.kind !== 'source')) throw new Error('Missing pinned source')
  const additional = [caller]
  // Read only exact source paths and revisions already present in the saved evidence packet.
  for (const anchor of [...initial, caller]) {
    const ref = `${anchor.commitSha}:${anchor.path}`
    const blob = execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim()
    const text = execFileSync('git', ['-C', repo, 'show', ref], { encoding: 'utf8' })
    const lines = text.trimEnd().split('\n')
    if (blob !== anchor.blobSha || lines.slice(anchor.startLine - 1, anchor.endLine).join('\n') !== anchor.text) throw new Error('Pinned source mismatch')
    if (['S0939e25f12ad3bd0','S0235cc4de9fc2e84'].includes(anchor.id)) additional.push({ ...anchor, id: `${anchor.id}-tail`, startLine: anchor.endLine + 1, endLine: lines.length, text: lines.slice(anchor.endLine).join('\n'), truncated: false, interpretationStatus: 'observed' })
  }
  const observations = [parserObservations(initial.find(e => e.id === 'S71375ea117d2451c'))]
  return { cases: realClaimCases(), initial, additional, observations }
}

export const AUDIT_PLAN = {
  basis: 'Root-agent-authored factual checks frozen before inference. Same agent designed and audits this diagnostic; not independent judging or a capability gold set. Report quotations and exceptions, not an aggregate semantic accuracy score.',
  checks: [
    { id: 'A1', case: 'P1', check: 'Distinguish generating a review-derived summary from parsing/displaying supplied text; common purpose or data alone is not shared responsibility.' },
    { id: 'A2', case: 'P1', check: 'Formatting requests are not guaranteed enforcement; renderer accepts non-keyword text and does not enforce a sentence cap.' },
    { id: 'A3', case: 'P1', check: 'Empty review input returns No reviews available without invoking the generation chain; claims should scope the generation path.' },
    { id: 'A4', case: 'P2', check: 'Feedback requires showFeedback and an onFeedback handler, plus nonempty content. Actual shown caller omits onFeedback; caller behavior is unknown before its mounting window is supplied.' },
    { id: 'A5', case: 'P2', check: 'Calling an onFeedback callback is not demonstrated persistence, network submission, or a guarantee that the parent updates feedbackGiven.' },
    { id: 'A6', case: 'P3', check: 'Batch writes are unknown from initial first 79 lines; appended source shows summary writes and conditional flagged-data writes.' },
    { id: 'A7', case: 'P3', check: 'Parsing model output as JSON does not validate requested course fields/pros/cons/verdict shape.' },
    { id: 'A8', case: 'P3', check: 'Different source revisions do not establish replacement or simultaneous deployment.' },
  ],
  limitations: 'Selected familiar neighborhood, three overlapping cases, one model, one run per condition/stage, no order replication, no blind held-out repo. Additional source and observations are bundled, so their individual effects cannot be separated. Same-model revision sees its own earlier answer and can be anchored. Relations remain unscored.'
}

export async function runRealClaims(o, { requestProvider = requestHierarchyCriticRequestPayload, apiKey = process.env[API_KEY_ENV], prepareBundle = () => prepareClaims(read(`${o.prepared}/packet.json`), resolve(o.repo)) } = {}) {
  const out = resolve(o.out), baseline = read(o.in)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  const bundle = o['replay-from'] || o['reconcile-from'] ? read(`${o['replay-from'] ?? o['reconcile-from']}/bundle.json`) : prepareBundle()
  const reconciliation = o['reconcile-from'] ? { originalOutputSha256: hash(read(`${o['reconcile-from']}/output.json`)), rule: 'Qualify literal CASE-C1/2/3 identifiers with their containing case ID. Preserve every other field. Raw invalid answers and diagnostics retained. Not a model correction or a semantic revision.' } : o['replay-from'] ? read(`${o['replay-from']}/manifest.json`).reconciliation : undefined
  const manifest = { protocol: reconciliation ? 'real-boundary-claims-v1-reconciled' : 'real-boundary-claims-v1', ...(reconciliation ? { reconciliation } : {}), baselineSha256: hash(baseline), bundleSha256: hash(bundle), auditPlanSha256: hash(AUDIT_PLAN), model: DEFAULT_MODEL,
    design: 'Three real-code comparisons. Summary and behavioral-boundary representations receive identical initial source, then identical appended source and isolated parser observations. Sequence: summary initial, boundary initial, boundary expanded, summary expanded. Expanded answers explicitly revise their own prior factual claims. No owner labels, graph summaries, expected relations, audit criteria or other-arm answers exposed. No correction calls. Observations and audit plan frozen before initial calls.',
    limits: { maxRequests: 4, costStopBeforeNextRequest: 0.75, maxPromptCharacters: 75000, maxOutputTokens: 9000 }, limitations: AUDIT_PLAN.limitations, applicationStatus: 'not-applied' }
  writeImmutable(`${out}/bundle.json`, bundle); writeImmutable(`${out}/audit-plan.json`, AUDIT_PLAN); writeImmutable(`${out}/manifest.json`, manifest)
  for (const condition of ['summary','boundary']) writeImmutable(`${out}/planned-${condition}-initial.json`, claimsRequest(bundle, condition, 'initial', DEFAULT_MODEL))
  if (o.prepare) return { status: 'prepared-not-run', manifest }
  const results = [], receipts = []
  for (const [condition, stage] of [['summary','initial'],['boundary','initial'],['boundary','expanded'],['summary','expanded']]) {
    const previous = results.find(r => r.condition === condition && r.stage === 'initial')
    if (stage === 'expanded' && previous?.status !== 'valid') { if (reconciliation) continue; else break }
    const request = claimsRequest(bundle, condition, stage, DEFAULT_MODEL, previous?.value), name = `${condition}-${stage}`
    if (request.messages.reduce((n,m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('Prompt budget exceeded')
    const stem = `${resolve(o['replay-from'] ?? (stage === 'initial' && o['reconcile-from'] ? o['reconcile-from'] : out))}/${name}`
    let payload, failure
    if (existsSync(`${stem}.request.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('Exact request mismatch')
      if (existsSync(`${stem}.response.json`)) payload = read(`${stem}.response.json`)
      else if (existsSync(`${stem}.failure.json`)) failure = read(`${stem}.failure.json`)
      else throw new Error('Request without outcome; reconcile before retry')
    } else {
      if (o['replay-from'] || (stage === 'initial' && o['reconcile-from'])) throw new Error('Replay response missing; live fallback forbidden')
      if (receipts.some(r => !Number.isFinite(r.usage.cost) || r.usage.cost < 0) || receipts.reduce((n,r) => n + r.usage.cost,0) >= manifest.limits.costStopBeforeNextRequest) break
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
    else try { const value = parseResponse(payload), issues = claimsDiagnostics(value, bundle, condition, stage); result = { status: issues.length ? 'invalid' : 'valid', value, issues } }
    catch (e) { result = { status: 'invalid', issues: [{ path: '$', issue: e.message }] } }
    if (reconciliation && stage === 'initial' && result.value) {
      const normalized = qualifyClaimIds(result.value, bundle)
      if (normalized.changes.length) {
        const issues = claimsDiagnostics(normalized.value, bundle, condition, stage)
        result = { status: issues.length ? 'invalid' : 'valid', value: normalized.value, issues, original: result, identifierReconciliation: normalized.changes }
      }
    }
    results.push({ condition, stage, ...result }); receipts.push({ name, requestSha256: hash(request), status: result.status, model: payload?.model ?? request.model, usage: payload?.usage ?? {} })
    writeImmutable(`${out}/${name}.result.json`, results.at(-1)); writeImmutable(`${out}/receipts-${receipts.length}.json`, receipts)
    process.stderr.write(`${name}: ${result.status}\n`)
    if (failure) break
  }
  if (hash(read(o.in)) !== manifest.baselineSha256) throw new Error('Accepted graph changed')
  const output = { manifest, results, receipts, status: results.length === 4 && results.every(r => r.status === 'valid') ? 'completed' : 'incomplete', cost: receipts.reduce((n,r) => n + (Number.isFinite(r.usage.cost) ? r.usage.cost : 0), 0), costComplete: receipts.every(r => Number.isFinite(r.usage.cost)), applicationStatus: 'not-applied' }
  writeImmutable(`${out}/output.json`, output); return output
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), o = {}
    for (let i=0;i<args.length;i++) { if (args[i] === '--prepare') { o.prepare = true; continue }; if (!['--in','--out','--prepared','--repo','--replay-from','--reconcile-from'].includes(args[i]) || !args[i+1]) throw new Error('Invalid arguments'); o[args[i].slice(2)] = args[++i] }
    for (const k of ['in','out']) if (!o[k]) throw new Error(`Missing ${k}`)
    if (o['replay-from'] && o['reconcile-from']) throw new Error('Choose replay or reconciliation')
    if (!o['replay-from'] && !o['reconcile-from'] && (!o.prepared || !o.repo)) throw new Error('Missing source inputs')
    const r = await runRealClaims(o); process.stdout.write(JSON.stringify({ status: r.status, cost: r.cost, costComplete: r.costComplete }) + '\n')
  } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
}
