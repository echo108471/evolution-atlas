export type JsonRecord = Record<string, unknown>

export interface CandidateClaim extends JsonRecord {
  text: string
  evidenceIds: string[]
  assessment: string
}

export interface CandidateNode extends JsonRecord {
  id: string
  name: string
  summary: string
  actor: string
  inputs: string[]
  outcomes: string[]
  conditions: string[]
  exclusions: string[]
  implementations: string[]
  evidenceIds: string[]
  assessment: string
  uncertainty: string[]
  claims: CandidateClaim[]
}

export interface CandidateEdge extends JsonRecord {
  from: string
  to: string
  type: string
  reason: string
  evidenceIds: string[]
  assessment: string
}

export interface CandidateMapArtifact extends JsonRecord {
  displayName: string
  commitSha: string
  mode: string
  graph: JsonRecord & { nodes: CandidateNode[]; edges: CandidateEdge[] }
  receipts: JsonRecord[]
  historyReceipts: JsonRecord[]
  warnings: string[]
}

const record = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be non-empty text.`)
  }
  return value
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  return value
}

function textList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be a list of text values.`)
  }
  return value as string[]
}

function assessment(value: unknown, label: string): string {
  const result = value === undefined ? 'unresolved' : requiredText(value, label)
  if (!['supported', 'partial', 'unresolved'].includes(result)) {
    throw new Error(`${label} must be supported, partial, or unresolved.`)
  }
  return result
}

async function sha256Json(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot validate the artifact’s SHA-256 bindings.')
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function recordList(value: unknown, label: string): JsonRecord[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(record)) {
    throw new Error(`${label} must be a list of objects.`)
  }
  return value
}

function normalizeNode(value: unknown, index: number): CandidateNode {
  const label = `graph.nodes[${index}]`
  if (!record(value)) throw new Error(`${label} must be an object.`)
  const claims = recordList(value.claims, `${label}.claims`).map((claim, claimIndex) => ({
    ...claim,
    text: requiredText(claim.text, `${label}.claims[${claimIndex}].text`),
    evidenceIds: textList(claim.evidenceIds, `${label}.claims[${claimIndex}].evidenceIds`),
    assessment: assessment(claim.assessment, `${label}.claims[${claimIndex}].assessment`),
  }))
  return {
    ...value,
    id: requiredText(value.id, `${label}.id`),
    name: requiredText(value.name, `${label}.name`),
    summary: requiredText(value.summary, `${label}.summary`),
    actor: optionalText(value.actor, `${label}.actor`),
    inputs: textList(value.inputs, `${label}.inputs`),
    outcomes: textList(value.outcomes, `${label}.outcomes`),
    conditions: textList(value.conditions, `${label}.conditions`),
    exclusions: textList(value.exclusions, `${label}.exclusions`),
    implementations: textList(value.implementations, `${label}.implementations`),
    evidenceIds: textList(value.evidenceIds, `${label}.evidenceIds`),
    assessment: assessment(value.assessment, `${label}.assessment`),
    uncertainty: textList(value.uncertainty, `${label}.uncertainty`),
    claims,
  }
}

function normalizeEdge(value: unknown, index: number): CandidateEdge {
  const label = `graph.edges[${index}]`
  if (!record(value)) throw new Error(`${label} must be an object.`)
  return {
    ...value,
    from: requiredText(value.from, `${label}.from`),
    to: requiredText(value.to, `${label}.to`),
    type: requiredText(value.type, `${label}.type`),
    reason: requiredText(value.reason, `${label}.reason`),
    evidenceIds: textList(value.evidenceIds, `${label}.evidenceIds`),
    assessment: assessment(value.assessment, `${label}.assessment`),
  }
}

async function verifyReviewNotes(
  value: unknown,
  rawGraph: JsonRecord,
  nodes: CandidateNode[],
  sourceIds: Set<string>,
) {
  if (!record(value)) throw new Error('reviewNotes must be an object.')
  const allowedRootKeys = ['graphSha256', 'notes']
  if (Object.keys(value).some((key) => !allowedRootKeys.includes(key))) {
    throw new Error('reviewNotes contains an unsupported field.')
  }
  const graphSha256 = requiredText(value.graphSha256, 'reviewNotes.graphSha256')
  if (!/^[a-f0-9]{64}$/.test(graphSha256)) throw new Error('reviewNotes.graphSha256 must be a SHA-256 digest.')
  if (!Array.isArray(value.notes)) throw new Error('reviewNotes.notes must be a list.')
  const actual = await sha256Json(rawGraph)
  if (actual !== graphSha256) throw new Error('Review notes do not match this candidate graph.')

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const targets = new Set<string>()
  const allowedFields = new Set(['summary', 'conditions', 'claims'])
  const allowedStatuses = new Set(['qualified', 'disputed', 'unresolved'])
  const allowedBases = new Set(['proposer-disclosed', 'source-review', 'owner-feedback'])
  value.notes.forEach((entry, index) => {
    const label = `reviewNotes.notes[${index}]`
    if (!record(entry)) throw new Error(`${label} must be an object.`)
    const expectedKeys = ['nodeId', 'field', 'expectedText', 'status', 'basis', 'message', 'evidenceIds', 'index']
    if (Object.keys(entry).some((key) => !expectedKeys.includes(key))) {
      throw new Error(`${label} contains an unsupported field.`)
    }
    const nodeId = requiredText(entry.nodeId, `${label}.nodeId`)
    const field = requiredText(entry.field, `${label}.field`)
    const expectedText = requiredText(entry.expectedText, `${label}.expectedText`)
    const status = requiredText(entry.status, `${label}.status`)
    const basis = requiredText(entry.basis, `${label}.basis`)
    requiredText(entry.message, `${label}.message`)
    if (!allowedFields.has(field) || !allowedStatuses.has(status) || !allowedBases.has(basis)) {
      throw new Error(`${label} has an unsupported field, status, or basis.`)
    }
    const node = nodeById.get(nodeId)
    if (!node) throw new Error(`${label} points to a missing capability.`)
    let targetText: string | undefined
    if (field === 'summary') {
      if (Object.hasOwn(entry, 'index')) throw new Error(`${label}.index is only valid for conditions or claims.`)
      targetText = node.summary
    } else {
      if (!Number.isSafeInteger(entry.index) || (entry.index as number) < 0) {
        throw new Error(`${label}.index must be a non-negative integer.`)
      }
      targetText = field === 'conditions' ? node.conditions[entry.index as number] : node.claims[entry.index as number]?.text
    }
    if (targetText !== expectedText) throw new Error(`${label} no longer matches its claim text.`)
    const targetKey = JSON.stringify([nodeId, field, field === 'summary' ? null : entry.index])
    if (targets.has(targetKey)) throw new Error(`${label} duplicates another review target.`)
    targets.add(targetKey)
    const evidenceIds = textList(entry.evidenceIds, `${label}.evidenceIds`)
    if (evidenceIds.length === 0 || new Set(evidenceIds).size !== evidenceIds.length
      || evidenceIds.some((id) => !sourceIds.has(id))) {
      throw new Error(`${label}.evidenceIds must name unique source receipts.`)
    }
  })
}

async function verifyReviewHistory(value: unknown, rawGraph: JsonRecord, commitSha: string, sourceIds: Set<string>) {
  if (!record(value) || value.schemaVersion !== 'repository-review-history/1' || value.status !== 'historical-only') {
    throw new Error('reviewHistory must use the historical-only review schema.')
  }
  if (value.currentMapReviewed !== false || !Array.isArray(value.inheritedApprovals) || value.inheritedApprovals.length !== 0) {
    throw new Error('Historical review notes cannot grant current approval.')
  }
  const shaPattern = /^[a-f0-9]{64}$/
  if (typeof value.sourceGraphSha256 !== 'string' || !shaPattern.test(value.sourceGraphSha256)
    || typeof value.targetGraphSha256 !== 'string' || !shaPattern.test(value.targetGraphSha256)
    || typeof value.entriesSha256 !== 'string' || !shaPattern.test(value.entriesSha256)) {
    throw new Error('reviewHistory graph and entry digests must be SHA-256 values.')
  }
  if (value.targetCommitSha !== commitSha || !Array.isArray(value.entries) || typeof value.limitation !== 'string') {
    throw new Error('reviewHistory does not match this map revision.')
  }
  if (await sha256Json(rawGraph) !== value.targetGraphSha256 || await sha256Json(value.entries) !== value.entriesSha256) {
    throw new Error('reviewHistory digest does not match its current map or entries.')
  }
  const statuses = new Set(['qualified', 'disputed', 'unresolved'])
  const bases = new Set(['proposer-disclosed', 'source-review', 'owner-feedback'])
  const dispositions = new Set(['historical-review-linked', 'reviewed-node-has-no-successor'])
  const correspondences = new Set(['single-successor', 'multiple-successors', 'merged-successor'])
  const contentStatuses = new Set(['unchanged', 'changed', 'absent'])
  const relationStatuses = new Set(['unchanged', 'changed', 'ambiguous'])
  value.entries.forEach((entry, index) => {
    const label = `reviewHistory.entries[${index}]`
    if (!record(entry) || !record(entry.note) || !Array.isArray(entry.projections)) {
      throw new Error(`${label} must contain a note and projection list.`)
    }
    const note = entry.note
    const nodeId = requiredText(entry.sourceNodeId, `${label}.sourceNodeId`)
    if (note.nodeId !== nodeId || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(entry.sourceCommitSha))) {
      throw new Error(`${label} has an invalid earlier revision binding.`)
    }
    if (!['summary', 'conditions', 'claims'].includes(String(note.field))
      || !requiredText(note.expectedText, `${label}.note.expectedText`)
      || !requiredText(note.message, `${label}.note.message`)
      || !statuses.has(String(note.status)) || !bases.has(String(note.basis))) {
      throw new Error(`${label} has an invalid historical review note.`)
    }
    if (note.field === 'summary' ? Object.hasOwn(note, 'index') : !Number.isSafeInteger(note.index) || (note.index as number) < 0) {
      throw new Error(`${label}.note has an invalid field index.`)
    }
    const evidenceIds = textList(note.evidenceIds, `${label}.note.evidenceIds`)
    if (!evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some((id) => !sourceIds.has(id))) {
      throw new Error(`${label}.note must cite unique source receipts from the historical record.`)
    }
    if (!dispositions.has(String(entry.disposition))) throw new Error(`${label} has an invalid historical disposition.`)
    const seenProjectionIds = new Set<string>()
    entry.projections.forEach((projection, projectionIndex) => {
      const projectionLabel = `${label}.projections[${projectionIndex}]`
      if (!record(projection)) throw new Error(`${projectionLabel} must be an object.`)
      const id = requiredText(projection.nodeId, `${projectionLabel}.nodeId`)
      if (seenProjectionIds.has(id)) throw new Error(`${projectionLabel} repeats a successor.`)
      seenProjectionIds.add(id)
      if (!correspondences.has(String(projection.correspondence)) || !contentStatuses.has(String(projection.contentStatus))
        || !relationStatuses.has(String(projection.incidentRelationships))
        || (projection.currentText !== null && typeof projection.currentText !== 'string')) {
        throw new Error(`${projectionLabel} has an invalid successor comparison.`)
      }
    })
  })
}

/** Validate imported JSON before the UI exposes any of its fields. */
export async function parseCandidateMapArtifact(value: unknown): Promise<CandidateMapArtifact> {
  if (!record(value)) throw new Error('The selected file must contain a JSON object.')
  if (!record(value.graph)) throw new Error('Candidate graph is missing.')
  if (!Array.isArray(value.graph.nodes) || !Array.isArray(value.graph.edges)) {
    throw new Error('Candidate graph must contain nodes and edges lists.')
  }
  if (!Array.isArray(value.receipts) || !value.receipts.every(record)) {
    throw new Error('Artifact receipts must be a list of objects.')
  }
  const displayName = requiredText(value.displayName, 'displayName')
  const commitSha = optionalText(value.commitSha, 'commitSha')
  const mode = optionalText(value.mode, 'mode')
  const nodes = value.graph.nodes.map(normalizeNode)
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Candidate graph repeats capability ID “${node.id}”.`)
    nodeIds.add(node.id)
  }
  const edges = value.graph.edges.map(normalizeEdge)
  const edgeKeys = new Set<string>()
  for (const edge of edges) {
    if (edge.from === edge.to) throw new Error(`Relationship “${edge.type}” cannot point to itself.`)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Relationship “${edge.type}” points to a missing capability.`)
    }
    const key = JSON.stringify([edge.from, edge.to, edge.type])
    if (edgeKeys.has(key)) throw new Error(`Candidate graph repeats relationship “${edge.type}”.`)
    edgeKeys.add(key)
  }

  const receiptIds = new Set<string>()
  const warnings: string[] = []
  value.receipts.forEach((receipt, index) => {
    const id = requiredText(receipt.id, `receipts[${index}].id`)
    if (receiptIds.has(id)) throw new Error(`Artifact repeats receipt ID “${id}”.`)
    receiptIds.add(id)
  })
  const history = record(value.history) ? value.history : null
  const historyReceipts = history ? recordList(history.receipts, 'history.receipts') : []
  const allReceiptIds = new Set(receiptIds)
  historyReceipts.forEach((receipt, index) => {
    const id = requiredText(receipt.id, `history.receipts[${index}].id`)
    if (allReceiptIds.has(id)) warnings.push(`Receipt ID “${id}” appears in more than one evidence plane.`)
    allReceiptIds.add(id)
  })
  const citedIds = new Set<string>()
  for (const node of nodes) {
    node.evidenceIds.forEach((id) => citedIds.add(id))
    node.claims.forEach((claim) => claim.evidenceIds.forEach((id) => citedIds.add(id)))
  }
  for (const edge of edges) edge.evidenceIds.forEach((id) => citedIds.add(id))
  const unknownCitations = [...citedIds].filter((id) => !allReceiptIds.has(id))
  if (unknownCitations.length) warnings.push(`${unknownCitations.length} cited evidence ID${unknownCitations.length === 1 ? '' : 's'} have no receipt in this artifact.`)

  if (Object.hasOwn(value, 'independentVerification') && value.independentVerification !== 'not-performed') {
    throw new Error('Artifact has an unsupported independent verification status.')
  }
  if (Object.hasOwn(value, 'reviewNotes')) {
    await verifyReviewNotes(
      value.reviewNotes,
      value.graph,
      nodes,
      new Set(value.receipts.filter((receipt) => receipt.kind === 'source').map((receipt) => String(receipt.id))),
    )
  }
  if (Object.hasOwn(value, 'reviewHistory')) {
    await verifyReviewHistory(value.reviewHistory, value.graph, commitSha, new Set(value.receipts.filter((receipt) => receipt.kind === 'source').map((receipt) => String(receipt.id))))
  }

  return {
    ...value,
    displayName,
    commitSha,
    mode,
    graph: { ...value.graph, nodes, edges },
    receipts: value.receipts,
    historyReceipts,
    warnings,
  }
}

export async function parseCandidateMapText(text: string): Promise<CandidateMapArtifact> {
  if (!text.trim()) throw new Error('The selected file is empty.')
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }
  return parseCandidateMapArtifact(value)
}

/** Map links can fetch a same-origin route only. External, data, and script URLs are refused. */
export function resolveLocalMapUrl(value: string, baseHref: string): string {
  const raw = value.trim()
  if (!raw || /[\\\u0000-\u001f]/.test(raw) || raw.includes('?') || raw.includes('#')) {
    throw new Error('Use a local artifact path without query or fragment text.')
  }
  if (raw.startsWith('//')) throw new Error('Map links must stay on this site.')
  const base = new URL(baseHref)
  let target: URL
  if (raw.startsWith('/')) {
    target = new URL(raw, base)
  } else if (/^https?:\/\//i.test(raw)) {
    target = new URL(raw)
  } else {
    throw new Error('Use a same-origin path such as /maps/output.json.')
  }
  if (target.origin !== base.origin || target.protocol !== base.protocol || target.username || target.password) {
    throw new Error('Map links must stay on this site.')
  }
  if (!target.pathname.toLowerCase().endsWith('.json')) {
    throw new Error('Choose an output.json or reviewed-output.json route.')
  }
  return target.href
}

export function asRecord(value: unknown): JsonRecord | null {
  return record(value) ? value : null
}

export function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function safeTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Receipt provenance comes from the saved contract, never from the claim citing it. */
export function receiptProvenance(kind: unknown): { label: string; observed: boolean } {
  switch (kind) {
    case 'search': return { label: 'Observed source search (navigation only)', observed: true }
    case 'source': return { label: 'Observed source receipt', observed: true }
    case 'commit-meta': return { label: 'Observed commit metadata', observed: true }
    case 'diff': return { label: 'Observed Git diff', observed: true }
    case 'path-history': return { label: 'Observed path history', observed: true }
    case 'commit-reading': return { label: 'Cached candidate reading', observed: false }
    case 'prior-map': return { label: 'Earlier candidate map', observed: false }
    default: return { label: 'Unclassified receipt', observed: false }
  }
}
