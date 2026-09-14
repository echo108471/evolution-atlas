#!/usr/bin/env node
/** Read-only broad review, with every rival and every model judgment exposed. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export function renderScopes(data, packets) {
  const names = new Map(data.graph.nodes.map((n) => [n.id, n.name]))
  const columns = ['existing-evidence-forward', 'existing-evidence-reverse', 'enriched-evidence-forward', 'enriched-evidence-reverse']
  const judgmentAt = (r, key) => r.judgments.find((j) => `${j.condition}-${j.order}` === key)
  const alternatives = (r) => r.plan.value?.alternatives ?? []
  const chosen = (r, j) => !j ? 'Not run' : j.status !== 'valid' ? `Invalid: ${j.validationError}` :
    j.value.selectedId === null ? 'Undecided' : alternatives(r).find((a) => a.id === j.value.selectedId)?.label ?? 'Unknown'
  const scopeTree = (g, ids) => {
    const nodes = g.nodes.filter((n) => ids.has(n.id)), links = g.edges.filter((e) => e.type === 'contains' && ids.has(e.from) && ids.has(e.to))
    const walk = (n) => {
      const children = links.filter((e) => e.from === n.id).map((e) => nodes.find((m) => m.id === e.to))
      return children.length ? `<li><details open><summary>${esc(n.name)}</summary><p>${esc(n.summary)}</p><ul>${children.map(walk).join('')}</ul></details></li>` : `<li><span>${esc(n.name)}</span><small>${esc(n.summary)}</small></li>`
    }
    return `<ul class="tree">${nodes.filter((n) => !links.some((e) => e.to === n.id)).map(walk).join('')}</ul>`
  }
  const title = (r) => r.plan.value?.question ?? r.case.members.map((id) => names.get(id)).join(' / ')
  const rows = data.results.map((r) => `<tr><th><a href="#${esc(r.case.id)}">${esc(title(r))}</a></th>${columns.map((key) => `<td>${esc(chosen(r, judgmentAt(r, key)))}</td>`).join('')}</tr>`).join('')
  const cases = data.results.map((r) => {
    if (r.plan.status !== 'valid') return `<section id="${esc(r.case.id)}"><h2>${esc(title(r))}</h2><p>Planning failed validation: ${esc(r.plan.validationError)}. No replacement answer was generated.</p><a href="${esc(r.case.id)}/plan.response.json">Original response</a></section>`
    const p = packets[r.case.id]
    const assessments = `<div class="scroll"><table><thead><tr><th>Alternative</th>${columns.map((key) => `<th>${esc(key.replaceAll('-', ' '))}</th>`).join('')}</tr></thead><tbody>${alternatives(r).map((a) => `<tr><th>${esc(a.id)} · ${esc(a.label)}</th>${columns.map((key) => `<td>${esc(judgmentAt(r, key)?.value?.assessments.find((v) => v.alternativeId === a.id)?.verdict ?? 'Not assessed')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    const cards = alternatives(r).map((a) => `<article><h3>${esc(a.id)} · ${esc(a.label)}</h3><p class="badge">${esc(a.kind === 'keep' ? 'Unchanged map' : a.kind === 'reuse' ? 'Existing parent' : 'New parent')}</p><p>${esc(a.description)}</p><p><strong>Planner’s concern:</strong> ${esc(a.weakness)}</p>
      <details><summary>See this arrangement, including the detail underneath</summary>${scopeTree(a.candidateGraph, new Set([...r.case.seedIds, ...a.newNodes.map((n) => n.id)]))}<p>Other capabilities and every original link remain unchanged. Shared children can appear more than once.</p></details></article>`).join('')
    const judgments = columns.map((key) => {
      const j = judgmentAt(r, key)
      if (!j || j.status !== 'valid') return `<details><summary>${esc(key)} — ${esc(chosen(r, j))}</summary><p>No repaired or substitute decision.</p></details>`
      const v = j.value
      return `<details><summary>${esc(key)} — ${esc(chosen(r, j))}</summary><p>${esc(v.reason)}</p>${v.assessments.map((a) => `<h4>${esc(a.alternativeId)} · ${esc(a.verdict)}</h4><p>${esc(a.reason)}</p><p class="citations">${a.evidenceIds.map((id) => `<a href="#${esc(r.case.id)}-${esc(id)}">${esc(id)}</a>`).join(' · ')}</p>`).join('')}
      <h4>Does a new parent duplicate an existing capability?</h4>${v.noveltyChecks.map((n) => `<p><strong>${esc(n.alternativeId)} / ${esc(n.newNodeId)}:</strong> ${esc(n.relationship)} relative to ${esc(names.get(n.closestExistingId))}. ${esc(n.reason)}</p><p class="citations">${n.evidenceIds.map((id) => `<a href="#${esc(r.case.id)}-${esc(id)}">${esc(id)}</a>`).join(' · ')}</p>`).join('')}
      <h4>Still unresolved</h4><ul>${v.unresolved.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>${v.missingAlternative ? `<p>Missing alternative: ${esc(v.missingAlternative)}</p>` : ''}<a href="${esc(r.case.id)}/${key}.response.json">Exact model response</a></details>`
    }).join('')
    const evidence = p.enriched.map((e) => `<details id="${esc(r.case.id)}-${esc(e.id)}"><summary>${esc(e.id)} · ${esc(e.kind)} · ${esc(e.path ?? e.subject)} ${p.addedEvidence.some((x) => x.id === e.id) ? '(added)' : '(existing)'}</summary><p>${esc(e.commitSha)}${e.path ? ` · lines ${e.startLine}–${e.endLine} of ${e.totalLines}` : ''}</p><pre>${esc(e.text)}</pre></details>`).join('')
    return `<section id="${esc(r.case.id)}"><h2>${esc(title(r))}</h2><p>${r.case.seedIds.map((id) => esc(names.get(id))).join(' · ')}</p><p>${r.retrieval.addedSourceCount} additional source windows; ${r.retrieval.addedEvidenceIds.length} additional evidence items by exact ID. Overlapping source windows may repeat code. ${r.retrieval.omitted.length} requests omitted. Evidence coverage is bounded, not exhaustive.</p>
    ${assessments}<div class="cards">${cards}</div><h3>All four decisions</h3>${judgments}
    <details><summary>Evidence requests and gaps</summary><ul>${r.plan.value.sources.map((s) => `<li>${esc(s.path)}:${s.startLine} at ${esc(s.revision)} — ${esc(s.discriminates)}</li>`).join('')}</ul><pre>${esc(JSON.stringify(r.retrieval.omitted, null, 2))}</pre><a href="${esc(r.case.id)}/retrieval.json">Retrieval receipts</a></details>
    <details><summary>Read every supplied excerpt (${p.enriched.length})</summary>${evidence}</details><p><a href="${esc(r.case.id)}/output.json">Full case output and all alternative graphs</a> · <a href="${esc(r.case.id)}/plan.response.json">Original rival proposal</a> · <a href="${esc(r.case.id)}/packets.json">Exact evidence packets</a></p></section>`
  }).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Competing umbrella scopes</title><style>
  body{font:16px/1.6 system-ui,sans-serif;max-width:1200px;margin:36px auto;padding:0 22px;color:#203028;background:#fafbf9}a{color:#146448}h1,h2,h3{line-height:1.25}h4{margin-bottom:5px}section{background:white;border:1px solid #d5ddd5;border-radius:10px;padding:24px;margin:28px 0;scroll-margin-top:15px}.note{padding:18px;background:#eaf0e8;border-radius:8px}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #ccd5cc;min-width:150px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{border:1px solid #dce3db;border-radius:8px;padding:16px}article h3{margin-top:0}.badge{font-size:13px;color:#526653}details{margin:16px 0}summary{cursor:pointer;font-weight:600}pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f1;padding:12px}small{display:block;color:#546154}.tree{padding-left:20px}.tree li{margin:12px 0}.tree p{font-size:13px}.citations{font-size:12px;overflow-wrap:anywhere}a:focus-visible,summary:focus-visible{outline:3px solid #479071;outline-offset:3px}</style>
  <h1>Which umbrella scope earns its place?</h1><p>Three neighborhoods from the previous model disagreements. The model proposes rival scopes, then judges the same choices with existing or enriched evidence. A second pass reverses the alternatives’ order. All detail underneath is preserved.</p>
  <p class="note">Your review can stay broad: do these alternatives and the reasons for choosing between them make sense? No commit-by-commit scoring is needed. These are competing proposals—not a winning map or an automatic update.</p>
  <div class="scroll"><table><thead><tr><th>Boundary question</th><th>Existing evidence<br>Forward</th><th>Existing evidence<br>Reverse</th><th>Enriched evidence<br>Forward</th><th>Enriched evidence<br>Reverse</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p>“Undecided” is a valid result, not evidence that the capabilities are absent. Agreement is not proof of correctness. One call per order cannot separate order sensitivity from ordinary sampling variability. The unchanged baseline and a reuse interpretation can sometimes have identical topology; inspect their scope descriptions.</p>
  <p class="note"><strong>Important test limitation:</strong> all original direct links were frozen. Inserting a parent can therefore create redundant paths to the same child, and a judge may penalize that representation rather than the underlying scope. Several valid structures can coexist; requiring a uniquely justified winner can also produce unnecessary abstention. These results do not establish that broader umbrellas are wrong.</p>${cases}
  <h2>Protocol and limits</h2><p>${esc(data.manifest.design)}</p><p>${esc(data.manifest.selectionRule)}</p><p>${esc(data.manifest.limitations)}</p><p>Recorded cost: <strong>$${data.cost?.toFixed(4) ?? 'unknown'}</strong>. Validation failures: ${data.stages.filter((s) => s.validationError).length}. No automatic repairs. The accepted map is unchanged.</p><p><a href="manifest.json">Frozen protocol and case selection</a> · <a href="output.json">Complete output and usage receipts</a> · <a href="../umbrella-ablation-1/index.html">Previous experiment</a></p></html>`
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('output.json required')
  const path = resolve(process.argv[2]), out = dirname(path), data = JSON.parse(readFileSync(path, 'utf8'))
  execFileSync('git', ['check-ignore', '-q', `${out}/index.html`])
  const packets = Object.fromEntries(data.results.filter((r) => r.plan.status === 'valid').map((r) => [r.case.id, JSON.parse(readFileSync(`${out}/${r.case.id}/packets.json`, 'utf8'))]))
  writeFileSync(`${out}/index.html`, renderScopes(data, packets))
  process.stdout.write(`${out}/index.html\n`)
}
