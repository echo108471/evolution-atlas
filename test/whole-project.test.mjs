import test from 'node:test'
import assert from 'node:assert/strict'
import { wholeAgenda, deepeningAgenda, validateWholeDecision } from '../scripts/lib/whole-project.mjs'
const graph = { nodes: ['N0', 'N1', 'N2'].map((id) => ({ id, name: id, evidenceIds: ['R0'] })), edges: [] }
const patch = { upsertNodes: [], removeNodeIds: [], upsertEdges: [], removeEdgeIds: [], reviewedNodeIds: ['N0'], continue: true, reason: 'Check', unresolved: [] }
test('whole-project agenda prioritizes requested scope but queues every other node', () => {
  assert.deepEqual(wholeAgenda(graph, [], ['N2']).requiredNodeIds, ['N2'])
  const history = [{ result: { reviewedNodeIds: ['N2'] }, investigationMode: 'coverage' }]
  assert.deepEqual(wholeAgenda(graph, history, ['N2']).requiredNodeIds, ['N0', 'N1'])
  history.push({ result: { reviewedNodeIds: ['N0', 'N1'] }, investigationMode: 'coverage' })
  assert.equal(wholeAgenda(graph, history, ['N2']).mode, 'reconcile')
})
test('coverage receipts distinguish partial or missing evidence from source-supported claims', () => {
  const evidence = [{ id: 'R0', kind: 'reading' }, { id: 'S0', kind: 'source' }]
  const assessed = (status, evidenceIds) => ({ ...patch, assessments: [{ nodeId: 'N0', status, evidenceIds, reason: 'Scope examined' }] })
  assert.throws(() => validateWholeDecision(assessed('supported', ['R0']), graph, evidence, ['N0'], 1), /supported requires/)
  assert.equal(validateWholeDecision(assessed('partial', ['R0']), graph, evidence, ['N0'], 1).assessments[0].status, 'partial')
  assert.equal(validateWholeDecision(assessed('unresolved', []), graph, evidence, ['N0'], 1).assessments[0].status, 'unresolved')
  assert.throws(() => validateWholeDecision({ ...patch, assessments: [] }, graph, evidence, ['N0'], 1), /each queued/)
  assert.throws(() => validateWholeDecision(assessed('partial', ['invented']), graph, evidence, ['N0'], 1), /citation/)
})

test('deepening revisits completed scope and queues newly discovered children before reconciliation', () => {
  const history = [{ result: { reviewedNodeIds: ['N0', 'N1', 'N2'] }, investigationMode: 'reconcile' },
    { result: { reviewedNodeIds: [] }, investigationMode: 'reconcile' }]
  assert.equal(wholeAgenda(graph, history, ['N2']).complete, true)
  assert.deepEqual(deepeningAgenda(graph, history, ['N2'], 1, 3).requiredNodeIds, ['N2'])
  const extended = { ...graph, nodes: [...graph.nodes, { id: 'N3' }] }
  assert.deepEqual(deepeningAgenda(extended, history, ['N2'], 2, 3).requiredNodeIds, ['N3', 'N2'])
  assert.equal(deepeningAgenda(extended, history, ['N2'], 3, 3).mode, 'reconcile')
  assert.equal(deepeningAgenda(extended, history, ['N2'], 3, 3).complete, false)
})
