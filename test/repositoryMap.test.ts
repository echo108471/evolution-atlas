import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  historyConsultations,
  integrationAccounting,
  parseCandidateMapArtifact,
  parseCandidateMapText,
  receiptGitLocation,
  receiptProvenance,
  resolveLocalMapUrl,
} from '../src/repositoryMap'

function fixture() {
  const graph = {
    nodes: [{
      id: 'cap:catalog',
      name: 'Catalog lookup',
      summary: 'Finds a record by its stable key.',
      actor: 'A caller with a key',
      inputs: ['Stable key'],
      outcomes: ['A matching record or an empty result'],
      conditions: ['The record is present'],
      exclusions: ['Does not validate the caller'],
      implementations: ['src/catalog.ts'],
      evidenceIds: ['S1'],
      assessment: 'partial',
      uncertainty: ['The excerpt does not show runtime handling.'],
      claims: [{ text: 'Returns a record when a key matches.', evidenceIds: ['S1'], assessment: 'partial' }],
    }],
    edges: [],
  }
  return {
    displayName: 'Synthetic map',
    commitSha: 'a'.repeat(40),
    mode: 'candidate',
    independentVerification: 'not-performed',
    graph,
    receipts: [{ id: 'S1', kind: 'source', path: 'src/catalog.ts', startLine: 3, endLine: 8, text: 'export function lookup(key) { return records.get(key) }' }],
    coverage: { files: 1, eligibleFiles: 5, omissions: ['Four eligible files were not inspected.'] },
  }
}

function reviewNote(overrides: Partial<{
  nodeId: string
  field: string
  expectedText: string
  status: string
  basis: string
  message: string
  evidenceIds: string[]
}> = {}) {
  return {
    nodeId: 'cap:catalog',
    field: 'summary',
    expectedText: 'Finds a record by its stable key.',
    status: 'qualified',
    basis: 'source-review',
    message: 'The wording should say lookup rather than validation.',
    evidenceIds: ['S1'],
    ...overrides,
  }
}

function attachNotes(output: ReturnType<typeof fixture>, notes = [reviewNote()]) {
  return {
    ...output,
    reviewNotes: {
      graphSha256: createHash('sha256').update(JSON.stringify(output.graph)).digest('hex'),
      notes,
    },
  }
}

function attachReviewHistory(output: ReturnType<typeof fixture>) {
  const entries = [{
    sourceCommitSha: 'b'.repeat(40),
    sourceNodeId: 'cap:catalog',
    note: reviewNote(),
    projections: [{
      nodeId: 'cap:catalog',
      correspondence: 'single-successor',
      contentStatus: 'unchanged',
      currentText: 'Finds a record by its stable key.',
      incidentRelationships: 'unchanged',
    }],
    disposition: 'historical-review-linked',
  }]
  return {
    ...output,
    reviewHistory: {
      schemaVersion: 'repository-review-history/1',
      status: 'historical-only',
      sourceGraphSha256: 'c'.repeat(64),
      targetGraphSha256: createHash('sha256').update(JSON.stringify(output.graph)).digest('hex'),
      sourceCommitSha: 'b'.repeat(40),
      targetCommitSha: output.commitSha,
      currentMapReviewed: false,
      inheritedApprovals: [],
      entries,
      entriesSha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
      limitation: 'Earlier notes remain historical and do not approve the current map.',
    },
  }
}

test('parses output and reviewed-output artifacts into a safe candidate model', async () => {
  const output = await parseCandidateMapArtifact(fixture())
  assert.equal(output.displayName, 'Synthetic map')
  assert.equal(output.graph.nodes[0].id, 'cap:catalog')
  assert.equal(output.graph.nodes[0].claims[0].text, 'Returns a record when a key matches.')
  assert.equal(output.historyReceipts.length, 0)

  const reviewed = await parseCandidateMapArtifact(attachNotes(fixture()))
  assert.equal((reviewed.reviewNotes as { notes: unknown[] }).notes.length, 1)
})

test('rejects absent and structurally malformed map inputs with actionable errors', async () => {
  await assert.rejects(parseCandidateMapText(''), /file is empty/i)
  await assert.rejects(parseCandidateMapText('{'), /not valid JSON/i)
  await assert.rejects(parseCandidateMapArtifact(null), /JSON object/i)
  await assert.rejects(parseCandidateMapArtifact({}), /Candidate graph is missing/i)

  const missingEdges = fixture() as unknown as { graph: unknown }
  missingEdges.graph = { nodes: [], edges: null }
  await assert.rejects(parseCandidateMapArtifact(missingEdges), /nodes and edges lists/i)

  const duplicateNodes = fixture()
  duplicateNodes.graph.nodes.push({ ...duplicateNodes.graph.nodes[0] })
  await assert.rejects(parseCandidateMapArtifact(duplicateNodes), /repeats capability ID/i)

  const dangling = fixture()
  dangling.graph.edges.push({ from: 'cap:catalog', to: 'missing', type: 'supports', reason: 'Synthetic link' })
  await assert.rejects(parseCandidateMapArtifact(dangling), /missing capability/i)

  const invalidList = fixture()
  invalidList.graph.nodes[0].outcomes = [null] as unknown as string[]
  await assert.rejects(parseCandidateMapArtifact(invalidList), /outcomes must be a list of text values/i)
})

test('review notes must match the graph, exact target text, and known source receipts', async () => {
  const output = fixture()
  const notes = attachNotes(output)
  assert.equal((await parseCandidateMapArtifact(notes)).displayName, 'Synthetic map')

  await assert.rejects(parseCandidateMapArtifact({
    ...notes,
    reviewNotes: { ...notes.reviewNotes, graphSha256: 'b'.repeat(64) },
  }), /do not match this candidate graph/i)
  await assert.rejects(parseCandidateMapArtifact(attachNotes(output, [reviewNote(), reviewNote()])), /duplicates another review target/i)
  await assert.rejects(parseCandidateMapArtifact(attachNotes(output, [reviewNote({ evidenceIds: ['not-a-source'] })])), /unique source receipts/i)
  await assert.rejects(parseCandidateMapArtifact(attachNotes(output, [reviewNote({ expectedText: 'stale wording' })])), /no longer matches/i)
})

test('historical review projections remain bound to this revision and cannot transfer approval', async () => {
  const history = attachReviewHistory(fixture())
  const parsed = await parseCandidateMapArtifact(history)
  assert.equal((parsed.reviewHistory as { status: string }).status, 'historical-only')

  await assert.rejects(parseCandidateMapArtifact({
    ...history,
    reviewHistory: { ...history.reviewHistory, currentMapReviewed: true },
  }), /cannot grant current approval/i)
  await assert.rejects(parseCandidateMapArtifact({
    ...history,
    reviewHistory: {
      ...history.reviewHistory,
      entries: [{ ...history.reviewHistory.entries[0], note: reviewNote({ message: 'Changed history note' }) }],
    },
  }), /digest does not match/i)
})

test('candidate fields cannot present independent verification as an assessment', async () => {
  const output = fixture()
  output.graph.nodes[0].assessment = 'independently-verified'
  await assert.rejects(parseCandidateMapArtifact(output), /supported, partial, or unresolved/i)

  const selfEdge = fixture()
  selfEdge.graph.edges.push({ from: 'cap:catalog', to: 'cap:catalog', type: 'supports', reason: 'Synthetic self reference' })
  await assert.rejects(parseCandidateMapArtifact(selfEdge), /cannot point to itself/i)
})

test('same-origin JSON route validation rejects redirects, external hosts, and active URLs', () => {
  const base = 'http://127.0.0.1:5174/?view=map'
  assert.equal(resolveLocalMapUrl('/maps/run/output.json', base), 'http://127.0.0.1:5174/maps/run/output.json')
  assert.equal(resolveLocalMapUrl('http://127.0.0.1:5174/maps/run/reviewed-output.json', base), 'http://127.0.0.1:5174/maps/run/reviewed-output.json')
  assert.throws(() => resolveLocalMapUrl('//example.com/output.json', base), /stay on this site/i)
  assert.throws(() => resolveLocalMapUrl('https://example.com/output.json', base), /stay on this site/i)
  assert.throws(() => resolveLocalMapUrl('data:application/json,{}', base), /same-origin path/i)
  assert.throws(() => resolveLocalMapUrl('/maps/output.json?token=private', base), /without query or fragment/i)
  assert.throws(() => resolveLocalMapUrl('/maps/output.html', base), /output.json/i)
})


test('receipt provenance never upgrades cached interpretations or unknown kinds to observed Git', () => {
  for (const kind of ['source', 'search', 'commit-meta', 'diff', 'path-history']) assert.equal(receiptProvenance(kind).observed, true)
  for (const kind of ['commit-reading', 'prior-map', 'reading', 'future-kind', undefined]) assert.equal(receiptProvenance(kind).observed, false)
  assert.equal(receiptProvenance('commit-reading').label, 'Cached candidate reading')
  assert.equal(receiptProvenance('search').label, 'Observed source search (navigation only)')
  assert.equal(receiptProvenance('prior-map').label, 'Earlier candidate map')
})

function v3Expansion() {
  const output = fixture()
  const diff = { id: 'R-001', kind: 'diff', pinnedCommitSha: 'a'.repeat(40), commitSha: 'd'.repeat(40), path: 'src/catalog.ts', text: '+ return records.get(key)' }
  const reading = { id: 'R-002', kind: 'commit-reading', artifactId: 'C1', commitSha: 'd'.repeat(40), subject: 'Add lookup', readings: [{ tier: 1, summary: 'Adds keyed lookup.' }] }
  const baselineSource = { id: 'old:A-001', kind: 'source', path: 'src/catalog.ts', commitSha: 'b'.repeat(40), startLine: 1, endLine: 4, text: 'export const records = new Map()' }
  return {
    ...output,
    version: 'repository-engine/3',
    mode: 'expansion',
    status: 'candidate-map-produced',
    interpretationStatus: 'candidate',
    receipts: [...output.receipts, diff, reading, baselineSource],
    graph: {
      ...output.graph,
      comparisons: [{ newNodeId: 'Acatalog', existingNodeIds: ['old:Acatalog'], relation: 'same', reason: 'Same lookup.', disposition: 'retained as cap:catalog', evidenceIds: ['S1'], uncertainty: [] }],
      decisions: [{ question: 'Merge lookup proposals?', decision: 'Keep one capability.', reason: 'Same behavior.', evidenceIds: ['S1'], uncertainty: [] }],
      lineage: [{ originalId: 'old:Acatalog', decision: 'revise', successorIds: ['cap:catalog'], reason: 'Definition widened.' }],
      edgeLineage: [],
    },
    baselineGraph: {
      nodes: [{ ...output.graph.nodes[0], id: 'old:Acatalog', evidenceIds: ['old:A-001'], claims: [] }],
      edges: [],
    },
    history: {
      version: 'repository-history/1',
      transition: { fromCommitSha: 'b'.repeat(40), toCommitSha: 'a'.repeat(40), relation: 'descendant', added: [], changed: [{ path: 'src/catalog.ts' }], unchanged: [], deleted: [] },
      lineage: [], edgeLineage: [],
      priorMaps: [{ id: 'M1', displayName: 'Earlier map', commitSha: 'e'.repeat(40), version: 'repository-engine/3', artifactSha256: 'f'.repeat(64), nodeCount: 9, edgeCount: 4, accessedNodeCount: 3, unaccessedNodeCount: 6 }],
      commitReadings: [{ artifactId: 'C1', commitSha: 'd'.repeat(40), subject: 'Add lookup', readings: [{ tier: 1, summary: 'Adds keyed lookup.' }] }],
      receiptIds: ['R-001', 'R-002'],
      omissions: [],
    },
    provenance: { runPlanSha256: '1'.repeat(64), integrationPacketSha256: '2'.repeat(64), outputFingerprints: { A: '3'.repeat(64), R: '4'.repeat(64) } },
  }
}

test('version 3 history receipts resolve by history.receiptIds against top-level receipt bodies', async () => {
  const parsed = await parseCandidateMapArtifact(v3Expansion())
  assert.deepEqual(parsed.historyReceipts.map((receipt) => receipt.id), ['R-001', 'R-002'])
  assert.equal(parsed.historyReceipts[0], parsed.receipts.find((receipt) => receipt.id === 'R-001'))
  assert.deepEqual(parsed.warnings, [])

  const missing = v3Expansion()
  missing.history.receiptIds = ['R-001', 'R-404']
  const withMissing = await parseCandidateMapArtifact(missing)
  assert.deepEqual(withMissing.historyReceipts.map((receipt) => receipt.id), ['R-001'])
  assert.match(withMissing.warnings.join(' '), /1 history receipt ID have no receipt body/)

  const malformed = v3Expansion() as unknown as { history: { receiptIds: unknown } }
  malformed.history.receiptIds = [7]
  await assert.rejects(parseCandidateMapArtifact(malformed), /history.receiptIds must be a list of text values/)
})

test('older artifacts that embed history.receipts still expose them', async () => {
  const legacy = { ...fixture(), history: { receipts: [{ id: 'H1', kind: 'commit-meta', commitSha: 'c'.repeat(40) }] } }
  const parsed = await parseCandidateMapArtifact(legacy)
  assert.deepEqual(parsed.historyReceipts.map((receipt) => receipt.id), ['H1'])
})

test('baseline graph is exposed for the baseline-vs-current view and tolerates malformed input', async () => {
  const parsed = await parseCandidateMapArtifact(v3Expansion())
  assert.equal(parsed.baselineGraph?.nodes[0].id, 'old:Acatalog')
  assert.deepEqual(parsed.baselineGraph?.nodes[0].evidenceIds, ['old:A-001'])
  assert.equal((await parseCandidateMapArtifact(fixture())).baselineGraph, null)

  const broken = v3Expansion() as unknown as { baselineGraph: { nodes: unknown[] } }
  broken.baselineGraph.nodes = [{ id: 'old:x' }]
  const tolerated = await parseCandidateMapArtifact(broken)
  assert.equal(tolerated.baselineGraph, null)
  assert.match(tolerated.warnings.join(' '), /Baseline graph was not shown/)
})

test('history consultations and integration accounting summarize candidate context without promoting it', async () => {
  const parsed = await parseCandidateMapArtifact(v3Expansion())
  const consulted = historyConsultations(parsed.history as Record<string, unknown>)
  assert.equal(consulted.priorMaps[0].accessedNodeCount, 3)
  assert.equal(consulted.priorMaps[0].unaccessedNodeCount, 6)
  assert.equal(consulted.commitReadings[0].readings[0].summary, 'Adds keyed lookup.')
  assert.deepEqual(historyConsultations(null), { priorMaps: [], commitReadings: [] })

  const accounting = integrationAccounting(parsed.graph)
  assert.equal(accounting.comparisons[0].relation, 'same')
  assert.equal(accounting.decisions[0].decision, 'Keep one capability.')
  assert.equal(accounting.lineage[0].originalId, 'old:Acatalog')
  assert.deepEqual(integrationAccounting(null).comparisons, [])
})

test('receipt Git location names the commit, path and saved lines', () => {
  assert.deepEqual(receiptGitLocation({ kind: 'source', path: 'src/a.ts', commitSha: 'a'.repeat(40), startLine: 3, endLine: 8 }), { commitSha: 'a'.repeat(40), path: 'src/a.ts', lines: '3–8' })
  assert.deepEqual(receiptGitLocation({ kind: 'path-history', path: 'src/a.ts', pinnedCommitSha: 'b'.repeat(40) }), { commitSha: 'b'.repeat(40), path: 'src/a.ts', lines: '' })
})
