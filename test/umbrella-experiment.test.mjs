import test from 'node:test'
import assert from 'node:assert/strict'
import { umbrellaSeed, umbrellaPacket, umbrellaRequest, validateUmbrella, umbrellaMetrics, pairAgreement } from '../scripts/lib/umbrella-experiment.mjs'

const graph = { nodes: ['N0', 'N1', 'N2'].map((id) => ({ id, name: id, summary: 'Behavior', evidenceIds: ['R0', 'S0'], reason: 'old grouping rationale', round: 8 })),
  edges: [{ id: 'E0', from: 'N0', to: 'N1', type: 'contains', evidenceIds: ['R0'], reason: 'old' }] }
const baseline = { graph, headSha: 'head', readingRegistry: [{ id: 'R0', kind: 'reading', text: 'commit interpretation' }],
  evidence: [{ id: 'S0', kind: 'source', commitSha: 'head', text: 'code' }] }
const packet = umbrellaPacket(baseline)
const patch = { upsertNodes: [{ id: 'U0', name: 'Outcome', summary: 'Shared outcome', reason: 'Both behaviors serve this outcome', evidenceIds: ['S0'], supersedes: [] }],
  upsertEdges: ['N0', 'N2'].map((to, i) => ({ id: `UE${i}`, from: 'U0', to, type: 'contains', reason: 'Serves outcome', evidenceIds: ['S0'] })),
  removeNodeIds: [], removeEdgeIds: [], reviewedNodeIds: ['N0', 'N2'], unresolved: [], continue: true, reason: 'Broader outcome' }
test('containment ablation changes only edges, not labels, packet or prompt', () => {
  const linked = umbrellaSeed(graph, 'linked'), unlinked = umbrellaSeed(graph, 'unlinked')
  assert.deepEqual(linked.nodes, unlinked.nodes)
  assert.equal(linked.nodes[0].reason, undefined)
  assert.equal(unlinked.edges.length, 0)
  const a = umbrellaRequest(linked, packet, 1, 'model'), b = umbrellaRequest(unlinked, packet, 1, 'model')
  assert.equal(a.messages[0].content, b.messages[0].content)
  const ca = JSON.parse(a.messages[1].content), cb = JSON.parse(b.messages[1].content)
  ca.graph.edges = []; assert.deepEqual(ca, cb)
  assert.equal(packet.evidence.length, 2)
  assert.equal(packet.coverage.length, 3)
})
test('new umbrellas preserve old details and can increase depth above existing parents', () => {
  const seed = umbrellaSeed(graph, 'linked'), result = validateUmbrella(patch, seed, seed, packet, 1)
  assert.equal(result.shape.maxDepth, 3)
  const metrics = umbrellaMetrics(result.graph, graph)
  assert.equal(metrics.broaderGroups.length, 1)
  assert.deepEqual(metrics.broaderGroups[0].members, ['N0', 'N1', 'N2'])
  assert.equal(metrics.preservedSeedNodes, 3)
  assert.equal(metrics.retainedOriginalContainment, 1)
  assert.equal(pairAgreement(metrics, metrics).jaccard, 1)
  assert.equal(pairAgreement({ coUmbrellaPairs: [] }, { coUmbrellaPairs: [] }).jaccard, null)
})
test('reject seed rewriting, unsupported citations, trivial new leaves, cycles and placeholder reasons', () => {
  const seed = umbrellaSeed(graph, 'linked')
  assert.throws(() => validateUmbrella({ ...patch, removeNodeIds: ['N0'] }, seed, seed, packet, 1), /seed details/)
  assert.throws(() => validateUmbrella({ ...patch, upsertNodes: [{ ...patch.upsertNodes[0], id: 'N0' }] }, seed, seed, packet, 1), /preserve seed/)
  assert.throws(() => validateUmbrella({ ...patch, upsertNodes: [{ ...patch.upsertNodes[0], evidenceIds: ['bad'] }] }, seed, seed, packet, 1), /citation/)
  assert.throws(() => validateUmbrella({ ...patch, upsertEdges: [] }, seed, seed, packet, 1), /two seed descendants/)
  assert.throws(() => validateUmbrella({ ...patch, upsertEdges: [...patch.upsertEdges, { ...patch.upsertEdges[0], id: 'UE9', from: 'N1', to: 'U0' }] }, seed, seed, packet, 1), /cycle/)
  assert.throws(() => validateUmbrella({ ...patch, upsertNodes: [{ ...patch.upsertNodes[0], reason: '...' }] }, seed, seed, packet, 1), /placeholder/)
})
test('dependency preservation is independent of containment ablation', () => {
  const input = { ...graph, edges: [...graph.edges, { id: 'D0', from: 'N1', to: 'N2', type: 'depends_on', evidenceIds: ['S0'] }] }
  const seed = umbrellaSeed(input, 'unlinked')
  assert.equal(seed.edges[0].id, 'D0')
  assert.throws(() => validateUmbrella({ ...patch, removeEdgeIds: ['D0'] }, seed, seed, packet, 1), /seed dependency/)
})
test('scope scoring includes an existing root reused as an umbrella, without changing frozen v1 scoring', () => {
  const reused = { ...graph, edges: [...graph.edges, { id: 'E1', from: 'N0', to: 'N2', type: 'contains' }] }
  assert.equal(umbrellaMetrics(reused, graph).broaderGroups.length, 0)
  const corrected = umbrellaMetrics(reused, graph, { includeParent: true })
  assert.equal(corrected.broaderGroups.length, 1)
  assert.deepEqual(corrected.broaderGroups[0].members, ['N0', 'N1', 'N2'])
})
