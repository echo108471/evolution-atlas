/** Repository-neutral, offline candidate-map report. Rendering performs no inference. */
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const raw = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`
const list = values => `<ul>${(values ?? []).map(value => `<li>${esc(value)}</li>`).join('')}</ul>`
// Encode JavaScript code units, preserving even lone surrogates without anchor collisions.
const anchor = (kind, id) => `${kind}-${Buffer.from(String(id), 'utf16le').toString('hex')}`
const css = `body{margin:0;font:16px/1.6 system-ui;color:#23333e;background:#f7f8fa}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:34px;line-height:1.2}h2{margin-top:38px}a{color:#175b9b}nav{display:flex;gap:18px;flex-wrap:wrap}.notice{padding:16px;border-left:4px solid #c18b26;background:#fff3d8}.overview{columns:2;column-gap:36px}.overview>li{break-inside:avoid;margin-bottom:14px}.capability{background:white;border:1px solid #d4dce3;border-radius:8px;padding:20px;margin:20px 0;scroll-margin-top:12px}.capability h2{margin-top:0}.meta{color:#4a6170;font-size:14px}details{border-top:1px solid #d4dce3;padding:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#edf1f5;padding:12px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;border:1px solid #d4dce3;text-align:left;vertical-align:top}th{font-weight:600}.table{overflow:auto}code{overflow-wrap:anywhere}ul{padding-left:22px}section{scroll-margin-top:12px}@media(max-width:720px){main{padding:16px}.overview{columns:1}h1{font-size:28px}.capability{padding:14px}}@media(prefers-color-scheme:dark){body{background:#17212a;color:#e2e9ee}.capability,table{background:#202e39}a{color:#91c5f4}.meta{color:#b4c7d5}pre{background:#283846}.notice{background:#3b321e}}`

export function renderRepositoryMap(output) {
  const { graph } = output
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('candidate graph required')
  const proposals = output.proposals ?? [], baseline = output.baselineGraph ?? { nodes: [], edges: [] }
  const receipts = output.receipts ?? [], sources = receipts.filter(r => r.kind === 'source')
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), sourceIds = new Set(sources.map(r => r.id))
  if (nodes.size !== graph.nodes.length || sourceIds.size !== sources.length) throw new Error('duplicate node or source receipt identity')
  const originals = new Map([...baseline.nodes, ...proposals.flatMap(p => p.nodes ?? [])].map(n => [n.id, n]))
  const nodeLink = id => nodes.has(id) ? `<a href="#${anchor('node', id)}">${esc(nodes.get(id).name)}</a>` : `${esc(id)} (not in final map)`
  const originalLabel = id => `${esc(originals.get(id)?.name ?? id)} <span class="meta">(${esc(id)})</span>`
  const refs = ids => (ids ?? []).map(id => sourceIds.has(id) ? `<a href="#${anchor('source', id)}">${esc(id)}</a>` : `${esc(id)} (source receipt unavailable)`).join(', ') || 'No inspected source cited.'
  const children = new Map(graph.nodes.map(n => [n.id, []])), parents = new Set(), involved = new Map(graph.nodes.map(n => [n.id, []]))
  for (const edge of graph.edges) {
    involved.get(edge.from)?.push(edge)
    if (edge.to !== edge.from) involved.get(edge.to)?.push(edge)
    if (edge.type === 'contains' && nodes.has(edge.from) && nodes.has(edge.to)) { children.get(edge.from).push(edge.to); parents.add(edge.to) }
  }
  const expanded = new Set()
  function branch(id, ancestors = new Set(), depth = 0) {
    if (ancestors.has(id)) return `<li>${nodeLink(id)} <span class="meta">(containment cycle; inspect relationships)</span></li>`
    if (expanded.has(id)) return `<li>${nodeLink(id)} <span class="meta">(also shown elsewhere)</span></li>`
    if (depth >= 48) return `<li>${nodeLink(id)} <span class="meta">(navigation depth limit; full definition and relationships below)</span></li>`
    expanded.add(id)
    const descendants = children.get(id), next = new Set(ancestors).add(id)
    return `<li>${nodeLink(id)}${descendants.length ? `<ul>${descendants.map(child => branch(child, next, depth + 1)).join('')}</ul>` : ''}</li>`
  }
  const roots = graph.nodes.filter(n => !parents.has(n.id)), grouped = roots.filter(n => children.get(n.id).length), standalone = roots.filter(n => !children.get(n.id).length)
  const groupedHtml = grouped.map(n => branch(n.id)).join(''), standaloneHtml = standalone.map(n => branch(n.id)).join('')
  let remainingHtml = ''
  for (const n of graph.nodes) if (!expanded.has(n.id)) remainingHtml += branch(n.id)
  const relationship = e => `<p>${nodeLink(e.from)} — ${esc(e.type)} → ${nodeLink(e.to)}<br>${esc(e.reason)}<br><span class="meta">Candidate · proposer assessment: ${esc(e.assessment)} · ${refs(e.evidenceIds)} · independent verification: not performed</span></p>`
  const coverage = output.coverage ?? {}
  const lineage = graph.lineage ?? [], edgeLineage = graph.edgeLineage ?? [], comparisons = graph.comparisons ?? []
  const originalEdges = { baseline: baseline.edges, discovery: proposals.flatMap(p => p.edges ?? []) }
  const edgeLabel = e => e ? `${esc(e.from)} — ${esc(e.type)} → ${esc(e.to)}` : 'Original relationship unavailable'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(output.displayName)} — candidate capability map</title><style>${css}</style></head>
<body><main><nav><a href="#map">Map</a><a href="#capabilities">All capabilities</a><a href="#relationships">Relationships</a><a href="#integration">Integration & changes</a><a href="#coverage">Coverage</a><a href="#records">Evidence & raw records</a></nav>
<h1>${esc(output.displayName)}: a candidate capability map</h1>
<p>Snapshot <code>${esc(output.commitSha)}</code> · ${esc(output.mode)}. This map describes candidate interpretations of inspected source.</p>
<p class="notice">All capabilities and relationships are candidates. Supported, partial and unresolved are proposer assessments; independent verification has not been performed. Source presence does not establish runtime behavior or availability. This snapshot does not establish historical change, origin or intent.</p>
<p>${graph.nodes.length} capabilities · ${graph.edges.length} relationships · ${sources.length} source windows · ${esc(coverage.files)} / ${esc(coverage.eligibleFiles)} eligible files with inspected excerpts.</p>
${output.validationIssues?.length ? `<details open><summary>Validation issues — retained, not hidden</summary>${raw(output.validationIssues)}</details>` : ''}
<section id="map"><h2>Capability organization</h2><p>Indented items show proposed containment. Multiple parents, deeper groupings and standalone capabilities are permitted. Repeated branches link to the same definition. Navigation is bounded for safety; every definition and relationship appears below.</p>
${groupedHtml ? `<h3>Broader groupings</h3><ul class="overview">${groupedHtml}</ul>` : ''}
${standaloneHtml ? `<h3>Other capabilities</h3><p>These have no proposed containment parent. This does not imply lesser importance or an absence of other relationships.</p><ul class="overview">${standaloneHtml}</ul>` : ''}
${remainingHtml ? `<h3>Additional containment entries</h3><p>Entries beyond the navigation depth limit or without an acyclic root remain accessible here.</p><ul class="overview">${remainingHtml}</ul>` : ''}
${!graph.nodes.length ? '<p>No candidate capabilities were proposed.</p>' : ''}</section>
<section id="capabilities"><h2>Every capability</h2>${graph.nodes.map(n => `<article class="capability" id="${anchor('node', n.id)}"><h2>${esc(n.name)}</h2><p>${esc(n.summary)}</p>
<p class="meta">${esc(n.id)} · candidate · proposer assessment: ${esc(n.assessment)} · independent verification: not performed</p><p><strong>Actor:</strong> ${esc(n.actor)}</p><p><strong>Observable outcomes</strong></p>${list(n.outcomes)}<p><strong>Conditions</strong></p>${list(n.conditions)}<p><strong>Outside this scope</strong></p>${list(n.exclusions)}<p><strong>Uncertainty</strong></p>${list(n.uncertainty)}<p><strong>Source:</strong> ${refs(n.evidenceIds)}
</p><details><summary>Inputs, implementations and individual claims</summary><h3>Inputs</h3>${list(n.inputs)}<h3>Implementations</h3>${list(n.implementations)}${(n.claims ?? []).map(c => `<p>${esc(c.text)}<br><span class="meta">Proposer assessment: ${esc(c.assessment)} · ${refs(c.evidenceIds)} · independent verification: not performed</span></p>`).join('')}</details><details><summary>Relationships involving this capability</summary>${involved.get(n.id).map(relationship).join('') || '<p>No relationship proposed.</p>'}</details></article>`).join('')}</section>
<section id="relationships"><h2>Every relationship</h2><div class="table"><table><thead><tr><th>From</th><th>Relationship / to</th><th>Reason & source</th></tr></thead><tbody>${graph.edges.map(e => `<tr><td>${nodeLink(e.from)}</td><td>${esc(e.type)} → ${nodeLink(e.to)}</td><td>${esc(e.reason)}<br><small>Candidate · proposer assessment: ${esc(e.assessment)} · ${refs(e.evidenceIds)} · independent verification: not performed</small></td></tr>`).join('')}</tbody></table></div></section>
<section id="integration"><h2>Integration decisions and changes</h2><p>These records account for model decisions; they do not establish correctness or independent review. Removals describe changes to candidate maps, not deletion of repository functionality.</p>
<h3>Global scope decisions</h3>${(graph.decisions ?? []).map(d => `<details><summary>${esc(d.question)}</summary><p><strong>Decision:</strong> ${esc(d.decision)}</p><p>${esc(d.reason)}</p><p>${refs(d.evidenceIds)}</p><h4>Uncertainty</h4>${list(d.uncertainty)}</details>`).join('') || '<p>No global scope decisions recorded.</p>'}
<h3>Every original capability disposition</h3>${lineage.map(l => `<details><summary>${originalLabel(l.originalId)} — ${esc(l.decision)}</summary><p>${esc(l.reason)}</p><p><strong>Successors:</strong> ${(l.successorIds ?? []).map(nodeLink).join(', ') || 'None; removed from the candidate map.'}</p><details><summary>Original definition</summary>${raw(originals.get(l.originalId) ?? { id: l.originalId, unavailable: true })}</details></details>`).join('') || '<p>No original capability dispositions recorded.</p>'}
<h3>Every original relationship disposition</h3>${edgeLineage.map(l => { const original = originalEdges[l.source]?.[l.originalIndex]; return `<details><summary>${esc(l.source)} ${esc(l.originalIndex)} · ${edgeLabel(original)} — ${esc(l.decision)}</summary><p>${esc(l.reason)}</p><p><strong>Successors:</strong></p>${(l.successorEdges ?? []).map(e => `<p>${nodeLink(e.from)} — ${esc(e.type)} → ${nodeLink(e.to)}</p>`).join('') || '<p>None; removed from the candidate map.</p>'}${raw(original ?? null)}</details>` }).join('') || '<p>No original relationship dispositions recorded.</p>'}
<h3>Every new-to-existing comparison</h3>${comparisons.map(c => `<details><summary>${originalLabel(c.newNodeId)} — ${esc(c.relation)}</summary><p><strong>Compared with:</strong> ${(c.existingNodeIds ?? []).map(originalLabel).join(', ') || 'No existing alternative recorded.'}</p><p>${esc(c.reason)}</p><p><strong>Disposition:</strong> ${esc(c.disposition)}</p><p>${refs(c.evidenceIds)}</p><h4>Uncertainty</h4>${list(c.uncertainty)}</details>`).join('') || '<p>No new-to-existing comparisons recorded.</p>'}</section>
<section id="coverage"><h2>What was and wasn’t inspected</h2><p>${esc(coverage.uniqueLines)} unique source lines inspected across ${esc(coverage.files)} files, from ${esc(coverage.eligibleFiles)} eligible files and ${esc(coverage.allTrackedEntries)} tracked entries. A file counts once even if only a small excerpt was read. This is not a percentage of capabilities discovered; completed assignments do not establish exhaustive coverage.</p>
${proposals.map(p => `<details><summary>Assignment ${esc(p.agent)} — scope and omissions</summary><p>${esc(p.scopeSummary)}</p>${raw(p.coverage ?? {})}<h3>Cross-assignment leads</h3>${list(p.crossPartitionLeads)}</details>`).join('')}<h3>Limitations</h3>${list([...(output.limitations ?? []), ...(graph.limitations ?? [])])}</section>
<section id="records"><h2>Evidence and raw records</h2><p><a href="output.json">Full output</a>. Source citations refer to saved excerpts identified by commit, blob, path and line range. Valid provenance and structural checks do not establish that an excerpt supports a particular interpretation. Navigation searches are not behavioral evidence.</p>
${sources.map(r => `<details id="${anchor('source', r.id)}"><summary>${esc(r.id)} · ${esc(r.path)}:${esc(r.startLine)}–${esc(r.endLine)}</summary><p class="meta">Commit <code>${esc(r.commitSha)}</code> · blob <code>${esc(r.blobSha)}</code> · saved line range ${esc(r.startLine)}–${esc(r.endLine)} of ${esc(r.totalLines)} lines</p><pre>${esc(String(r.text ?? '').split('\n').map((line, i) => `${Number.isSafeInteger(r.startLine) ? r.startLine + i : r.startLine}  ${line}`).join('\n'))}</pre></details>`).join('')}
<details><summary>Navigation searches (not proof of behavior)</summary>${raw(receipts.filter(r => r.kind === 'search'))}</details><details><summary>All source receipt metadata</summary>${raw(sources.map(({ text, ...metadata }) => metadata))}</details><details><summary>Baseline candidate definitions</summary>${raw(baseline)}</details>${proposals.map(p => `<details><summary>Unedited proposal ${esc(p.agent)}</summary>${raw(p)}</details>`).join('')}<details><summary>Complete final graph and accounting records</summary>${raw(graph)}</details><details><summary>Validation issues</summary>${raw(output.validationIssues ?? [])}</details></section>
</main></body></html>`
}
