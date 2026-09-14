#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readJson, saveNew, sha } from './vscode-snapshot-evidence.mjs'
import { assembleAudit, blindNode, reviewIssues } from './vscode-evidence-audit.mjs'
import { applyCandidateRevision } from './lib/candidate-revision.mjs'
import { graphIssues } from './report-vscode-discovery.mjs'
import { revisionMarkdown, revisionMap } from './report-vscode-revision.mjs'
export function prepareRevision(auditDir, out) {
  auditDir = resolve(auditDir); out = resolve(out)
  execFileSync('git', ['check-ignore', '-q', out + '/manifest.json'])
  const audit = assembleAudit(auditDir)
  if (audit.issues.length || sha(audit) !== sha(readJson(auditDir + '/output.json'))) throw new Error('audit incomplete or changed')
  const source = readJson(audit.manifest.base + '/output.json'), receipts = source.receipts.filter(r => r.kind === 'source'), registry = new Map(receipts.map(r => [r.id, r]))
  const ref = (reviewer, id) => registry.has(id) ? id : `audit:${reviewer}:${id}`
  for (const bucket of audit.receipts) for (const r of bucket.extra.filter(r => r.kind === 'source')) receipts.push({ ...r, id: `audit:${bucket.reviewer}:${r.id}` })
  const findings = audit.reviews.flatMap(review => review.reviews.flatMap(n => {
    const items = [...n.claims.filter(c => c.verdict !== 'supported').map(c => ({ ...c, field: `claims[${c.claimIndex}].text` })), ...n.boundaryFindings]
    return items.map(f => ({ id: `${review.reviewer}:${n.nodeId}:${f.field}`, nodeId: n.nodeId, field: f.field,
      verdict: f.verdict, reason: f.reason, replacement: f.replacement, evidenceIds: f.evidenceIds.map(id => ref(review.reviewer, id)) }))
  }))
  const allowedNodeIds = [...new Set(findings.map(f => f.nodeId))]
  const contextIds = new Set([...source.graph.nodes.filter(n => allowedNodeIds.includes(n.id)).flatMap(n => n.evidenceIds), ...findings.flatMap(f => f.evidenceIds)])
  const parentCheck = structuredClone(audit.parentCheck)
  for (const c of parentCheck.checks) c.evidenceIds = c.sources.map(s => ref(s.reviewer, s.receiptId))
  const input = { protocol: 'vscode-revision-recheck-v1', beforeGraphSha256: audit.graphSha256,
    nodes: source.graph.nodes.filter(n => allowedNodeIds.includes(n.id)), allowedNodeIds, findings, parentCheck,
    receipts: receipts.filter(r => contextIds.has(r.id)) }
  mkdirSync(out, { recursive: true }); saveNew(out + '/revision-input.json', input)
  saveNew(out + '/source-input.json', { graph: source.graph, receipts, auditSamples: audit.packets.map(p => ({ reviewer: p.reviewer, nodeIds: p.nodes.map(n => n.id), evidenceIds: p.receipts.map(r => r.id) })),
    auditExtraEvidence: audit.receipts.map(b => ({ reviewer: b.reviewer, evidenceIds: b.extra.filter(r => r.kind === 'source').map(r => `audit:${b.reviewer}:${r.id}`) })) })
  const protocol = `# Wording revision and fresh source recheck\n\nFreeze the six-capability audit and its source evidence before revision. A fresh revision agent sees the four qualified definitions, all eleven adverse findings and the parent's qualifications. It may revise, keep or defer each finding with evidence. It must not treat the reviewer as an oracle. Only text fields on these four nodes can change. No node creation/removal/renaming, edge changes, history claims, target execution, network, external model API or additional retrieval. This test holds identity fixed to isolate correction, not as a long-term architecture restriction.\n\nRevision schema: {beforeGraphSha256, decisions:[{findingId,action:'revise'|'keep'|'defer',reason,evidenceIds}], patches:[{nodeId,field,before,after,reason,evidenceIds,findingIds}], limitations:[strings]}. Every finding exactly once. A revise decision must actually patch its flagged field. before must exactly match active input text; after must be a distinct nonempty string. Allowed fields: summary, actor, existing inputs/outcomes/conditions/exclusions/implementations/uncertainty array entries using field[index], and existing claims[index].text. Do not patch name, id, citations, assessments, claim count or array size. Evidence IDs must refer to supplied source receipts. Additional connected wording edits must cite the finding they address. Preserve useful responsibilities and make the minimum justified correction. Save first complete proposal, including invalid results. No semantic correction call.\n\nThe deterministic transaction validates the entire proposal before cloning any changes. It preserves capability IDs, names, node order, all relationships and unaffected node records. Changed node/claim proposer assessments reset to partial; independent reviews never carry forward. Previous integration decision records are archived separately, not presented as current revision lineage.\n\nAfter the proposal and resulting candidate version are frozen, two fresh reviewers see the same six sampled definitions and expanded static source evidence, with all previous assessments, findings, replacements, parent checks and owner feedback withheld. Each receives the same three node IDs as an earlier reviewer, including the two unchanged controls across the assignments. They must inspect all fields and claims, using the preceding audit result schema. No extra retrieval or target execution. This is a fresh assessment on revised wording, not an accuracy experiment or a randomized comparison. The earlier audit and recheck differ in source availability at review start; effects cannot be attributed solely to revision. Fresh context is instruction-based, not sandbox isolation.\n\nReport all decisions, before/after edits, revised map, raw rechecks, remaining findings, unchanged controls and provenance. No automatic acceptance or core-app migration. An output that passes structural checks can still fail the semantic recheck.\n`
  writeFileSync(out + '/protocol.md', protocol, { flag: 'wx' })
  saveNew(out + '/manifest.json', { protocol: input.protocol, auditDir, base: audit.manifest.base,
    sourceGraphSha256: audit.graphSha256, auditSha256: sha(audit), inputSha256: sha(input),
    sourceInputSha256: sha(readJson(out + '/source-input.json')), protocolSha256: sha(protocol), frozenAt: new Date().toISOString() })
  return { findings: findings.length, nodes: allowedNodeIds, graphSha256: audit.graphSha256 }
}
export function loadRevision(out) {
  const m = readJson(out + '/manifest.json'), input = readJson(out + '/revision-input.json'), source = readJson(out + '/source-input.json')
  if (sha(input) !== m.inputSha256 || sha(source) !== m.sourceInputSha256 || sha(readFileSync(out + '/protocol.md', 'utf8')) !== m.protocolSha256) throw new Error('frozen revision input changed')
  if (sha(readJson(m.base + '/output.json').graph) !== m.sourceGraphSha256 || sha(assembleAudit(m.auditDir)) !== m.auditSha256) throw new Error('original graph/audit changed')
  return { m, input, source }
}
export function applyRevision(out) {
  const { m, input, source } = loadRevision(out), proposal = readJson(out + '/proposal.json')
  const result = applyCandidateRevision(source.graph, proposal, { findings: input.findings, receipts: source.receipts, allowedNodeIds: input.allowedNodeIds })
  const errors = graphIssues(result.graph, source.receipts)
  if (errors.length) throw new Error(JSON.stringify(errors))
  return { protocol: m.protocol, ...result, receipts: source.receipts, proposal,
    sourceInputSha256: m.sourceInputSha256, auditSha256: m.auditSha256, candidateOnly: true }
}
export function prepareRechecks(out) {
  const { source } = loadRevision(out), result = applyRevision(out)
  saveNew(out + '/candidate.json', result)
  for (const sample of source.auditSamples) {
    const packet = recheckPacket(result, sample, source.auditExtraEvidence.find(x => x.reviewer === sample.reviewer).evidenceIds)
    saveNew(out + '/' + sample.reviewer + '/packet.json', packet)
  }
  saveNew(out + '/recheck-manifest.json', { candidateSha256: sha(result), proposalSha256: sha(result.proposal),
    packets: Object.fromEntries(source.auditSamples.map(s => [s.reviewer, sha(readJson(out + '/' + s.reviewer + '/packet.json'))])), frozenAt: new Date().toISOString() })
  return { graphSha256: result.graphSha256, revisions: result.revisions.length, changedNodes: result.reviewState.changedNodeIds }
}
export function recheckPacket(candidate, sample, extraEvidenceIds) {
  const nodes = sample.nodeIds.map(id => {
    const node = candidate.graph.nodes.find(n => n.id === id)
    if (!node) throw new Error('sample node missing from revised candidate')
    return blindNode(node)
  })
  const ids = new Set([...sample.evidenceIds, ...extraEvidenceIds, ...nodes.flatMap(n => [...n.evidenceIds, ...n.claims.flatMap(c => c.evidenceIds)])])
  const receipts = candidate.receipts.filter(r => ids.has(r.id))
  if ([...ids].some(id => !receipts.some(r => r.id === id && r.kind === 'source'))) throw new Error('recheck source missing')
  return { reviewer: sample.reviewer, graphSha256: candidate.graphSha256, nodes, receipts }
}
export function assembleRechecks(out) {
  const manifest = readJson(out + '/recheck-manifest.json'), candidate = applyRevision(out)
  if (sha(candidate) !== manifest.candidateSha256 || sha(readJson(out + '/candidate.json')) !== manifest.candidateSha256) throw new Error('candidate changed after freeze')
  const reviews = [], packets = [], issues = []
  for (const [reviewer, hash] of Object.entries(manifest.packets)) {
    const packet = readJson(out + '/' + reviewer + '/packet.json'); packets.push(packet)
    if (sha(packet) !== hash) throw new Error('recheck input changed')
    if (!existsSync(out + '/' + reviewer + '/review.json')) { issues.push(reviewer + ': missing review'); continue }
    const review = readJson(out + '/' + reviewer + '/review.json'); reviews.push(review)
    issues.push(...reviewIssues(packet, review, packet.receipts).map(x => reviewer + ': ' + x))
  }
  return { candidate, manifest, packets, reviews, issues, candidateOnly: true, runtimeVerified: false, automaticPromotion: false }
}
export function recheckOverlay(output) {
  if (output.issues.length || output.reviews.length !== Object.keys(output.manifest.packets).length) throw new Error('complete valid rechecks required')
  if (sha(output.candidate) !== output.manifest.candidateSha256) throw new Error('candidate version changed')
  const entries = []
  for (const [reviewer, hash] of Object.entries(output.manifest.packets)) {
    const packet = output.packets.find(p => p.reviewer === reviewer), review = output.reviews.find(r => r.reviewer === reviewer)
    if (!packet || sha(packet) !== hash || packet.graphSha256 !== output.candidate.graphSha256) throw new Error('recheck target changed')
    if (!review || reviewIssues(packet, review, packet.receipts).length) throw new Error('invalid recheck')
    for (const r of review.reviews) {
      const n = packet.nodes.find(n => n.id === r.nodeId)
      entries.push({ reviewer, nodeId: n.id, scope: 'definition', contentSha256: sha(n), verdict: r.definitionVerdict,
        reason: r.reason, evidenceIds: r.evidenceIds, boundaryFindings: r.boundaryFindings })
      for (const c of r.claims) entries.push({ reviewer, nodeId: n.id, scope: 'claim', contentSha256: sha(n.claims[c.claimIndex]), ...c })
    }
  }
  return { graphSha256: output.candidate.graphSha256, kind: 'fresh-static-source-recheck', inheritedApprovals: [],
    runtimeVerified: false, automaticPromotion: false, contentProjection: 'Blinded review-packet definitions and zero-based claims',
    reviewSha256: Object.fromEntries(output.reviews.map(r => [r.reviewer, sha(r)])), entries }
}
export function writeOrVerify(path, content) {
  // Crash recovery never overwrites a differing artifact or requires another model call.
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) throw new Error('existing artifact differs: ' + path)
    return 'verified-existing'
  }
  writeFileSync(path, content, { flag: 'wx' }); return 'created'
}
export function freezeRechecks(out) {
  const output = assembleRechecks(out), overlay = recheckOverlay(output)
  const baseline = readJson(readJson(out + '/manifest.json').base + '/output.json')
  const artifacts = { 'output.json': JSON.stringify(output, null, 2) + '\n',
    'recheck-overlay.json': JSON.stringify(overlay, null, 2) + '\n',
    'report.md': revisionMarkdown(output), 'map.html': revisionMap(output, baseline) }
  return Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, writeOrVerify(out + '/' + name, content)]))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, first, second] = process.argv.slice(2)
  const result = mode === 'prepare' ? prepareRevision(first, second) : mode === 'recheck-packets' ? prepareRechecks(resolve(first)) : mode === 'apply' ? applyRevision(resolve(first)) : mode === 'freeze' ? freezeRechecks(resolve(first)) : assembleRechecks(resolve(first))
  console.log(JSON.stringify(mode === 'apply' ? { graphSha256: result.graphSha256, revisions: result.revisions.length } : mode === 'check' ? { issues: result.issues, reviews: result.reviews.length } : result, null, 2))
}
