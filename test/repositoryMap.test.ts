import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { parseCandidateMapArtifact, parseCandidateMapText, resolveLocalMapUrl, receiptProvenance } from '../src/repositoryMap'

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
