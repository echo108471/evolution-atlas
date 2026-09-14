import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDescription, validateDescriptionGate, descriptionRequest, replaceDescription, descriptorLineage } from '../scripts/lib/capability-description.mjs'
import { renderDescription } from '../scripts/render-capability-description.mjs'
const head = 'a'.repeat(40), evidence = [{ id: 'S1', kind: 'source', commitSha: head, text: '<script>bad</script>' }]
const original = { id: 'N1', name: 'Browse', summary: 'Browse items', evidenceIds: ['S1'] }
const proposal = () => ({ nodeId: 'N1', identityDecision: 'preserve', descriptor: { ...original, summary: 'Browse and inspect items' }, reason: 'Same responsibility', evidenceIds: ['S1'], unresolved: [] })
test('description replacement requires unchanged identity, exact fields and grounded citations', () => {
  assert.equal(validateDescription(proposal(), original, evidence, head).descriptor.id, 'N1')
  for (const change of [p => p.descriptor.id = 'N2', p => p.descriptor.evidenceIds = ['unknown'], p => p.descriptor.extra = 'hidden', p => p.descriptor.summary = ' ', p => p.descriptor.name = 'x'.repeat(181)]) {
    const p = proposal(); change(p); assert.throws(() => validateDescription(p, original, evidence, head))
  }
  assert.throws(() => validateDescription(proposal(), original, [{ ...evidence[0], commitSha: 'b'.repeat(40) }], head))
})
test('split and uncertain proposals abstain from replacement', () => {
  for (const identityDecision of ['requires_split', 'uncertain']) {
    assert.throws(() => validateDescription({ ...proposal(), identityDecision }, original, evidence, head))
    assert.equal(validateDescription({ ...proposal(), identityDecision, descriptor: null }, original, evidence, head).descriptor, null)
  }
})
test('identity gate permits rejection and deferral but validates their source claims', () => {
  for (const decision of ['approve', 'defer', 'reject']) assert.equal(validateDescriptionGate({ decision, reason: 'Evidence limits', evidenceIds: ['S1'], unresolved: [] }, evidence, head).decision, decision)
  assert.throws(() => validateDescriptionGate({ decision: 'approve', reason: 'Fine', evidenceIds: [], unresolved: [] }, evidence, head))
})
test('replacement preserves other nodes and all edges without mutating baseline', () => {
  const graph = { nodes: [original, { ...original, id: 'N2' }], edges: [{ from: 'N1', to: 'N2', type: 'contains' }] }, before = structuredClone(graph)
  const candidate = replaceDescription(graph, proposal().descriptor)
  assert.deepEqual(graph, before); assert.deepEqual(candidate.edges, graph.edges); assert.deepEqual(candidate.nodes[1], graph.nodes[1]); assert.notDeepEqual(candidate.nodes[0], graph.nodes[0])
  assert.throws(() => replaceDescription(graph, { ...original, id: 'missing' }))
  assert.equal(descriptorLineage(original, candidate.nodes[0], { evidence }).applicationStatus, 'not-applied')
})
test('proposal and gate prompts do not receive relationship verdicts or proposal rationale', () => {
  const context = { graph: { nodes: [original], edges: [] }, targetNodeId: 'N1', retrievedEvidence: evidence }
  const p = descriptionRequest('propose', context, 'test'), g = descriptionRequest('gate', { ...context, candidateDescriptor: proposal().descriptor }, 'test')
  assert.deepEqual(JSON.parse(p.messages[1].content), context)
  assert.equal(JSON.parse(g.messages[1].content).reason, undefined)
  assert.match(g.messages[0].content, /reject unsupported expansion/)
})
test('report shows descriptor, gate, fixed evidence, abstention and escaped model text', () => {
  const data = { graph: { nodes: [original] }, originalDescriptor: original, proposal: { status: 'valid', value: proposal() }, gate: { status: 'valid', value: { decision: 'defer', reason: '<script>bad</script>' } }, claims: [{ id: 'L1', from: 'N1', to: 'N1' }], reviews: [], manifest: { limitations: 'Small test' }, cost: 0 }
  const html = renderDescription(data, { evidence, searches: [] })
  assert.match(html, /identity gate did not approve/); assert.match(html, /id="S1"/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
  data.originalDescriptor = { ...original, evidenceIds: ['missing'] }
  const missing = renderDescription(data, { evidence, searches: [] })
  assert.match(missing, /missing \(not in fixed packet\)/); assert.doesNotMatch(missing, /href="#missing"/)
})
