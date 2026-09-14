import { render, intervalCoverage } from './report-vscode-discovery.mjs'
const esc = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const md = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1')
export function recheckSummary(output) {
  const definitions = output.reviews.flatMap(r => r.reviews), claims = definitions.flatMap(n => n.claims)
  const count = (rows, field) => Object.fromEntries(['supported', 'qualified', 'contradicted', 'unresolved'].map(v => [v, rows.filter(r => r[field] === v).length]))
  return { definitions: count(definitions, 'definitionVerdict'), claims: count(claims, 'verdict'),
    fields: count(definitions.flatMap(n => n.boundaryFindings).filter(f => !/^evidenceIds(?:\[|$)/.test(f.field)), 'verdict'),
    metadata: count(definitions.flatMap(n => n.boundaryFindings).filter(f => /^evidenceIds(?:\[|$)/.test(f.field)), 'verdict'),
    changedNodes: output.candidate.reviewState.changedNodeIds.length,
    unchangedNodes: output.candidate.lineage.filter(l => l.decision === 'retain').length,
    patches: output.candidate.revisions.length,
    controls: definitions.filter(n => !output.candidate.reviewState.changedNodeIds.includes(n.nodeId)).map(n => ({ nodeId: n.nodeId, verdict: n.definitionVerdict })) }
}
export function revisionMarkdown(output) {
  const { candidate } = output, s = recheckSummary(output), names = new Map(candidate.graph.nodes.map(n => [n.id, n.name]))
  const refs = ids => ids.map(id => {
    const r = candidate.receipts.find(r => r.id === id)
    return `[${md(id)}](https://github.com/microsoft/vscode/blob/${r.commitSha}/${r.path}#L${r.startLine}-L${r.endLine})`
  }).join(', ')
  const parts = ['# VS Code: revision and fresh recheck', '',
    '[Complete revised map](map.html#map) · [Original map, unchanged](../vscode-expansion-1/index.html#map) · [Source audit](../vscode-evidence-audit-1/index.html) · [Full output](output.json)', '',
    `The model proposed ${s.patches} wording edits on ${s.changedNodes} capabilities. All ${candidate.graph.nodes.length} IDs and names, all ${candidate.graph.edges.length} relationships, and ${s.unchangedNodes} unaffected definitions remain unchanged.`, '',
    `Fresh reviewers assessed the same six sampled capabilities: ${s.definitions.supported} definitions supported, ${s.definitions.qualified} qualified, ${s.definitions.contradicted} contradicted, ${s.definitions.unresolved} unresolved. Explicit claims: ${s.claims.supported} supported, ${s.claims.qualified} qualified, ${s.claims.contradicted} contradicted, ${s.claims.unresolved} unresolved. These are static-source judgments, not accuracy or runtime guarantees.`, '',
    `Before: \`${candidate.beforeGraphSha256}\`. Revised: \`${candidate.graphSha256}\`.`, '',
    'No previous review approval transfers to this version. Capability identity and relationships were held fixed for this wording experiment, not as a permanent engine restriction. Prior integration decisions remain archived in candidate.json rather than presented as new lineage.', '',
    '## Remaining qualifications and gaps', '',
    'Overall definition verdicts are the reviewers’ own labels. A supported label can coexist with an unresolved field; neither is silently discarded. Citation-metadata checks are reported separately from behavior checks. Proposed next corrections below have not been applied.', '']
  for (const r of output.reviews) for (const n of r.reviews) {
    const findings = [...n.boundaryFindings.filter(f => f.verdict !== 'supported'), ...n.claims.filter(c => c.verdict !== 'supported').map(c => ({ ...c, field: `claims[${c.claimIndex}].text` }))]
    for (const f of findings) parts.push(`**${md(names.get(n.nodeId))} / ${md(f.field)} — ${md(f.verdict)}.** ${md(f.reason)}`, '', refs(f.evidenceIds), '')
  }
  parts.push('## Every finding disposition', '')
  for (const d of candidate.decisions) parts.push(`**${md(d.findingId)} — ${md(d.action)}.** ${md(d.reason)}`, '', refs(d.evidenceIds), '')
  parts.push('## Every active-text change', '')
  for (const p of candidate.revisions) parts.push(`### ${md(names.get(p.nodeId))} / ${md(p.field)}`, '',
    `Before: ${md(p.before)}`, '', `After: ${md(p.after)}`, '', md(p.reason), '', refs(p.evidenceIds), '')
  parts.push('## Complete fresh rechecks', '')
  for (const r of output.reviews) for (const n of r.reviews) {
    const source = candidate.graph.nodes.find(x => x.id === n.nodeId)
    parts.push(`### ${md(names.get(n.nodeId))}`, '', `**Definition: ${md(n.definitionVerdict)}.** ${md(n.reason)}`, '', refs(n.evidenceIds), '')
    for (const f of n.boundaryFindings) parts.push(`**${md(f.field)} — ${md(f.verdict)}.** ${md(f.reason)}`, '',
      ...(f.replacement ? [`Proposed next correction: ${md(f.replacement)}`, ''] : []), refs(f.evidenceIds), '')
    for (const c of n.claims) parts.push(`**Claim ${c.claimIndex + 1} — ${md(c.verdict)}.** ${md(source.claims[c.claimIndex].text)}`, '', md(c.reason), '',
      ...(c.replacement ? [`Proposed next correction: ${md(c.replacement)}`, ''] : []), refs(c.evidenceIds), '')
  }
  parts.push('## Controls and limits', '', ...s.controls.map(c => `- Unchanged control ${md(names.get(c.nodeId))}: ${md(c.verdict)}.`), '',
    'Reviewers saw current definitions and the accumulated source packet, but not old findings, proposed replacements, confidence ratings, parent checks or owner feedback. No new source was retrieved. The original audit did not start with this expanded packet, so this does not isolate the effect of wording alone. There was one revision proposal and one fresh review per assignment, with no repeated semantic corrections until passing.', '',
    'Passing checks means the sampled wording received source support in this pass, not that the entire engine or map is verified. The recheck excludes proposer uncertainty prose to avoid leaking earlier reasoning; changes to that prose are not separately blind-audited. Identity, relationship and historical-evolution claims remain outside this test.', '',
    ...output.reviews.flatMap(r => r.limitations.map(l => `- Reviewer ${r.reviewer}: ${md(l)}`)), '',
    ...candidate.limitations.map(l => `- Revision: ${md(l)}`), '')
  return parts.join('\n')
}
export function revisionMap(output, baseline) {
  const c = output.candidate, coverage = intervalCoverage(c.receipts)
  const summary = recheckSummary(output)
  const data = { graph: c.graph, manifest: baseline.manifest, receipts: c.receipts,
    coverage: { ...coverage, eligibleFiles: baseline.coverage.eligibleFiles,
      assignments: [{ agent: 'Cumulative discovery and source audit', eligibleFiles: baseline.coverage.eligibleFiles, ...coverage }] },
    amendments: [], graphIssues: [], proposalIssues: [], provenanceIssues: [], proposals: [], limitations: [...baseline.limitations, ...c.limitations], status: 'candidate-map-produced' }
  let html = render(data)
    .replace('<h1>VS Code: a first capability map</h1>', '<h1>VS Code: a revised candidate map</h1>')
    .replace('Assessments below are the proposing model’s judgments; independent verification has not been performed.', `Changed definitions start as partial proposals. Fresh static-source reviews cover six sampled capabilities: ${summary.definitions.supported} supported, ${summary.definitions.qualified} qualified, ${summary.definitions.contradicted} contradicted, ${summary.definitions.unresolved} unresolved. Field findings include ${summary.fields.unresolved} unresolved gaps even when an overall definition is supported. No runtime verification or automatic promotion has occurred. <a href="index.html">Read every revision and recheck.</a>`)
    .replace('No feedback has been used to tune this output.', 'Source-audit findings informed wording revisions. Owner capability labels and feedback were withheld from revision and fresh review.')
    .replaceAll('independently verified: not performed', 'runtime verification: not performed')
    .replaceAll('independent verification: not performed', 'runtime verification: not performed')
    .replace('href="inventory.json"', 'href="../vscode-discovery-1/inventory.json"')
    .replace('href="reconciled.json">Original reconciler output', 'href="proposal.json">Original revision proposal')
    .replace('<summary>Global scope decisions and lineage</summary>', '<summary>Prior decisions and current revision lineage are in candidate.json</summary><a href="candidate.json">Candidate version and preserved decision records</a>')
  for (const review of output.reviews) for (const n of review.reviews) {
    const tag = `<article class="capability" id="${esc(n.nodeId)}">`
    const remaining = [...n.boundaryFindings, ...n.claims].filter(f => f.verdict !== 'supported')
    html = html.replace(tag, `${tag}<p class="notice">Fresh static-source recheck: ${esc(n.definitionVerdict)}. ${remaining.length} field/claim qualifications or gaps remain. This is a reviewer judgment, not runtime verification. <a href="index.html">Full findings</a>.</p>`)
  }
  return html
}
