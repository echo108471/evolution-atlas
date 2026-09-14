#!/usr/bin/env node
/** Complete local human review: exact model labels, every edge, provenance and yes/no ballots. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hash, graphShape } from './lib/capability-graph.mjs'

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const md = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').replaceAll('|', '\\|')
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => i % 2 ? pairs : [...pairs, [arg, all[i + 1]]], []))
if (!options['--in'] || !options['--out']) throw new Error('Usage: node scripts/render-capability-graph-review.mjs --in <graph.json> --out <ignored directory>')
const inputPath = resolve(options['--in']), outputDir = resolve(options['--out'])
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('git', ['-C', root, 'check-ignore', '-q', `${outputDir}/index.html`])
const data = JSON.parse(readFileSync(inputPath, 'utf8')), graph = data.graph
const broad = options['--mode'] === 'broad'
const umbrella = data.method === 'umbrella-containment-ablation'
const shape = graphShape(graph), fingerprint = hash(data)
const byId = new Map(graph.nodes.map((node) => [node.id, node]))
const evidence = new Map([...data.readingRegistry, ...data.evidence].map((entry) => [entry.id, entry]))
const edges = graph.edges
const children = (id) => edges.filter((edge) => edge.type === 'contains' && edge.from === id)
const label = (id) => `${byId.get(id).name} [${id}]`
const treeLines = []
const walk = (id, prefix, connector, expanded) => {
  treeLines.push(`${prefix}${connector}${label(id)}${expanded.has(id) ? ' (also appears above)' : ''}`)
  if (expanded.has(id)) return
  expanded.add(id)
  const nextPrefix = prefix + (connector ? connector === '└── ' ? '    ' : '│   ' : '')
  const descendants = children(id)
  descendants.forEach((edge, index) => walk(edge.to, nextPrefix, index === descendants.length - 1 ? '└── ' : '├── ', expanded))
}
const expanded = new Set()
shape.roots.forEach((id) => { walk(id, '', '', expanded); treeLines.push('') })
const tree = treeLines.join('\n')
const hierarchyHtml = (id, seen = new Set()) => {
  const node = byId.get(id)
  if (seen.has(id)) return `<li><a href="#node-${escape(id)}">${escape(node.name)} (shared capability)</a></li>`
  seen.add(id)
  return `<li><details><summary>${escape(node.name)}</summary><p>${escape(node.summary)}</p><a href="#node-${escape(id)}">Optional evidence and detail</a>${children(id).length ? `<ul>${children(id).map((e) => hierarchyHtml(e.to, seen)).join('')}</ul>` : ''}</details></li>`
}
const allSeen = new Set()
const wholeMap = `<ul>${shape.roots.map((id) => hierarchyHtml(id, allSeen)).join('')}</ul>`
const pending = data.unreviewedNodeIds ?? []
const unresolved = [...new Set(data.history.flatMap((entry) => entry.result.unresolved))]
const summary = `${graph.nodes.length} capabilities · ${edges.filter((e) => e.type === 'contains').length} containment links · ${shape.dependencies} dependencies · maximum depth ${shape.maxDepth}`
const refs = (ids) => ids.map((id) => `<a href="#evidence-${escape(id)}">${escape(id)}</a>`).join(' ')
const ballot = (kind, id) => broad && kind !== 'map' ? '' : `<fieldset class="ballot" data-key="${escape(kind + ':' + id)}"><legend>${broad ? 'Does the overall organization broadly make sense?' : 'Your judgment'}</legend>
<label><input type="radio" name="${kind}:${escape(id)}" value="yes"> Yes</label>
<label><input type="radio" name="${kind}:${escape(id)}" value="no"> No</label>
<label><input type="radio" name="${kind}:${escape(id)}" value="" checked> Unrated</label>
<input class="note" type="text" placeholder="Optional correction or note" aria-label="Note for ${escape(id)}"></fieldset>`
const nodeCards = graph.nodes.map((node) => `${broad ? `<details><summary>${escape(node.name)}</summary>` : ''}<article id="node-${escape(node.id)}"><h3>${escape(label(node.id))}</h3>
<p>${escape(node.summary)}</p><p class="muted">${escape(({ 'prior-induction-leaf': 'Retained starting capability', revised: 'Revised during this run', proposed: 'Added during this run' })[node.origin] ?? 'Candidate capability')} · ${pending.includes(node.id) ? 'Not examined in this run' : broad ? 'Accounted for, not independently verified' : 'Accounted for in the run; awaiting your judgment'}</p>
${node.reason ? `<p><strong>Model rationale:</strong> ${escape(node.reason)}</p>` : ''}
<p><strong>Parents:</strong> ${edges.filter((e) => e.type === 'contains' && e.to === node.id).map((e) => escape(label(e.from))).join('; ') || 'None'}</p>
${node.supersedes?.length ? `<p><strong>Replaces:</strong> ${node.supersedes.map(escape).join(', ')}</p>` : ''}
<details><summary>Evidence (${node.evidenceIds.length})</summary><p class="refs">${refs(node.evidenceIds)}</p></details>
${ballot('node', node.id)}</article>${broad ? '</details>' : ''}`).join('\n')
const edgeCards = edges.map((edge) => `<article id="edge-${escape(edge.id)}"><h3>${escape(edge.id)} · ${escape(label(edge.from))} ${edge.type === 'contains' ? 'contains' : 'depends on'} ${escape(label(edge.to))}</h3>
<p>${escape(edge.reason)}</p><p class="refs">Evidence: ${refs(edge.evidenceIds)}</p>${ballot('edge', edge.id)}</article>`).join('\n')
const referenced = new Set([...graph.nodes, ...edges].flatMap((entry) => entry.evidenceIds))
for (const id of referenced) if (!evidence.has(id)) throw new Error(`missing report evidence ${id}`)
const evidenceHtml = [...referenced].map((id) => {
  const entry = evidence.get(id)
  const title = entry.kind === 'source' ? `${entry.path}:${entry.startLine}-${entry.endLine} @ ${entry.commitSha.slice(0, 8)}${entry.truncated ? ' · excerpt' : ''}` : `${entry.subject} @ ${entry.commitSha.slice(0, 8)}`
  return `<details id="evidence-${escape(id)}"><summary>${escape(id)} · ${escape(title)}</summary><p>${entry.kind === 'source' ? 'Observed source text' : 'Model reading of a commit; candidate interpretation'}</p><pre>${escape(entry.text)}</pre></details>`
}).join('\n')
const historyHtml = data.history.map((entry) => `<details><summary>Round ${entry.round} · ${escape(entry.investigationMode ?? 'local')} · depth ${entry.result.shape.maxDepth}</summary>
<p>${escape(entry.plan.raw.question)}</p><p>${escape(entry.result.reason)}</p>
<pre>${escape(JSON.stringify(entry.decision.raw, null, 2))}</pre></details>`).join('\n')
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Full capability graph — ${escape(data.repository)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#202522;background:#fafbf9;max-width:1060px;margin:32px auto;padding:0 22px}h1,h2,h3{line-height:1.25}h1{font-size:30px}h2{margin-top:40px}h3{font-size:18px}a{color:#146448}article{background:white;border:1px solid #d5ddd5;border-radius:8px;padding:16px 20px;margin:14px 0}.muted{color:#657065;font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf1eb;padding:16px;border-radius:6px;font-size:13px}#tree{white-space:pre;overflow:auto;line-height:1.7}.refs{overflow-wrap:anywhere}.ballot{border:0;padding:10px 0 0;margin:12px 0 0;border-top:1px solid #e0e7df}.ballot label{margin-right:18px}.note{display:block;width:96%;margin-top:10px;padding:8px;font:inherit}button{padding:10px 16px;background:#185d43;color:white;border:0;border-radius:5px;cursor:pointer}nav{display:flex;gap:18px;flex-wrap:wrap}details{margin:12px 0}summary{cursor:pointer}.toolbar{position:sticky;top:0;background:#fafbf9;padding:12px 0;border-bottom:1px solid #d5ddd5;z-index:1}#progress{margin-left:15px}article:target,details:target{outline:3px solid #b2d9b9}</style>
<style>[id]{scroll-margin-top:80px}</style>
<h1>${escape(data.repository)} — full capability output</h1><p>${escape(summary)}</p>
<p class="muted">Pinned revision ${escape(data.headSha)} · ${data.history.length} rounds · $${data.usage.cost?.toFixed(4) ?? 'unknown'} · ${escape(data.stopReason)}</p>
<p>${broad ? 'This is the combined whole-project candidate map, including data and infrastructure capabilities. Expand any area to see its responsibilities and children. Your feedback is broad plausibility; individual evidence checks are optional. Coverage means investigated or explicitly deferred, not proven correct.' : "These are the model's exact names, descriptions, and relationships. Your yes/no judgments evaluate this frozen output; they are not fed back into discovery. All items start unrated."}</p>
<div class="toolbar"><button id="export">Export my judgments</button><span id="progress"></span></div>
${umbrella ? `<p><strong>Controlled umbrella experiment:</strong> ${escape(data.protocol.condition)} starting links, repeat ${data.protocol.repeat}. All seed capability details were held fixed. Only containment was reconsidered, using the same frozen evidence packet in all runs. This is not a fresh implementation audit or an automatically accepted replacement.</p><p><a href="../index.html">Compare all four runs</a></p>` : ''}
${broad && pending.length ? `<p><strong>${umbrella ? 'Review scope:' : 'Budget limit reached:'}</strong> ${pending.length} ${umbrella ? 'capabilities were not explicitly accounted for in these two passes' : 'newly proposed capabilities still need a follow-up pass'}: ${pending.map((id) => escape(label(id))).join('; ')}. Their descriptions and evidence are included below.</p>` : ''}
${broad ? ballot('map', 'overall') : ''}
${broad && data.protocol.priorityIds ? `<p>Investigated first (not a predefined group): ${data.protocol.priorityIds.filter((id) => byId.has(id)).map((id) => `<a href="#node-${escape(id)}">${escape(byId.get(id).name)}</a>`).join(' · ')}</p>` : ''}
<nav><a href="#map">Full hierarchy</a><a href="#capabilities">All capabilities</a><a href="#relationships">All relationships</a><a href="#uncertainty">Open questions</a><a href="#evidence">Evidence</a><a href="#history">Every round</a><a href="output.json">Raw output</a><a href="review.md">Markdown</a></nav>
<h2 id="map">Full hierarchy</h2>${broad ? wholeMap : `<pre id="tree">${escape(tree)}</pre>`}
<h2 id="capabilities">All capabilities (${graph.nodes.length})</h2>${nodeCards}
<h2 id="relationships">All relationships (${edges.length})</h2>${edgeCards}
<h2 id="uncertainty">Questions recorded during the run</h2><p>Not accounted for: ${pending.map(escape).join(', ') || 'none'}. Accounting is not a correctness score. This includes earlier questions that later rounds may have addressed; see each round for chronology.</p><ul>${unresolved.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>
<h2 id="evidence">Referenced evidence (${referenced.size})</h2>${evidenceHtml}
<h2 id="history">Every round</h2>${historyHtml}
<script>const fingerprint=${JSON.stringify(fingerprint)};const storageKey='atlas-human-review:'+fingerprint;let judgments={};try{judgments=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}const fields=[...document.querySelectorAll('.ballot')];function update(){const rated=Object.values(judgments).filter(x=>x.verdict==='yes'||x.verdict==='no');document.getElementById('progress').textContent=rated.length+' / '+fields.length+' rated';try{localStorage.setItem(storageKey,JSON.stringify(judgments))}catch{}}for(const field of fields){const key=field.dataset.key;const saved=judgments[key];if(saved){for(const radio of field.querySelectorAll('input[type=radio]'))radio.checked=radio.value===saved.verdict;field.querySelector('.note').value=saved.note||''}field.addEventListener('change',()=>{judgments[key]={verdict:field.querySelector('input[type=radio]:checked').value,note:field.querySelector('.note').value};update()});field.querySelector('.note').addEventListener('input',()=>{judgments[key]={verdict:field.querySelector('input[type=radio]:checked').value,note:field.querySelector('.note').value};update()})}update();document.getElementById('export').addEventListener('click',()=>{const output={schemaVersion:'0.1.0',graphSha256:fingerprint,evaluation:'human-yes-no',judgments};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));a.download='capability-judgments.json';a.click();URL.revokeObjectURL(a.href)});for(const link of document.querySelectorAll('a[href^="#evidence-"]'))link.addEventListener('click',()=>{document.getElementById(link.hash.slice(1)).open=true});</script></html>`

const markdown = [`# ${data.repository}: full capability output`, '', summary, '',
  `Revision: ${data.headSha}. Rounds: ${data.history.length}. Status: ${data.stopReason}. Cost: $${data.usage.cost?.toFixed(4) ?? 'unknown'}.`, '',
  broad ? 'Evaluation: overall plausibility only. Does the organization broadly make sense? Yes/no: _____. Optional note: _____. Individual evidence review is optional; accounting is not correctness.' : 'Evaluation: your yes/no judgments of this frozen output. No judgments have been filled in.', '',
  '## Full hierarchy', '', '```text', tree, '```', '', '## All capabilities', '',
  ...graph.nodes.flatMap((node) => [`### ${md(label(node.id))}`, '', node.summary, '',
    `Model rationale: ${node.reason ?? 'Retained seed interpretation.'}`, '',
    `Evidence: ${node.evidenceIds.join(', ')}`, '', ...(broad ? [] : ['Your judgment (yes/no): _____', 'Correction: _____', ''])]),
  '## All relationships', '', '| ID | From | Relationship | To | Model rationale |', '| --- | --- | --- | --- | --- |',
  ...edges.map((edge) => `| ${edge.id} | ${md(label(edge.from))} | ${edge.type} | ${md(label(edge.to))} | ${md(edge.reason)} |`), '',
  '## Open questions', '', ...unresolved.map((item) => `- ${item}`), '',
  'Full evidence, per-round patches, and source excerpts are included in the adjacent output.json and interactive index.html.', ''].join('\n')
mkdirSync(outputDir, { recursive: true })
const navigationScript = `<script>function reveal(id){const target=document.getElementById(id);let parent=target;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement}return target}for(const a of document.querySelectorAll('a[href^="#"]'))a.addEventListener('click',()=>reveal(a.hash.slice(1)));if(location.hash)reveal(location.hash.slice(1))?.scrollIntoView()</script>`
writeFileSync(resolve(outputDir, 'index.html'), html.replace('</html>', navigationScript + '</html>').replace("evaluation:'human-yes-no'", `evaluation:'${broad ? 'human-overall-plausibility' : 'human-yes-no'}'`))
writeFileSync(resolve(outputDir, 'review.md'), markdown)
writeFileSync(resolve(outputDir, 'output.json'), `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ outputDir, nodes: graph.nodes.length, relationships: edges.length, evidence: referenced.size, graphSha256: fingerprint })}\n`)
