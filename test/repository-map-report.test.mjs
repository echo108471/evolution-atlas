import test from 'node:test'
import assert from 'node:assert/strict'
import { renderRepositoryMap } from '../scripts/render-repository-map.mjs'

const anchor = (kind, id) => `${kind}-${Buffer.from(id, 'utf16le').toString('hex')}`
const node = (id, evidenceIds = ['old:A-001']) => ({ id, name: `Capability ${id}`, summary: 'Synthetic behavior', actor: 'Caller', inputs: ['Request'], outcomes: ['Result'], conditions: [], exclusions: [], implementations: ['src/example.ts'], uncertainty: [], evidenceIds, assessment: 'partial', claims: [{ text: 'Produces a result', evidenceIds, assessment: 'partial' }] })
const edge = (from, to) => ({ from, to, type: 'contains', reason: 'Synthetic containment', evidenceIds: ['old:A-001'], assessment: 'partial' })
function fixture() {
  return { displayName: 'Example repository', commitSha: 'a'.repeat(40), mode: 'expansion', graph: { nodes: [node('one'), node('two'), node('shared'), node('standalone')], edges: [edge('one', 'shared'), edge('two', 'shared')], lineage: [], edgeLineage: [], comparisons: [], decisions: [], limitations: ['Bounded excerpts'] }, baselineGraph: { nodes: [], edges: [] }, proposals: [], receipts: [{ id: 'old:A-001', kind: 'source', commitSha: 'a'.repeat(40), blobSha: 'b'.repeat(40), path: 'src/example.ts', startLine: 2, endLine: 3, totalLines: 5, text: 'return result\n}', truncated: true }], coverage: { files: 1, uniqueLines: 2, eligibleFiles: 20, allTrackedEntries: 30 }, validationIssues: [], limitations: ['Synthetic test'] }
}
test('generic report preserves multiple parents, standalone capabilities, and one definition per node', () => {
  const output = fixture(), html = renderRepositoryMap(output), organization = html.split('<section id="map">')[1].split('<section id="capabilities">')[0]
  assert.equal((organization.match(new RegExp(`href="#${anchor('node', 'shared')}"`, 'g')) ?? []).length, 2)
  assert.match(organization, /also shown elsewhere/)
  assert.match(organization, /Other capabilities/)
  for (const n of output.graph.nodes) assert.equal((html.match(new RegExp(`id="${anchor('node', n.id)}"`, 'g')) ?? []).length, 1)
  assert.equal((html.match(/<article class="capability"/g) ?? []).length, 4)
  assert.match(html, /independent verification: not performed/)
  assert.match(html, /not a percentage of capabilities discovered/)
  assert.doesNotMatch(html, /VS Code|microsoft|github\.com|experiment-summary|API calls|API cost/)
  assert.deepEqual([...new Set([...html.matchAll(/href="([^#][^"]*)"/g)].map(m => m[1]))], ['output.json'])
})
test('all dynamic labels, source content, metadata and raw records are escaped', () => {
  const output = fixture(), attack = '<script>alert("unsafe")</script>'
  output.displayName = attack; output.commitSha = attack; output.mode = attack
  output.graph.nodes[0].name = attack; output.graph.nodes[0].claims[0].text = attack; output.graph.edges[0].reason = attack
  output.receipts[0].path = attack; output.receipts[0].text = attack; output.receipts[0].commitSha = attack; output.receipts[0].blobSha = attack; output.receipts[0].totalLines = attack
  output.coverage.files = attack; output.validationIssues = [{ message: attack }]; output.limitations.push(attack)
  const html = renderRepositoryMap(output)
  assert.doesNotMatch(html, /<script>|alert\("unsafe"\)/)
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/)
  assert.match(html, /Validation issues — retained, not hidden/)
})
test('node and receipt anchors are injective and all citation links resolve', () => {
  const output = fixture(), ids = ['old:A', 'old%3AA', 'old:A%25', '"<x>', '\ud800', '\ud801']
  output.graph.nodes = ids.map(id => node(id, ids)); output.graph.edges = []
  output.receipts = ids.map(id => ({ ...output.receipts[0], id }))
  const html = renderRepositoryMap(output), definitions = [...html.matchAll(/\bid="([^"]*)"/g)].map(m => m[1])
  assert.equal(new Set(definitions).size, definitions.length)
  for (const id of ids) { assert.ok(definitions.includes(anchor('node', id))); assert.ok(definitions.includes(anchor('source', id))) }
  for (const match of html.matchAll(/href="#([^"]*)"/g)) assert.ok(definitions.includes(match[1]), match[1])
})
test('report includes removed definitions, edge dispositions, comparisons and global decisions', () => {
  const output = fixture(), prior = node('old:removed'), originalEdge = edge('old:removed', 'old:other')
  output.baselineGraph = { nodes: [prior, node('old:other')], edges: [originalEdge] }
  output.proposals = [{ agent: 'A', scopeSummary: 'Inspected a boundary', nodes: [node('new:A')], edges: [], coverage: { omitted: 'Not exhaustive' }, crossPartitionLeads: ['Follow dependency'] }]
  output.graph.lineage = [{ originalId: prior.id, decision: 'remove', successorIds: [], reason: 'Definition is too broad' }]
  output.graph.edgeLineage = [{ source: 'baseline', originalIndex: 0, decision: 'remove', successorEdges: [], reason: 'Unsupported relationship' }]
  output.graph.comparisons = [{ newNodeId: 'new:A', existingNodeIds: [prior.id], relation: 'distinct', disposition: 'Keep separate', reason: 'Different outcome', evidenceIds: ['old:A-001'], uncertainty: ['Bounded support'] }]
  output.graph.decisions = [{ question: 'Which scope?', decision: 'Narrow scope', reason: 'Inspect the visible boundary', evidenceIds: ['old:A-001'], uncertainty: ['Runtime unknown'] }]
  const html = renderRepositoryMap(output)
  for (const expected of ['Definition is too broad', 'Unsupported relationship', 'Different outcome', 'Keep separate', 'Narrow scope', 'Runtime unknown', 'None; removed from the candidate map.', 'Original definition', 'Unedited proposal A']) assert.ok(html.includes(expected), expected)
  assert.doesNotMatch(html, new RegExp(`href="#${anchor('node', prior.id)}"`))
})
test('deep and cyclic containment navigation remains bounded without dropping definitions or edges', () => {
  const output = fixture()
  output.graph.nodes = Array.from({ length: 160 }, (_, i) => node(`N${i}`))
  output.graph.edges = output.graph.nodes.slice(1).map((n, i) => edge(`N${i}`, n.id))
  let html = renderRepositoryMap(output)
  assert.match(html, /navigation depth limit/)
  assert.equal((html.match(/<article class="capability"/g) ?? []).length, 160)
  assert.equal((html.split('<section id="relationships">')[1].split('</section>')[0].match(/<tr>/g) ?? []).length, 160)
  output.graph.edges.push(edge('N159', 'N0'))
  html = renderRepositoryMap(output)
  assert.match(html, /Additional containment entries/)
  assert.equal((html.match(/<article class="capability"/g) ?? []).length, 160)
  output.graph.edges = [edge('N0', 'N0')]
  assert.match(renderRepositoryMap(output), /containment cycle/)
})
test('duplicate identities are rejected rather than producing ambiguous anchors', () => {
  const output = fixture()
  output.graph.nodes.push(output.graph.nodes[0])
  assert.throws(() => renderRepositoryMap(output), /duplicate node or source receipt identity/)
  output.graph.nodes.pop(); output.receipts.push(output.receipts[0])
  assert.throws(() => renderRepositoryMap(output), /duplicate node or source receipt identity/)
})
