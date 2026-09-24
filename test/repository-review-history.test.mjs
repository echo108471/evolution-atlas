import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { candidateProjection } from '../scripts/lib/repository-engine-contract.mjs'
import { projectRepositoryReviewHistory, attachRepositoryReviewHistory } from '../scripts/repository-review-history.mjs'
import { renderRepositoryMap } from '../scripts/render-repository-map-v3.mjs'

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const revision = n => String(n).repeat(40)
function fixture() {
  const source = { version: 'repository-engine/3', displayName: 'Synthetic history', commitSha: revision(1), independentVerification: 'not-performed',
    graph: { nodes: [{ id: 'A1', name: 'Read source', summary: 'Reads a bounded source excerpt.', actor: 'Maintainer',
      inputs: [], outcomes: ['An excerpt'], conditions: [], exclusions: [], implementations: [], uncertainty: [],
      evidenceIds: ['A-001'], assessment: 'partial', claims: [{ text: 'Only selected lines are read.', evidenceIds: ['A-001'], assessment: 'partial' }] }], edges: [] },
    receipts: [{ id: 'A-001', kind: 'source', commitSha: revision(1), blobSha: revision(3), path: 'source.mjs', startLine: 1, endLine: 1, totalLines: 1, text: 'synthetic()' }] }
  source.reviewNotes = { graphSha256: sha(source.graph), notes: [{ nodeId: 'A1', field: 'summary', expectedText: source.graph.nodes[0].summary,
    status: 'qualified', basis: 'source-review', message: 'The sample is narrower than the general wording.', evidenceIds: ['A-001'] }] }
  return { source, target: successor(source) }
}
function successor(source) {
  const baselineGraph = candidateProjection(source.graph, 'old:')
  return { version: 'repository-engine/3', displayName: source.displayName, commitSha: revision(Number(source.commitSha[0]) + 1), independentVerification: 'not-performed',
    baselineGraph, graph: { ...structuredClone(baselineGraph), lineage: baselineGraph.nodes.map(n => ({ originalId: n.id, decision: 'retain', successorIds: [n.id], reason: 'Synthetic retain' })) },
    receipts: source.receipts.map(r => ({ ...r, id: 'old:' + r.id })) }
}

test('historical notes attach through exact baseline lineage without transferring approval or changing candidate data', () => {
  const { source, target } = fixture(), before = structuredClone({ source, target })
  const result = attachRepositoryReviewHistory(source, target)
  assert.deepEqual({ source, target }, before)
  assert.deepEqual(result.output.graph, target.graph)
  const h = result.output.reviewHistory
  assert.equal(h.status, 'historical-only')
  assert.equal(h.currentMapReviewed, false)
  assert.deepEqual(h.inheritedApprovals, [])
  assert.equal(h.entries[0].projections[0].contentStatus, 'unchanged')
  assert.deepEqual(h.entries[0].note.evidenceIds, ['old:A-001'])
  assert.match(result.html, /No approval inherited/)
  assert.equal(result.output.independentVerification, 'not-performed')
  assert.equal(Object.hasOwn(result.output, 'reviewNotes'), false)
})

test('changed, split and removed successors preserve qualifications instead of resolving them', () => {
  const { source, target } = fixture()
  target.graph.nodes[0].summary = 'Changed wording.'
  target.graph.lineage[0].decision = 'revise'
  assert.equal(projectRepositoryReviewHistory(source, target).entries[0].projections[0].contentStatus, 'changed')
  target.graph.nodes.push({ ...structuredClone(target.graph.nodes[0]), id: 'split' })
  target.graph.lineage[0] = { ...target.graph.lineage[0], decision: 'split', successorIds: ['old:A1', 'split'] }
  assert.ok(projectRepositoryReviewHistory(source, target).entries[0].projections.every(p => p.correspondence === 'multiple-successors'))
  target.graph.nodes = []
  target.graph.lineage[0] = { ...target.graph.lineage[0], decision: 'remove', successorIds: [] }
  const removed = attachRepositoryReviewHistory(source, target)
  assert.equal(removed.output.reviewHistory.entries[0].disposition, 'reviewed-node-has-no-successor')
  assert.match(removed.html, /archived, not resolved/)
})

test('merged successors and changing incident relationships remain explicit', () => {
  const { source } = fixture()
  source.graph.nodes.push({ ...structuredClone(source.graph.nodes[0]), id: 'A2', name: 'Second capability' })
  source.graph.edges.push({ from: 'A1', to: 'A2', type: 'supports', evidenceIds: ['A-001'], reason: 'Synthetic edge', assessment: 'partial' })
  source.reviewNotes.graphSha256 = sha(source.graph)
  const target = successor(source)
  assert.equal(projectRepositoryReviewHistory(source, target).entries[0].projections[0].incidentRelationships, 'unchanged')
  target.graph.edges[0].reason = 'Changed relationship'
  assert.equal(projectRepositoryReviewHistory(source, target).entries[0].projections[0].incidentRelationships, 'changed')
  target.graph.nodes.push({ ...structuredClone(target.graph.nodes[1]), id: 'split' })
  target.graph.lineage[1] = { ...target.graph.lineage[1], decision: 'split', successorIds: ['old:A2', 'split'] }
  assert.equal(projectRepositoryReviewHistory(source, target).entries[0].projections[0].incidentRelationships, 'ambiguous')
  target.graph.nodes = [target.graph.nodes[0]]
  target.graph.edges = []
  target.graph.lineage = target.graph.lineage.map(line => ({ ...line, decision: 'merge', successorIds: ['old:A1'] }))
  const merged = projectRepositoryReviewHistory(source, target).entries[0].projections[0]
  assert.equal(merged.correspondence, 'merged-successor')
  assert.equal(merged.incidentRelationships, 'changed')
})

test('multi-revision history preserves origin and evidence aliases without reapplying notes as a new review', () => {
  const { source, target } = fixture()
  const first = attachRepositoryReviewHistory(source, target).output
  const next = successor(first)
  const h = projectRepositoryReviewHistory(first, next)
  assert.equal(h.entries[0].sourceCommitSha, source.commitSha)
  assert.equal(h.entries[0].sourceNodeId, 'A1')
  assert.deepEqual(h.entries[0].note.evidenceIds, ['old:old:A-001'])
  assert.equal(h.entries[0].projections[0].nodeId, 'old:old:A1')
  assert.equal(h.currentMapReviewed, false)
})

test('reject forged source binding, stale notes, missing lineage and changed receipt bytes', () => {
  for (const mutate of [
    (s, t) => { t.baselineGraph.nodes[0].summary = 'Different baseline' },
    (s, t) => { t.graph.lineage = [] },
    (s, t) => { t.receipts[0].text = 'tampered' },
    (s, t) => { t.independentVerification = 'verified' },
    s => { s.reviewNotes.notes[0].expectedText = 'stale' },
    (s, t) => { t.history = { transition: { fromCommitSha: revision(9), toCommitSha: t.commitSha } } },
  ]) {
    const { source, target } = fixture(); mutate(source, target)
    assert.throws(() => projectRepositoryReviewHistory(source, target))
  }
})

test('inherited review history rejects revision, evidence and entry tampering', () => {
  for (const mutate of [
    s => { s.reviewHistory.targetCommitSha = revision(9) },
    s => { s.reviewHistory.entries[0].sourceCommitSha = 'invalid'; s.reviewHistory.entriesSha256 = sha(s.reviewHistory.entries) },
    s => { s.reviewHistory.entries[0].note.message = 'Unrecorded change' },
    s => { s.reviewHistory.entries[0].note.evidenceIds = ['missing']; s.reviewHistory.entriesSha256 = sha(s.reviewHistory.entries) },
    s => { s.reviewHistory.entries[0].projections[0].nodeId = 'missing'; s.reviewHistory.entriesSha256 = sha(s.reviewHistory.entries) },
  ]) {
    const { source, target } = fixture()
    const reviewed = attachRepositoryReviewHistory(source, target).output
    mutate(reviewed)
    assert.throws(() => projectRepositoryReviewHistory(reviewed, successor(reviewed)))
  }
})

test('v3 HTML exposes observed transition and history evidence without declaring candidate lineage verified', () => {
  const { target } = fixture()
  target.receipts.push({ id: 'R-001', kind: 'diff', commitSha: revision(2), text: '+ <script>bad</script>' })
  target.history = { transition: { fromCommitSha: revision(1), toCommitSha: revision(2), relation: 'ancestor', added: [], changed: [{ path: 'source.mjs' }], deleted: [], unchanged: [] },
    lineage: [{ id: 'H1', from: { commitSha: revision(1), nodeId: 'A1' }, to: [{ commitSha: revision(2), nodeId: 'old:A1' }], decision: 'expanded', claim: '<script>claim</script>', reason: 'Candidate explanation', evidenceIds: ['R-001'], assessment: 'partial' }], omissions: ['Only one path inspected.'] }
  const html = renderRepositoryMap(target)
  assert.match(html, /Observed revision transition/)
  assert.match(html, /Candidate capability evolution/)
  assert.match(html, /Observed Git evidence/)
  assert.match(html, /&lt;script&gt;claim&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.doesNotMatch(html, /This snapshot does not establish historical change/)
  assert.match(html, /independent verification: not performed/)
  target.history.transition.added = { length: '<img src=x onerror=bad()>' }
  const malformed = renderRepositoryMap(target)
  assert.doesNotMatch(malformed, /<img/)
  assert.match(malformed, /not recorded/)
})
