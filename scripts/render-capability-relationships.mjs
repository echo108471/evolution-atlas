#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export function renderRelationships(data, evidence) {
  const pool = data.proposal.value ?? { newNodes: [], edges: [], unresolved: [] }
  const nodes = [...data.graph.nodes, ...pool.newNodes], name = (id) => nodes.find((n) => n.id === id)?.name ?? id
  const phrase = (e) => `${name(e.from)} ${e.type === 'contains' ? 'includes' : e.type === 'supports' ? 'supports' : 'depends on'} ${name(e.to)}`
  const refs = (ids) => ids.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(' · ')
  const valid = data.reviews.filter((r) => r.status === 'valid')
  const status = (r, field, id) => r.status === 'valid' ? r.value[field].find((d) => d.id === id)?.decision ?? 'Missing' : 'Invalid review'
  const edgeRows = pool.edges.map((e) => `<tr><th>${esc(phrase(e))}${data.graph.edges.some((b) => b.type === e.type && b.from === e.from && b.to === e.to) ? '<small>Already exists — not a new discovery</small>' : ''}</th>${data.reviews.map((r) => `<td>${esc(status(r, 'edgeDecisions', e.id))}</td>`).join('')}<td><details><summary>Reasons and evidence</summary><p><strong>Proposed:</strong> ${esc(e.reason)}</p><p>${refs(e.evidenceIds)}</p>${valid.map((r) => {
    const d = r.value.edgeDecisions.find((d) => d.id === e.id)
    return `<h4>${esc(r.order)} · ${esc(d.decision)}</h4><p>${esc(d.reason)}</p><p>${refs(d.evidenceIds)}</p>`
  }).join('')}</details></td></tr>`).join('')
  const newNodes = pool.newNodes.map((n) => `<article><h3>${esc(n.name)}</h3><p>${esc(n.summary)}</p><p>Proposal: ${esc(n.reason)}</p><p>${refs(n.evidenceIds)}</p>${valid.map((r) => {
    const d = r.value.nodeDecisions.find((d) => d.id === n.id)
    return `<p><strong>${esc(r.order)}:</strong> ${esc(d.decision)} · ${esc(d.relationship)} relative to ${esc(name(d.closestExistingId))}.</p><details><summary>Scope assessment</summary><p>${esc(d.reason)}</p><p>${refs(d.evidenceIds)}</p></details>`
  }).join('')}</article>`).join('')
  const composed = valid.map((r) => {
    const { view, compositionBlocked, orphanNewNodeIds, acceptedEdgeIds } = r.composition
    const walk = (n, depth = 0) => {
      const children = view.edges.filter((e) => e.type === 'contains' && e.from === n.id).map((e) => view.nodes.find((n) => n.id === e.to))
      const shared = view.sharedCapabilities.some((s) => s.id === n.id) ? ' · shared capability' : ''
      return children.length ? `<li><details${depth > 0 ? ' open' : ''}><summary>${esc(n.name)}${shared}</summary><p>${esc(n.summary)}</p><ul>${children.map((c) => walk(c, depth + 1)).join('')}</ul></details></li>` : `<li><span>${esc(n.name)}${shared}</span><small>${esc(n.summary)}</small></li>`
    }
    const roots = view.nodes.filter((n) => !view.edges.some((e) => e.type === 'contains' && e.to === n.id))
    const includedEdges = pool.edges.filter((e) => acceptedEdgeIds.includes(e.id))
    return `<section><h2>${esc(r.order)} review — composed candidate</h2><p>${acceptedEdgeIds.length} proposed relationships included; ${view.sharedCapabilities.length} ${view.sharedCapabilities.length === 1 ? 'capability has' : 'capabilities have'} multiple independent parents. ${view.hiddenTransitiveEdges.length} transitive shortcuts are hidden only in this view; their original claims and citations remain in the saved graph.</p>
    <h3>Shared memberships</h3>${view.sharedCapabilities.length ? `<ul>${view.sharedCapabilities.map((s) => `<li><strong>${esc(name(s.id))}</strong> belongs under ${s.parentIds.map((id) => esc(name(id))).join(' and ')}.</li>`).join('')}</ul>` : '<p>No independent shared membership survived this review. It was allowed, not required.</p>'}
    <h3>Connections added together</h3><ul>${includedEdges.map((e) => `<li>${esc(phrase(e))}</li>`).join('')}</ul>
    <details><summary>Browse the entire containment view (${view.nodes.length} capabilities)</summary><p>Inherited baseline capabilities and links are not revalidated by their presence here. A shared node appears under each applicable parent; it remains one identity. Support and dependency are separate connections, not hidden child memberships.</p><ul class="tree">${roots.map((n) => walk(n)).join('')}</ul></details>
    <details><summary>All support and dependency connections</summary><ul>${view.edges.filter((e) => e.type !== 'contains').map((e) => `<li>${esc(phrase(e))}${includedEdges.some((n) => n.id === e.id) ? ' (new proposal)' : ' (inherited)'}</li>`).join('')}</ul></details>
    <details><summary>Conflicts, blocked composition and remaining questions</summary><p>Conflicts reported by model: ${r.value.conflicts.length}. Composition-blocked edges: ${compositionBlocked.length}. Orphan new nodes: ${orphanNewNodeIds.length}.</p><pre>${esc(JSON.stringify({ conflicts: r.value.conflicts, compositionBlocked, orphanNewNodeIds, existingClaims: r.composition.existingClaims, unresolved: r.value.unresolved }, null, 2))}</pre></details></section>`
  }).join('')
  const items = evidence.map((e) => `<details id="${esc(e.id)}"><summary>${esc(e.id)} · ${esc(e.kind)} · ${esc(e.path ?? e.subject)}</summary><p>${esc(e.commitSha)}${e.path ? ` · lines ${e.startLine}–${e.endLine} of ${e.totalLines}` : ''}</p><pre>${esc(e.text)}</pre></details>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capability relationships that can coexist</title><style>
  body{font:16px/1.6 system-ui;max-width:1200px;margin:36px auto;padding:0 22px;background:#fafbf9;color:#203028}h1,h2,h3{line-height:1.3}a{color:#146448}section,article{border:1px solid #d7dfd5;border-radius:10px;background:white;padding:22px;margin:22px 0}.note{background:#eaf0e8;padding:18px;border-radius:8px}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d7dfd5}th{min-width:220px}td{min-width:110px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;background:#f2f5ef;padding:14px}small{display:block;color:#516154}.tree{padding-left:20px}.tree li{margin:14px 0}.tree p{font-size:14px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start}.cards article{margin:0}a:focus-visible,summary:focus-visible{outline:3px solid #479071;outline-offset:3px}</style>
  <h1>Which relationships can coexist?</h1><p>One proposal pool, reviewed twice in opposite order. Each connection is considered separately. There is no winning umbrella arrangement and no requirement to choose only one parent.</p>
  <p class="note">These are model-interpreted candidate relationships, not verified architecture. “Include” means the reviewer considers that claim useful and grounded enough to compose provisionally. Your accepted map has not changed. Broad feedback is enough; the detailed evidence is optional.</p>
  <p><strong>Includes:</strong> part of a broader outcome. <strong>Supports:</strong> contributes to an outcome without claiming membership or necessity. <strong>Depends on:</strong> requires the other capability. Overlap alone is not a conflict.</p>
  ${data.audit ? `<section><h2>Source spot-checks: read these before treating the graph as settled</h2><p>These notes are separate assistant checks, not edits to either model output.</p>${data.audit.notes.map((n) => `<p><strong>${esc(n.claimIds.join(', '))}:</strong> ${esc(n.issue)}</p><p>${refs(n.evidenceIds)}</p>`).join('')}<a href="audit.json">Separate audit notes</a></section>` : ''}
  ${data.manifest.reconciliation ? `<p class="note">${esc(data.manifest.reconciliation)} <a href="../relationship-coexistence-1/output.json">Original failed run</a>. Reused inference is counted once in the total below; additional review cost is $${data.newInferenceCost?.toFixed(4) ?? 'unknown'}.</p>` : ''}
  ${data.proposal.status !== 'valid' ? `<p>Proposal failed validation: ${esc(data.proposal.validationError)}. No substitute response was generated.</p>` : `<h2>Every proposed connection</h2><div class="scroll"><table><thead><tr><th>Relationship</th>${data.reviews.map((r) => `<th>${esc(r.order)}</th>`).join('')}<th>Why?</th></tr></thead><tbody>${edgeRows}</tbody></table></div><h2>Proposed outcome nodes</h2>${newNodes ? `<div class="cards">${newNodes}</div>` : '<p>No new outcome nodes were proposed.</p>'}`}
  ${data.reviews.filter((r) => r.status !== 'valid').map((r) => `<p>${esc(r.order)} review failed: ${esc(r.validationError)}. No candidate was composed from it.</p>`).join('')}${composed}
  <h2>Evidence and remaining limits</h2><p>${esc(data.manifest.limitations)}</p><p>The inherited map, node descriptions, and the new relationship vocabulary still shape discovery. Reversing order is a small sensitivity check, not independent validation or a causal test. A relation type can be misused even when its citations are valid.</p><details><summary>Proposal gaps</summary><ul>${pool.unresolved.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details><details><summary>All ${evidence.length} supplied evidence items</summary>${items}</details>
  <p>Recorded inference cost: <strong>$${data.cost?.toFixed(4) ?? 'unknown'}</strong>. ${data.stages.filter((s) => s.validationError).length} rejected responses under this validation protocol.${data.manifest.reconciliation ? ' The original duplicate-claim rejection is preserved separately above.' : ''} No automatic retries or repairs.</p><p><a href="output.json">All graphs, claims, reviews and receipts</a> · <a href="manifest.json">Frozen protocol</a> · <a href="evidence.json">Exact evidence packet</a> · <a href="propose.response.json">Original proposal</a>${data.reviews.map((r) => ` · <a href="review-${esc(r.order)}.response.json">${esc(r.order)} review response</a>`).join('')} · <a href="../umbrella-scopes-1/index.html">Previous scope experiment</a></p></html>`
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('output.json required')
  const input = resolve(process.argv[2]), out = dirname(input)
  execFileSync('git', ['check-ignore', '-q', `${out}/index.html`])
  const data = JSON.parse(readFileSync(input, 'utf8'))
  if (existsSync(`${out}/audit.json`)) data.audit = JSON.parse(readFileSync(`${out}/audit.json`, 'utf8'))
  writeFileSync(`${out}/index.html`, renderRelationships(data, JSON.parse(readFileSync(`${out}/evidence.json`, 'utf8'))))
  process.stdout.write(`${out}/index.html\n`)
}
