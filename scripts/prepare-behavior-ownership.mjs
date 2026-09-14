#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash } from './lib/capability-graph.mjs'
import { DEFAULT_MODEL } from './lib/capability-hierarchy-critic.mjs'
import { scopeTensions, ownershipRequest } from './lib/behavior-ownership.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, value) => { const text = JSON.stringify(value, null, 2) + '\n'; if (existsSync(p)) { if (readFileSync(p, 'utf8') !== text) throw new Error(`refusing overwrite ${p}`); return } mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' }) }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const args = process.argv.slice(2), o = {}
for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prior', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
for (const k of ['in', 'prior', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
const baseline = read(o.in), prior = read(`${o.prior}/output.json`), packet = read(`${o.prior}/packet.json`), out = resolve(o.out)
execFileSync('git', ['check-ignore', '-q', `${out}/plan.json`])
if (hash(baseline) !== prior.manifest.baselineSha256 || hash(packet) !== prior.manifest.packetSha256) throw new Error('input fingerprint mismatch')
const diagnostics = prior.reviews.map((r) => ({ condition: r.condition, order: r.order, reviewStatus: r.status, tensions: r.status === 'valid' ? scopeTensions(prior.pairs, r.value) : [] }))
const requests = ['forward', 'reverse'].map((order) => {
  const request = ownershipRequest(prior.nodes, prior.pairs, packet, baseline.headSha, DEFAULT_MODEL, order === 'reverse')
  const characters = request.messages.reduce((n, m) => n + m.content.length, 0)
  if (characters > 430000) throw new Error('prompt size limit')
  write(`${out}/planned-${order}.json`, request)
  return { order, file: `planned-${order}.json`, requestSha256: hash(request), characters }
})
const plan = { protocol: 'behavior-ownership-preparation-v1', status: 'prepared-not-run', baselineSha256: hash(baseline), priorSha256: hash(prior), packetSha256: hash(packet), headSha: baseline.headSha,
  cost: 0, providerCalls: 0, source: 'Prior behavioral-boundary neighborhood and fixed evidence; no new source observations.',
  question: 'Can model-discovered behavior witnesses and explicit responsibility roles produce better-grounded, scope-consistent capability decisions without prohibiting composites?',
  design: 'Two independent ownership-and-pair reviews with reversed pair order. Same five candidates and ten pairs. Model discovers behavior IDs, responsibility roles and implementation/history observations separately. No previous definitions, decisions, diagnostic findings, owner examples or expected answers enter requests. A whole-answer consistency pass is requested. Results are provisional and never composed into the accepted graph.',
  limitations: 'Preparation only. No semantic result or paid inference. This changes instructions and representation together, so any later difference cannot be attributed to representation alone. At most 12 model-discovered behaviors is a budget, not exhaustive coverage or target count. Role categories and cross-reference constraints are experimental. Explicit roles may shift assumptions without improving them. Pair-label diagnostics are only conditional tensions because previous scopes/revisions live in prose. Citation and witness accounting cannot validate meaning.',
  liveBoundary: 'Live calls require confirmation that provider spending is available. Preparation has no provider-call code. Do not overwrite the previous blocked audit or simulate missing verdicts. A later live run should persist raw responses before validation, stop on provider error, avoid automatic retries/repairs, and record complete or missing usage.',
  instructionCorrection: 'The previous define prompt explicitly said to mark mixed responsibilities disputed. This instruction biased against composite capabilities; the new prompt explicitly permits coherent multi-responsibility scopes. This is a protocol correction, not proof that the new representation works.',
  requests, diagnostics, diagnosticsSuppliedToModel: false, applicationStatus: 'not-applied' }
write(`${out}/plan.json`, plan); write(`${out}/packet.json`, packet)
const names = new Map(prior.nodes.map((n) => [n.id, n.name]))
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Behavior ownership: prepared test</title><style>body{font:16px/1.65 system-ui;color:#23313b;background:#f6f8fa;padding:24px;margin:0}main{max-width:1050px;margin:auto}article{background:white;border:1px solid #d4dce3;border-radius:8px;padding:18px;margin:16px 0}.notice{background:#e8f1f8;padding:18px;border-left:4px solid #477596}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}a{color:#175db0}summary{cursor:pointer}</style><main><h1>Behavior ownership and scope consistency</h1><div class="notice">Prepared, not run. No new model verdicts or paid calls. The prior provider spending limit has not been bypassed. Your accepted map is unchanged.</div><h2>What this test asks</h2><p>${esc(plan.question)}</p><p>${esc(plan.design)}</p><h2>A correction to the previous test</h2><p>${esc(plan.instructionCorrection)}</p><h2>Existing-output diagnostics—not new inference</h2><p>A potential tension means broader → included behavior → overlap needs scope review. It does not prove contradiction, and it never changes a decision automatically.</p>${diagnostics.map((d) => `<article><h3>${esc(d.condition)} · ${esc(d.order)}</h3>${d.tensions.length ? d.tensions.map((t) => `<p>${esc(names.get(t.larger))} is called broader than ${esc(names.get(t.included))}; the latter overlaps ${esc(names.get(t.other))}, but the larger capability is called distinct from it.</p><p>${esc(t.assumption)}</p>`).join('') : '<p>No tension matching this narrow diagnostic rule. This is not a correctness pass.</p>'}</article>`).join('')}<h2>What will be recorded</h2><p>The model will name concrete behaviors, then distinguish includes, uses, hosts, excludes and unknown for each capability. Shared interfaces will not automatically count as shared responsibility. Each pair decision will reference those behaviors and specify evidence that could change it. Broader capabilities remain allowed. Unknown is not exclusion.</p><h2>Limits and run status</h2><p>${esc(plan.limitations)}</p><p>${esc(plan.liveBoundary)}</p><p>New cost: $0 · provider calls: 0.</p><details><summary>Full prepared protocol and local diagnostics</summary><pre>${esc(JSON.stringify(plan, null, 2))}</pre></details><p>${requests.map((r) => `<a href="${r.file}">${r.order} planned request</a>`).join(' · ')} · <a href="plan.json">Plan and fingerprints</a> · <a href="packet.json">Fixed evidence</a></p></main></html>`
if (existsSync(`${out}/index.html`) && readFileSync(`${out}/index.html`, 'utf8') !== html) throw new Error('refusing report overwrite')
if (!existsSync(`${out}/index.html`)) writeFileSync(`${out}/index.html`, html, { flag: 'wx' })
process.stdout.write(JSON.stringify({ out, status: plan.status, providerCalls: 0, diagnosticCounts: diagnostics.map((d) => ({ condition: d.condition, order: d.order, count: d.tensions.length })) }) + '\n')
