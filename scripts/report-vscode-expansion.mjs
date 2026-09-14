#!/usr/bin/env node
/** Evidence/accounting only. All semantic integration decisions come from the saved model output. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, saveNew, sha } from './vscode-snapshot-evidence.mjs'
import { prefixBaseline } from './vscode-expansion.mjs'
import { graphIssues, intervalCoverage, render } from './report-vscode-discovery.mjs'
const edgeKey = e => JSON.stringify([e.from, e.to, e.type])
const countBy = (xs, key) => xs.reduce((a, x) => ({ ...a, [x[key]]: (a[x[key]] ?? 0) + 1 }), {})

export function integrationIssues(graph, baseline, proposals, receipts) {
  const originals = [...baseline.nodes, ...proposals.flatMap(p => p.nodes)], byId = new Map(originals.map(n => [n.id, n]))
  const final = new Map(graph.nodes.map(n => [n.id, n]))
  // Existing graph validator predates explicit revision; validate shared fields, then revision accounting here.
  const errors = graphIssues({ ...graph, lineage: (graph.lineage ?? []).map(l => ({ ...l, decision: l.decision === 'revise' ? 'rename' : l.decision })) }, receipts, originals.map(n => n.id))
  const issue = (target, message) => errors.push({ target, message })
  for (const l of graph.lineage ?? []) {
    if (!['retain', 'merge', 'split', 'rename', 'revise', 'remove'].includes(l.decision)) issue(l.originalId, 'invalid integration action')
    if (l.decision === 'retain' && (l.successorIds?.length !== 1 || !isDeepStrictEqual(byId.get(l.originalId), final.get(l.successorIds?.[0])))) issue(l.originalId, 'retain changed original content')
    if (l.decision === 'remove' && l.successorIds?.length) issue(l.originalId, 'removal has successors')
  }
  const freshIds = new Set(proposals.flatMap(p => p.nodes.map(n => n.id))), oldIds = new Set(baseline.nodes.map(n => n.id))
  const sources = new Set(receipts.filter(r => r.kind === 'source').map(r => r.id)), compared = new Set()
  for (const [i, c] of (graph.comparisons ?? []).entries()) {
    const target = `comparison:${i}`; compared.add(c.newNodeId)
    if (!freshIds.has(c.newNodeId)) issue(target, 'unknown new comparison node')
    if (!Array.isArray(c.existingNodeIds) || c.existingNodeIds.some(id => !oldIds.has(id))) issue(target, 'invalid existing comparison nodes')
    if (!['same', 'overlapping', 'broader', 'narrower', 'distinct', 'uncertain'].includes(c.relation)) issue(target, 'invalid comparison relation')
    if (!c.reason || !c.disposition || !Array.isArray(c.uncertainty)) issue(target, 'missing comparison explanation')
    if (!Array.isArray(c.evidenceIds) || c.evidenceIds.some(id => !sources.has(id))) issue(target, 'invalid comparison citations')
    if (!['distinct', 'uncertain'].includes(c.relation) && !c.existingNodeIds?.length) issue(target, 'non-distinct comparison lacks existing alternative')
    if (!c.evidenceIds?.length) issue(target, 'comparison lacks inspected evidence')
  }
  for (const id of freshIds) if (!compared.has(id)) issue(id, 'missing new-to-existing comparison')
  const inputEdges = { baseline: baseline.edges, discovery: proposals.flatMap(p => p.edges) }, seen = new Set(), edges = new Map(graph.edges.map(e => [edgeKey(e), e]))
  for (const [i, l] of (graph.edgeLineage ?? []).entries()) {
    const target = `edgeLineage:${i}`, key = `${l.source}:${l.originalIndex}`, original = inputEdges[l.source]?.[l.originalIndex]
    if (!original || !Number.isInteger(l.originalIndex) || seen.has(key)) issue(target, 'unknown/duplicate original edge')
    seen.add(key)
    if (!['retain', 'revise', 'remove'].includes(l.decision) || !l.reason || !Array.isArray(l.successorEdges)) issue(target, 'invalid edge disposition')
    for (const e of l.successorEdges ?? []) if (!edges.has(edgeKey(e))) issue(target, 'edge successor absent')
    if (l.decision === 'retain' && (l.successorEdges?.length !== 1 || !isDeepStrictEqual(original, edges.get(edgeKey(l.successorEdges?.[0] ?? {}))))) issue(target, 'retained edge changed')
    if (l.decision === 'remove' && l.successorEdges?.length) issue(target, 'removed edge has successors')
    if (l.decision === 'revise' && !l.successorEdges?.length) issue(target, 'revised edge has no successor')
  }
  for (const [source, es] of Object.entries(inputEdges)) es.forEach((_, i) => { if (!seen.has(`${source}:${i}`)) issue(`${source}:${i}`, 'missing original edge disposition') })
  return errors
}

export function changeSummary(graph, baseline, proposals) {
  const originals = [...baseline.nodes, ...proposals.flatMap(p => p.nodes)], old = new Map(originals.map(n => [n.id, n])), final = new Map(graph.nodes.map(n => [n.id, n]))
  const successors = new Set((graph.lineage ?? []).flatMap(l => l.successorIds))
  return {
    baselineNodes: baseline.nodes.length, discoveryNodes: proposals.reduce((n, p) => n + p.nodes.length, 0), finalNodes: graph.nodes.length,
    netNodeGrowth: graph.nodes.length - baseline.nodes.length, naiveConcatenationNodes: originals.length,
    differenceFromConcatenation: graph.nodes.length - originals.length,
    baselineActions: countBy((graph.lineage ?? []).filter(l => l.originalId.startsWith('old:')), 'decision'),
    discoveryActions: countBy((graph.lineage ?? []).filter(l => !l.originalId.startsWith('old:')), 'decision'),
    comparisonRelations: countBy(graph.comparisons ?? [], 'relation'),
    newlyConstructedNodes: graph.nodes.filter(n => !successors.has(n.id)).map(n => ({ id: n.id, name: n.name })),
    changes: (graph.lineage ?? []).filter(l => l.decision !== 'retain').map(l => ({ ...l, originalName: old.get(l.originalId)?.name,
      successors: l.successorIds.map(id => ({ id, name: final.get(id)?.name,
        changedFields: Object.keys(final.get(id) ?? {}).filter(k => !isDeepStrictEqual(old.get(l.originalId)?.[k], final.get(id)?.[k])) })) })),
    edgeActions: countBy(graph.edgeLineage ?? [], 'decision'),
    removedEdges: (graph.edgeLineage ?? []).filter(l => l.decision === 'remove'),
    baselineEdges: baseline.edges.length, finalEdges: graph.edges.length
  }
}

export function assembleExpansion(out) {
  const manifest = readJson(out + '/manifest.json'), inventory = readJson(out + '/inventory.json'), base = readJson(manifest.baseDirectory + '/output.json')
  if (sha(readFileSync(manifest.baseDirectory + '/output.json', 'utf8')) !== manifest.baseOutputSha256 || sha(base.graph) !== manifest.baseGraphSha256) throw new Error('frozen baseline changed')
  for (const [file, expected] of [['protocol.md', manifest.instructionSha256]]) if (sha(readFileSync(out + '/' + file, 'utf8')) !== expected) throw new Error(file + ' changed')
  if (sha(inventory) !== manifest.inventorySha256) throw new Error('discovery inventory changed')
  if (sha(readFileSync(new URL('./vscode-snapshot-evidence.mjs', import.meta.url), 'utf8')) !== manifest.brokerSha256) throw new Error('evidence broker changed')
  if (sha(readFileSync(new URL('./vscode-expansion.mjs', import.meta.url), 'utf8')) !== manifest.setupSha256) throw new Error('setup changed after freeze')
  const baseline = readJson(out + '/baseline-input.json'), expected = prefixBaseline(base.graph, base.receipts)
  if (!isDeepStrictEqual(baseline, expected)) throw new Error('namespaced baseline changed semantically')
  const fullInventory = readJson(out + '/reconciliation-evidence/inventory.json')
  if (sha(fullInventory) !== manifest.baseInventorySha256) throw new Error('full source inventory changed')
  const reconciliationManifest = readJson(out + '/reconciliation-evidence/manifest.json')
  if (!isDeepStrictEqual(reconciliationManifest, { ...manifest, inventorySha256: sha(fullInventory) })) throw new Error('reconciliation evidence limits changed')
  const receipts = [...baseline.receipts], newReceipts = [], proposals = [], fingerprints = {}, provenanceIssues = []
  for (const agent of [...manifest.partitions, 'R']) {
    const relative = agent === 'R' ? 'reconciliation-evidence/receipts/R' : 'receipts/' + agent, directory = out + '/' + relative
    if (existsSync(directory)) for (const name of readdirSync(directory).filter(n => n.endsWith('.json')).sort()) {
      const r = readJson(directory + '/' + name); receipts.push(r); newReceipts.push(r); fingerprints[relative + '/' + name] = sha(readFileSync(directory + '/' + name, 'utf8'))
    }
    const proposal = out + '/proposals/' + agent + '.json'
    if (existsSync(proposal)) { proposals.push(readJson(proposal)); fingerprints['proposals/' + agent + '.json'] = sha(readFileSync(proposal, 'utf8')) }
  }
  const seen = new Set(baseline.receipts.filter(r => r.kind === 'source').map(r => r.path)), eligible = new Map(fullInventory.files.map(f => [f.path, f]))
  const uniqueReceipts = new Set()
  for (const r of receipts) {
    if (uniqueReceipts.has(r.id)) provenanceIssues.push({ target: r.id, message: 'duplicate receipt identity' })
    uniqueReceipts.add(r.id)
  }
  for (const agent of [...manifest.partitions, 'R']) {
    const rs = newReceipts.filter(r => r.id.startsWith(agent + '-')), budget = agent === 'R' ? manifest.budgets.reconciler : manifest.budgets.perAgent
    if (rs.filter(r => r.kind === 'source').length > budget.windows || rs.filter(r => r.kind === 'search').length > budget.searches || rs.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0) > budget.evidenceBytes) provenanceIssues.push({ target: agent, message: 'retrieval budget exceeded' })
  }
  for (const r of newReceipts.filter(r => r.kind === 'source')) {
    if (!r.id.startsWith('R-') && seen.has(r.path)) provenanceIssues.push({ target: r.id, message: 'discovery reread previous file' })
    const f = eligible.get(r.path)
    if (!f || f.blobSha !== r.blobSha || r.commitSha !== manifest.commitSha) { provenanceIssues.push({ target: r.id, message: 'source identity mismatch' }); continue }
    if (!Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine || r.endLine - r.startLine + 1 > manifest.budgets.perAgent.linesPerWindow || r.endLine > r.totalLines) provenanceIssues.push({ target: r.id, message: 'invalid source range' })
    const text = execFileSync('git', ['--git-dir=' + manifest.repo, 'cat-file', 'blob', r.blobSha], { encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 }).split('\n').slice(r.startLine - 1, r.endLine).join('\n')
    if (text !== r.text) provenanceIssues.push({ target: r.id, message: 'source excerpt mismatch' })
  }
  if (existsSync(out + '/reconciliation-input.json')) {
    const packet = readJson(out + '/reconciliation-input.json')
    for (const [file, hash] of Object.entries(packet.inputFingerprints)) if (fingerprints[file] !== hash) provenanceIssues.push({ target: file, message: 'discovery input changed after integration freeze' })
  }
  const proposalIssues = proposals.flatMap(p => graphIssues(p, newReceipts.filter(r => r.id.startsWith(p.agent + '-'))).map(x => ({ ...x, agent: p.agent })))
  const complete = manifest.partitions.every(a => proposals.some(p => p.agent === a)), graph = existsSync(out + '/reconciled.json') ? readJson(out + '/reconciled.json') : null
  if (graph) fingerprints['reconciled.json'] = sha(readFileSync(out + '/reconciled.json', 'utf8'))
  const issues = graph ? integrationIssues(graph, baseline.graph, proposals, receipts) : []
  const discoveryReceipts = newReceipts.filter(r => !r.id.startsWith('R-'))
  return { protocol: manifest.protocol, manifest, status: graph && complete ? 'candidate-map-produced' : 'incomplete', completeAssignments: complete,
    graph, baselineGraph: baseline.graph, proposals, receipts, proposalIssues, graphIssues: issues, provenanceIssues, inputFingerprints: fingerprints,
    baselineUnchanged: sha(readJson('public/graph-reviews/whole-project-2-etl/output.json')) === manifest.baselineGraphSha256,
    priorMapUnchanged: true, independentVerification: 'not-performed', interpretationStatus: 'candidate', externalModelApiCalls: 0, externalModelApiCost: 0,
    amendments: [], limitations: manifest.limitations,
    executionRecord: existsSync(out + '/execution-record.json') ? readJson(out + '/execution-record.json') : null,
    coverage: { ...intervalCoverage(receipts), eligibleFiles: fullInventory.eligibleFiles, allTrackedEntries: fullInventory.allTrackedEntries,
      baseline: intervalCoverage(baseline.receipts), discovery: intervalCoverage(discoveryReceipts), newRetrieval: intervalCoverage(newReceipts),
      assignments: manifest.partitions.map(a => ({ agent: a, eligibleFiles: inventory.files.filter(f => f.partition === a).length, ...intervalCoverage(discoveryReceipts.filter(r => r.id.startsWith(a + '-'))) })) },
    changes: graph ? changeSummary(graph, baseline.graph, proposals) : null }
}

const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
export function renderExpansion(output) {
  if (!output.graph) throw new Error('complete graph required for expansion report')
  const graph = output.graph, changes = output.changes, names = new Map([...output.baselineGraph.nodes, ...output.proposals.flatMap(p => p.nodes), ...graph.nodes].map(n => [n.id, n.name]))
  const originalNames = new Map([...output.baselineGraph.nodes, ...output.proposals.flatMap(p => p.nodes)].map(n => [n.id, n.name]))
  const name = id => esc(names.get(id) ?? id), ref = id => `<a href="#${esc(id)}">${name(id)}</a>`
  const originalName = id => esc(originalNames.get(id) ?? id)
  const actions = counts => Object.entries(counts).map(([action, count]) => `${count} ${({ retain: 'retained unchanged', merge: 'merged', revise: 'revised', split: 'split', rename: 'renamed', remove: 'removed' })[action] ?? action}`).join(', ')
  const source = ids => ids.map(id => `<a href="#evidence-${esc(id)}">${esc(id)}</a>`).join(', ')
  const panel = `<section id="changes"><h2>What changed from the first map</h2><p><a href="../vscode-discovery-1/index.html#map">Explore the unchanged first map</a> · <a href="#map">Explore the complete expanded map</a></p>
<p>${changes.baselineNodes} original capabilities + ${changes.discoveryNodes} blind proposals → ${changes.finalNodes} integrated capabilities (${changes.netNodeGrowth >= 0 ? '+' : ''}${changes.netNodeGrowth} net). Simply concatenating the inputs would give ${changes.naiveConcatenationNodes}. Counts describe integration, not correctness or usefulness.</p>
<p>New discovery inspected ${output.coverage.discovery.files} previously unread files. Combined evidence now touches ${output.coverage.files} / ${output.coverage.eligibleFiles} eligible files; these are partial excerpts, not capability coverage.</p>
<h3>Integration actions</h3><p>Existing candidates: ${esc(actions(changes.baselineActions))}. New proposals: ${esc(actions(changes.discoveryActions))}.</p>
${changes.newlyConstructedNodes.length ? `<p>Newly constructed capabilities: ${changes.newlyConstructedNodes.map(n => ref(n.id)).join(', ')}.</p>` : ''}
<h3>Every new-to-existing comparison</h3><p>Relations describe the new proposal relative to an existing capability. These are model decisions, not an independent audit.</p>
${(graph.comparisons ?? []).map(c => `<details><summary>${originalName(c.newNodeId)} — ${esc(c.relation)}${c.existingNodeIds.length ? ' / ' + c.existingNodeIds.map(originalName).join(', ') : ''}</summary><p>${esc(c.reason)}</p><p><strong>Disposition:</strong> ${esc(c.disposition)}</p><p>${source(c.evidenceIds)}</p>${c.uncertainty.length ? `<p><strong>Uncertainty:</strong> ${esc(c.uncertainty.join(' '))}</p>` : ''}</details>`).join('')}
<h3>Changed, merged, split or removed definitions</h3>${changes.changes.map(c => `<details><summary>${esc(c.originalName)} — ${esc(c.decision)}</summary><p>${esc(c.reason)}</p>${c.successors.map(n => `<p>${ref(n.id)}<br><span class="meta">Changed fields: ${esc(n.changedFields.join(', '))}</span></p>`).join('')}</details>`).join('') || '<p>No definition changes.</p>'}
<details><summary>Every original relationship disposition, including removals</summary><pre>${esc(JSON.stringify(graph.edgeLineage, null, 2))}</pre></details>
<details><summary>Baseline definitions before revision</summary><p>Baseline nodes, edges and citations have old: identifiers. Any embedded earlier-run decision or lineage records retain their historical identifiers and are not the integration lineage.</p><pre>${esc(JSON.stringify(output.baselineGraph, null, 2))}</pre></details>
<details><summary>Execution record and retrieval failures</summary><pre>${esc(JSON.stringify(output.executionRecord ?? {}, null, 2))}</pre></details></section>`
  return render(output).replace('<h1>VS Code: a first capability map</h1>', '<h1>VS Code: discovery beyond the first map</h1>')
    .replace('<a href="#map">Map</a>', '<a href="#changes">What changed</a><a href="#map">Full map</a>')
    .replace('<section id="map">', panel + '<section id="map">')
    .replace('No feedback has been used to tune this output.', 'Broad approval of the first map motivated this expansion; no owner capability labels or examples were given to discovery or integration.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2]), mode = process.argv[3] ?? 'check', output = assembleExpansion(out)
  if (mode === 'packet') {
    if (!output.completeAssignments || output.proposalIssues.length || output.provenanceIssues.length) throw new Error('clean complete discovery required before integration')
    saveNew(out + '/reconciliation-input.json', { protocol: output.protocol, inputFingerprints: output.inputFingerprints,
      baseline: 'baseline-input.json', proposals: output.proposals.map(p => 'proposals/' + p.agent + '.json'),
      sourceReceipts: output.receipts.filter(r => r.kind === 'source').map(({ text, ...r }) => ({ ...r, location: r.id.startsWith('old:') ? 'baseline-input.json receipts array' : `receipts/${r.id.split('-')[0]}/${r.id}.json` })),
      originalNodeIds: [...output.baselineGraph.nodes, ...output.proposals.flatMap(p => p.nodes)].map(n => n.id) })
  }
  if (mode === 'freeze') {
    if (!output.completeAssignments || !output.graph) throw new Error('complete integration required')
    saveNew(out + '/output.json', output); writeFileSync(out + '/index.html', renderExpansion(output))
  }
  if (mode === 'render') writeFileSync(out + '/index.html', renderExpansion(readJson(out + '/output.json')))
  console.log(JSON.stringify({ status: output.status, proposals: output.proposals.map(p => ({ agent: p.agent, nodes: p.nodes.length, edges: p.edges.length })),
    coverage: output.coverage, changes: output.changes && { ...output.changes, changes: undefined }, proposalIssues: output.proposalIssues,
    graphIssues: output.graphIssues, provenanceIssues: output.provenanceIssues, priorMapUnchanged: output.priorMapUnchanged, baselineUnchanged: output.baselineUnchanged }, null, 2))
}
