#!/usr/bin/env node
/** Post-inference, exact-lineage projection of earlier notes. Never transfers approval. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidateProjection } from './lib/repository-engine-contract.mjs'
import { reviewRepositoryMap } from './review-repository-map.mjs'
import { renderRepositoryMap } from './render-repository-map-v3.mjs'

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const requireThat = (condition, message) => { if (!condition) throw new Error(message) }
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const anchor = (kind, id) => `${kind}-${Buffer.from(String(id), 'utf16le').toString('hex')}`
const commitId = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
const text = value => typeof value === 'string' && value.trim().length > 0

function reviewedText(node, note) {
  if (!node) return null
  return note.field === 'summary' ? node.summary ?? null
    : note.field === 'conditions' ? node.conditions?.[note.index] ?? null : node.claims?.[note.index]?.text ?? null
}

export function projectRepositoryReviewHistory(source, target) {
  requireThat(source?.graph && target?.graph && Array.isArray(target.graph.lineage), 'Published maps with explicit lineage required')
  requireThat(commitId(source.commitSha) && commitId(target.commitSha), 'Revision identities required')
  requireThat(target.independentVerification === 'not-performed', 'Historical review cannot grant current verification')
  requireThat(isDeepStrictEqual(candidateProjection(source.graph, 'old:'), target.baselineGraph), 'Target baseline does not match the reviewed source graph')
  if (target.history?.transition) requireThat(target.history.transition.fromCommitSha === source.commitSha && target.history.transition.toCommitSha === target.commitSha, 'Review revision transition mismatch')
  const targets = new Map(target.graph.nodes.map(n => [n.id, n]))
  const oldNodes = new Map(source.graph.nodes.map(n => [n.id, n]))
  const mappings = new Map()
  for (const node of source.graph.nodes) {
    const lines = target.graph.lineage.filter(line => line.originalId === 'old:' + node.id)
    requireThat(lines.length === 1, 'Exactly one explicit lineage record required for ' + node.id)
    const line = lines[0]
    requireThat(Array.isArray(line.successorIds) && new Set(line.successorIds).size === line.successorIds.length && line.successorIds.every(id => targets.has(id)), 'Unknown or duplicate review successor')
    requireThat((line.decision === 'remove') === (line.successorIds.length === 0), 'Review lineage disposition mismatch')
    mappings.set(node.id, line.successorIds)
  }
  const sourceReceipts = new Map(source.receipts.map(r => [r.id, r]))
  const targetReceipts = new Map(target.receipts.map(r => [r.id, r]))
  const mapEvidence = ids => ids.map(id => {
    const original = sourceReceipts.get(id), projected = targetReceipts.get('old:' + id)
    requireThat(original && projected, 'Missing historical review evidence correspondence')
    requireThat(isDeepStrictEqual({ ...original, id: projected.id }, projected), 'Historical review evidence changed')
    return projected.id
  })
  const incident = (sourceId, targetId) => {
    const edges = source.graph.edges.filter(e => e.from === sourceId || e.to === sourceId)
    if (!edges.every(e => mappings.get(e.from)?.length === 1 && mappings.get(e.to)?.length === 1)) return 'ambiguous'
    const before = edges.map(e => ({ ...e, from: mappings.get(e.from)[0], to: mappings.get(e.to)[0], evidenceIds: mapEvidence(e.evidenceIds) }))
    const after = target.graph.edges.filter(e => e.from === targetId || e.to === targetId)
    const edgeKey = e => JSON.stringify([e.from, e.to, e.type])
    const byKey = (a, b) => edgeKey(a).localeCompare(edgeKey(b))
    return isDeepStrictEqual(before.sort(byKey), after.sort(byKey)) ? 'unchanged' : 'changed'
  }
  const notes = []
  if (source.reviewNotes) {
    reviewRepositoryMap(source, source.reviewNotes)
    for (const note of source.reviewNotes.notes) notes.push({ sourceCommitSha: source.commitSha, sourceNodeId: note.nodeId, note, currentSourceIds: [note.nodeId] })
  }
  if (source.reviewHistory) {
    const previous = source.reviewHistory
    requireThat(previous.schemaVersion === 'repository-review-history/1' && previous.status === 'historical-only' && previous.targetGraphSha256 === sha(source.graph) && previous.targetCommitSha === source.commitSha && previous.currentMapReviewed === false && Array.isArray(previous.inheritedApprovals) && previous.inheritedApprovals.length === 0, 'Invalid prior review history binding')
    requireThat(Array.isArray(previous.entries), 'Historical entries required')
    requireThat(previous.entriesSha256 === sha(previous.entries), 'Historical entry fingerprints changed')
    for (const entry of previous.entries) {
      const n = entry.note
      requireThat(commitId(entry.sourceCommitSha) && text(entry.sourceNodeId) && n?.nodeId === entry.sourceNodeId, 'Invalid inherited review origin')
      requireThat(['summary', 'conditions', 'claims'].includes(n.field) && [n.expectedText, n.message].every(text)
        && ['qualified', 'disputed', 'unresolved'].includes(n.status) && ['proposer-disclosed', 'source-review', 'owner-feedback'].includes(n.basis)
        && (n.field === 'summary' ? !Object.hasOwn(n, 'index') : Number.isSafeInteger(n.index) && n.index >= 0)
        && Array.isArray(n.evidenceIds) && n.evidenceIds.length > 0 && n.evidenceIds.every(id => text(id) && sourceReceipts.has(id))
        && new Set(n.evidenceIds).size === n.evidenceIds.length, 'Invalid inherited review note')
      requireThat(Array.isArray(entry.projections) && new Set(entry.projections.map(p => p.nodeId)).size === entry.projections.length
        && entry.projections.every(p => oldNodes.has(p.nodeId) && ['single-successor', 'multiple-successors', 'merged-successor'].includes(p.correspondence)
          && ['unchanged', 'changed', 'absent'].includes(p.contentStatus) && ['unchanged', 'changed', 'ambiguous'].includes(p.incidentRelationships)), 'Invalid inherited review correspondence')
      notes.push({ ...entry, currentSourceIds: entry.projections.map(p => p.nodeId) })
    }
  }
  const entries = notes.map(entry => {
    const note = structuredClone(entry.note)
    note.evidenceIds = mapEvidence(note.evidenceIds)
    const projectedIds = [...new Set(entry.currentSourceIds.flatMap(id => mappings.get(id) ?? []))]
    const projections = projectedIds.map(nodeId => {
      const predecessors = [...mappings].filter(([, ids]) => ids.includes(nodeId)).map(([id]) => id)
      const currentText = reviewedText(targets.get(nodeId), note)
      const sourceId = entry.currentSourceIds.find(id => mappings.get(id)?.includes(nodeId))
      return { nodeId, correspondence: projectedIds.length > 1 ? 'multiple-successors' : predecessors.length > 1 ? 'merged-successor' : 'single-successor',
        contentStatus: currentText === null ? 'absent' : currentText === note.expectedText ? 'unchanged' : 'changed', currentText,
        incidentRelationships: incident(sourceId, nodeId) }
    })
    return { sourceCommitSha: entry.sourceCommitSha, sourceNodeId: entry.sourceNodeId, note, projections,
      disposition: projections.length ? 'historical-review-linked' : 'reviewed-node-has-no-successor' }
  })
  return { schemaVersion: 'repository-review-history/1', status: 'historical-only', sourceGraphSha256: sha(source.graph), targetGraphSha256: sha(target.graph),
    sourceCommitSha: source.commitSha, targetCommitSha: target.commitSha, currentMapReviewed: false, inheritedApprovals: [], entries, entriesSha256: sha(entries),
    limitation: 'Earlier notes remain historical. Matching text does not transfer approval; changed wording, relationships and revisions require fresh review. Removed findings are archived, not resolved.' }
}

export function attachRepositoryReviewHistory(source, target) {
  const history = projectRepositoryReviewHistory(source, target)
  if (target.reviewHistory) requireThat(isDeepStrictEqual(target.reviewHistory, history), 'Conflicting review history companion')
  const output = { ...structuredClone(target), reviewHistory: history }
  let html = renderRepositoryMap(output)
  const notice = `<section id="review-history"><h2>Earlier review notes</h2><p class="notice">${esc(history.limitation)}</p>${history.entries.map(entry => `<article class="capability"><h3>${esc(entry.sourceNodeId)} · earlier ${esc(entry.note.status)}</h3><p>${esc(entry.note.expectedText)}</p><p>${esc(entry.note.message)}</p><p>Reviewed revision: <code>${esc(entry.sourceCommitSha)}</code> · basis: ${esc(entry.note.basis)}</p>${entry.projections.length ? entry.projections.map(p => `<p><a href="#${anchor('node', p.nodeId)}">${esc(p.nodeId)}</a>: ${esc(p.contentStatus)} text; ${esc(p.correspondence)}; ${esc(p.incidentRelationships)} relationships. No approval inherited.</p>`).join('') : '<p>No current successor. This finding remains archived, not resolved.</p>'}</article>`).join('') || '<p>No earlier notes recorded.</p>'}</section>`
  html = html.replace('</main>', notice + '</main>')
  return { output, html }
}

function readRegular(path) {
  requireThat(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Regular artifact required: ' + path)
  return readFileSync(path)
}
export function saveRepositoryReviewHistory(sourcePath, directory) {
  const run = resolve(directory), source = JSON.parse(readRegular(resolve(sourcePath))), target = JSON.parse(readRegular(run + '/output.json'))
  const result = attachRepositoryReviewHistory(source, target)
  const artifacts = [['reviewed-output.json', JSON.stringify(result.output, null, 2) + '\n'], ['reviewed.html', result.html]]
  const pending = []
  for (const [name, bytes] of artifacts) {
    try { requireThat(readRegular(run + '/' + name).equals(Buffer.from(bytes)), 'Refusing changed review companion: ' + name) }
    catch (error) { if (error.code !== 'ENOENT') throw error; pending.push([name, bytes]) }
  }
  for (const [name, bytes] of pending) writeFileSync(run + '/' + name, bytes, { flag: 'wx' })
  return { output: run + '/reviewed-output.json', report: run + '/reviewed.html', entries: result.output.reviewHistory.entries.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [source, run, ...extra] = process.argv.slice(2)
    if (!source || !run || extra.length) throw new Error('Usage: repository-review-history.mjs PREVIOUS_REVIEWED_OUTPUT.json CURRENT_RUN')
    console.log(JSON.stringify(saveRepositoryReviewHistory(source, run)))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
