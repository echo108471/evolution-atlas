import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStructureComparison, retrieveContrastEvidence, validateAudit } from '../scripts/lib/capability-structures.mjs'
const graph = { nodes: [{ id: 'N0', name: 'Browse' }, { id: 'N1', name: 'Reviews' }], edges: [] }
const evidence = [{ id: 'S0', kind: 'source', commitSha: 'old' }, { id: 'S1', kind: 'source', commitSha: 'new' }]
const structure = () => ({ newNodes: [], contains: [], removeNodeIds: [], removeEdgeIds: [] })
const alt = (id, type, s = structure()) => ({ id, type, structure: s, evidenceIds: ['S0'], label: 'Label', description: 'Description', support: 'Support', weakness: 'Weakness' })
const proposal = () => ({ alternatives: [alt('A', 'keep_separate'), alt('B', 'umbrella', { ...structure(), contains: [{ from: 'N0', to: 'N1' }] })], selectedId: 'B', strongestAlternativeId: 'A', reason: 'Outcome', links: [], unresolved: [] })

test('umbrella preserves child identity and permits dependency at the same time', () => {
  const p = proposal(), original = JSON.stringify(graph)
  p.links.push({ type: 'depends_on', from: 'N1', to: 'N0', reason: 'Consumes', evidenceIds: ['S0'] })
  const result = validateStructureComparison(p, evidence, graph)
  assert.equal(result.alternatives[1].candidateGraph.nodes.length, 2)
  assert.equal(result.alternatives[1].candidateGraph.edges[0].type, 'contains')
  assert.equal(result.links.length, 1)
  assert.equal(JSON.stringify(graph), original)
  p.alternatives[1].structure.removeNodeIds = ['N1']
  assert.throws(() => validateStructureComparison(p, evidence, graph), /retain/)
})

test('structural validator rejects cycles, dangling edges and hidden merges', () => {
  let p = proposal()
  p.alternatives[1].structure.contains.push({ from: 'N1', to: 'N0' })
  assert.throws(() => validateStructureComparison(p, evidence, graph), /cycle/)
  p = proposal(); p.alternatives[1].structure.contains[0].to = 'unknown'
  assert.throws(() => validateStructureComparison(p, evidence, graph), /dangling/)
  p = proposal(); p.alternatives[1].type = 'merge'
  assert.throws(() => validateStructureComparison(p, evidence, graph), /retired/)
  p = proposal(); p.alternatives[1].type = 'depends_on'
  assert.throws(() => validateStructureComparison(p, evidence, graph), /not structural/)
})

test('implementation existence is source-pinned and cannot claim a replacement era', () => {
  const p = proposal()
  p.links = [{ type: 'implemented_by', from: 'N0', to: 'Older backend', temporalClaim: 'observed_at', revisionShas: ['old'], evidenceIds: ['S0'], reason: 'Present in this revision' }]
  assert.equal(validateStructureComparison(p, evidence, graph).links.length, 1)
  p.links[0].revisionShas = ['made-up']
  assert.throws(() => validateStructureComparison(p, evidence, graph), /source support/)
  p.links[0].revisionShas = ['old']; p.links[0].temporalClaim = 'replaced_by'
  assert.throws(() => validateStructureComparison(p, evidence, graph), /replacement/)
})

test('retrieval protects historical and current source capacity despite ranked overflow', () => {
  const source = { paths: [], read: (r) => ({ id: r.path, kind: 'source', commitSha: r.revision, text: 'x'.repeat(1700) }) }
  const requests = [...Array.from({ length: 8 }, (_, i) => ({ path: `C${i}`, revision: 'head' })),
    ...Array.from({ length: 3 }, (_, i) => ({ path: `H${i}`, revision: 'R0' }))]
  const result = retrieveContrastEvidence({ sources: requests }, [{ id: 'R0', kind: 'reading', text: 'history' }], source)
  assert.equal(result.sourceCount, 6)
  assert.ok(result.receipts.filter((r) => r.period === 'historical').length >= 2)
  assert.ok(result.receipts.filter((r) => r.period === 'current').length >= 2)
  assert.ok(result.bytes <= 24000)
  assert.ok(result.omitted.length > 0)
  const missing = retrieveContrastEvidence({ sources: [] }, [], source)
  assert.equal(missing.gaps.length, 2)
})

test('model audit remains separate and must cite retrieved evidence', () => {
  assert.throws(() => validateAudit({ verdict: 'supported', summary: 'Fine', issues: [], evidenceIds: ['unknown'] }, evidence), /cite/)
  assert.equal(validateAudit({ verdict: 'partial', summary: 'Broadly coherent', issues: ['Missing current source'], evidenceIds: ['S0'] }, evidence).evaluator, 'model-not-ground-truth')
})

test('HEAD alias normalizes to the pinned head token only in the corrected protocol', () => {
  const source = { paths: [], read: (r) => {
    if (r.revision !== 'head') throw new Error('revision outside registry')
    return { id: 'S0', kind: 'source', commitSha: 'pinned', text: 'current source' }
  } }
  const plan = { sources: [{ revision: 'HEAD', path: 'source.js' }] }
  assert.equal(retrieveContrastEvidence(plan, [], source).sourceCount, 0)
  const fixed = retrieveContrastEvidence(plan, [], source, [], { normalizeHead: true })
  assert.equal(fixed.sourceCount, 1)
  assert.equal(fixed.receipts[0].period, 'current')
  assert.equal(fixed.evidence[0].commitSha, 'pinned')
  assert.equal(plan.sources[0].revision, 'HEAD')
})
