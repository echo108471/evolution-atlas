import { isDeepStrictEqual } from 'node:util'
const nodeFields = ['id', 'name', 'summary', 'actor', 'inputs', 'outcomes', 'conditions', 'exclusions', 'implementations', 'evidenceIds', 'assessment', 'uncertainty', 'claims']
const edgeFields = ['from', 'to', 'type', 'reason', 'evidenceIds', 'assessment']
const claimFields = ['text', 'evidenceIds', 'assessment']
const pick = (value, fields) => Object.fromEntries(fields.filter(k => Object.hasOwn(value, k)).map(k => [k, structuredClone(value[k])]))
const key = e => JSON.stringify([e.from, e.to, e.type])
const text = x => typeof x === 'string' && x.trim().length > 0
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const texts = x => Array.isArray(x) && x.every(text)
const uniqueTexts = x => texts(x) && new Set(x).size === x.length
const assessment = x => ['supported', 'partial', 'unresolved'].includes(x)
export function candidateProjection(graph, prefix = '') {
  if (typeof prefix !== 'string' || !record(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid candidate projection input')
  const refs = x => ({ ...x, evidenceIds: x.evidenceIds.map(id => prefix + id) })
  return { nodes: graph.nodes.map(n => ({ ...refs(pick(n, nodeFields)), id: prefix + n.id,
    claims: n.claims.map(c => refs(pick(c, claimFields))) })),
    edges: graph.edges.map(e => ({ ...refs(pick(e, edgeFields)), from: prefix + e.from, to: prefix + e.to })) }
}
export function strictGraphIssues(graph, receipts) {
  const issues = [], add = (target, message) => issues.push({ target, message })
  if (!record(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(receipts)) return [{ target: 'graph', message: 'nodes, edges and receipts arrays required' }]
  const source = new Set(), receiptIds = new Set()
  for (const r of receipts) {
    if (!record(r) || !text(r.id) || receiptIds.has(r.id)) { add('receipts', 'invalid or duplicate receipt identity'); continue }
    receiptIds.add(r.id)
    if (r.kind === 'source') source.add(r.id)
  }
  const cites = (v, target) => {
    if (!uniqueTexts(v.evidenceIds) || v.evidenceIds.some(id => !source.has(id))) add(target, 'invalid, duplicate or non-source evidence')
    if (v.assessment !== 'unresolved' && !v.evidenceIds?.length) add(target, 'non-unresolved claim has no source citation')
    if (!assessment(v.assessment)) add(target, 'invalid proposer assessment')
  }
  const check = (v, keys, target) => { for (const k of Object.keys(v)) if (!keys.includes(k)) issues.push({ target, message: 'unexpected interpretation field: ' + k }) }
  check(graph, ['nodes', 'edges', 'agent', 'scopeSummary', 'coverage', 'crossPartitionLeads', 'lineage', 'edgeLineage', 'comparisons', 'decisions', 'limitations'], 'graph')
  const ids = new Set(), children = new Map(), indegree = new Map()
  for (const n of graph.nodes) {
    if (!record(n)) { add('node', 'node object required'); continue }
    if (!text(n.id) || ids.has(n.id)) add('node', 'missing/duplicate ID')
    else { ids.add(n.id); children.set(n.id, []); indegree.set(n.id, 0) }
    check(n, nodeFields, n.id)
    for (const k of ['name', 'summary', 'actor']) if (!text(n[k])) add(n.id, k + ' must be nonempty text')
    for (const k of ['inputs', 'outcomes', 'conditions', 'exclusions', 'implementations', 'uncertainty']) if (!texts(n[k])) add(n.id, k + ' must contain nonempty text')
    cites(n, n.id)
    if (!Array.isArray(n.claims)) add(n.id, 'claims array required')
    else for (const c of n.claims) {
      if (!record(c)) { add(n.id, 'claim object required'); continue }
      check(c, claimFields, n.id)
      if (!text(c.text)) add(n.id, 'claim text required')
      cites(c, n.id)
    }
  }
  const edgeKeys = new Set()
  for (const e of graph.edges) {
    if (!record(e)) { add('edge', 'edge object required'); continue }
    check(e, edgeFields, 'edge'); cites(e, 'edge')
    if (!ids.has(e.from) || !ids.has(e.to)) add('edge', 'dangling endpoint')
    if (e.from === e.to) add('edge', 'self edge')
    if (edgeKeys.has(key(e))) add('edge', 'duplicate edge')
    edgeKeys.add(key(e))
    if (!['contains', 'depends_on', 'supports', 'overlaps'].includes(e.type)) add('edge', 'unknown relationship type')
    if (!text(e.reason)) add('edge', 'reason required')
    if (e.type === 'contains' && ids.has(e.from) && ids.has(e.to)) { children.get(e.from).push(e.to); indegree.set(e.to, indegree.get(e.to) + 1) }
  }
  // Iterative traversal avoids imposing a recursion-depth ceiling on valid maps.
  const queue = [...ids].filter(id => !indegree.get(id))
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i])) { indegree.set(child, indegree.get(child) - 1); if (!indegree.get(child)) queue.push(child) }
  if (queue.length !== ids.size) add('graph', 'containment cycle')
  return issues
}
export function lineageIssues(graph, originals, originalEdges) {
  const issues = [], add = (target, message) => issues.push({ target, message })
  if (!Array.isArray(graph.lineage) || !Array.isArray(graph.edgeLineage)) return [{ target: 'lineage', message: 'node and edge lineage arrays required' }]
  const before = new Map(originals.map(n => [n.id, n])), after = new Map(graph.nodes.map(n => [n.id, n])), seen = new Set()
  if (before.size !== originals.length) add('lineage', 'duplicate input node identity')
  const owners = id => graph.lineage.filter(l => record(l) && Array.isArray(l.successorIds) && l.successorIds.includes(id))
  for (const l of graph.lineage) {
    if (!l || !before.has(l.originalId) || seen.has(l.originalId)) { add('lineage', 'unknown/duplicate original'); continue }
    seen.add(l.originalId)
    const ids = l.successorIds
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !after.has(id)) || !text(l.reason)) { add(l.originalId, 'invalid or duplicate successors/reason'); continue }
    if (!['retain', 'rename', 'revise', 'merge', 'split', 'remove'].includes(l.decision)) add(l.originalId, 'invalid action')
    if (l.decision === 'remove' ? ids.length !== 0 : l.decision === 'split' ? ids.length < 2 : ids.length !== 1) add(l.originalId, 'action successor cardinality mismatch')
    if (l.decision === 'retain' && !isDeepStrictEqual(before.get(l.originalId), after.get(ids[0]))) add(l.originalId, 'retain changed the original')
    if (l.decision === 'rename') {
      const a = before.get(l.originalId), b = after.get(ids[0])
      if (!b || !isDeepStrictEqual({ ...a, id: null, name: null }, { ...b, id: null, name: null }) || (a.id === b.id && a.name === b.name)) add(l.originalId, 'rename may change only ID/name and must change one')
    }
    if (l.decision === 'revise' && isDeepStrictEqual(before.get(l.originalId), after.get(ids[0]))) add(l.originalId, 'revision made no change')
    if (l.decision === 'merge' && (ids.length !== 1 || owners(ids[0]).length < 2 || owners(ids[0]).some(x => x.decision !== 'merge'))) add(l.originalId, 'merge requires at least two explicitly merging originals')
    if (l.decision !== 'merge' && ids.some(id => owners(id).length > 1)) add(l.originalId, 'shared successor requires explicit merge accounting')
  }
  for (const id of before.keys()) if (!seen.has(id)) add(id, 'missing original lineage')
  const edgeMap = new Map(graph.edges.map(e => [key(e), e])), edgeSeen = new Set()
  for (const l of graph.edgeLineage) {
    const k = `${l?.source}:${l?.originalIndex}`, original = Object.hasOwn(originalEdges, l?.source) ? originalEdges[l.source]?.[l.originalIndex] : null
    if (!l || !original || !Number.isInteger(l.originalIndex) || edgeSeen.has(k)) { add(k, 'unknown/duplicate original edge'); continue }
    edgeSeen.add(k)
    if (!text(l.reason) || !Array.isArray(l.successorEdges)) { add(k, 'edge successors/reason required'); continue }
    if (l.successorEdges.some(e => !record(e) || !text(e.from) || !text(e.to) || !text(e.type) || Object.keys(e).some(k => !['from', 'to', 'type'].includes(k)))) { add(k, 'edge successor must identify from, to and type only'); continue }
    const ks = l.successorEdges.map(key)
    if (new Set(ks).size !== ks.length || ks.some(k => !edgeMap.has(k))) add(k, 'duplicate or missing edge successor')
    if (!['retain', 'revise', 'remove'].includes(l.decision)) add(k, 'invalid edge action')
    if (l.decision === 'remove' && ks.length) add(k, 'removed edge has successor')
    if (l.decision === 'revise' && !ks.length) add(k, 'revised edge has no successor')
    if (l.decision === 'revise' && ks.length === 1 && isDeepStrictEqual(original, edgeMap.get(ks[0]))) add(k, 'edge revision made no change')
    if (l.decision === 'retain' && (ks.length !== 1 || !isDeepStrictEqual(original, edgeMap.get(ks[0])))) add(k, 'retained edge changed')
  }
  for (const [source, es] of Object.entries(originalEdges)) es.forEach((_, i) => { if (!edgeSeen.has(`${source}:${i}`)) add(`${source}:${i}`, 'missing original edge lineage') })
  return issues
}
export function reconciledIssues(graph, baseline, proposals, receipts, expansion) {
  const issues = strictGraphIssues(graph, receipts)
  if (issues.length) return issues
  try {
    issues.push(...lineageIssues(graph, [...baseline.nodes, ...proposals.flatMap(p => p.nodes)], { baseline: baseline.edges, discovery: proposals.flatMap(p => p.edges) }))
    if (expansion) issues.push(...comparisonIssues(graph.comparisons, baseline, proposals, receipts))
    if (!Array.isArray(graph.decisions) || !texts(graph.limitations)) issues.push({ target: 'graph', message: 'global decisions and text limitations required' })
    const sources = new Set(receipts.filter(r => r.kind === 'source').map(r => r.id))
    for (const d of graph.decisions ?? []) if (!record(d) || !text(d.question) || !text(d.decision) || !text(d.reason) || !texts(d.uncertainty) || !uniqueTexts(d.evidenceIds) || d.evidenceIds.some(id => !sources.has(id))) issues.push({ target: 'decisions', message: 'incomplete decision or invalid citation' })
  } catch (e) { issues.push({ target: 'graph', message: 'malformed reconciliation: ' + e.message }) }
  return issues
}

function comparisonIssues(comparisons, baseline, proposals, receipts) {
  if (!Array.isArray(comparisons)) return [{ target: 'comparisons', message: 'new-to-existing comparisons array required' }]
  const issues = [], fresh = new Set(proposals.flatMap(p => p.nodes.map(n => n.id))), old = new Set(baseline.nodes.map(n => n.id)), seen = new Set(), pairs = new Set()
  const sources = new Set(receipts.filter(r => r.kind === 'source').map(r => r.id))
  for (const c of comparisons) {
    const add = message => issues.push({ target: c?.newNodeId ?? 'comparison', message })
    if (!record(c)) { add('comparison object required'); continue }
    if (!fresh.has(c.newNodeId)) add('unknown new comparison node')
    seen.add(c.newNodeId)
    if (!uniqueTexts(c.existingNodeIds) || c.existingNodeIds.some(id => !old.has(id))) add('invalid existing comparison nodes')
    else {
      const k = JSON.stringify([c.newNodeId, [...c.existingNodeIds].sort()])
      if (pairs.has(k)) add('duplicate alternative set comparison')
      pairs.add(k)
    }
    if (!['same', 'overlapping', 'broader', 'narrower', 'distinct', 'uncertain'].includes(c.relation)) add('invalid comparison relation')
    if (!['distinct', 'uncertain'].includes(c.relation) && !c.existingNodeIds?.length) add('non-distinct comparison lacks existing alternative')
    if (!text(c.reason) || !text(c.disposition) || !texts(c.uncertainty)) add('missing comparison explanation')
    if (!uniqueTexts(c.evidenceIds) || !c.evidenceIds.length || c.evidenceIds.some(id => !sources.has(id))) add('comparison lacks valid inspected evidence')
  }
  for (const id of fresh) if (!seen.has(id)) issues.push({ target: id, message: 'missing new-to-existing comparison' })
  return issues
}
