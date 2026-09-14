import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCases, comparisonRequest, validateComparison } from '../scripts/lib/capability-alternatives.mjs'

const evidence = [{ id: 'R0', kind: 'reading' }, { id: 'S1', kind: 'source', commitSha: 'old' }, { id: 'S2', kind: 'source', commitSha: 'new' }]
const option = (id, type, evidenceIds = ['R0']) => ({ id, type, evidenceIds, label: 'Label', description: 'Proposal', support: 'Evidence', weakness: 'Boundary uncertain' })
const comparison = (type = 'umbrella', refs = ['R0']) => ({ alternatives: [option('A', type, refs), option('B', 'keep_separate')], selectedId: 'A', strongestAlternativeId: 'B', reason: 'Explains behaviors', unresolved: [] })

test('case selection is deterministic and excludes annotated cases from blind selection', () => {
  const graph = { nodes: Array.from({ length: 10 }, (_, i) => ({ id: `N${i}` })) }
  const selected = selectCases(graph, ['N3', 'N4'])
  assert.equal(selected.length, 4)
  assert.deepEqual(selected, selectCases({ nodes: graph.nodes.toReversed() }, ['N3', 'N4']))
  assert.ok(selected.slice(2).every((c) => !['N3', 'N4'].includes(c.nodeId)))
  assert.throws(() => selectCases(graph, ['unknown']), /unknown/)
})

test('comparison preserves the rival, rejects unsupported history and never applies a graph patch', () => {
  assert.equal(validateComparison(comparison(), evidence).applicationStatus, 'proposal-only')
  assert.throws(() => validateComparison(comparison('umbrella', ['made-up']), evidence), /citation/)
  assert.throws(() => validateComparison(comparison('dependency'), evidence), /source/)
  assert.throws(() => validateComparison(comparison('implementation_history', ['S1']), evidence), /two revisions/)
  assert.throws(() => validateComparison(comparison('implementation_history', ['S1', 'S2']), evidence.map((e) => ({ ...e, commitSha: 'same' }))), /two revisions/)
  assert.equal(validateComparison(comparison('implementation_history', ['S1', 'S2']), evidence).selectedId, 'A')
  assert.throws(() => validateComparison({ ...comparison(), strongestAlternativeId: 'A' }, evidence), /rival/)
  assert.throws(() => validateComparison({ ...comparison(), alternatives: [option('A', 'split')] }, evidence), /2–4/)
})

test('all comparison types remain available without expected repository-specific parents', () => {
  const request = comparisonRequest('compare', { focusNodeId: 'N4' }, 'test-model')
  assert.match(request.messages[0].content, /keep_separate\|umbrella\|split\|dependency\|implementation_history\|uncertain/)
  assert.equal(request.messages[1].content, '{"focusNodeId":"N4"}')
})
