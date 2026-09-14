/** Atomic, source-linked wording revisions. Semantics are model decisions, never inferred here. */
import { createHash } from 'node:crypto'
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
const text = x => typeof x === 'string' && x.trim().length > 0
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
export function revisionTarget(node, path) {
  if (!node || typeof path !== 'string') return null
  let m = /^(summary|actor)$/.exec(path)
  if (m && typeof node[m[1]] === 'string') return { container: node, key: m[1] }
  m = /^(inputs|outcomes|conditions|exclusions|implementations|uncertainty)\[(0|[1-9]\d*)\]$/.exec(path)
  if (m && Array.isArray(node[m[1]]) && typeof node[m[1]][Number(m[2])] === 'string') return { container: node[m[1]], key: Number(m[2]) }
  m = /^claims\[(0|[1-9]\d*)\]\.text$/.exec(path)
  if (m && Array.isArray(node.claims) && typeof node.claims[Number(m[1])]?.text === 'string') return { container: node.claims[Number(m[1])], key: 'text', claimIndex: Number(m[1]) }
  return null
}
export function applyCandidateRevision(graph, proposal, { findings, receipts, allowedNodeIds }) {
  requireThat(object(proposal) && proposal.beforeGraphSha256 === hash(graph), 'stale or missing graph precondition')
  requireThat(Object.keys(proposal).every(k => ['beforeGraphSha256', 'decisions', 'patches', 'limitations'].includes(k)), 'unknown proposal field')
  requireThat(Array.isArray(proposal.decisions) && Array.isArray(proposal.patches) && Array.isArray(proposal.limitations), 'decisions, patches and limitations required')
  requireThat(proposal.limitations.every(text), 'limitations must contain nonempty text')
  const allowed = new Set(allowedNodeIds), sources = new Set(receipts.filter(r => r.kind === 'source').map(r => r.id))
  const known = new Map(findings.map(f => [f.id, f])), decisions = new Map(), targets = new Set()
  requireThat(known.size === findings.length, 'duplicate finding ID')
  const cite = ids => requireThat(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => sources.has(id)), 'unknown, duplicate or non-source evidence')
  for (const d of proposal.decisions) {
    requireThat(object(d) && known.has(d.findingId) && !decisions.has(d.findingId), 'unknown or duplicate finding decision')
    requireThat(Object.keys(d).every(k => ['findingId', 'action', 'reason', 'evidenceIds'].includes(k)), 'unknown decision field')
    requireThat(['revise', 'keep', 'defer'].includes(d.action) && text(d.reason), 'invalid finding action/reason')
    cite(d.evidenceIds); decisions.set(d.findingId, d)
  }
  requireThat(decisions.size === known.size, 'all findings require an explicit decision')
  // Validate all patches before modifying a cloned node. Array identity and length cannot change.
  for (const p of proposal.patches) {
    requireThat(object(p) && allowed.has(p.nodeId), 'patch outside permitted nodes')
    requireThat(Object.keys(p).every(k => ['nodeId', 'field', 'before', 'after', 'reason', 'evidenceIds', 'findingIds'].includes(k)), 'unknown patch field')
    const n = graph.nodes.find(n => n.id === p.nodeId), target = revisionTarget(n, p.field)
    requireThat(target && text(p.after) && text(p.reason), 'invalid patch target/text/reason')
    requireThat(p.before === target.container[target.key], 'stale field precondition')
    requireThat(p.after.trim() !== p.before.trim(), 'revision must change the active assertion')
    const key = JSON.stringify([p.nodeId, p.field]); requireThat(!targets.has(key), 'duplicate patch target'); targets.add(key)
    cite(p.evidenceIds)
    requireThat(Array.isArray(p.findingIds) && p.findingIds.length && new Set(p.findingIds).size === p.findingIds.length && p.findingIds.every(id => known.get(id)?.nodeId === p.nodeId && decisions.get(id)?.action === 'revise'), 'patch must address revised findings on the same node')
  }
  for (const [id, d] of decisions) {
    const f = known.get(id), patches = proposal.patches.filter(p => p.findingIds.includes(id))
    if (d.action === 'revise') requireThat(patches.some(p => p.nodeId === f.nodeId && p.field === f.field), 'revision decision must change the flagged field')
    else requireThat(!patches.length, 'kept/deferred finding cannot have a patch')
  }
  const nodes = structuredClone(graph.nodes), touched = new Set()
  for (const p of proposal.patches) {
    const n = nodes.find(n => n.id === p.nodeId), target = revisionTarget(n, p.field)
    target.container[target.key] = p.after
    n.evidenceIds = [...new Set([...n.evidenceIds, ...p.evidenceIds])]
    n.assessment = 'partial' // New wording is a candidate; a fresh review must assess it.
    if (target.claimIndex !== undefined) {
      n.claims[target.claimIndex].assessment = 'partial'
      n.claims[target.claimIndex].evidenceIds = [...new Set([...n.claims[target.claimIndex].evidenceIds, ...p.evidenceIds])]
    }
    touched.add(n.id)
  }
  const next = { nodes, edges: structuredClone(graph.edges) }
  return { graph: next, beforeGraphSha256: hash(graph), graphSha256: hash(next),
    previousDecisionRecords: structuredClone(Object.fromEntries(Object.entries(graph).filter(([k]) => !['nodes', 'edges'].includes(k)))),
    revisions: proposal.patches.map(p => ({ ...p, beforeContentSha256: hash(p.before), afterContentSha256: hash(p.after) })),
    lineage: graph.nodes.map(n => ({ originalId: n.id, successorIds: [n.id], decision: touched.has(n.id) ? 'revise' : 'retain',
      beforeNodeSha256: hash(n), afterNodeSha256: hash(nodes.find(x => x.id === n.id)) })),
    reviewState: { inheritedApprovals: [], changedNodeIds: [...touched],
      reason: 'Previous reviews remain attached to the previous graph version; none are promoted to this graph.',
      allNodes: 'candidate', runtimeVerified: false, automaticPromotion: false },
    decisions: structuredClone(proposal.decisions), limitations: structuredClone(proposal.limitations) }
}
