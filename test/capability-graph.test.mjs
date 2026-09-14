import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { seedGraph, graphShape, applyGraphProposal, parseResponse, investigationCoverage, validateInvestigationCoverage } from '../scripts/lib/capability-graph.mjs'
import { safeEvidencePath, sourceReader, retrieveGraphEvidence } from '../scripts/lib/capability-graph-evidence.mjs'

const evidence = [{ id: 'R0', kind: 'reading', text: 'a change' }, { id: 'S0', kind: 'source', text: 'implementation' }]
const node = (id) => ({ id, name: id, summary: 'behavior', evidenceIds: ['R0'], reason: 'supported behavior', supersedes: [] })
const edge = (id, from, to, type = 'contains') => ({ id, from, to, type, reason: 'supported relation', evidenceIds: ['S0'] })
const patch = (extra = {}) => ({ upsertNodes: [], upsertEdges: [], removeNodeIds: [], removeEdgeIds: [],
  reviewedNodeIds: [], unresolved: [], continue: true, reason: 'investigate', ...extra })

test('full run requires coverage of added nodes and two whole-map rounds', () => {
  const graph = { nodes: [node('A'), node('B')], edges: [] }
  const history = [{ investigationMode: 'coverage', result: { reviewedNodeIds: ['A'] } }]
  assert.deepEqual(investigationCoverage(graph, history).pending, ['B'])
  assert.throws(() => validateInvestigationCoverage({ reviewedNodeIds: ['A'] }, ['B']), /required nodes/)
  history.push({ investigationMode: 'coverage', result: { reviewedNodeIds: ['B'] } })
  assert.equal(investigationCoverage(graph, history).complete, false)
  history.push(...[1, 2].map(() => ({ investigationMode: 'reconcile', result: { reviewedNodeIds: ['A', 'B'] } })))
  assert.equal(investigationCoverage(graph, history).complete, true)
  graph.nodes.push(node('P'))
  assert.equal(investigationCoverage(graph, history).complete, false)
})

test('seed retains leaves but removes parent labels and positional parent IDs', () => {
  const seed = seedGraph({ headSha: 'head', commits: { sha: { reading: 'source reading' } },
    capabilities: [{ id: 'old:1', name: 'Forbidden parent', children: [
      { id: 'old:1.0', name: 'Leaf', directEvidence: ['sha'] },
    ] }] })
  assert.equal(seed.graph.nodes[0].id, 'N0')
  assert.equal(seed.graph.nodes[0].name, 'Leaf')
  assert.equal(JSON.stringify(seed.graph).includes('Forbidden parent'), false)
  assert.equal(JSON.stringify(seed.graph).includes('old:'), false)
  assert.equal(seed.lineage.N0, 'old:1.0')
})

test('repeated rounds grow past two levels with uneven branches and shared children', () => {
  let graph = { nodes: [node('A'), node('B')], edges: [] }
  for (let round = 1; round <= 4; round++) {
    graph = applyGraphProposal(graph, patch({ upsertNodes: [node(`P${round}`)],
      upsertEdges: [edge(`E${round}`, `P${round}`, round === 1 ? 'A' : `P${round - 1}`)] }), evidence, round).graph
  }
  graph = applyGraphProposal(graph, patch({ upsertEdges: [edge('shared', 'B', 'A'), edge('dependency', 'A', 'B', 'depends_on')] }), evidence, 5).graph
  assert.equal(graphShape(graph).maxDepth, 5)
  assert.equal(graphShape(graph).multipleParents, 1)
  assert.equal(graphShape(graph).dependencies, 1)
})

test('split, merge, rename, and reparent retain history without mutating the prior snapshot', () => {
  const original = { nodes: [node('A'), node('P')], edges: [edge('E', 'P', 'A')] }
  const snapshot = JSON.stringify(original)
  const result = applyGraphProposal(original, patch({ removeNodeIds: ['A'], removeEdgeIds: ['E'],
    upsertNodes: [{ ...node('B'), supersedes: ['A'] }, { ...node('C'), supersedes: ['A'] }],
    upsertEdges: [edge('EB', 'P', 'B'), edge('EC', 'P', 'C')], reviewedNodeIds: ['A'] }), evidence, 1)
  assert.equal(JSON.stringify(original), snapshot)
  assert.deepEqual(result.graph.nodes.find((n) => n.id === 'B').supersedes, ['A'])
  const merged = applyGraphProposal(result.graph, patch({ removeNodeIds: ['B', 'C'], removeEdgeIds: ['EB', 'EC'],
    upsertNodes: [{ ...node('D'), supersedes: ['B', 'C'] }, { ...node('P'), name: 'Renamed' }],
    upsertEdges: [edge('DP', 'D', 'P')], reviewedNodeIds: ['B', 'C', 'P'] }), evidence, 2)
  assert.equal(merged.graph.nodes.find((n) => n.id === 'P').name, 'Renamed')
  assert.equal(merged.shape.maxDepth, 2)
})

test('reject cycles, dangling edges, unfetched citations, and unsupported dependency evidence atomically', () => {
  const graph = { nodes: [node('A'), node('B')], edges: [edge('AB', 'A', 'B')] }
  const before = JSON.stringify(graph)
  assert.throws(() => applyGraphProposal(graph, patch({ upsertEdges: [edge('BA', 'B', 'A')] }), evidence, 1), /cycle/)
  assert.throws(() => applyGraphProposal(graph, patch({ removeNodeIds: ['B'], removalEvidence: [{nodeId: 'B', evidenceIds: ['R0'], reason: 'unsupported'}] }), evidence, 1), /dangling/)
  assert.throws(() => applyGraphProposal(graph, patch({ upsertNodes: [{ ...node('C'), evidenceIds: ['unknown'] }] }), evidence, 1), /citation/)
  assert.throws(() => applyGraphProposal(graph, patch({ upsertEdges: [{ ...edge('D', 'A', 'B', 'depends_on'), evidenceIds: ['R0'] }] }), evidence, 1), /source/)
  assert.throws(() => applyGraphProposal(graph, patch({ upsertNodes: [node('A')] }), evidence, 1), /not reviewed/)
  assert.equal(JSON.stringify(graph), before)
})

test('later revisions preserve split lineage without retiring the predecessor twice', () => {
  const first = applyGraphProposal({ nodes: [node('A')], edges: [] }, patch({
    removeNodeIds: ['A'], upsertNodes: [{ ...node('B'), supersedes: ['A'] }], reviewedNodeIds: ['A'],
  }), evidence, 1).graph
  for (const supersedes of [[], ['A']]) {
    const next = applyGraphProposal(first, patch({ upsertNodes: [{ ...node('B'), supersedes }], reviewedNodeIds: ['B'] }), evidence, 2)
    assert.deepEqual(next.graph.nodes[0].supersedes, ['A'])
  }
  assert.throws(() => applyGraphProposal(first, patch({ removeNodeIds: ['B'], reviewedNodeIds: ['B'] }), evidence, 2), /removalEvidence/)
})

test('incomplete provider responses cannot be parsed as complete investigations', () => {
  assert.throws(() => parseResponse({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /incomplete/)
})

test('budgeted retrieval reports omitted evidence and exposes searchable readings outside seed membership', () => {
  const readings = [{ id: 'R0', text: 'catalog search' }, { id: 'R1', text: 'automation workflow' }]
  const source = { paths: ['ci/workflow.yml'], read: () => ({ id: 'S1', kind: 'source', text: 'code' }) }
  const result = retrieveGraphEvidence({ readingIds: ['R0', 'bad'], searches: ['automation'], sources: [{ path: 'ci/workflow.yml' }] }, readings, source, { maxReadings: 1, maxSources: 1, maxBytes: 2000 })
  assert.equal(result.searchResults[0].readingIds[0], 'R1')
  assert.equal(result.readingCount, 1)
  assert.equal(result.sourceCount, 1)
  assert.ok(result.bytes <= 2000)
  assert.ok(result.omitted.some((item) => item.id === 'R1'))
  assert.ok(result.omitted.some((item) => item.id === 'bad'))
})

test('source retrieval uses pinned historical blobs, denies sensitive paths and enforces line/byte limits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'atlas-graph-test-'))
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('init'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'source.js'), 'old behavior\nsecond line\n')
    writeFileSync(join(repo, 'legacy.js'), 'historical implementation\n')
    git('add', 'source.js', 'legacy.js'); git('commit', '-m', 'initial')
    const old = git('rev-parse', 'HEAD')
    writeFileSync(join(repo, 'source.js'), 'new behavior\nsecond line\n')
    git('rm', 'legacy.js')
    git('add', 'source.js'); git('commit', '-m', 'change')
    const head = git('rev-parse', 'HEAD')
    writeFileSync(join(repo, 'source.js'), 'uncommitted behavior')
    const reader = sourceReader(repo, head, [{ id: 'R0', commitSha: old }])
    assert.equal(reader.read({ path: 'source.js', revision: 'R0', startLine: 1 }, 15).text, 'old behavior')
    assert.equal(reader.read({ path: 'source.js', revision: 'head', startLine: 1 }, 15).text, 'new behavior')
    assert.throws(() => reader.catalog('head^'), /outside/)
    const historicalReader = sourceReader(repo, head, [{ id: 'R0', commitSha: old }], { allowParents: true })
    assert.equal(historicalReader.catalog('head^').commitSha, old)
    assert.deepEqual(historicalReader.changedPaths('head'), ['legacy.js', 'source.js'])
    assert.ok(historicalReader.catalog('head^').paths.includes('legacy.js'))
    assert.ok(!historicalReader.paths.includes('legacy.js'))
    assert.equal(historicalReader.read({ path: 'legacy.js', revision: 'head^' }).text.trim(), 'historical implementation')
    assert.equal(historicalReader.read({ path: 'source.js', revision: 'head^' }, 15).text, 'old behavior')
    assert.throws(() => historicalReader.catalog('head^^'), /parent must/)
    assert.throws(() => reader.read({ path: '.env', revision: 'head' }), /denied/)
    assert.throws(() => reader.read({ path: 'source.js', revision: 'HEAD' }), /outside/)
    assert.throws(() => reader.read({ path: 'source.js', revision: 'head', startLine: -1 }), /startLine/)
    for (const path of ['../source.js', '/tmp/file', '.env.local', 'a/private.key', 'x.pem', 'a/.git/config']) assert.equal(safeEvidencePath(path), false)
    for (const path of ['db/migration.sql', '.github/workflows/ci.yml', 'docs/setup.md']) assert.equal(safeEvidencePath(path), true)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})
