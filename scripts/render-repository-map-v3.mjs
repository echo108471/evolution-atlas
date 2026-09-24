/** Version 3 report: observed revision changes and candidate historical claims stay distinct. */
import { renderRepositoryMap as renderSnapshot } from './render-repository-map.mjs'

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const anchor = (kind, id) => `${kind}-${Buffer.from(String(id), 'utf16le').toString('hex')}`
const raw = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`
const list = values => `<ul>${(values ?? []).map(value => `<li>${esc(value)}</li>`).join('')}</ul>`
const count = values => Array.isArray(values) ? values.length : 'not recorded'

export function renderRepositoryMap(output) {
  let html = renderSnapshot(output)
  const history = output.history
  const receipts = output.receipts ?? []
  const ids = new Set(receipts.map(r => r.id))
  const refs = evidence => (evidence ?? []).map(id => ids.has(id) ? `<a href="#${anchor('source', id)}">${esc(id)}</a>` : `${esc(id)} (receipt unavailable)`).join(', ')
  const nodeIds = new Set(output.graph.nodes.map(n => n.id))
  const nodeRef = node => node ? `<code>${esc(node.commitSha)}</code> · ${node.commitSha === output.commitSha && nodeIds.has(node.nodeId) ? `<a href="#${anchor('node', node.nodeId)}">${esc(node.nodeId)}</a>` : esc(node.nodeId)}` : 'No predecessor in the earlier candidate map.'
  const observedKinds = new Set(['commit-meta', 'diff', 'path-history'])
  for (const receipt of receipts.filter(r => r.kind !== 'source')) {
    html = html.replaceAll(`${esc(receipt.id)} (source receipt unavailable)`, `<a href="#${anchor('source', receipt.id)}">${esc(receipt.id)}</a>`)
  }
  if (history) {
    html = html.replace('This snapshot does not establish historical change, origin or intent.', 'Revision differences below are Git observations. Historical capability claims remain candidate interpretations; provenance does not establish their semantic correctness or intent.')
    html = html.replace('<nav>', '<nav><a href="#history">Revision history</a>')
    const t = history.transition
    const transition = t ? `<h3>Observed revision transition</h3><p><code>${esc(t.fromCommitSha)}</code> → <code>${esc(t.toCommitSha)}</code> · ${esc(t.relation)}</p><p>${count(t.added)} added · ${count(t.changed)} changed · ${count(t.deleted)} deleted · ${count(t.unchanged)} unchanged eligible files. These counts describe source inventory, not capability changes.</p><details><summary>Paths and exact blob identities</summary>${raw(t)}</details>` : '<p>Initial discovery: no earlier map was supplied for revision comparison.</p>'
    const claims = (history.lineage ?? []).map(entry => `<article class="capability"><h3>${esc(entry.decision)} · ${esc(entry.id)}</h3><p>${esc(entry.claim ?? entry.reason)}</p><p>${esc(entry.reason)}</p><p><strong>Before:</strong> ${nodeRef(entry.from)}</p><p><strong>After:</strong> ${(entry.to ?? []).map(nodeRef).join('; ') || 'No successor in this candidate map.'}</p><p class="meta">Candidate · proposer assessment: ${esc(entry.assessment)} · ${refs(entry.evidenceIds)} · independent verification: not performed</p></article>`).join('')
    const section = `<section id="history"><h2>History across revisions</h2>${transition}<h3>Candidate capability evolution</h3><p>These explanations are model-authored. Map consolidation decisions alone do not prove a repository behavior was introduced, changed, or removed.</p>${claims || '<p>No history-backed capability claim was proposed.</p>'}<details><summary>Relationship lineage</summary>${raw(history.edgeLineage ?? [])}</details><details><summary>Prior-map and cached-reading catalog</summary>${raw({ priorMaps: history.priorMaps ?? [], commitReadings: history.commitReadings ?? [] })}</details><h3>History omissions</h3>${list(history.omissions)}</section>`
    html = html.replace('<section id="map">', section + '<section id="map">')
  }
  const records = receipts.filter(r => r.kind !== 'source' && r.kind !== 'search').map(r => `<details id="${anchor('source', r.id)}"><summary>${esc(r.id)} · ${esc(r.kind)} · ${esc(r.commitSha ?? r.path ?? '')}</summary><p class="meta">${observedKinds.has(r.kind) ? 'Observed Git evidence at the recorded revision; not an interpretation.' : 'Earlier candidate interpretation; not direct proof of repository behavior.'}</p>${raw(r)}</details>`).join('')
  html = html.replace('<details><summary>Navigation searches (not proof of behavior)</summary>', records + '<details><summary>Navigation searches (not proof of behavior)</summary>')
  return html
}
