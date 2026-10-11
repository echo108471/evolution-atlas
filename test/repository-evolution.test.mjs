import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import * as v1 from '../scripts/versions/repository-engine-v1/repository-engine.mjs'
import {
  bindEngineLaunch, checkpointEngine, engineBroker, freezeIntegration, inspectEngine,
  prepareEngine, publishEngine, recordEngineTerminal, reserveEngineLaunch,
} from '../scripts/repository-engine-v3.mjs'
import { reconciledIssuesV3 } from '../scripts/lib/repository-engine-v3-contract.mjs'
import { priorMapPage } from '../scripts/lib/prior-map-catalog.mjs'

const json = value => JSON.stringify(value, null, 2) + '\n'
const save = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, json(value))
}
const node = (id, evidence, name = `Capability ${id}`) => ({
  id, name, summary: `Observed responsibility ${id}`, actor: 'Synthetic caller',
  inputs: ['request'], outcomes: ['result'], conditions: [], exclusions: [], implementations: [],
  uncertainty: [], evidenceIds: [evidence], assessment: 'partial',
  claims: [{ text: `Claim for ${id}`, evidenceIds: [evidence], assessment: 'partial' }],
})

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'repository-evolution-test-'))
  const repo = resolve(root, 'source')
  mkdirSync(repo)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync('git', ['init', '-q', repo], { env })
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Synthetic'])
  git(['config', 'user.email', 'synthetic@example.invalid'])
  const write = (path, text) => { mkdirSync(dirname(resolve(repo, path)), { recursive: true }); writeFileSync(resolve(repo, path), text) }
  write('src/changed.ts', 'c\n')
  write('src/unchanged.ts', 'u\n')
  write('src/deleted.ts', 'd\n')
  write('src/oversize.ts', 'more than twelve bytes\n')
  git(['add', '--all']); git(['commit', '-qm', 'baseline'])
  const baselineSha = git(['rev-parse', 'HEAD'])
  write('src/changed.ts', 'C\n')
  rmSync(resolve(repo, 'src/deleted.ts'))
  write('src/added.ts', 'a\n')
  git(['add', '--all']); git(['commit', '-qm', 'current'])
  const currentSha = git(['rev-parse', 'HEAD'])
  return { root, repo, git, write, baselineSha, currentSha }
}

function createV1Map(f, directory, { revision, maxFileBytes, paths, names = [] }) {
  const config = { mode: 'discovery', repo: f.repo, revision, displayName: 'Synthetic map', partitionCount: 1, maxFileBytes }
  v1.prepareEngine(directory, config)
  v1.recordEngineLaunch(directory, 'A', `legacy-A-${directory}`)
  const receipts = paths.map(path => v1.engineBroker(directory, 'A', 'read', [path]))
  if (revision === f.baselineSha && maxFileBytes === 12) v1.engineBroker(directory, 'A', 'search', ['src/', 'u'])
  v1.recordEngineTerminal(directory, 'A', `legacy-A-${directory}`, 'completed')
  const nodes = receipts.map((receipt, index) => node(`A${index + 1}`, receipt.id, names[index]))
  const proposal = { agent: 'A', scopeSummary: 'Synthetic fixture coverage', coverage: { inspected: receipts.map(receipt => receipt.path), omissions: [] },
    crossPartitionLeads: [], nodes, edges: [], limitations: ['Synthetic fixture; no model inference.'] }
  save(resolve(directory, 'proposals/A.json'), proposal)
  v1.checkpointEngine(directory, 'A')
  v1.freezeIntegration(directory)
  v1.recordEngineLaunch(directory, 'R', `legacy-R-${directory}`)
  const graph = { nodes, edges: [], lineage: nodes.map(value => ({ originalId: value.id, decision: 'retain', successorIds: [value.id], reason: 'Exact synthetic carry-forward' })),
    edgeLineage: [], decisions: [], limitations: ['Synthetic fixture; no model inference.'], comparisons: [] }
  save(resolve(directory, 'reconciled.json'), graph)
  v1.recordEngineTerminal(directory, 'R', `legacy-R-${directory}`, 'completed')
  v1.checkpointEngine(directory, 'R')
  v1.publishEngine(directory)
  return resolve(directory, 'output.json')
}

function launch(directory, assignment) {
  const reservation = reserveEngineLaunch(directory, assignment)
  bindEngineLaunch(directory, assignment, reservation.reservationId, `fixture-${assignment}`)
  return `fixture-${assignment}`
}

function finish(directory, assignment, handle) {
  recordEngineTerminal(directory, assignment, handle, 'completed')
  checkpointEngine(directory, assignment)
}

test('v3 links two revisions, withholds exact old blobs, brokers candidate context, and replays frozen lineage', t => {
  const f = fixture(t), baselineRun = resolve(f.root, 'baseline-run')
  const baselineOutput = createV1Map(f, baselineRun, { revision: f.baselineSha, maxFileBytes: 12, paths: ['src/unchanged.ts'] })
  const sameHeadMapDirectory = resolve(f.root, 'other-map')
  createV1Map(f, sameHeadMapDirectory, { revision: f.currentSha, maxFileBytes: 1_048_576, paths: ['src/changed.ts', 'src/unchanged.ts'], names: ['Changed', 'Stable'] })
  const readingPath = resolve(f.root, 'commit-readings.json')
  save(readingPath, {
    repository: 'Synthetic map', headSha: f.currentSha, method: 'synthetic/analyze-commits-compatible', unit: 'first-parent',
    coverage: { analyzed: 1, unitCount: 2, ofUnit: 0.5, ofHistory: 0.5 },
    readings: [{ commitSha: f.currentSha, subject: 'current', tier1: {
      tier: 1, summary: 'Candidate interpretation', capability: 'candidate capability', kind: 'introduce',
      significance: 0.7, confidence: 0.6, interpretationStatus: 'candidate', model: 'fixture-model',
      diffLines: 2, diffTruncated: false, diffWithheldFiles: 2, diffPartial: true,
      reviewStatus: 'accepted', owner: 'should not escape',
    }, tier2: null }],
  })
  const out = resolve(f.root, 'expansion')
  const state = prepareEngine(out, { mode: 'expansion', repo: f.repo, revision: f.currentSha, displayName: 'Synthetic expansion',
    partitionCount: 1, maxFileBytes: 1_048_576, baseline: baselineOutput, priorMaps: [sameHeadMapDirectory], commitReadings: [readingPath] })
  assert.equal(state.transition.relation, 'ancestor')
  assert.deepEqual(state.transition.changed.map(entry => entry.path), ['src/changed.ts'])
  assert.deepEqual(state.transition.unchanged.map(entry => entry.path), ['src/unchanged.ts'])
  assert.deepEqual(state.transition.deleted.map(entry => entry.path), ['src/deleted.ts'])
  assert.deepEqual(state.transition.added.map(entry => entry.path), ['src/added.ts'])
  assert.ok(!state.transition.added.some(entry => entry.path === 'src/oversize.ts'))
  assert.ok(state.transition.omissions.some(entry => entry.reason === 'not-comparable-to-baseline:oversize' && entry.samplePaths.includes('src/oversize.ts')))
  assert.deepEqual(state.inventory.files.map(file => file.path), ['src/added.ts', 'src/changed.ts', 'src/oversize.ts'])
  assert.ok(state.omissions.some(item => item.includes('navigation search receipt')))
  assert.equal(state.baseline.receipts.some(receipt => receipt.kind === 'search'), false)
  const pinnedBaseline = readFileSync(resolve(out, 'history/baseline-output.json'))
  assert.ok(JSON.parse(pinnedBaseline).receipts.some(receipt => receipt.kind === 'search'), 'raw baseline receipt bytes stay preserved')

  const aHandle = launch(out, 'A')
  const changed = engineBroker(out, 'A', 'read', ['src/changed.ts'])
  const discovery = { agent: 'A', scopeSummary: 'Inspected changed source', coverage: { inspected: [changed.path], omissions: [] },
    crossPartitionLeads: [], nodes: [node('A1', changed.id, 'New capability')], edges: [], limitations: ['Synthetic fixture.'] }
  save(resolve(out, 'proposals/A.json'), discovery)
  finish(out, 'A', aHandle)
  freezeIntegration(out)

  const rHandle = launch(out, 'R')
  const currentStable = engineBroker(out, 'R', 'read', ['src/unchanged.ts'])
  const addedDiff = engineBroker(out, 'R', 'diff', [f.currentSha, 'src/added.ts'])
  const catalog = engineBroker(out, 'R', 'prior-map', ['catalog'])
  assert.equal(catalog.directSourceProof, false)
  const priorPage = engineBroker(out, 'R', 'prior-map', ['M1', '0', '1'])
  assert.equal(priorPage.directSourceProof, false)
  assert.equal(priorPage.edgeCoverage, 'edges touching a returned node; cross-page endpoint node text may require another page')
  assert.equal(priorPage.totalEdges, 0)
  const reading = engineBroker(out, 'R', 'reading', ['C1', f.currentSha, '1'])
  assert.equal(reading.directSourceProof, false)
  assert.equal(reading.artifactProvenance.method, 'synthetic/analyze-commits-compatible')
  assert.equal(reading.artifactProvenance.unit, 'first-parent')
  assert.deepEqual(reading.readings.map(value => value.model), ['fixture-model'])
  assert.equal(reading.readings[0].diffWithheldFiles, 2)
  assert.equal(reading.readings[0].diffPartial, true)
  assert.equal(Object.hasOwn(reading.readings[0], 'reviewStatus'), false)
  assert.equal(Object.hasOwn(reading.readings[0], 'owner'), false)

  const baselineNode = state.baseline.graph.nodes[0]
  const currentNode = discovery.nodes[0]
  const graph = {
    nodes: [baselineNode, currentNode], edges: [],
    lineage: [
      { originalId: baselineNode.id, decision: 'retain', successorIds: [baselineNode.id], reason: 'The candidate is carried forward unchanged.' },
      { originalId: currentNode.id, decision: 'retain', successorIds: [currentNode.id], reason: 'The current discovery node is retained.' },
    ], edgeLineage: [], decisions: [], limitations: ['Synthetic fixture; candidate lineage only.'],
    comparisons: [{ newNodeId: currentNode.id, existingNodeIds: [baselineNode.id], relation: 'distinct', reason: 'Separate source evidence supports a distinct capability.',
      disposition: 'Keep separately', evidenceIds: [currentNode.evidenceIds[0]], uncertainty: [] }],
    historyLineage: [
      { id: 'h-retain-1', from: { commitSha: f.baselineSha, nodeId: baselineNode.id },
        to: [{ commitSha: f.currentSha, nodeId: baselineNode.id }], decision: 'retain', claim: 'The earlier capability remains present.',
        reason: 'The same source-backed behavior is visible at both revisions.', evidenceIds: [baselineNode.evidenceIds[0], currentStable.id], assessment: 'partial' },
      { id: 'h-introduce-1', from: null, to: [{ commitSha: f.currentSha, nodeId: currentNode.id }], decision: 'introduce',
        claim: 'The current map includes a newly observed capability.', reason: 'The post-baseline addition diff supports this candidate introduction.',
        evidenceIds: [addedDiff.id], assessment: 'partial' },
    ], historyEdgeLineage: [],
  }
  save(resolve(out, 'reconciled.json'), graph)
  finish(out, 'R', rHandle)
  const published = publishEngine(out)
  const bytes = readFileSync(resolve(out, 'output.json'))
  const html = readFileSync(resolve(out, 'index.html'))
  const output = JSON.parse(bytes)
  assert.equal(published.status, 'candidate-map-produced')
  assert.equal(output.history.transition.fromCommitSha, f.baselineSha)
  assert.equal(output.history.transition.toCommitSha, f.currentSha)
  assert.equal(output.history.lineage.length, 2)
  assert.equal(output.history.lineage[1].decision, 'introduce')
  assert.ok(output.receipts.some(receipt => receipt.id === addedDiff.id && receipt.kind === 'diff'))
  assert.ok(output.receipts.some(receipt => receipt.id === reading.id && receipt.kind === 'commit-reading'))
  assert.equal(output.history.commitReadings[0].directSourceProof, false)
  assert.equal(output.history.commitReadings[0].artifactProvenance.method, 'synthetic/analyze-commits-compatible')
  assert.equal(output.history.priorMaps[0].accessedNodeCount, 1)
  assert.ok(!JSON.stringify(output).includes('should not escape'))
  assert.match(html.toString('utf8'), /History across revisions/)
  assert.deepEqual(publishEngine(out), published)
  assert.deepEqual(readFileSync(resolve(out, 'output.json')), bytes)
  assert.deepEqual(readFileSync(resolve(out, 'index.html')), html)
  assert.equal(inspectEngine(out).status, 'candidate-map-produced')
  writeFileSync(resolve(out, 'history/baseline-output.json'), Buffer.concat([pinnedBaseline, Buffer.from(' ')]))
  assert.throws(() => inspectEngine(out), /Baseline history bytes changed/)
})

test('history claims require source or relevant diff receipts and account for both revision graphs', () => {
  const baseline = { nodes: [node('old:A1', 'old:s1')], edges: [] }
  const current = node('A1', 's2')
  const graph = { nodes: [current], edges: [], lineage: [{ originalId: 'old:A1', decision: 'revise', successorIds: ['A1'], reason: 'Revised.' }],
    edgeLineage: [], decisions: [], limitations: [], comparisons: [], historyLineage: [
      { id: 'h1', from: { commitSha: 'a'.repeat(40), nodeId: 'old:A1' }, to: [{ commitSha: 'b'.repeat(40), nodeId: 'A1' }],
        decision: 'revise', claim: 'Changed behavior.', reason: 'Diff required.', evidenceIds: ['meta'], assessment: 'partial' },
    ], historyEdgeLineage: [] }
  const receipts = [{ id: 'meta', kind: 'commit-meta', commitSha: 'b'.repeat(40) }]
  // The complete reconciliation harness has more structural requirements; directly assert that metadata is never accepted as history proof.
  const result = reconciledIssuesV3(graph, baseline, [], receipts, true, { baselineCommitSha: 'a'.repeat(40), currentCommitSha: 'b'.repeat(40), transitionDiffReceiptIds: [] })
  assert.ok(result.some(issue => /source or unavailable evidence/.test(issue.message)))
})

test('same-revision expansion requires real empty lineage arrays and accepts no false history claim', () => {
  const baseSha = 'a'.repeat(40), nodeValue = node('A1', 's1')
  const baseline = { nodes: [nodeValue], edges: [] }
  const graph = { nodes: [nodeValue], edges: [], lineage: [{ originalId: 'A1', decision: 'retain', successorIds: ['A1'], reason: 'Same revision.' }],
    edgeLineage: [], decisions: [], limitations: [], comparisons: [], historyLineage: [], historyEdgeLineage: [] }
  const result = reconciledIssuesV3(graph, baseline, [], [{ id: 's1', kind: 'source' }], true, { baselineCommitSha: baseSha, currentCommitSha: baseSha })
  assert.deepEqual(result, [])
  assert.ok(reconciledIssuesV3({ ...graph, historyLineage: 'bad' }, baseline, [], [{ id: 's1', kind: 'source' }], true,
    { baselineCommitSha: baseSha, currentCommitSha: baseSha }).some(issue => issue.target === 'historyLineage'))
  assert.ok(reconciledIssuesV3({ ...graph, historyEdgeLineage: { bad: true } }, baseline, [], [{ id: 's1', kind: 'source' }], true,
    { baselineCommitSha: baseSha, currentCommitSha: baseSha }).some(issue => issue.target === 'historyEdgeLineage'))
})

test('prior-map pages report boundary-edge omissions and candidate-only attribution', () => {
  const map = { id: 'M1', artifactSha256: 'a'.repeat(64), commitSha: 'b'.repeat(40), graph: {
    nodes: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
    edges: [{ from: 'A1', to: 'A2' }, { from: 'A2', to: 'A3' }, { from: 'A1', to: 'A3' }],
  } }
  const page = priorMapPage(map, 1, 1)
  assert.equal(page.totalEdges, 3)
  assert.equal(page.returnedEdges, 2)
  assert.equal(page.omittedEdges, 1)
  assert.equal(page.directSourceProof, false)
})
