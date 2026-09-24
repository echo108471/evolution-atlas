import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import {
  asRecord,
  parseCandidateMapText,
  resolveLocalMapUrl,
  safeText,
  safeTextList,
  type CandidateEdge,
  type CandidateMapArtifact,
  type CandidateNode,
  type JsonRecord,
} from './repositoryMap'

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const ARTIFACT_SIZE_MESSAGE = 'This artifact exceeds the browser’s 64 MB map limit.'

interface RepositoryMapExplorerProps {
  sourceUrl: string | null
  onSourceUrl: (value: string) => void
  onBack: () => void
}

function recordList(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => Boolean(asRecord(entry))) : []
}

function joinedText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2) ?? 'Details are unavailable.'
  } catch {
    return 'Details are unavailable.'
  }
}

function displayItems(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (!Array.isArray(value)) return value == null ? [] : [joinedText(value)]
  return value.map((item) => typeof item === 'string' ? item : joinedText(item))
}

function metric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '—'
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ARTIFACT_BYTES) {
    throw new Error(ARTIFACT_SIZE_MESSAGE)
  }
  if (!response.body) {
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > MAX_ARTIFACT_BYTES) throw new Error(ARTIFACT_SIZE_MESSAGE)
    return body
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_ARTIFACT_BYTES) {
        await reader.cancel()
        throw new Error(ARTIFACT_SIZE_MESSAGE)
      }
      chunks.push(value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    throw cause
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function ObjectDetails({ value, label }: { value: unknown; label: string }) {
  if (value === undefined || value === null) return null
  return (
    <details className="map-raw-details">
      <summary>{label}</summary>
      <pre>{joinedText(value)}</pre>
    </details>
  )
}

function EvidenceLinks({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  if (ids.length === 0) return <span className="map-no-citation">No source receipt cited.</span>
  return (
    <ul className="map-evidence-links" aria-label="Cited evidence receipts">
      {ids.map((id, index) => (
        <li key={`${id}:${index}`}>
          <button type="button" onClick={() => onSelect(id)}>{id}</button>
        </li>
      ))}
    </ul>
  )
}

function ReviewNote({
  note,
  onSelectEvidence,
}: {
  note: JsonRecord
  onSelectEvidence: (id: string) => void
}) {
  const evidenceIds = safeTextList(note.evidenceIds)
  return (
    <aside className="map-review-note" aria-label="Claim-local review note">
      <div className="map-note-title">
        <strong>Review note</strong>
        <span>{safeText(note.status, 'unresolved')}</span>
        <span>{safeText(note.basis, 'basis not recorded')}</span>
      </div>
      {typeof note.expectedText === 'string' && <blockquote>{note.expectedText}</blockquote>}
      {typeof note.message === 'string' && <p>{note.message}</p>}
      <p className="map-review-boundary">A recorded review assertion does not establish runtime behavior or independent verification.</p>
      <EvidenceLinks ids={evidenceIds} onSelect={onSelectEvidence} />
    </aside>
  )
}

function FieldList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <section className="map-detail-section">
      <h3>{title}</h3>
      <ul className="map-copy-list">
        {values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}
      </ul>
    </section>
  )
}

function CandidateClaimView({
  node,
  index,
  notes,
  onSelectEvidence,
}: {
  node: CandidateNode
  index: number
  notes: JsonRecord[]
  onSelectEvidence: (id: string) => void
}) {
  const note = notes.find((entry) => entry.nodeId === node.id && entry.field === 'claims' && entry.index === index)
  return (
    <div className="map-claim">
      <p>{node.claims[index].text}</p>
      <div className="map-claim-meta">
        <span>Proposer assessment: {node.claims[index].assessment}</span>
        <span>Independent verification: not performed</span>
      </div>
      <EvidenceLinks ids={node.claims[index].evidenceIds} onSelect={onSelectEvidence} />
      {note && <ReviewNote note={note} onSelectEvidence={onSelectEvidence} />}
    </div>
  )
}

function CitationRow({
  ids,
  notes,
  nodeId,
  field,
  index,
  onSelectEvidence,
}: {
  ids: string[]
  notes: JsonRecord[]
  nodeId: string
  field: string
  index?: number
  onSelectEvidence: (id: string) => void
}) {
  const note = notes.find((entry) => entry.nodeId === nodeId && entry.field === field && entry.index === index)
  return (
    <>
      <EvidenceLinks ids={ids} onSelect={onSelectEvidence} />
      {note && <ReviewNote note={note} onSelectEvidence={onSelectEvidence} />}
    </>
  )
}

function CapabilityDetail({
  node,
  relatedEdges,
  notes,
  onSelectNode,
  onSelectEvidence,
}: {
  node: CandidateNode
  relatedEdges: CandidateEdge[]
  notes: JsonRecord[]
  onSelectNode: (id: string) => void
  onSelectEvidence: (id: string) => void
}) {
  const summaryNote = notes.find((entry) => entry.nodeId === node.id && entry.field === 'summary')
  return (
    <article className="map-capability-detail" aria-labelledby="map-capability-title">
      <header className="map-capability-heading">
        <div>
          <p className="map-kicker">Candidate capability</p>
          <h2 id="map-capability-title">{node.name}</h2>
        </div>
        <span className={`map-assessment map-assessment--${node.assessment}`}>{node.assessment}</span>
      </header>
      <p className="map-capability-summary">{node.summary}</p>
      <div className="map-claim-meta">
        <span>{node.id}</span>
        <span>Independent verification: not performed</span>
      </div>
      {summaryNote && <ReviewNote note={summaryNote} onSelectEvidence={onSelectEvidence} />}
      {node.actor && (
        <section className="map-detail-section">
          <h3>Actor or caller</h3>
          <p>{node.actor}</p>
        </section>
      )}
      <FieldList title="Inputs" values={node.inputs} />
      <FieldList title="Observable outcomes" values={node.outcomes} />
      <section className="map-detail-section">
        <h3>Conditions</h3>
        {node.conditions.length ? (
          <ol className="map-copy-list">
            {node.conditions.map((condition, index) => {
              const note = notes.find((entry) => entry.nodeId === node.id && entry.field === 'conditions' && entry.index === index)
              return (
                <li key={`${index}:${condition}`}>
                  <span>{condition}</span>
                  {note && <ReviewNote note={note} onSelectEvidence={onSelectEvidence} />}
                </li>
              )
            })}
          </ol>
        ) : <p className="map-empty-field">No condition was recorded.</p>}
      </section>
      <FieldList title="Implementations" values={node.implementations} />
      <FieldList title="Outside this scope" values={node.exclusions} />
      <FieldList title="Uncertainty" values={node.uncertainty} />
      <section className="map-detail-section">
        <h3>Candidate evidence</h3>
        <p>These source receipts were cited for the candidate definition.</p>
        <CitationRow
          ids={node.evidenceIds}
          notes={notes}
          nodeId={node.id}
          field="summary"
          onSelectEvidence={onSelectEvidence}
        />
      </section>
      {node.claims.length > 0 && (
        <section className="map-detail-section">
          <h3>Specific claims</h3>
          <ol className="map-claims">
            {node.claims.map((claim, index) => (
              <li key={`${index}:${claim.text}`}>
                <CandidateClaimView node={node} index={index} notes={notes} onSelectEvidence={onSelectEvidence} />
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="map-detail-section">
        <div className="map-section-heading">
          <div>
            <p className="map-kicker">Edges touching this node</p>
            <h3>Candidate relationships</h3>
          </div>
          <span>{relatedEdges.length}</span>
        </div>
        {relatedEdges.length ? (
          <ul className="map-relationships">
            {relatedEdges.map((edge, index) => (
              <li key={`${edge.from}:${edge.type}:${edge.to}:${index}`}>
                <div className="map-edge-nodes">
                  <button type="button" onClick={() => onSelectNode(edge.from)} aria-label={`Open ${edge.from}`}>
                    {edge.from === node.id ? node.name : edge.from}
                  </button>
                  <span>{edge.type.replaceAll('_', ' ')}</span>
                  <button type="button" onClick={() => onSelectNode(edge.to)} aria-label={`Open ${edge.to}`}>
                    {edge.to === node.id ? node.name : edge.to}
                  </button>
                </div>
                <p>{edge.reason}</p>
                <div className="map-claim-meta">
                  <span>Proposer assessment: {edge.assessment}</span>
                  <span>Independent verification: not performed</span>
                </div>
                <EvidenceLinks ids={edge.evidenceIds} onSelect={onSelectEvidence} />
              </li>
            ))}
          </ul>
        ) : <p className="map-empty-field">No relationship was proposed for this capability.</p>}
      </section>
    </article>
  )
}

function EvidenceInspector({ receipt, missingId }: { receipt: JsonRecord | null; missingId: string | null }) {
  if (!receipt && missingId) {
    return (
      <section className="map-evidence-inspector" aria-label="Evidence detail">
        <p className="map-kicker">Receipt unavailable</p>
        <h2>{missingId}</h2>
        <p>This citation is recorded, but its receipt body is not included in the artifact you opened.</p>
      </section>
    )
  }
  if (!receipt) {
    return (
      <section className="map-evidence-inspector" aria-label="Evidence detail">
        <p className="map-kicker">Evidence detail</p>
        <h2>Select a receipt</h2>
        <p>Choose a source reference to inspect its saved text and Git metadata.</p>
      </section>
    )
  }
  const kind = safeText(receipt.kind, 'receipt')
  const path = safeText(receipt.path)
  const text = safeText(receipt.text)
  const commitSha = safeText(receipt.commitSha)
  const startLine = receipt.startLine
  const endLine = receipt.endLine
  return (
    <section className="map-evidence-inspector" aria-label="Evidence detail">
      <p className="map-kicker">{kind === 'source' ? 'Observed source receipt' : 'History receipt'}</p>
      <h2>{safeText(receipt.id, 'Evidence')}</h2>
      <dl className="map-evidence-facts">
        {path && <div><dt>Path</dt><dd><code>{path}</code></dd></div>}
        {commitSha && <div><dt>Commit</dt><dd><code>{commitSha}</code></dd></div>}
        {typeof startLine === 'number' && <div><dt>Saved lines</dt><dd>{startLine}{typeof endLine === 'number' ? `–${endLine}` : ''}</dd></div>}
        {safeText(receipt.subject) && <div><dt>Subject</dt><dd>{safeText(receipt.subject)}</dd></div>}
        {safeText(receipt.tier) && <div><dt>Reading tier</dt><dd>{safeText(receipt.tier)}</dd></div>}
      </dl>
      {text ? (
        <pre className="map-source-text">{text}</pre>
      ) : (
        <p className="map-empty-field">This receipt has metadata but no saved body in this artifact.</p>
      )}
      <p className="map-review-boundary">A citation points to recorded material; it does not establish that the material supports the interpretation.</p>
      <ObjectDetails value={receipt.payload} label="Receipt payload" />
      <ObjectDetails value={receipt.omitted} label="Fields omitted from this receipt" />
    </section>
  )
}

function RevisionTransition({ transition }: { transition: JsonRecord }) {
  const count = (key: string) => recordList(transition[key]).length
  const rows = [
    ['Added paths', 'added', 'map-added'],
    ['Changed paths', 'changed', 'map-changed'],
    ['Unchanged paths', 'unchanged', 'map-unchanged'],
    ['Deleted paths', 'deleted', 'map-deleted'],
  ] as const
  return (
    <section className="map-history-section">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Observed Git transition</p>
          <h2>What changed between revisions</h2>
        </div>
        <span>{safeText(transition.relation, 'comparison')}</span>
      </div>
      <div className="map-revision-range">
        <code>{safeText(transition.fromCommitSha, 'Earlier revision unavailable')}</code>
        <span aria-hidden="true">to</span>
        <code>{safeText(transition.toCommitSha, 'Current revision unavailable')}</code>
      </div>
      <div className="map-transition-grid">
        {rows.map(([label, key, className]) => {
          const items = recordList(transition[key])
          return (
            <section key={key} className={`map-transition-column ${className}`}>
              <h3>{label}<span>{count(key)}</span></h3>
              {items.length ? (
                <ul>{items.map((entry, index) => (
                  <li key={`${safeText(entry.path, 'path')}:${index}`}>
                    <code>{safeText(entry.path, 'Path not recorded')}</code>
                    {(safeText(entry.fromBlobSha) || safeText(entry.toBlobSha) || safeText(entry.blobSha)) && (
                      <small>{safeText(entry.fromBlobSha)}{entry.fromBlobSha && entry.toBlobSha ? ' → ' : ''}{safeText(entry.toBlobSha || entry.blobSha)}</small>
                    )}
                  </li>
                ))}</ul>
              ) : <p>No paths in this category.</p>}
            </section>
          )
        })}
      </div>
      {displayItems(transition.omissions).length > 0 && (
        <div className="map-history-omissions">
          <h3>History omissions</h3>
          <ul>{displayItems(transition.omissions).map((omission, index) => <li key={`${index}:${omission}`}>{omission}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

function HistoryLineage({
  history,
  onSelectEvidence,
}: {
  history: JsonRecord
  onSelectEvidence: (id: string) => void
}) {
  const rows = recordList(history.lineage)
  const edgeRows = recordList(history.edgeLineage)
  const omissions = displayItems(history.omissions)
  if (rows.length === 0 && edgeRows.length === 0 && omissions.length === 0) return null
  const renderLineage = (entry: JsonRecord, index: number, label: string) => {
    const from = asRecord(entry.from)
    const successors = recordList(entry.to)
    const formatReference = (reference: JsonRecord, isEdge: boolean) => {
      const revision = safeText(reference.commitSha, 'revision unavailable')
      if (isEdge && typeof reference.from === 'string' && typeof reference.to === 'string') {
        return `${revision} · ${reference.from} — ${safeText(reference.type, 'relationship')} → ${reference.to}`
      }
      return `${revision} · ${safeText(reference.nodeId, 'capability unavailable')}`
    }
    return (
      <li key={`${label}:${safeText(entry.id, String(index))}`}>
        <div className="map-lineage-title">
          <strong>{safeText(entry.decision, 'Disposition not recorded')}</strong>
          <span>Proposer assessment: {safeText(entry.assessment, 'unresolved')}</span>
        </div>
        {typeof entry.claim === 'string' && <blockquote>{entry.claim}</blockquote>}
        <p>
          {from ? formatReference(from, label === 'relationship') : 'No predecessor mapping'}
          {' → '}
          {successors.length ? successors.map((target) => formatReference(target, label === 'relationship')).join('; ') : 'no successor'}
        </p>
        {typeof entry.reason === 'string' && <p>{entry.reason}</p>}
        <EvidenceLinks ids={safeTextList(entry.evidenceIds)} onSelect={onSelectEvidence} />
      </li>
    )
  }
  return (
    <section className="map-history-section">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Candidate interpretation lineage</p>
          <h2>Capabilities across revisions</h2>
        </div>
        <span>candidate interpretation</span>
      </div>
      {rows.length > 0 && <ol className="map-lineage-list">{rows.map((entry, index) => renderLineage(entry, index, 'capability'))}</ol>}
      {edgeRows.length > 0 && (
        <details className="map-lineage-edges">
          <summary>Relationship lineage · {edgeRows.length}</summary>
          <ol className="map-lineage-list">{edgeRows.map((entry, index) => renderLineage(entry, index, 'relationship'))}</ol>
        </details>
      )}
      {omissions.length > 0 && (
        <div className="map-history-omissions">
          <h3>History omissions</h3>
          <ul>{omissions.map((omission, index) => <li key={`${index}:${omission}`}>{omission}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

function ReviewHistory({
  reviewHistory,
  onSelectEvidence,
}: {
  reviewHistory: JsonRecord
  onSelectEvidence: (id: string) => void
}) {
  const entries = recordList(reviewHistory.entries)
  if (entries.length === 0) return null
  return (
    <section className="map-history-section map-review-history">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Historical review context</p>
          <h2>Earlier claim-local notes</h2>
        </div>
        <span>historical only</span>
      </div>
      <p className="map-history-boundary">Earlier notes stay attached to the earlier revision. Their projections do not approve or verify the current map, even when wording is unchanged.</p>
      <ol className="map-lineage-list">
        {entries.map((entry, index) => {
          const note = asRecord(entry.note)
          const projections = recordList(entry.projections)
          const fromCommitSha = safeText(entry.sourceCommitSha, safeText(asRecord(entry.from)?.commitSha, 'Earlier revision'))
          return (
            <li key={`${safeText(entry.id, String(index))}:${index}`}>
              <div className="map-lineage-title">
                <strong>{safeText(entry.disposition, 'Historical note')}</strong>
                <span>{fromCommitSha}</span>
              </div>
              {note && <ReviewNote note={note} onSelectEvidence={onSelectEvidence} />}
              {projections.length > 0 && (
                <ul className="map-projections">
                  {projections.map((projection, projectionIndex) => (
                    <li key={`${safeText(projection.nodeId, String(projectionIndex))}:${projectionIndex}`}>
                      <strong>{safeText(projection.nodeId, 'Successor')}</strong>
                      <span>{safeText(projection.correspondence, 'mapping not classified')}</span>
                      <span>Text: {safeText(projection.contentStatus, 'unknown')}</span>
                      {typeof projection.currentText === 'string' && <blockquote>{projection.currentText}</blockquote>}
                      <span>Relationships: {safeText(projection.incidentRelationships, 'not compared')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {safeText(entry.reason) && <p>{safeText(entry.reason)}</p>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function CoverageSection({ artifact }: { artifact: CandidateMapArtifact }) {
  const coverage = asRecord(artifact.coverage)
  const proposals = recordList(artifact.proposals)
  const limitations = [...displayItems(artifact.limitations), ...displayItems(asRecord(artifact.graph)?.limitations)]
  const topOmissions = [
    ...displayItems(asRecord(artifact.coverage)?.omissions),
    ...displayItems(artifact.omissions),
  ]
  const coverageEntries = coverage ? Object.entries(coverage).filter(([key]) => key !== 'omissions') : []
  return (
    <section className="map-history-section map-coverage-section">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Scope record</p>
          <h2>Coverage and omissions</h2>
        </div>
      </div>
      {coverageEntries.length > 0 ? (
        <dl className="map-coverage-metrics">
          {coverageEntries.map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}</dt>
              <dd>{typeof value === 'number' || typeof value === 'string' ? String(value) : joinedText(value)}</dd>
            </div>
          ))}
        </dl>
      ) : <p>No aggregate coverage record was included.</p>}
      {topOmissions.length > 0 && (
        <div className="map-history-omissions">
          <h3>Recorded omissions</h3>
          <ul>{topOmissions.map((omission, index) => <li key={`${index}:${omission}`}>{omission}</li>)}</ul>
        </div>
      )}
      {proposals.map((proposal, index) => {
        const proposalCoverage = asRecord(proposal.coverage)
        const proposalOmissions = displayItems(proposalCoverage?.omissions)
        return (
          <details className="map-assignment" key={`${safeText(proposal.agent, String(index))}:${index}`}>
            <summary>{safeText(proposal.agent, `Assignment ${index + 1}`)} · scope and omissions</summary>
            {safeText(proposal.scopeSummary) && <p>{safeText(proposal.scopeSummary)}</p>}
            {proposalOmissions.length > 0 && <ul>{proposalOmissions.map((item, itemIndex) => <li key={`${itemIndex}:${item}`}>{item}</li>)}</ul>}
            <ObjectDetails value={proposalCoverage} label="Full assignment coverage record" />
          </details>
        )
      })}
      {limitations.length > 0 && (
        <div className="map-history-omissions">
          <h3>Limitations</h3>
          <ul>{limitations.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>
        </div>
      )}
      {artifact.warnings.map((warning, index) => <p className="map-validation-warning" key={`${index}:${warning}`}>{warning}</p>)}
    </section>
  )
}

function MapError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="map-error" role="alert">
      <div><strong>Map could not be opened.</strong><p>{message}</p></div>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}

export function RepositoryMapExplorer({ sourceUrl, onSourceUrl, onBack }: RepositoryMapExplorerProps) {
  const [artifact, setArtifact] = useState<CandidateMapArtifact | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [routeInput, setRouteInput] = useState(sourceUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRouteInput(sourceUrl ?? '')
  }, [sourceUrl])

  useEffect(() => {
    if (!sourceUrl) return
    const controller = new AbortController()
    setArtifact(null)
    setSelectedEvidenceId(null)
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        const url = resolveLocalMapUrl(sourceUrl, window.location.href)
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: 'omit',
          mode: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`The local route returned ${response.status}.`)
        const body = await readLimitedResponseText(response)
        const loaded = await parseCandidateMapText(body)
        if (!controller.signal.aborted) {
          setArtifact(loaded)
          setSelectedNodeId(loaded.graph.nodes[0]?.id ?? null)
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The local artifact could not be read.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [sourceUrl])

  const nodes = artifact?.graph.nodes ?? []
  const edges = artifact?.graph.edges ?? []
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null
  const receipts = artifact ? [...artifact.receipts, ...artifact.historyReceipts] : []
  const evidenceById = useMemo(() => {
    const indexed = new Map<string, JsonRecord>()
    receipts.forEach((receipt) => {
      if (typeof receipt.id === 'string' && !indexed.has(receipt.id)) indexed.set(receipt.id, receipt)
    })
    return indexed
  }, [artifact])
  const selectedReceipt = selectedEvidenceId ? evidenceById.get(selectedEvidenceId) ?? null : null
  const relatedEdges = selectedNode ? edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id) : []
  const query = filter.trim().toLocaleLowerCase()
  const filteredNodes = query
    ? nodes.filter((node) => `${node.name} ${node.id} ${node.summary} ${node.outcomes.join(' ')}`.toLocaleLowerCase().includes(query))
    : nodes
  const reviewNotes = recordList(asRecord(artifact?.reviewNotes)?.notes)
  const history = asRecord(artifact?.history)
  const transition = asRecord(history?.transition)
  const reviewHistory = asRecord(artifact?.reviewHistory)
  const coverage = asRecord(artifact?.coverage)

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError(null)
    setLoading(true)
    try {
      if (file.size > MAX_ARTIFACT_BYTES) throw new Error(ARTIFACT_SIZE_MESSAGE)
      const body = await file.text()
      const loaded = await parseCandidateMapText(body)
      setArtifact(loaded)
      setSelectedNodeId(loaded.graph.nodes[0]?.id ?? null)
      setSelectedEvidenceId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected file is not valid candidate map JSON.')
    } finally {
      setLoading(false)
    }
  }

  function loadRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const resolved = resolveLocalMapUrl(routeInput, window.location.href)
      onSourceUrl(resolved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid same-origin JSON route.')
    }
  }

  return (
    <main className="app-shell map-shell">
      <header className="map-app-header">
        <button type="button" className="product-brand" onClick={onBack}>
          <span className="brand-mark">EVOLUTION ATLAS</span>
          <strong>Candidate capability map</strong>
        </button>
        <button type="button" className="map-back-button" onClick={onBack}>Back to the atlas</button>
      </header>

      <header className="map-page-heading">
        <div>
          <p className="map-kicker">Capabilities · evidence · change</p>
          <h1>{artifact ? artifact.displayName : 'Open a candidate map'}</h1>
          <p>Inspect how an engine output connects capability claims, inspected source and history. Imported files stay in this browser session.</p>
        </div>
        {artifact && (
          <div className="map-snapshot-meta">
            <span>{artifact.mode || 'candidate snapshot'}</span>
            {artifact.commitSha && <code>{artifact.commitSha}</code>}
          </div>
        )}
      </header>

      <section className="map-trust-panel" aria-label="Evidence boundaries">
        <div>
          <span className="map-trust-mark map-trust-mark--observed" aria-hidden="true">G</span>
          <p><strong>Observed Git</strong><br />Commit, path, blob and saved source or history receipts.</p>
        </div>
        <div>
          <span className="map-trust-mark map-trust-mark--candidate" aria-hidden="true">C</span>
          <p><strong>Candidate interpretation</strong><br />Capabilities, claims, relationships and dispositions proposed from that evidence.</p>
        </div>
        <p className="map-verification-state">Independent verification: not performed</p>
      </section>

      <section className="map-open-tools" aria-label="Open a candidate map">
        <div className="map-file-action">
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void openFile(event)}
            aria-label="Choose output.json or reviewed-output.json"
          />
          <button type="button" className="map-primary-action" onClick={() => fileInput.current?.click()}>
            Choose output.json
          </button>
          <span>or reviewed-output.json from a local run</span>
        </div>
        <form className="map-route-form" onSubmit={loadRoute}>
          <label htmlFor="map-local-route">Map path on this site</label>
          <div>
            <input
              id="map-local-route"
              type="text"
              inputMode="url"
              placeholder="/maps/output.json"
              value={routeInput}
              onChange={(event) => setRouteInput(event.currentTarget.value)}
              aria-describedby="map-route-help"
            />
            <button type="submit">Open map</button>
          </div>
          <small id="map-route-help">Map links are read from this site. File imports are never uploaded.</small>
        </form>
      </section>

      {error && <MapError message={error} onDismiss={() => setError(null)} />}
      {loading && <p className="map-loading" role="status">Reading the candidate map…</p>}

      {!artifact && !loading && (
        <section className="map-empty-screen">
          <div className="map-empty-glyph" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <p className="map-kicker">No map loaded</p>
            <h2>Start from the engine output.</h2>
            <p>Choose <code>output.json</code> for the candidate graph or <code>reviewed-output.json</code> to include claim-local notes. The map remains usable without an atlas dataset.</p>
            <p>Nothing is sent anywhere. The file is read in memory and is not added to the gallery.</p>
          </div>
        </section>
      )}

      {artifact && (
        <>
          <section className="map-summary-strip" aria-label="Map summary">
            <div><strong>{metric(nodes.length)}</strong><span>capabilities</span></div>
            <div><strong>{metric(edges.length)}</strong><span>relationships</span></div>
            <div><strong>{metric(artifact.receipts.filter((receipt) => receipt.kind === 'source').length)}</strong><span>source windows</span></div>
            <div><strong>{metric(coverage?.files)}</strong><span>files inspected</span></div>
            <div><strong>{reviewNotes.length}</strong><span>review notes</span></div>
          </section>

          {transition && <RevisionTransition transition={transition} />}

          <section className="map-explorer" aria-label="Candidate capability map">
            <nav className="map-node-index" aria-label="Capability list">
              <div className="map-index-heading">
                <div>
                  <p className="map-kicker">The candidate map</p>
                  <h2>Capabilities</h2>
                </div>
                <span>{filteredNodes.length}/{nodes.length}</span>
              </div>
              <label className="map-search-label" htmlFor="map-capability-search">Find a capability</label>
              <input
                id="map-capability-search"
                className="map-search"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder="Name, summary, outcome"
              />
              <ul>
                {filteredNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={selectedNode?.id === node.id ? 'is-selected' : ''}
                      aria-pressed={selectedNode?.id === node.id}
                      onClick={() => { setSelectedNodeId(node.id); setSelectedEvidenceId(null) }}
                    >
                      <span>{node.name}</span>
                      <small>{node.assessment} · {node.id}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {filteredNodes.length === 0 && <p className="map-index-empty">No capabilities match this search.</p>}
            </nav>

            <div className="map-main-detail">
              {selectedNode ? (
                <CapabilityDetail
                  node={selectedNode}
                  relatedEdges={relatedEdges}
                  notes={reviewNotes}
                  onSelectNode={(id) => { setSelectedNodeId(id); setSelectedEvidenceId(null) }}
                  onSelectEvidence={setSelectedEvidenceId}
                />
              ) : (
                <div className="map-no-nodes"><h2>No candidate capabilities were proposed.</h2><p>The source and coverage records remain available below.</p></div>
              )}
            </div>

            <aside className="map-inspector-column">
              <EvidenceInspector receipt={selectedReceipt} missingId={selectedEvidenceId} />
              {selectedNode && (
                <section className="map-inspector-sources">
                  <p className="map-kicker">Available citations</p>
                  <h2>Evidence for this capability</h2>
                  <ul>
                    {selectedNode.evidenceIds.map((id, index) => (
                      <li key={`${index}:${id}`}>
                        <button type="button" onClick={() => setSelectedEvidenceId(id)}>
                          <span>{id}</span>
                          <small>{safeText(evidenceById.get(id)?.path, safeText(evidenceById.get(id)?.kind, 'source unavailable'))}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </section>

          {history && <HistoryLineage history={history} onSelectEvidence={setSelectedEvidenceId} />}
          {reviewHistory && <ReviewHistory reviewHistory={reviewHistory} onSelectEvidence={setSelectedEvidenceId} />}
          <CoverageSection artifact={artifact} />
        </>
      )}
      <footer className="map-footer">
        <span>Candidate map · evidence remains local</span>
        <button type="button" onClick={onBack}>Return to atlas</button>
      </footer>
    </main>
  )
}
