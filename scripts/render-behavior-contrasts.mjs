#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const json = (x) => `<pre>${esc(JSON.stringify(x,null,2))}</pre>`
export function renderContrasts(output, cases, oracle, diagnostics, audit = null) {
  const columns = output.results.map((r) => `${r.condition} ${r.order}`)
  const rows = cases.map((c) => `<tr><th><a href="#${esc(c.id)}">${esc(c.id)}</a><br>${esc(c.family)}</th><td>${esc(oracle.find((o)=>o.id===c.id)?.expectedDelta)}</td>${output.results.map((r) => {
    const d=r.value?.decisions?.find((d)=>d.id===c.id), s=r.score?.items.find((i)=>i.id===c.id)
    return `<td>${esc(d?.behaviorDelta ?? '—')} ${s ? s.correct ? '✓' : '✗' : '(unscored)'}<br><small>Relation: ${esc(d?.capabilityRelation ?? '—')}</small></td>`
  }).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Behavior contrasts — experiment 1</title><style>
body{font:16px/1.55 system-ui;margin:0;background:#f4f6f8;color:#24313c}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:32px;line-height:1.2}h2{margin-top:36px}a{color:#145b9b}table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}th,td{border:1px solid #ced7de;padding:10px;text-align:left;vertical-align:top}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e9eef2;padding:16px;font-size:13px}details{background:#fff;border:1px solid #d4dde4;padding:14px;margin:12px 0}summary{cursor:pointer;font-weight:600}.note{border-left:4px solid #ad7824;padding:12px 16px;background:#fff5dd}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}small{color:#53616d}@media(max-width:700px){main{padding:14px}.grid{grid-template-columns:1fr}}
</style><main><a href="../experiment-summary/index.html">All experiments</a><h1>Can the model separate behavior from machinery?</h1>
<p>Fixed synthetic code contrasts · ${esc(output.status)} · $${Number(output.cost).toFixed(6)}${output.costComplete?'':' known; usage incomplete'} · accepted map unchanged</p>
<p>${output.results.map((r)=>`${esc(r.condition)} ${esc(r.order)}: <strong>${r.score ? `${r.score.correct}/${r.score.total}` : esc(r.status)}</strong>`).join(' · ')}</p>
<p class="note">Scores measure observable behavior changes and deliberate evidence gaps—not correct capability grouping. These are eight small cases from three related synthetic families, not eight independent production features. All model-created capability relations below remain qualitative proposals.</p>
${audit ? `<h2>What we learned</h2>${audit.findings.map((x)=>`<p>${esc(x)}</p>`).join('')}<p><strong>Next:</strong> ${esc(audit.next)}</p>` : ''}
<h2>Every decision</h2><p>The expected delta comes from executed probes or an explicitly missing helper. No expected capability-relation label is supplied or scored.</p><div class="table"><table><thead><tr><th>Case</th><th>Expected delta</th>${columns.map((c)=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<h2>Protocol and limitations</h2><p>${esc(output.manifest.design)}</p><p>${esc(output.manifest.limitations)}</p><details><summary>Full manifest and spending limits</summary>${json(output.manifest)}</details>
<h2>Full code, checks and explanations</h2>${cases.map((c)=>{
    const o=oracle.find((o)=>o.id===c.id)
    return `<section id="${esc(c.id)}"><h3>${esc(c.id)} · ${esc(c.family)}</h3><p>${esc(c.domain)}</p><div class="grid"><div><strong>Unit A</strong><pre>${esc(c.a)}</pre></div><div><strong>Unit B</strong><pre>${esc(c.b)}</pre></div></div><p>Expected delta: ${esc(o.expectedDelta)}. ${o.probes.length} executed probes${o.differences !== undefined ? `; ${o.differences} differences` : ''}. ${esc(o.reason ?? '')}</p>${o.probes.some((p)=>!p.equal)?`<details open><summary>First observed difference</summary>${json(o.probes.find((p)=>!p.equal))}</details>`:''}<details><summary>All executable checks</summary>${json(o)}</details>${output.results.map((r)=>`<details><summary>${esc(r.condition)} ${esc(r.order)} — ${esc(r.status)}</summary>${json(r.value?.decisions?.find((d)=>d.id===c.id) ?? r.issues ?? r.error)}</details>`).join('')}</section>`
  }).join('')}
<h2>Complete model outputs</h2>${output.results.map((r)=>`<details><summary>${esc(r.condition)} ${esc(r.order)} — ${esc(r.status)}</summary><p><a href="${r.condition}-${r.order}.request.json">Exact request</a> · <a href="${r.condition}-${r.order}.result.json">Parsed result and validation</a> · <a href="${r.condition}-${r.order}.${r.status === 'provider_error'?'failure':'response'}.json">Raw saved outcome</a></p>${json(r)}</details>`).join('')}
<h2>Validation feedback repair</h2><p>A new version locates all ownership-field errors, including unsupported revisions in behavior definitions and implementations. Old requests and results remain intact for exact replay. This offline check did not purchase or invent corrected model answers.</p><details><summary>All field-specific diagnostics on the previous experiment</summary>${json(diagnostics)}</details>
<p><a href="source-inspiration.json">Original source inspiration, not the synthetic fixture</a> · <a href="fixture.json">Frozen synthetic fixtures</a> · <a href="oracle.json">Checks hidden from model input</a> · <a href="output.json">Full experiment data</a></p></main></html>`
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir=dirname(resolve(process.argv[2])), read=(name)=>JSON.parse(readFileSync(`${dir}/${name}.json`,'utf8'))
  let audit=null; try { audit=read('audit') } catch(e) { if(e.code!=='ENOENT') throw e }
  writeFileSync(`${dir}/index.html`,renderContrasts(read('output'),read('fixture'),read('oracle'),read('ownership-feedback-v2'),audit))
}
