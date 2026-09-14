// Pairwise candidate decisions are an interpretation sidecar, never graph mutations.
export const relations = ['same', 'overlapping', 'broader', 'narrower', 'distinct', 'uncertain']
export const facetKeys = ['left', 'right', 'sharedBehavior', 'sharedImplementation', 'leftOnly', 'rightOnly']
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const text = x => typeof x === 'string' && x.trim().length > 0
const strings = x => Array.isArray(x) && x.every(text)

export function witnessIssues(output, packet, condition, packetSha256) {
  const issues = [], add = (target, message) => issues.push({ target, message })
  if (!obj(output)) return [{ target: 'output', message: 'object required' }]
  if (output.schemaVersion !== '0.1.0') add('schemaVersion', 'expected 0.1.0')
  if (output.condition !== condition) add('condition', 'wrong condition')
  if (output.packetSha256 !== packetSha256) add('packetSha256', 'wrong frozen packet')
  const receipts = new Map(packet.receipts.map(r => [r.id, r]))
  const cited = (ids, target, nonempty = true) => {
    if (!strings(ids) || (nonempty && !ids.length) || new Set(ids).size !== ids.length || ids.some(id => !receipts.has(id))) add(target, 'unique available source IDs required')
  }
  cited(output.inspectedEvidenceIds, 'inspectedEvidenceIds')
  if (!strings(output.limitations) || !output.limitations.length) add('limitations', 'nonempty limitations required')
  if (!Array.isArray(output.decisions)) return [...issues, { target: 'decisions', message: 'array required' }]
  const pairs = new Set(packet.pairs.map(p => p.id)), seen = new Set(), allCitations = new Set()
  for (const [i, d] of output.decisions.entries()) {
    const t = `decisions[${i}]`
    if (!obj(d)) { add(t, 'object required'); continue }
    if (!pairs.has(d.pairId) || seen.has(d.pairId)) add(t + '.pairId', 'unknown or duplicate pair')
    seen.add(d.pairId)
    if (!relations.includes(d.relation)) add(t + '.relation', 'invalid relation')
    for (const field of ['disposition', 'reason', 'revisionTrigger']) if (!text(d[field])) add(t + '.' + field, 'nonempty text required')
    if (!strings(d.uncertainty)) add(t + '.uncertainty', 'text array required')
    cited(d.evidenceIds, t + '.evidenceIds')
    for (const id of Array.isArray(d.evidenceIds) ? d.evidenceIds : []) allCitations.add(id)
    if (condition === 'prose') {
      if ('facets' in d || 'separationTest' in d) add(t, 'prose condition must not add witness-schema fields')
      continue
    }
    if (!obj(d.facets)) { add(t + '.facets', 'facet object required'); continue }
    for (const k of facetKeys) {
      const facts = d.facets[k], f = t + '.facets.' + k
      if (!Array.isArray(facts) || (['left', 'right'].includes(k) && !facts.length)) { add(f, 'fact array required; each side must have at least one fact'); continue }
      for (const [j, fact] of facts.entries()) {
        if (!obj(fact) || !text(fact.statement) || !Array.isArray(fact.citations) || !fact.citations.length) { add(`${f}[${j}]`, 'statement and nonempty citations required'); continue }
        for (const c of fact.citations) {
          const r = receipts.get(c?.receiptId)
          if (!r || !Number.isInteger(c.startLine) || !Number.isInteger(c.endLine) || c.startLine > c.endLine || c.startLine < r.startLine || c.endLine > r.endLine) add(`${f}[${j}].citations`, 'citation range must lie inside its available receipt')
          else allCitations.add(c.receiptId)
        }
      }
    }
    if (!['established', 'not-established', 'unknown'].includes(d.sharedBehaviorStatus)) add(t + '.sharedBehaviorStatus', 'invalid status')
    if (d.sharedBehaviorStatus === 'established' && !d.facets.sharedBehavior?.length) add(t + '.sharedBehaviorStatus', 'established status requires at least one witness')
    if (d.sharedBehaviorStatus !== 'established' && d.facets.sharedBehavior?.length) add(t + '.sharedBehaviorStatus', 'non-established status cannot assert established shared facts')
    const s = d.separationTest
    if (!obj(s)) add(t + '.separationTest', 'object required')
    else {
      for (const k of ['scenario', 'expectedLeft', 'expectedRight', 'limit']) if (!text(s[k])) add(t + '.separationTest.' + k, 'nonempty text required')
      cited(s.evidenceIds, t + '.separationTest.evidenceIds')
      for (const id of Array.isArray(s.evidenceIds) ? s.evidenceIds : []) allCitations.add(id)
    }
  }
  for (const id of pairs) if (!seen.has(id)) add('decisions', 'missing pair ' + id)
  if (strings(output.inspectedEvidenceIds)) for (const id of allCitations) if (!output.inspectedEvidenceIds.includes(id)) add('inspectedEvidenceIds', 'cited source not reported consulted: ' + id)
  return issues
}

export function witnessMetrics(runs, packet) {
  const valid = runs.filter(r => r.state === 'saved-valid')
  const groups = Object.fromEntries(['prose', 'witness'].map(condition => {
    const rs = valid.filter(r => r.condition === condition)
    const pairs = packet.pairs.map(p => {
      const labels = rs.map(r => ({ run: r.run, relation: r.output.decisions.find(d => d.pairId === p.id).relation }))
      return { pairId: p.id, labels, agreement: labels.length === 2 ? labels[0].relation === labels[1].relation : null }
    })
    return [condition, { validRuns: rs.length, comparablePairs: pairs.filter(p => p.agreement !== null).length, agreeingPairs: pairs.filter(p => p.agreement === true).length, pairs }]
  }))
  return { kind: 'paired-label-recurrence-not-accuracy', conditions: groups,
    fullCoverage: runs.length === 4 && valid.length === 4,
    limits: ['Diagnostic sample selected using earlier outcomes, not held-out accuracy.', 'Pairwise comparisons and fixed sampling differ from global integration.', 'Two runs per condition cannot establish a general advantage.', 'Schema and line-range checks do not establish semantic support.', 'The witness condition changes both explicit attention and output structure; this does not isolate formatting alone.', 'Source-reading lists are self-reports. No graph updates, automatic promotion or runtime tests.'] }
}
