// Historical review visibility, never semantic approval transfer.
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { blindNode, definitionField } from '../vscode-evidence-audit.mjs'
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
const verdicts = new Set(['supported', 'qualified', 'contradicted', 'unresolved'])
function registry(values, name) {
  requireThat(Array.isArray(values) && values.every(v => v && typeof v.id === 'string'), name + ' requires IDs')
  const map = new Map(values.map(v => [v.id, v]))
  requireThat(map.size === values.length, 'duplicate ' + name + ' ID')
  return map
}
export function projectReviewHistory({ sourceGraph, targetGraph, overlay, lineage, sourceReceipts, targetReceipts, evidenceAliases }) {
  requireThat(overlay.graphSha256 === sha(sourceGraph), 'review graph version mismatch')
  const sources = registry(sourceGraph.nodes, 'source node'), targets = registry(targetGraph.nodes, 'target node')
  const oldReceipts = registry(sourceReceipts, 'source receipt'), newReceipts = registry(targetReceipts, 'target receipt')
  requireThat(Array.isArray(lineage), 'explicit lineage required')
  const mappings = new Map()
  for (const l of lineage) {
    requireThat(sources.has(l.sourceId) && !mappings.has(l.sourceId), 'unknown or duplicate lineage source')
    requireThat(Array.isArray(l.targetIds) && new Set(l.targetIds).size === l.targetIds.length && l.targetIds.every(id => targets.has(id)), 'invalid lineage successors')
    mappings.set(l.sourceId, l.targetIds)
  }
  const predecessorCount = id => [...mappings.values()].filter(ids => ids.includes(id)).length
  const mapEvidence = ids => ids.map(id => {
    const alias = Object.hasOwn(evidenceAliases, id) ? evidenceAliases[id] : undefined
    const old = oldReceipts.get(id), next = newReceipts.get(alias)
    requireThat(old?.kind === 'source' && next?.kind === 'source', 'missing source evidence correspondence')
    const { id: oldId, ...a } = old, { id: nextId, ...b } = next
    requireThat(isDeepStrictEqual(a, b), 'review evidence changed')
    return alias
  })
  const incidentContext = (sourceId, targetId) => {
    const before = sourceGraph.edges.filter(e => e.from === sourceId || e.to === sourceId)
    const after = targetGraph.edges.filter(e => e.from === targetId || e.to === targetId)
    const resolvable = before.every(e => mappings.get(e.from)?.length === 1 && mappings.get(e.to)?.length === 1)
    const mapped = resolvable ? before.map(e => ({ ...e, from: mappings.get(e.from)[0], to: mappings.get(e.to)[0], evidenceIds: mapEvidence(e.evidenceIds) })) : []
    return { status: !resolvable ? 'ambiguous-lineage' : isDeepStrictEqual(mapped.map(sha).sort(), after.map(sha).sort()) ? 'unchanged' : 'changed',
      sourceCount: before.length, targetCount: after.length }
  }
  requireThat(Array.isArray(overlay.entries) && overlay.reviewSha256, 'review records required')
  const entries = [], seen = new Set()
  for (const entry of overlay.entries) {
    const original = sources.get(entry.nodeId), successors = mappings.get(entry.nodeId)
    requireThat(original && successors, 'reviewed node requires explicit lineage')
    requireThat(['definition', 'claim'].includes(entry.scope), 'unknown review scope')
    requireThat(verdicts.has(entry.verdict) && typeof overlay.reviewSha256[entry.reviewer] === 'string', 'invalid review identity/verdict')
    const definition = blindNode(original)
    if (entry.scope === 'claim') requireThat(Number.isInteger(entry.claimIndex) && entry.claimIndex >= 0 && definition.claims[entry.claimIndex], 'invalid reviewed claim index')
    const content = entry.scope === 'definition' ? definition : definition.claims[entry.claimIndex]
    requireThat(entry.contentSha256 === sha(content), 'review content version mismatch')
    const key = JSON.stringify([entry.reviewer, entry.nodeId, entry.scope, entry.claimIndex ?? null])
    requireThat(!seen.has(key), 'duplicate review entry'); seen.add(key)
    const findings = entry.scope === 'definition' ? entry.boundaryFindings : []
    requireThat(Array.isArray(findings), 'definition findings required')
    for (const finding of findings) {
      requireThat(verdicts.has(finding.verdict) && definitionField(definition, finding.field) !== undefined, 'invalid reviewed field')
      mapEvidence(finding.evidenceIds)
    }
    const evidenceIds = mapEvidence(entry.evidenceIds)
    const projections = successors.map(id => {
      const current = blindNode(targets.get(id)), expected = { ...definition, id,
        evidenceIds: mapEvidence(definition.evidenceIds),
        claims: definition.claims.map(c => ({ ...c, evidenceIds: mapEvidence(c.evidenceIds) })) }
      const wholeDefinitionUnchanged = isDeepStrictEqual(expected, current)
      const claimUnchanged = entry.scope === 'claim' && isDeepStrictEqual(expected.claims[entry.claimIndex], current.claims[entry.claimIndex])
      return { nodeId: id, name: targets.get(id).name,
        correspondence: successors.length > 1 ? 'multiple-successors' : predecessorCount(id) > 1 ? 'merged-successor' : 'single-successor',
        predecessorCount: predecessorCount(id), incidentRelationships: incidentContext(entry.nodeId, id),
        reviewedContentUnchanged: entry.scope === 'definition' ? wholeDefinitionUnchanged : claimUnchanged,
        definitionUnchanged: wholeDefinitionUnchanged,
        findings: findings.map(f => ({ ...f, evidenceIds: mapEvidence(f.evidenceIds),
          reviewedValue: definitionField(definition, f.field), currentValue: definitionField(current, f.field) ?? null,
          fieldUnchanged: isDeepStrictEqual(definitionField(expected, f.field), definitionField(current, f.field)) })) }
    })
    entries.push({ ...entry, evidenceIds, boundaryFindings: findings.map(f => ({ ...f, evidenceIds: mapEvidence(f.evidenceIds) })),
      sourceReviewSha256: overlay.reviewSha256[entry.reviewer], projections,
      disposition: successors.length ? 'historical-review-linked' : 'reviewed-node-has-no-successor' })
  }
  return { schemaVersion: 'review-history-v1', sourceGraphSha256: sha(sourceGraph), targetGraphSha256: sha(targetGraph),
    graphContextChanged: !isDeepStrictEqual(sourceGraph, targetGraph),
    status: 'historical-only', inheritedApprovals: [], currentMapReviewed: false, runtimeVerified: false,
    automaticPromotion: false, entries,
    limitation: 'Exact content matches preserve visibility, not approval. New relationships, neighboring definitions, implementations or evidence may change meaning. Changed or split successors need fresh review; earlier findings are not automatically resolved.' }
}

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
export function renderReviewHistory(baseHtml, history, { historyHref = 'review-history.json' } = {}) {
  requireThat(history.status === 'historical-only' && history.inheritedApprovals.length === 0, 'historical-only report required')
  requireThat(/^[a-zA-Z0-9._-]+\.json$/.test(historyHref), 'local history filename required')
  let html = baseHtml
  const ids = [...new Set(history.entries.flatMap(e => e.projections.map(p => p.nodeId)))]
  for (const id of ids) {
    const records = history.entries.flatMap(e => e.projections.filter(p => p.nodeId === id).map(p => ({ entry: e, projection: p })))
    const problems = records.flatMap(({ entry, projection }) => entry.scope === 'definition'
      ? projection.findings.filter(f => f.verdict !== 'supported').map(f => ({ ...f, unchanged: f.fieldUnchanged }))
      : entry.verdict !== 'supported' ? [{ ...entry, field: `claims[${entry.claimIndex}].text`, unchanged: projection.reviewedContentUnchanged }] : [])
    const tag = `<article class="capability" id="${esc(id)}">`
    requireThat(html.split(tag).length === 2, 'unique capability report anchor required')
    const text = records.every(r => r.projection.definitionUnchanged && r.projection.correspondence === 'single-successor') ? 'Reviewed definition content is unchanged after explicit ID mapping.' : 'Definition content or identity correspondence changed; do not reuse its earlier verdict.'
    const relationshipText = records.some(r => r.projection.incidentRelationships.status !== 'unchanged') ? 'Relationships involving this capability changed or have ambiguous correspondence.' : 'Its incident relationships are unchanged; the wider graph may still affect interpretation.'
    const notice = `<aside class="notice"><strong>Earlier source review—not a review of this map.</strong> ${esc(text)} ${esc(relationshipText)} No approval is inherited. ${problems.length} earlier field/claim qualifications or gaps are recorded here. <a href="${esc(historyHref)}">Version-linked review records</a> · <a href="../vscode-revision-recheck-1/index.html">Original review</a>${problems.map(f => `<details><summary>${esc(f.field)} — earlier ${esc(f.verdict)}; ${f.unchanged ? 'same reviewed content' : 'changed content, recheck needed'}</summary><p>${esc(f.reason)}</p>${f.replacement ? `<p>Earlier proposed correction, not applied by this layer: ${esc(f.replacement)}</p>` : ''}<p>${f.evidenceIds.map(e => `<a href="#evidence-${esc(e)}">${esc(e)}</a>`).join(', ')}</p></details>`).join('')}</aside>`
    html = html.replace(tag, tag + notice)
  }
  const removed = history.entries.filter(e => !e.projections.length)
  const archive = removed.length ? `<section><h2>Earlier reviews with no current successor</h2><p>These findings are archived, not resolved.</p>${removed.map(e => `<details><summary>${esc(e.nodeId)} / ${esc(e.scope)} — earlier ${esc(e.verdict)}</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details>`).join('')}</section>` : ''
  return html.replace('</h1>', `</h1><p class="notice">This separate view preserves the frozen candidate map and displays earlier source-review findings after discovery. It does not change model decisions, transfer approval, or supply feedback to discovery. <a href="index.html#map">Original frozen report</a> · <a href="${esc(historyHref)}">Review history</a></p>${archive}`)
}
