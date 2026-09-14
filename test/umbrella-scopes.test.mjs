import test from 'node:test'
import assert from 'node:assert/strict'
import { scopeCases, scopeRequest, validateScopePlan, judgeContext, validateScopeJudgment } from '../scripts/lib/umbrella-scopes.mjs'
import { renderScopes } from '../scripts/render-umbrella-scopes.mjs'
const graph = { nodes: ['N0', 'N1', 'N2'].map((id) => ({ id, name: id, summary: 'Behavior', evidenceIds: ['S0'] })),
  edges: [{ id: 'E0', from: 'N0', to: 'N1', type: 'contains', evidenceIds: ['S0'] }] }
const experimentCase = { seedIds: ['N0', 'N1', 'N2'] }
const plan = { question: 'Which outcome?', readingIds: [], sources: [], alternatives: [
  { id: 'A', kind: 'keep', label: 'Separate', description: 'No change', weakness: 'Shared outcome hidden', focusParentId: null, newNodes: [], contains: [] },
  { id: 'B', kind: 'reuse', label: 'Use existing', description: 'Extend scope', weakness: 'Possibly broad', focusParentId: 'N0', newNodes: [], contains: [{ from: 'N0', to: 'N2' }] },
  { id: 'C', kind: 'new', label: 'New umbrella', description: 'Another outcome', weakness: 'Possibly redundant', focusParentId: 'P0', newNodes: [{ id: 'P0', name: 'Outcome', summary: 'Common purpose' }], contains: [{ from: 'P0', to: 'N0' }, { from: 'P0', to: 'N2' }] },
] }
const evidence = [{ id: 'S0', kind: 'source', text: 'code' }]
const judgment = { assessments: plan.alternatives.map((a) => ({ alternativeId: a.id, verdict: 'supported', reason: 'Behavior supports this outcome', evidenceIds: ['S0'] })),
  noveltyChecks: [{ alternativeId: 'C', newNodeId: 'P0', closestExistingId: 'N0', relationship: 'broader', reason: 'Includes additional behavior', evidenceIds: ['S0'] }],
  selectedId: 'C', reason: 'Coherent scope', unresolved: [], missingAlternative: null }

test('scope proposals retain every seed and original edge, support reuse and deeper umbrellas', () => {
  const result = validateScopePlan(plan, graph, experimentCase)
  assert.deepEqual(result.alternatives[2].candidateGraph.nodes.slice(0, 3), graph.nodes)
  assert.deepEqual(result.alternatives[2].candidateGraph.edges[0], graph.edges[0])
  assert.deepEqual(result.alternatives[1].candidateGraph.nodes, graph.nodes)
})
test('reject cycles, duplicated existing edges, out-of-neighborhood nodes, overwritten seeds and trivial parents', () => {
  for (const edit of [
    (p) => { p.alternatives[1].contains = [{ from: 'N1', to: 'N0' }] },
    (p) => { p.alternatives[1].contains = [{ from: 'N0', to: 'N1' }] },
    (p) => { p.alternatives[1].contains = [{ from: 'N0', to: 'unknown' }] },
    (p) => { p.alternatives[2].newNodes[0].id = 'N0' },
    (p) => { p.alternatives[2].contains = [{ from: 'P0', to: 'N2' }] },
  ]) { const changed = structuredClone(plan); edit(changed); assert.throws(() => validateScopePlan(changed, graph, experimentCase)) }
})
test('judge calls exclude planner weakness, preference and run provenance; order only reverses alternatives', () => {
  const a = judgeContext(graph, plan.alternatives, evidence), b = judgeContext(graph, plan.alternatives, evidence, true)
  assert.equal(a.alternatives[0].weakness, undefined)
  b.alternatives.reverse(); assert.deepEqual(a, b)
  const enriched = judgeContext(graph, plan.alternatives, [...evidence, { id: 'S1', text: 'more' }])
  enriched.retrievedEvidence.pop(); assert.deepEqual(a, enriched)
  assert.equal(scopeRequest('judge', a, 'model').messages[0].content, scopeRequest('judge', b, 'model').messages[0].content)
})
test('judgments account for each rival and new parent; validate citations without claiming semantic truth', () => {
  assert.equal(validateScopeJudgment(judgment, plan.alternatives, evidence, graph).evaluator, 'same-model-not-ground-truth')
  for (const edit of [
    (j) => { j.assessments.pop() }, (j) => { j.noveltyChecks = [] },
    (j) => { j.assessments[0].evidenceIds = ['unknown'] },
    (j) => { j.selectedId = 'unknown' }, (j) => { j.assessments[2].verdict = 'unsupported' },
  ]) { const changed = structuredClone(judgment); edit(changed); assert.throws(() => validateScopeJudgment(changed, plan.alternatives, evidence, graph)) }
  assert.equal(validateScopeJudgment({ ...judgment, selectedId: null }, plan.alternatives, evidence, graph).selectedId, null)
})
test('case selection is derived from prior graph topology, not owner labels or ratings', () => {
  const proposed = validateScopePlan(plan, graph, experimentCase).alternatives[2].candidateGraph
  const a = scopeCases(graph, [{ runId: 'run', graph: proposed }])
  const b = scopeCases(graph, [{ runId: 'run', graph: proposed, humanVerdict: 'no', note: 'merge everything' }])
  assert.deepEqual(a, b)
  assert.equal(a.selected.length, 1)
  assert.deepEqual(a.selected[0].members, ['N0', 'N1', 'N2'])
})
test('report exposes all alternatives and decisions, escapes untrusted text, and labels abstention', () => {
  const planned = validateScopePlan(plan, graph, experimentCase)
  planned.question = '<script>not instructions</script>'
  const result = { case: { ...experimentCase, id: 'case' }, plan: { status: 'valid', value: planned },
    retrieval: { addedSourceCount: 0, addedEvidenceIds: [], omitted: [] },
    judgments: [{ condition: 'existing-evidence', order: 'forward', status: 'valid', value: { ...judgment, selectedId: null } }] }
  const html = renderScopes({ graph, results: [result], manifest: { design: 'Test', selectionRule: 'Topology', limitations: 'No truth claim' }, stages: [], cost: 0 },
    { case: { enriched: evidence, addedEvidence: [] } })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /Undecided/)
  assert.match(html, /See this arrangement/)
  assert.match(html, /No automatic repairs/)
  for (const a of plan.alternatives) assert.ok(html.includes(a.label))
})
