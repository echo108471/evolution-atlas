// Supplemental presentation checks, authored before viewing either experiment result.
// Does not replace the frozen recurrence metrics or alter any model output.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkStability, freezeStability } from './snapshot-stability.mjs'
import { writeExact } from './snapshot-workflow.mjs'
import { sha } from './vscode-snapshot-evidence.mjs'
import { setRecurrence } from './lib/integration-stability.mjs'
const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const key = e => JSON.stringify([e.from, e.to, e.type])
const count = xs => xs.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})
export function supplementalStructure(graph) {
  const duplicateSuccessors = graph.lineage.filter(l => new Set(l.successorIds).size !== l.successorIds.length).map(l => l.originalId)
  const originalOwners = id => graph.lineage.filter(l => l.successorIds.includes(id)).map(l => l.originalId)
  const malformedSplits = graph.lineage.filter(l => l.decision === 'split' && new Set(l.successorIds).size < 2).map(l => l.originalId)
  const malformedMerges = graph.lineage.filter(l => l.decision === 'merge' && (l.successorIds.length !== 1 || originalOwners(l.successorIds[0]).length < 2)).map(l => l.originalId)
  const children = id => graph.edges.filter(e => e.from === id && e.type === 'contains').map(e => e.to)
  const depth = (id, ancestors = []) => {
    if (ancestors.includes(id)) throw new Error('containment cycle')
    const cs = children(id); return cs.length ? 1 + Math.max(...cs.map(c => depth(c, [...ancestors, id]))) : 0
  }
  const consulted = new Set(graph.inspectedEvidenceIds)
  const citedButNotReportedConsulted = [...new Set([...graph.comparisons, ...graph.decisions].flatMap(d => d.evidenceIds).filter(id => !consulted.has(id)))].sort()
  const accountedEdges = new Set(graph.edgeLineage.flatMap(l => l.successorEdges.map(key)))
  return { duplicateSuccessors, malformedSplits, malformedMerges, citedButNotReportedConsulted,
    actions: count(graph.lineage.map(l => l.decision)),
    parentCount: graph.nodes.filter(n => children(n.id).length).length,
    maxContainmentDepth: Math.max(0, ...graph.nodes.map(n => depth(n.id))),
    successorCounts: graph.lineage.map(l => ({ originalId: l.originalId, decision: l.decision, successors: l.successorIds.length })),
    newRelationships: graph.edges.filter(e => !accountedEdges.has(key(e))),
    consultedEvidenceIsSelfReport: true }
}
export function correctArmPresentation(html, consulted) {
  return html.replace('</h1>', `</h1><p class="notice">Presentation correction: this run received a fixed packet of source evidence. It reports consulting ${consulted} receipt IDs; actual token exposure was not instrumented. Available evidence is not all necessarily inspected. No new discovery or external retrieval occurred in this arm. <a href="../index.html">Compare both independent runs</a>.</p>`)
    .replaceAll('eligible files inspected', 'eligible files represented in the available packet')
    .replaceAll(' source windows ·', ' source windows available ·')
    .replaceAll('What was and wasn’t inspected', 'Evidence available to both integrations')
    .replaceAll('unique source lines inspected.', 'unique source lines available in the packet.')
    .replaceAll('File coverage counts a file once even if only a small excerpt was read.', 'An available excerpt does not establish that this integrator read it.')
    .replace(/<p>New discovery inspected[^<]*<\/p>/, '<p>This pair reuses frozen proposals and evidence; it performs no new discovery. Packet coverage is availability, not this integrator’s measured reading.</p>')
    .replace(/Broad approval of the first map motivated this expansion[^<]*/, 'The two fresh integrations receive identical available evidence, with owner feedback and earlier integration conclusions withheld.')
}
export function renderStabilityComparison(report, state, supplements) {
  const { comparison: c } = report
  const inputNodes = [...state.input.baseline.nodes, ...state.input.proposals.flatMap(p => p.nodes)], names = new Map(inputNodes.map(n => [n.id, n.name]))
  const style = readFileSync(resolve(state.m.sourceRun, 'index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1]
  const raw = x => `<pre>${esc(JSON.stringify(x, null, 2))}</pre>`
  const format = x => x === null ? 'not scored' : String(x)
  const groupRows = (groups, arm) => groups.map(g => `<details><summary><a href="${arm}/review.html#${encodeURIComponent(g.id)}">${esc(g.name)}</a> — ${g.members.length} original descendants</summary><p>${g.members.map(id => esc(names.get(id) ?? id)).join('; ') || 'No comparable original descendants'}</p></details>`).join('')
  const errors = supplements.flatMap(s => [...s.duplicateSuccessors, ...s.malformedSplits, ...s.malformedMerges])
  const consulted = setRecurrence(state.runs[0].graph.inspectedEvidenceIds, state.runs[1].graph.inspectedEvidenceIds)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VS Code: two fixed-evidence integrations</title><style>${style}</style><main><nav><a href="../experiment-summary/index.html">Experiment summary</a><a href="A/review.html#map">Complete map A</a><a href="B/review.html#map">Complete map B</a><a href="comparison.json">Frozen metrics</a><a href="supplemental-checks.json">Supplemental checks</a></nav>
  <h1>Same available evidence, two independent maps</h1><p>Both fresh agents received ${state.m.inputNodes} definitions and ${state.m.sourceWindows} source windows. Neither received the other answer, earlier integration decisions or owner feedback. They could select different portions of the common evidence. This pair is not an exact repeat of interactive retrieval.</p>
  <p class="notice">This measures recurrence, not correctness. All maps remain candidates. ${errors.length ? 'Supplemental checks found invalid identity correspondence; do not interpret recurrence scores as valid.' : 'Supplemental identity-correspondence checks found no duplicate successors or malformed split/merge cardinality.'} No winner or automatic approval is selected.</p>
  <div class="table"><table><tr><th>Result</th><th>Run A</th><th>Run B</th></tr>${[['Capabilities', ...report.runs.map(r => r.nodes)], ['Relationships', ...report.runs.map(r => r.edges)], ['Actual containment parents', ...supplements.map(s => s.parentCount)], ['Containment depth', ...supplements.map(s => s.maxContainmentDepth)], ['Unchanged-retain actions', ...supplements.map(s => s.actions.retain ?? 0)], ['Self-reported consulted receipts', ...report.runs.map(r => r.consultedReceipts)]].map(row => `<tr>${row.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table></div>
  <p>The two self-reports share ${consulted.shared} receipt IDs (${consulted.left} in A, ${consulted.right} in B). This is not independently measured reading or proof that every claim was checked.</p>
  <h2>Boundary decisions</h2><p>${c.nodeActions.same}/${c.nodeActions.total} original-node action words match. Unchanged retention can dominate this number; matching “revise” or “split” does not establish the same resulting scope.</p>
  ${c.nodeActions.differences.map(d => `<p><strong>${esc(names.get(d.id) ?? d.id)}:</strong> A ${esc(d.left)}; B ${esc(d.right)}.</p>`).join('') || '<p>No action-word differences.</p>'}
  <p>Of ${c.comparisonTargets.left} versus ${c.comparisonTargets.right} distinct examined alternative sets, ${c.comparisonTargets.shared} are shared. Relation-label sets match on ${c.comparisonTargets.sameRelationsOnSharedTargets} of those shared sets. ${c.comparisonTargets.leftOnly.length} sets occur only in A and ${c.comparisonTargets.rightOnly.length} only in B; these are not treated as agreements or disagreements on unseen alternatives.</p>
  <details open><summary>Every comparison-label difference on shared alternatives</summary>${raw(c.comparisonTargets.differences)}</details>
  <details><summary>All examined alternative sets, including unmatched cases</summary>${raw(c.comparisonTargets)}</details>
  <h2>Organization, not just counts</h2><p>${c.containmentMemberships.shared} exact original-descendant member sets recur among ${c.containmentMemberships.left} unique sets in A and ${c.containmentMemberships.right} in B. This is NOT hierarchy or semantic identity agreement: parent multiplicity, intermediate layers, parent identity and new-only descendants can differ. Actual parent counts and depth are shown above; inspect every group below.</p>
  <h3>Run A groupings</h3>${groupRows(c.containmentMemberships.leftGroups, 'A')}<h3>Run B groupings</h3>${groupRows(c.containmentMemberships.rightGroups, 'B')}
  <p>Co-successor original pairs: A ${c.coMergedOriginalPairs.left}, B ${c.coMergedOriginalPairs.right}, shared ${c.coMergedOriginalPairs.shared}; Jaccard ${esc(format(c.coMergedOriginalPairs.jaccard))}. Shared successors do not prove correct merges; empty sets receive no perfect score.</p>
  <h2>Relationships and qualifications</h2><p>${c.inputEdgeActions.same}/${c.inputEdgeActions.total} input-edge disposition words match. This excludes comparison of all new links and explanations.</p>
  ${supplements.map((s, i) => `<details><summary>Run ${i ? 'B' : 'A'}: every added link and supplemental diagnostic</summary>${raw(s)}</details>`).join('')}
  <h2>What this test cannot establish</h2><ul>${[...c.limits, 'Each full map preserves its detailed reasons and uncertainty. No claim-local semantic audit or runtime test was performed.', 'Supplemental checks and presentation corrections were specified after code review but before examining results; frozen metrics and raw reports remain unchanged.'].map(l => `<li>${esc(l)}</li>`).join('')}</ul>
  <p><a href="input.json">Identical common input</a> · <a href="protocol.md">Frozen protocol</a> · <a href="manifest.json">Fingerprints</a> · <a href="execution.json">Execution record</a> · <a href="A/reconciled.json">First raw A</a> · <a href="B/reconciled.json">First raw B</a></p></main></html>`
}
export function publishStability(out) {
  out = resolve(out); const report = freezeStability(out), state = checkStability(out)
  const supplements = state.runs.map(r => ({ arm: r.arm, ...supplementalStructure(r.graph) }))
  for (const run of state.runs) {
    for (const proposal of state.input.proposals) writeExact(resolve(out, run.arm, 'proposals', proposal.agent + '.json'), JSON.stringify(proposal, null, 2) + '\n')
    writeExact(resolve(out, run.arm, 'review.html'), correctArmPresentation(readFileSync(resolve(out, run.arm, 'index.html'), 'utf8'), run.graph.inspectedEvidenceIds.length))
  }
  const supplemental = { status: 'supplemental-not-frozen-primary-metrics', definedBeforeResultInspection: true, runs: supplements,
    emptyMemberGroups: { A: report.comparison.containmentMemberships.leftGroups.filter(g => !g.members.length), B: report.comparison.containmentMemberships.rightGroups.filter(g => !g.members.length) },
    rendererSha256: sha(readFileSync(new URL(import.meta.url), 'utf8')) }
  writeExact(out + '/supplemental-checks.json', JSON.stringify(supplemental, null, 2) + '\n')
  writeExact(out + '/index.html', renderStabilityComparison(report, state, supplements))
  return { reports: ['index.html', 'A/review.html', 'B/review.html'], supplements }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(publishStability(process.argv[2]), null, 2))
