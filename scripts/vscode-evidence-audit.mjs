#!/usr/bin/env node
// Claim-local source review sidecar. Never promotes or mutates the candidate graph.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readJson, saveNew, sha } from './vscode-snapshot-evidence.mjs'

export const protocol = 'vscode-evidence-audit-v1'
export function sampleGraph(graph) {
  return [['merge', 1], ['revise', 2], ['retain', 3]].flatMap(([stratum, count]) =>
    graph.nodes.filter(n => graph.lineage.some(l => l.decision === stratum && l.successorIds.includes(n.id)))
      .sort((a, b) => sha(protocol + ':' + a.id).localeCompare(sha(protocol + ':' + b.id)))
      .slice(0, count).map(n => ({ nodeId: n.id, stratum })))
}
export function blindNode(n) {
  const { assessment, uncertainty, ...definition } = n
  return { ...definition, claims: n.claims.map(({ assessment, ...c }, claimIndex) => ({ ...c, claimIndex })) }
}
export function definitionField(node, path) {
  // Citation metadata is inspectable too; recognizing the field does not verify its claims.
  const match = /^(name|summary|actor|inputs|outcomes|conditions|exclusions|implementations|evidenceIds)(?:\[(0|[1-9]\d*)\])?$/.exec(path ?? '')
  if (!match || !Object.hasOwn(node, match[1])) return undefined
  const value = node[match[1]]
  return match[2] === undefined ? value : Array.isArray(value) ? value[Number(match[2])] : undefined
}
export function prepareAudit(base, out) {
  base = resolve(base); out = resolve(out)
  execFileSync('git', ['check-ignore', '-q', out + '/manifest.json'])
  mkdirSync(out, { recursive: true })
  const source = readJson(base + '/output.json'), graphSha256 = sha(source.graph)
  const selected = sampleGraph(source.graph)
  if (selected.length !== 6 || new Set(selected.map(n => n.nodeId)).size !== 6) throw new Error('six distinct sampled nodes required')
  const assignmentIds = { A: [selected[0], selected[2], selected[3]], B: [selected[1], selected[4], selected[5]] }
  const inventory = readJson('public/graph-reviews/vscode-discovery-1/inventory.json')
  const instruction = `# Frozen source-support audit\n\nReview the exact behavior of six reproducibly sampled candidates from an immutable graph. One merged, two revised, three retained nodes are selected by ascending SHA256(protocol + ':' + node ID) within each lineage stratum. This is a small stratified diagnostic, not a representative accuracy estimate.\n\nTwo fresh-context subscription agents each review three disjoint candidates. They see definitions, claims and cited source receipts, but no proposer assessments, uncertainty prose, lineage reasoning, owner feedback, other review or desired verdict. Context isolation is instruction-based, not a filesystem sandbox. They may read six additional windows and four location searches, at most 40000 serialized receipt bytes each, using the unchanged frozen snapshot broker. All broker calls must be sequential per agent. No target execution, network, external model API, target instructions or history.\n\nFor every claim record supported, qualified, contradicted or unresolved with evidence and scope. Supported means static source supports the precise wording, not runtime verification. For every node examine summary, inputs, outcomes, conditions, exclusions and compositional boundaries, not only its enumerated claims. Do not force atomicity or judge taxonomy as uniquely correct. A qualification must give an exact proposed replacement; a contradiction must explain the counterexample. No original graph edits. First complete review is preserved. A parent may verify findings using source and record disagreement separately, not overwrite them. No semantic correction call. Mechanical schema failures are retained.\n\nResult schema: {reviewer: 'A'|'B', reviews:[{nodeId, definitionVerdict, reason, evidenceIds:[source receipt IDs], claims:[{claimIndex, verdict, reason, evidenceIds:[source receipt IDs], replacement:string|null}], boundaryFindings:[{field, verdict, reason, evidenceIds:[source receipt IDs], replacement:string|null}]}], limitations:[strings]}. Verdict enum: supported|qualified|contradicted|unresolved. Include every assigned node and every claim exactly once; boundaryFindings may be empty only when the definition review finds no further issue. Give source citations even for unresolved findings where they show the inspected boundary. Unresolved never means disproved.\n\nReport all raw reviews and caveats. Attach review statuses to exact graph and claim hashes in a separate sidecar. Owner approval remains broad usefulness only. Preserve all prior outputs.\n`
  writeFileSync(out + '/protocol.md', instruction, { flag: 'wx' })
  const manifests = {}
  for (const [reviewer, selections] of Object.entries(assignmentIds)) {
    const nodes = selections.map(s => blindNode(source.graph.nodes.find(n => n.id === s.nodeId)))
    const ids = new Set(nodes.flatMap(n => [...n.evidenceIds, ...n.claims.flatMap(c => c.evidenceIds)]))
    const packet = { protocol, graphSha256, commitSha: source.manifest.commitSha, reviewer, nodes,
      receipts: source.receipts.filter(r => r.kind === 'source' && ids.has(r.id)) }
    saveNew(out + '/' + reviewer + '/packet.json', packet)
    saveNew(out + '/' + reviewer + '/inventory.json', inventory)
    saveNew(out + '/' + reviewer + '/manifest.json', { ...source.manifest, inventorySha256: sha(inventory),
      budgets: { perAgent: { windows: 6, searches: 4, evidenceBytes: 40000, linesPerWindow: 160, bytesPerWindow: 16000 } } })
    manifests[reviewer] = { packetSha256: sha(packet), manifestSha256: sha(readJson(out + '/' + reviewer + '/manifest.json')) }
  }
  const manifest = { protocol, base, graphSha256, outputSha256: sha(readFileSync(base + '/output.json', 'utf8')),
    protocolSha256: sha(instruction), selected, assignments: manifests, frozenAt: new Date().toISOString(),
    interpretationStatus: 'candidate', independentRuntimeVerification: false }
  saveNew(out + '/manifest.json', manifest)
  return manifest
}
export function reviewIssues(packet, review, receipts) {
  const issues = [], verdicts = new Set(['supported', 'qualified', 'contradicted', 'unresolved'])
  const sources = new Set(receipts.filter(r => r.kind === 'source').map(r => r.id))
  const check = (finding, where) => {
    if (!finding || !verdicts.has(finding.verdict)) issues.push(where + ': invalid verdict')
    if (!finding?.reason?.trim()) issues.push(where + ': reason required')
    if (!Array.isArray(finding?.evidenceIds) || !finding.evidenceIds.length || finding.evidenceIds.some(id => !sources.has(id))) issues.push(where + ': source citations required')
    if (['qualified', 'contradicted'].includes(finding?.verdict) && !finding.replacement?.trim()) issues.push(where + ': exact replacement required')
  }
  if (review?.reviewer !== packet.reviewer) issues.push('reviewer mismatch')
  if (!Array.isArray(review?.reviews)) return [...issues, 'reviews required']
  if (review.reviews.length !== packet.nodes.length) issues.push('all and only assigned nodes required')
  if (new Set(review.reviews.map(r => r.nodeId)).size !== review.reviews.length) issues.push('duplicate node')
  for (const n of packet.nodes) {
    const r = review.reviews.find(r => r.nodeId === n.id)
    if (!r) { issues.push('missing ' + n.id); continue }
    check({ ...r, verdict: r.definitionVerdict, replacement: 'See field findings' }, n.id)
    if (!Array.isArray(r.boundaryFindings)) issues.push(n.id + ': boundary findings required')
    for (const f of r.boundaryFindings ?? []) {
      check(f, n.id + ':' + f.field)
      if (definitionField(n, f.field) === undefined) issues.push(n.id + ': invalid boundary field')
    }
    if (['qualified', 'contradicted'].includes(r.definitionVerdict) && !(r.boundaryFindings ?? []).some(f => ['qualified', 'contradicted'].includes(f.verdict)) && !(r.claims ?? []).some(c => ['qualified', 'contradicted'].includes(c.verdict))) issues.push(n.id + ': adverse definition verdict needs finding')
    if (!Array.isArray(r.claims) || r.claims.length !== n.claims.length || new Set(r.claims?.map(c => c.claimIndex)).size !== n.claims.length) issues.push(n.id + ': complete unique claim accounting required')
    for (const c of r.claims ?? []) {
      if (!n.claims.some(x => x.claimIndex === c.claimIndex)) issues.push(n.id + ': unknown claim')
      check(c, n.id + ':' + c.claimIndex)
    }
  }
  return issues
}
export function assembleAudit(out) {
  const m = readJson(out + '/manifest.json'), source = readJson(m.base + '/output.json')
  if (sha(source.graph) !== m.graphSha256 || sha(readFileSync(m.base + '/output.json', 'utf8')) !== m.outputSha256) throw new Error('source graph changed')
  if (sha(readFileSync(out + '/protocol.md', 'utf8')) !== m.protocolSha256) throw new Error('protocol changed')
  const reviews = [], issues = [], receipts = [], packets = []
  for (const reviewer of Object.keys(m.assignments)) {
    const root = out + '/' + reviewer, packet = readJson(root + '/packet.json'), manifest = readJson(root + '/manifest.json')
    if (sha(packet) !== m.assignments[reviewer].packetSha256 || sha(manifest) !== m.assignments[reviewer].manifestSha256) throw new Error('frozen audit input changed')
    if (sha(readJson(root + '/inventory.json')) !== manifest.inventorySha256) throw new Error('inventory changed')
    if (sha(readFileSync('scripts/vscode-snapshot-evidence.mjs', 'utf8')) !== manifest.brokerSha256) throw new Error('broker changed')
    // F is unused by inherited unprefixed receipts. Separate directories isolate reviewers.
    const dir = root + '/receipts/F'
    const extra = existsSync(dir) ? readdirSync(dir).filter(p => p.endsWith('.json')).sort().map(p => readJson(dir + '/' + p)) : []
    const all = [...packet.receipts, ...extra]
    if (new Set(all.map(r => r.id)).size !== all.length) throw new Error('receipt ID collision')
    const budget = manifest.budgets.perAgent
    if (extra.filter(r => r.kind === 'source').length > budget.windows || extra.filter(r => r.kind === 'search').length > budget.searches || extra.reduce((s, r) => s + Buffer.byteLength(JSON.stringify(r)), 0) > budget.evidenceBytes) throw new Error('retrieval budget exceeded')
    const inventory = readJson(root + '/inventory.json')
    for (const r of all.filter(r => r.kind === 'source')) {
      const f = inventory.files.find(f => f.path === r.path)
      if (!f || f.blobSha !== r.blobSha || r.commitSha !== packet.commitSha) throw new Error('receipt snapshot mismatch')
      const blob = execFileSync('git', ['--git-dir=' + manifest.repo, 'cat-file', 'blob', r.blobSha], { encoding: 'utf8' })
      if (blob.split('\n').slice(r.startLine - 1, r.endLine).join('\n') !== r.text) throw new Error('source text mismatch')
    }
    packets.push(packet); receipts.push({ reviewer, extra, source: packet.receipts })
    if (!existsSync(root + '/review.json')) { issues.push(reviewer + ': review missing'); continue }
    const review = readJson(root + '/review.json')
    reviews.push(review); issues.push(...reviewIssues(packet, review, all).map(i => reviewer + ': ' + i))
  }
  return { protocol, graphSha256: m.graphSha256, manifest: m, packets, receipts, reviews, issues,
    candidateMapUnchanged: true, verificationKind: 'bounded-static-source-review',
    runtimeVerified: false, representativeAccuracyEstimate: false,
    parentCheck: existsSync(out + '/parent-check.json') ? readJson(out + '/parent-check.json') : null,
    ownerFeedback: existsSync(out + '/owner-feedback.json') ? readJson(out + '/owner-feedback.json') : null,
    executionRecord: existsSync(out + '/execution-record.json') ? readJson(out + '/execution-record.json') : null }
}
export function reviewOverlay(audit) {
  if (audit.issues.length || audit.reviews.length !== audit.packets.length) throw new Error('complete valid reviews required')
  for (const packet of audit.packets) {
    if (packet.graphSha256 !== audit.graphSha256 || sha(packet) !== audit.manifest?.assignments?.[packet.reviewer]?.packetSha256) throw new Error('review target changed')
    const review = audit.reviews.find(r => r.reviewer === packet.reviewer)
    const bucket = audit.receipts.find(r => r.reviewer === packet.reviewer)
    if (!review || !bucket || reviewIssues(packet, review, [...bucket.source, ...bucket.extra]).length) throw new Error('invalid review')
  }
  return { schemaVersion: '0.1.0', graphSha256: audit.graphSha256,
    interpretationStatus: 'candidate', verificationKind: audit.verificationKind,
    runtimeVerified: false, automaticPromotion: false,
    contentProjection: 'Frozen review-packet definition without proposer assessment/uncertainty; claims include zero-based claimIndex',
    reviewSha256: Object.fromEntries(audit.reviews.map(r => [r.reviewer, sha(r)])),
    entries: audit.reviews.flatMap(review => {
      const packet = audit.packets.find(p => p.reviewer === review.reviewer)
      return review.reviews.flatMap(r => {
        const n = packet.nodes.find(n => n.id === r.nodeId)
        return [{ nodeId: n.id, scope: 'definition', contentSha256: sha(n), reviewer: review.reviewer,
          verdict: r.definitionVerdict, reason: r.reason, evidenceIds: r.evidenceIds, boundaryFindings: r.boundaryFindings },
        ...r.claims.map(c => ({ nodeId: n.id, scope: 'claim', claimIndex: c.claimIndex,
          contentSha256: sha(n.claims.find(x => x.claimIndex === c.claimIndex)), reviewer: review.reviewer,
          ...c }))]
      })
    }) }
}
const md = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1')
export function renderAuditMarkdown(audit) {
  const overlay = reviewOverlay(audit), claims = overlay.entries.filter(e => e.scope === 'claim')
  const counts = Object.fromEntries(['supported', 'qualified', 'contradicted', 'unresolved'].map(v => [v, claims.filter(c => c.verdict === v).length]))
  const definitions = audit.reviews.flatMap(r => r.reviews)
  const boundaryContradictions = definitions.flatMap(r => r.boundaryFindings).filter(f => f.verdict === 'contradicted').length
  const cite = (reviewer, ids) => ids.map(id => {
    const bucket = audit.receipts.find(r => r.reviewer === reviewer)
    const r = [...bucket.source, ...bucket.extra].find(r => r.id === id)
    return `[${md(id)}: ${md(r.path)}:${r.startLine}–${r.endLine}](https://github.com/microsoft/vscode/blob/${r.commitSha}/${r.path}#L${r.startLine}-L${r.endLine})`
  }).join('; ')
  const parts = ['# VS Code: claim-local evidence audit', '',
    '[Original expanded map, unchanged](../vscode-expansion-1/index.html#map) · [Raw audit](output.json) · [Review sidecar](review-overlay.json)', '',
    `Six sampled capabilities; ${claims.length} explicit claims reviewed. ${counts.supported} source-supported, ${counts.qualified} need qualification, ${counts.contradicted} contradicted, ${counts.unresolved} unresolved. These are reviewer judgments, not a measured accuracy rate.`, '',
    `Across the complete definitions: ${definitions.filter(r => r.definitionVerdict === 'supported').length} supported and ${definitions.filter(r => r.definitionVerdict === 'qualified').length} qualified. Reviewers also identified ${boundaryContradictions} contradicted condition outside the explicit claim list.`, '',
    'Two fresh-context reviewers inspected disjoint samples without prior confidence ratings or owner feedback. One merged, two revised and three unchanged candidates were selected by a frozen hash-based rule. Static inspection does not establish runtime correctness, a uniquely correct taxonomy, or the validity of all graph relationships.', '',
    `Graph: \`${audit.graphSha256}\`. All capabilities remain candidates. Proposed replacements below are not applied to the frozen map.`, '',
    '## What the audit changes', '',
    'The candidate map remains useful; these reviews qualify specific descriptions. Reviewing summaries, outcomes and conditions matters: a condition can be wrong even when all of a node’s enumerated claims pass.', '']
  if (audit.parentCheck) {
    parts.push('### Parent cross-check, not a blind replication', '')
    for (const c of audit.parentCheck.checks) parts.push(`**${md(c.nodeId)} — ${md(c.disposition)}.** ${md(c.reason)}`, '',
      ...c.sources.map(s => cite(s.reviewer, [s.receiptId])), '')
  }
  parts.push('## Complete findings', '')
  for (const review of audit.reviews) for (const r of review.reviews) {
    const n = audit.packets.find(p => p.reviewer === review.reviewer).nodes.find(n => n.id === r.nodeId)
    parts.push(`### ${md(n.name)}`, '', `**Definition: ${md(r.definitionVerdict)}.** ${md(r.reason)}`, '',
      `Original summary: ${md(n.summary)}`, '', cite(review.reviewer, r.evidenceIds), '')
    for (const f of r.boundaryFindings) parts.push(`**Field ${md(f.field)} — ${md(f.verdict)}:** ${md(f.reason)}`, '',
      `Original: ${md(definitionField(n, f.field))}`, '',
      f.replacement ? `Proposed replacement: ${md(f.replacement)}` : 'No replacement proposed.', '', cite(review.reviewer, f.evidenceIds), '')
    for (const c of r.claims) parts.push(`**Claim ${c.claimIndex + 1} — ${md(c.verdict)}**`, '',
      `Original: ${md(n.claims.find(x => x.claimIndex === c.claimIndex).text)}`, '', md(c.reason), '',
      ...(c.replacement ? [`Proposed replacement: ${md(c.replacement)}`, ''] : []), cite(review.reviewer, c.evidenceIds), '')
  }
  parts.push('## Scope and limitations', '', ...audit.reviews.flatMap(r => r.limitations.map(l => `- Reviewer ${r.reviewer}: ${md(l)}`)), '',
    'The parent inspected selected findings separately; see parent-check.json when present. Review is not blind at that stage. Missing evidence is not disproof. Source receipts preserve exact snapshot/blob/path/line provenance. No target code or external model API was executed.', '')
  return parts.join('\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, first, second] = process.argv.slice(2)
  if (mode === 'prepare') console.log(JSON.stringify(prepareAudit(first, second), null, 2))
  else { const result = assembleAudit(resolve(first)); console.log(JSON.stringify({ issues: result.issues, reviewed: result.reviews.length }, null, 2)) }
}
