import test from 'node:test'
import assert from 'node:assert/strict'
import { boundaryNeighborhood, boundaryRequest, boundaryReviewContext, validateBoundaries, validateBoundaryReview, validateBoundaryAudit } from '../scripts/lib/behavioral-boundaries.mjs'
import { boundaryMetrics, renderBoundaries } from '../scripts/render-behavioral-boundaries.mjs'
const sha = 'a'.repeat(40), evidence = [{ id: 'S1', kind: 'source', commitSha: sha }], fact = () => ({ text: 'Emits a result for input', evidenceIds: ['S1'] })
const nodes = [{ id: 'N0', name: 'One', summary: 'Old' }, { id: 'N1', name: 'Two', summary: 'Old' }], pairs = [{ id: 'N0:N1', a: 'N0', b: 'N1' }]
const definition = (n) => ({ id: n.id, name: n.name, scopeStatus: 'clarified', responsibilities: [fact()], inputsAndTriggers: [], observableResults: [], conditions: [], outsideBoundary: [], implementations: [{ ...fact(), atCommit: sha }], history: [], unknowns: [] })
const decision = () => ({ id: pairs[0].id, relation: 'distinct', sharedBehavior: [], aOnly: [fact()], bOnly: [], reason: 'Different responsibility', evidenceIds: ['S1'], definitionProblems: [], openQuestions: [], revisionTriggers: ['An executable shared responsibility'] })
test('neighborhood expands only one hop then compares every pair, independent of edge order', () => {
  const graph = { nodes: [...nodes, { id: 'N2' }, { id: 'N3' }], edges: [{ from: 'N1', to: 'N2', type: 'contains' }, { from: 'N2', to: 'N3', type: 'contains' }] }
  const a = boundaryNeighborhood(graph, [{ from: 'N0', to: 'N1' }]); assert.equal(a.nodes.length, 3); assert.equal(a.pairs.length, 3)
  assert.deepEqual(a, boundaryNeighborhood({ ...graph, edges: [...graph.edges].reverse() }, [{ from: 'N0', to: 'N1' }]))
})
test('definitions preserve matching identity and validate citations and revision claims', () => {
  const raw = { definitions: nodes.map(definition) }; assert.equal(validateBoundaries(raw, nodes, evidence), raw)
  for (const mutate of [r => r.definitions.pop(), r => r.definitions[0].name = 'Renamed', r => r.definitions[0].responsibilities[0].evidenceIds = ['missing'], r => r.definitions[0].implementations[0].atCommit = 'b'.repeat(40)]) {
    const r = structuredClone(raw); mutate(r); assert.throws(() => validateBoundaries(r, nodes, evidence))
  }
})
test('missing or disputed boundaries can be expressed without invented exclusions', () => {
  const d = definition(nodes[0]); d.scopeStatus = 'insufficient'; d.responsibilities = []; d.unknowns = ['Missing behavior source']
  assert.equal(validateBoundaries({ definitions: [d] }, [nodes[0]], evidence).definitions[0].outsideBoundary.length, 0)
})
test('pair review accepts identity choices separately from graph containment and requires revision criteria', () => {
  for (const relation of ['same', 'overlapping', 'a_broader', 'b_broader', 'distinct']) assert.equal(validateBoundaryReview({ decisions: [{ ...decision(), relation }] }, pairs, evidence).decisions[0].relation, relation)
  assert.throws(() => validateBoundaryReview({ decisions: [{ ...decision(), relation: 'contains' }] }, pairs, evidence))
  assert.throws(() => validateBoundaryReview({ decisions: [{ ...decision(), revisionTriggers: [] }] }, pairs, evidence))
  assert.throws(() => validateBoundaryReview({ decisions: [{ ...decision(), relation: 'unresolved' }] }, pairs, evidence))
})
test('same review prompt and evidence isolate representation; reversed order does not swap endpoints', () => {
  const packet = { evidence, searches: [] }, a = boundaryReviewContext(nodes, pairs, null, packet, sha), b = boundaryReviewContext(nodes, pairs, nodes.map(definition), packet, sha, true)
  assert.deepEqual(a.retrievedEvidence, b.retrievedEvidence); assert.deepEqual(a.pairs, b.pairs); assert.notDeepEqual(a.candidates, b.candidates)
  assert.equal(boundaryRequest('review', a, 'test').messages[0].content, boundaryRequest('review', b, 'test').messages[0].content)
  assert.equal(a.graph, undefined); assert.equal(b.expectedAnswers, undefined)
})
test('masked audits may prefer neither and must ground substantive preferences', () => {
  const a = { comparisons: [{ id: pairs[0].id, betterExplanation: 'neither', reason: 'Both overclaim', evidenceIds: ['S1'], X: { grounding: 'mixed', distinctions: 'uncertain', issues: [] }, Y: { grounding: 'unsupported', distinctions: 'erased', issues: [] } }] }
  assert.equal(validateBoundaryAudit(a, pairs, evidence), a)
  a.comparisons[0].evidenceIds = []; assert.throws(() => validateBoundaryAudit(a, pairs, evidence))
})
test('report distinguishes missing reviews from disagreement and escapes candidate text', () => {
  const data = { nodes, pairs, definitions: { status: 'invalid', error: '<bad>' }, reviews: [{ condition: 'summary', order: 'forward', status: 'valid', value: { decisions: [decision()] } }], audits: [], manifest: {}, cost: 0 }
  assert.equal(boundaryMetrics(data)[0].stablePairs, null)
  const html = renderBoundaries(data, { evidence, searches: [] })
  assert.match(html, /Not measurable/); assert.match(html, /&lt;bad&gt;/); assert.doesNotMatch(html, /<bad>/)
  assert.match(html, /id="S1"/); assert.match(html, /id="pair-N0:N1"/)
  data.audits = [{ mapping: { X: 'summary', Y: 'boundary' }, status: 'provider_error', httpStatus: 403, error: 'Spending limit' }]; data.costComplete = false
  const failed = renderBoundaries(data, { evidence, searches: [] })
  assert.match(failed, /Separate model quality review blocked/); assert.match(failed, /Successful responses only/)
})
