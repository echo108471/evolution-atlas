import { reconciledIssues, strictGraphIssues } from './repository-engine-contract.mjs'

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const strings = value => Array.isArray(value) && value.every(text)
const uniqueStrings = value => strings(value) && new Set(value).size === value.length
const assessment = value => ['supported', 'partial', 'unresolved'].includes(value)
const decisions = new Set(['retain', 'rename', 'revise', 'merge', 'split', 'remove', 'introduce', 'uncertain'])
const edgeKey = edge => JSON.stringify([edge.from, edge.to, edge.type])
const refKey = edge => JSON.stringify([edge.from, edge.to, edge.type])
const withoutHistory = graph => {
  const result = { ...graph }
  delete result.historyLineage
  delete result.historyEdgeLineage
  return result
}

function graphReceipts(receipts) {
  // A verified diff may support a behavior claim. Commit metadata, cached readings, and
  // prior maps remain observations/context and cannot establish source behavior.
  return receipts.map(receipt => receipt?.kind === 'diff' ? { ...receipt, kind: 'source' } : receipt)
}

export function strictGraphIssuesV3(graph, receipts, { integration = false } = {}) {
  if (!record(graph)) return [{ target: 'graph', message: 'graph object required' }]
  const issues = strictGraphIssues(withoutHistory(graph), graphReceipts(receipts))
  if (!integration && (Object.hasOwn(graph, 'historyLineage') || Object.hasOwn(graph, 'historyEdgeLineage'))) {
    issues.push({ target: 'graph', message: 'history lineage is integration-only' })
  }
  return issues
}

function validateEvidence(entry, receipts, target, issues, decision, priorSha, currentSha) {
  const add = message => issues.push({ target, message })
  if (!text(entry.claim) || !text(entry.reason)) add('history claim and reason required')
  if (!assessment(entry.assessment)) add('invalid candidate assessment')
  if (!uniqueStrings(entry.evidenceIds)) add('history citations must be unique receipt IDs')
  else {
    for (const id of entry.evidenceIds) {
      const receipt = receipts.find(candidate => candidate?.id === id)
      if (!receipt || !['source', 'diff'].includes(receipt.kind)) add('history claim cites non-source or unavailable evidence: ' + id)
    }
  }
  const cited = (Array.isArray(entry.evidenceIds) ? entry.evidenceIds : [])
    .map(id => receipts.find(candidate => candidate?.id === id)).filter(Boolean)
  if (entry.assessment !== 'unresolved') {
    if (['introduce', 'rename', 'revise', 'merge', 'split', 'remove'].includes(decision) && !cited.some(receipt => receipt.kind === 'diff' && receipt.commitSha !== priorSha)) {
      add('changed, introduced, merged, split, or removed claim requires a post-baseline diff receipt')
    } else if (decision === 'retain' && (!cited.some(receipt => receipt.kind === 'source' && receipt.commitSha === priorSha)
      || !cited.some(receipt => receipt.kind === 'source' && receipt.commitSha === currentSha))) {
      add('retained capability requires source receipts from both revisions')
    } else if (decision === 'uncertain' && !cited.some(receipt => receipt.kind === 'diff'
      || (receipt.kind === 'source' && [priorSha, currentSha].includes(receipt.commitSha)))) {
      add('partially assessed uncertainty requires source or diff evidence')
    }
  }
}

function validateNodeLineage(rows, priorNodes, currentNodes, receipts, priorSha, currentSha) {
  const issues = [], add = (target, message) => issues.push({ target, message })
  if (!Array.isArray(rows)) return [{ target: 'historyLineage', message: 'historyLineage array required' }]
  const prior = new Map(priorNodes.map(node => [node.id, node])), current = new Map(currentNodes.map(node => [node.id, node]))
  const seenPrior = new Set(), memberships = new Map(), sharedOwners = new Map(), ids = new Set()
  for (const entry of rows) {
    const target = entry?.id ?? 'historyLineage'
    if (!record(entry)) { add(target, 'history lineage row object required'); continue }
    if (Object.keys(entry).some(key => !['id', 'from', 'to', 'decision', 'claim', 'reason', 'evidenceIds', 'assessment'].includes(key))) add(target, 'unexpected history lineage field')
    if (!text(entry.id) || ids.has(entry.id)) add(target, 'history lineage ID missing or duplicated')
    ids.add(entry.id)
    if (!Array.isArray(entry.to) || entry.to.some(ref => !record(ref) || ref.commitSha !== currentSha || !text(ref.nodeId) || !current.has(ref.nodeId))
      || new Set((entry.to ?? []).map(ref => ref?.nodeId)).size !== (entry.to ?? []).length) add(target, 'invalid current-revision successors')
    else for (const ref of entry.to) {
      if (Object.keys(ref).some(key => !['commitSha', 'nodeId'].includes(key))) add(target, 'unexpected successor reference field')
      memberships.set(ref.nodeId, (memberships.get(ref.nodeId) ?? 0) + 1)
    }
    if (entry.from == null) {
      if (!['introduce', 'uncertain'].includes(entry.decision) || !Array.isArray(entry.to) || entry.to.length !== 1) add(target, 'unmatched current node must be one introduced or uncertain successor')
    } else {
      const from = entry.from
      if (!record(from) || Object.keys(from).some(key => !['commitSha', 'nodeId'].includes(key)) || from.commitSha !== priorSha || !text(from.nodeId) || !prior.has(from.nodeId) || seenPrior.has(from.nodeId)) add(target, 'unknown, foreign, future, or duplicated predecessor')
      else seenPrior.add(from.nodeId)
      if (entry.decision === 'introduce') add(target, 'introduced capability cannot have a predecessor')
      if (entry.decision === 'remove' && entry.to?.length !== 0) add(target, 'removed capability cannot have a successor')
      if (entry.decision === 'split' && entry.to?.length < 2) add(target, 'split requires at least two successors')
      if (entry.decision === 'merge' && entry.to?.length !== 1) add(target, 'merge requires exactly one successor')
      if (['retain', 'rename', 'revise'].includes(entry.decision) && entry.to?.length !== 1) add(target, 'mapped capability requires exactly one successor')
      if (entry.decision === 'uncertain' && entry.to?.length > 1) add(target, 'uncertain mapping cannot claim a split')
      if (entry.decision === 'merge' && Array.isArray(entry.to) && entry.to.length === 1) {
        const nodeId = entry.to[0]?.nodeId
        sharedOwners.set(nodeId, (sharedOwners.get(nodeId) ?? 0) + 1)
      }
    }
    if (!decisions.has(entry.decision)) add(target, 'invalid history change category')
    validateEvidence(entry, receipts, target, issues, entry.decision, priorSha, currentSha)
  }
  for (const id of prior.keys()) if (!seenPrior.has(id)) add(id, 'missing predecessor accounting')
  for (const id of current.keys()) {
    const count = memberships.get(id) ?? 0, merges = sharedOwners.get(id) ?? 0
    if (count === 0) add(id, 'missing successor accounting')
    if (count > 1 && (count !== merges || merges < 2)) add(id, 'shared successor requires explicit merge accounting')
    if (merges === 1) add(id, 'merge requires at least two predecessor claims')
  }
  return issues
}

function validateEdgeLineage(rows, priorEdges, currentEdges, receipts, priorSha, currentSha) {
  const issues = [], add = (target, message) => issues.push({ target, message })
  if (!Array.isArray(rows)) return [{ target: 'historyEdgeLineage', message: 'historyEdgeLineage array required' }]
  const priorKeys = new Set(priorEdges.map(edgeKey)), currentByKey = new Map(currentEdges.map(edge => [edgeKey(edge), edge]))
  const seenPrior = new Set(), memberships = new Map(), sharedOwners = new Map(), ids = new Set()
  for (const entry of rows) {
    const target = entry?.id ?? 'historyEdgeLineage'
    if (!record(entry)) { add(target, 'history edge lineage row object required'); continue }
    if (Object.keys(entry).some(key => !['id', 'from', 'to', 'decision', 'claim', 'reason', 'evidenceIds', 'assessment'].includes(key))) add(target, 'unexpected history edge lineage field')
    if (!text(entry.id) || ids.has(entry.id)) add(target, 'history edge lineage ID missing or duplicated')
    ids.add(entry.id)
    const to = entry.to
    if (!Array.isArray(to) || to.some(edge => !record(edge) || edge.commitSha !== currentSha || !text(edge.from) || !text(edge.to) || !text(edge.type) || !currentByKey.has(refKey(edge)))
      || new Set((to ?? []).map(refKey)).size !== (to ?? []).length) add(target, 'invalid current-revision successor edge')
    else for (const edge of to) {
      if (Object.keys(edge).some(key => !['commitSha', 'from', 'to', 'type'].includes(key))) add(target, 'unexpected successor relationship field')
      const key = refKey(edge); memberships.set(key, (memberships.get(key) ?? 0) + 1)
    }
    if (entry.from == null) {
      if (!['introduce', 'uncertain'].includes(entry.decision) || !Array.isArray(to) || to.length !== 1) add(target, 'unmatched current edge must be one introduced or uncertain successor')
    } else {
      const from = entry.from
      if (!record(from) || Object.keys(from).some(key => !['commitSha', 'from', 'to', 'type'].includes(key)) || from.commitSha !== priorSha || !text(from.from) || !text(from.to) || !text(from.type)
        || !priorKeys.has(refKey(from)) || seenPrior.has(refKey(from))) add(target, 'unknown, foreign, future, or duplicated predecessor edge')
      else seenPrior.add(refKey(from))
      if (entry.decision === 'introduce') add(target, 'introduced relationship cannot have a predecessor')
      if (entry.decision === 'remove' && to?.length !== 0) add(target, 'removed relationship cannot have a successor')
      if (entry.decision === 'split' && to?.length < 2) add(target, 'split relationship requires at least two successors')
      if (entry.decision === 'merge' && to?.length !== 1) add(target, 'merged relationship requires exactly one successor')
      if (['retain', 'rename', 'revise'].includes(entry.decision) && to?.length !== 1) add(target, 'mapped relationship requires exactly one successor')
      if (entry.decision === 'uncertain' && to?.length > 1) add(target, 'uncertain relationship cannot claim a split')
      if (entry.decision === 'merge' && Array.isArray(to) && to.length === 1) {
        const key = refKey(to[0]); sharedOwners.set(key, (sharedOwners.get(key) ?? 0) + 1)
      }
    }
    if (!decisions.has(entry.decision)) add(target, 'invalid history relationship category')
    validateEvidence(entry, receipts, target, issues, entry.decision, priorSha, currentSha)
  }
  for (const key of priorKeys) if (!seenPrior.has(key)) add(key, 'missing predecessor relationship accounting')
  for (const key of currentByKey.keys()) {
    const count = memberships.get(key) ?? 0, merges = sharedOwners.get(key) ?? 0
    if (count === 0) add(key, 'missing successor relationship accounting')
    if (count > 1 && (count !== merges || merges < 2)) add(key, 'shared successor relationship requires merge accounting')
    if (merges === 1) add(key, 'relationship merge requires at least two predecessors')
  }
  return issues
}

export function reconciledIssuesV3(graph, baseline, proposals, receipts, expansion, { baselineCommitSha, currentCommitSha, transitionDiffReceiptIds = [] } = {}) {
  const issues = reconciledIssues(withoutHistory(graph), baseline, proposals, graphReceipts(receipts), expansion)
  if (!expansion) {
    if (!Array.isArray(graph?.historyLineage) || graph.historyLineage.length) issues.push({ target: 'historyLineage', message: 'initial discovery requires an empty history lineage array' })
    if (!Array.isArray(graph?.historyEdgeLineage) || graph.historyEdgeLineage.length) issues.push({ target: 'historyEdgeLineage', message: 'initial discovery requires an empty history edge lineage array' })
    return issues
  }
  if (!baselineCommitSha || !currentCommitSha) {
    issues.push({ target: 'historyLineage', message: 'pinned baseline and current revisions required' })
    return issues
  }
  if (baselineCommitSha === currentCommitSha) {
    if (!Array.isArray(graph?.historyLineage) || graph.historyLineage.length) issues.push({ target: 'historyLineage', message: 'same-revision expansion requires an empty history lineage array' })
    if (!Array.isArray(graph?.historyEdgeLineage) || graph.historyEdgeLineage.length) issues.push({ target: 'historyEdgeLineage', message: 'same-revision expansion requires an empty history edge lineage array' })
    return issues
  }
  const oldNodes = Array.isArray(baseline?.nodes) ? baseline.nodes : []
  const oldEdges = Array.isArray(baseline?.edges) ? baseline.edges : []
  const currentNodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const currentEdges = Array.isArray(graph?.edges) ? graph.edges : []
  const transitionDiffs = new Set(transitionDiffReceiptIds)
  const gitReceipts = receipts.filter(receipt => receipt?.kind === 'source' || (receipt?.kind === 'diff' && transitionDiffs.has(receipt.id)))
  issues.push(...validateNodeLineage(graph?.historyLineage, oldNodes, currentNodes, gitReceipts, baselineCommitSha, currentCommitSha))
  issues.push(...validateEdgeLineage(graph?.historyEdgeLineage, oldEdges, currentEdges, gitReceipts, baselineCommitSha, currentCommitSha))
  return issues
}
