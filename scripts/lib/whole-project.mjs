import { buildGraphRequest, applyGraphProposal, investigationCoverage, validateInvestigationCoverage } from './capability-graph.mjs'
import { comparisonRequest } from './capability-alternatives.mjs'
const check = (ok, message) => { if (!ok) throw new Error(message) }

export function wholeAgenda(graph, history, priorityIds) {
  const coverage = investigationCoverage(graph, history)
  const requiredNodeIds = history.length === 0 ? priorityIds.filter((id) => coverage.pending.includes(id)) : coverage.pending.slice(0, 4)
  return { ...coverage, requiredNodeIds, mode: requiredNodeIds.length ? 'coverage' : 'reconcile' }
}

export function deepeningAgenda(graph, history, priorityIds, step, rounds) {
  const agenda = wholeAgenda(graph, history, priorityIds)
  return { ...agenda,
    requiredNodeIds: step === 1 ? priorityIds : [...new Set([...agenda.pending, ...priorityIds])]
      .filter((id) => graph.nodes.some((n) => n.id === id)).slice(0, 7),
    mode: step === rounds ? 'reconcile' : 'data-deepen' }
}

export function validateWholeDecision(raw, graph, evidence, required, round) {
  const result = validateInvestigationCoverage(applyGraphProposal(graph, raw, evidence, round), required)
  check(Array.isArray(raw.assessments), 'assessments required')
  check(new Set(raw.assessments.map((a) => a.nodeId)).size === raw.assessments.length, 'duplicate assessment')
  for (const a of raw.assessments) {
    check(result.reviewedNodeIds.includes(a.nodeId), 'assessment must concern a reviewed node')
    check(['supported', 'partial', 'unresolved'].includes(a.status), 'invalid assessment status')
    check(typeof a.reason === 'string' && a.reason.trim(), 'assessment needs reason')
    check(Array.isArray(a.evidenceIds) && a.evidenceIds.every((id) => evidence.some((e) => e.id === id)), 'assessment citation missing')
    if (a.status !== 'unresolved') check(a.evidenceIds.length > 0, 'assessment needs evidence')
    if (a.status === 'supported') check(a.evidenceIds.some((id) => evidence.some((e) => e.id === id && e.kind === 'source')), 'supported requires relevant retrieved source, not absence of contradictions')
  }
  check(required.every((id) => raw.assessments.some((a) => a.nodeId === id)), 'each queued node needs assessment')
  return { ...result, assessments: raw.assessments }
}

export function wholeRequest(phase, context, model) {
  if (phase === 'decision') {
    const req = buildGraphRequest('decision', context, { model, maxTokens: 9000 })
    if (model.startsWith('x-ai/')) req.reasoning = { effort: 'low' }
    req.messages[0].content += `
This is a combined whole-project map, including infrastructure and data capabilities as first-class behaviors, not just UI features. The requiredNodeIds are an evidence coverage queue, NOT a suggested grouping. Account for every required ID, or explicitly defer it. New nodes will also be investigated in later rounds.
Investigate coherent broader outcomes and substantive narrower capabilities. An umbrella retains children: do not erase their identities or demand a shared source module. Different implementations can serve the same outcome. A dependency is independently compatible with containment. Do not create generic parents that merely rename their sole child. No target number of layers or groups.
If code supports responsibilities hidden inside a broad node, add explicit children beneath that existing node instead of necessarily retiring it. Avoid a single administrative summary standing in for an entire supported process. Conversely do not turn every file/function into a capability. Reconcile new relationships with the entire existing graph.
Use only retrievedEvidence for changed claims. Paths, imports, and chronological proximity alone do not establish a full runtime flow. Do not assert a migration from head-only code. Judge relevance BEFORE support: off-topic evidence means unresolved, not that keeping the old node is supported. Partial excerpts justify partial assessments.
In addition to the patch fields, return assessments:[{nodeId,status:"supported|partial|unresolved",evidenceIds:["S0"],reason:"relevance and limits"}] for every required node. A supported status must cite source directly relevant to the node. Current readings and old citations on the graph are not automatically fresh proof. Pure removals require removalEvidence:[{nodeId,evidenceIds,reason}]. In reconciliation rounds review the combined map, revisit weak relations and follow previous evidence gaps. Return concise complete JSON.`
    return req
  }
  const req = comparisonRequest(phase === 'plan' ? 'readings' : 'sources', context, model)
  req.max_tokens = 4000
  req.messages[0].content += phase === 'plan' ?
    ' Cover all requiredNodeIds, which are NOT a proposed group. Choose up to 12 readings across them and across related implementation changes, including history when useful. The first batch prioritizes the requested investigation scope, not an expected taxonomy. In reconciliation, seek missing links and questionable scope across the whole map. Do not return the same neighborhood when prior evidence was irrelevant.' :
    ' Select at most 8 exact source windows, ordered by discriminating value, covering requiredNodeIds and tracing producers/consumers or responsibility boundaries. Include current source and historical source when useful. Known current evidence anchors are available as fallbacks. Use revision=head (HEAD is normalized to that pinned revision), R-ID, or R-ID^ for its first parent. Consult headPaths and historicalCatalog instead of guessing paths. Prefer code over datasets. Request later startLine windows if previous excerpts cut off a needed operation. Decisions see only retrieved evidence, not your assumptions.'
  return req
}
