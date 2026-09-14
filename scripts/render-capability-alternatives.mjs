#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
const input = resolve(process.argv[2]), out = dirname(input)
execFileSync('git', ['check-ignore', '-q', `${out}/index.html`])
const data = JSON.parse(readFileSync(input, 'utf8'))
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const structured = data.protocol.startsWith('structures-')
const arrangement = (a) => {
  if (!a.structure) return ''
  const names = new Map(a.candidateGraph.nodes.map((n) => [n.id, n.name]))
  const lines = a.structure.contains.map((e) => `${names.get(e.from)} → ${names.get(e.to)}`)
  if (a.structure.removeNodeIds.length) lines.push(`Replace ${a.structure.removeNodeIds.join(', ')} with ${a.structure.newNodes.map((n) => n.name).join('; ')}`)
  if (!lines.length) lines.push('Keep current capability boundaries.')
  return `<pre>${escape(lines.join('\n'))}</pre>`
}
const overview = structured ? `<h2>The proposed map, at a glance</h2><p>Parent → child below preserves both capabilities. These are independent case proposals, not a reconciled whole-map update. Model checks are provisional: they can mistake missing evidence for support.</p>
${data.results.map((r) => { const a = r.comparison.alternatives.find((a) => a.id === r.comparison.selectedId); return `<article><h3>${escape(r.name)}</h3><p>${escape(a.label)}</p>${arrangement(a)}<p><b>Model check:</b> ${escape(({ supported: 'The model found support in the retrieved evidence.', partial: 'Some support; important details remain unresolved.', unsupported: 'The model found substantial problems.' })[r.audit.verdict])}</p><p>${r.comparison.links.length} additional dependency/implementation proposals · <a href="#${escape(r.nodeId)}">Inspect details if useful</a></p></article>` }).join('')}
<p><b>Your role:</b> Does this broadly look like a sensible organization of the project? You can flag anything that feels off without reviewing individual citations.</p><h2>Optional detail</h2>` : ''
const sections = data.results.map((result) => {
  const c = result.comparison, chosen = c.alternatives.find((a) => a.id === c.selectedId)
  return `${structured ? `<details><summary>${escape(result.name)} — alternatives and evidence</summary>` : ''}<section id="${escape(result.nodeId)}"><h2>${escape(result.nodeId)} · ${escape(result.name)}</h2>
<p>${escape(result.cohort)} · ${result.retrieval.readingCount} readings · ${result.retrieval.sourceCount} source excerpts</p>
<h3>Chosen: ${escape(chosen.label)} (${escape(chosen.type)})</h3><p>${escape(c.reason)}</p>
${c.alternatives.map((a) => `<article><h3>${escape(a.id)} · ${escape(a.label)}${a.id === c.selectedId ? ' — chosen' : a.id === c.strongestAlternativeId ? ' — strongest alternative' : ''}</h3><p>${escape(a.description)}</p>${arrangement(a)}<p><b>Support:</b> ${escape(a.support)}</p><p><b>Weakness:</b> ${escape(a.weakness)}</p><p>Evidence: ${a.evidenceIds.map((id) => `<a href="#${escape(result.nodeId + '-' + id)}">${escape(id)}</a>`).join(' ')}</p></article>`).join('')}
${structured ? `<h3>Additional links (compatible with the structure)</h3><pre>${escape(JSON.stringify(c.links, null, 2))}</pre><h3>Model audit</h3><p>${escape(result.audit.summary)}</p><ul>${result.audit.issues.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>` : ''}
<h3>Unresolved</h3><ul>${c.unresolved.map((q) => `<li>${escape(q)}</li>`).join('')}</ul>
${structured ? '' : `<p><b>Your review:</b> Does the chosen relationship make sense? Would you prefer the rival? What is missing? Reply using ${escape(result.nodeId)}.</p>`}
<details><summary>Exact retrieved evidence and omissions</summary>${result.retrieval.evidence.map((e) => `<article id="${escape(result.nodeId + '-' + e.id)}"><h4>${escape(e.id)} · ${escape(e.kind === 'source' ? e.path + ':' + e.startLine + '-' + e.endLine : e.subject)}</h4><p>${escape(e.commitSha)} · ${escape(e.interpretationStatus)}</p><pre>${escape(e.text)}</pre></article>`).join('')}<pre>${escape(JSON.stringify(result.retrieval.omitted, null, 2))}</pre></details></section>${structured ? '</details>' : ''}`
}).join('')
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capability alternatives experiment</title><style>body{max-width:1040px;margin:32px auto;padding:0 24px;font:16px/1.6 system-ui;color:#202522;background:#fafbf9}section{margin:45px 0}article{padding:16px 22px;border:1px solid #d5ddd5;background:white;border-radius:8px;margin:12px 0}h2,h3{line-height:1.3}a{color:#146448}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}nav{display:flex;flex-wrap:wrap;gap:15px}:target{outline:2px solid #74a985}</style>
<h1>Capability alternatives experiment</h1><p>${data.results.length} independent cases · $${data.cost?.toFixed(4) ?? 'unknown'} accounted request cost${data.newInferenceCost !== undefined ? ` ($${data.newInferenceCost?.toFixed(4) ?? 'unknown'} new for this correction)` : ''} · proposal-only; baseline unchanged</p>
<p>Chosen interpretations and their strongest alternatives, with exact supporting evidence. No ratings or suggested parent names were supplied. Targeted cases were selected from your boundary questions; blind-selection cases were chosen deterministically from other nodes, not from an unseen repository.</p>
<nav>${data.results.map((r) => `<a href="#${escape(r.nodeId)}">${escape(r.nodeId + ': ' + r.name)}</a>`).join('')}<a href="output.json">Complete raw output</a></nav>${overview}${sections}
<script>for(const a of document.querySelectorAll('a[href^="#"]'))a.addEventListener('click',()=>{let target=document.getElementById(a.hash.slice(1));while(target){if(target.tagName==='DETAILS')target.open=true;target=target.parentElement}})</script></html>`
writeFileSync(`${out}/index.html`, html)
process.stdout.write(`${out}/index.html\n`)
