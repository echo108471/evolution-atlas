import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import {
  asRecord,
  historyConsultations,
  integrationAccounting,
  parseCandidateMapText,
  receiptGitLocation,
  receiptProvenance,
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
  onSourceUrl: (value: string | null) => void
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
  const provenance = receiptProvenance(receipt.kind)
  const path = safeText(receipt.path)
  const text = safeText(receipt.text)
  const commitSha = safeText(receipt.commitSha)
  const startLine = receipt.startLine
  const endLine = receipt.endLine
  return (
    <section className="map-evidence-inspector" aria-label="Evidence detail">
      <p className="map-kicker">{provenance.label}</p>
      <h2>{safeText(receipt.id, 'Evidence')}</h2>
      <dl className="map-evidence-facts">
        {path && <div><dt>Path</dt><dd><code>{path}</code></dd></div>}
        {commitSha && <div><dt>Commit</dt><dd><code>{commitSha}</code></dd></div>}
        {safeText(receipt.pinnedCommitSha) && safeText(receipt.pinnedCommitSha) !== commitSha && <div><dt>Read at revision</dt><dd><code>{safeText(receipt.pinnedCommitSha)}</code></dd></div>}
        {safeText(receipt.blobSha) && <div><dt>Blob</dt><dd><code>{safeText(receipt.blobSha)}</code></dd></div>}
        {typeof startLine === 'number' && <div><dt>Saved lines</dt><dd>{startLine}{typeof endLine === 'number' ? `–${endLine}` : ''}</dd></div>}
        {safeText(receipt.subject) && <div><dt>Subject</dt><dd>{safeText(receipt.subject)}</dd></div>}
        {safeText(receipt.tier) && <div><dt>Reading tier</dt><dd>{safeText(receipt.tier)}</dd></div>}
      </dl>
      {text ? (
        <pre className="map-source-text">{text}</pre>
      ) : (
        <p className="map-empty-field">No plain-text excerpt is included. Inspect the saved receipt fields below.</p>
      )}
      <p className="map-review-boundary">A citation points to recorded material; it does not establish that the material supports the interpretation.</p>
      {receipt.kind === 'search' && <p className="map-history-boundary">Search results are navigation only; they cannot support behavior claims without inspected source evidence.</p>}
      {!provenance.observed && <p className="map-history-boundary">This is not observed Git evidence. Cached readings and prior maps are candidate interpretations; they cannot independently support a historical source claim.</p>}
      <ObjectDetails value={receipt} label="Full saved receipt" />
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

function shortSha(value: string) {
  return /^[a-f0-9]{40,64}$/.test(value) ? value.slice(0, 10) : value
}

function NodeRef({ id, onOpenNode, known }: { id: string; onOpenNode: (id: string) => void; known: (id: string) => boolean }) {
  if (!known(id)) return <code className="map-node-ref">{id}</code>
  return <button type="button" className="map-node-ref" onClick={() => onOpenNode(id)}>{id}</button>
}

function GitLocation({ receipt }: { receipt: JsonRecord }) {
  const { commitSha, path, lines } = receiptGitLocation(receipt)
  if (!commitSha && !path) return null
  return (
    <span className="map-git-location">
      {path && <code>{path}{lines ? `:${lines}` : ''}</code>}
      {commitSha && <code title={commitSha}>@{shortSha(commitSha)}</code>}
    </span>
  )
}

function ConsultedHistory({ history }: { history: JsonRecord }) {
  const { priorMaps, commitReadings } = historyConsultations(history)
  return (
    <section className="map-history-section map-consulted" aria-label="Earlier interpretations consulted">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Candidate context · not evidence</p>
          <h2>Earlier interpretations consulted</h2>
        </div>
        <span>{priorMaps.length + commitReadings.length}</span>
      </div>
      <p className="map-history-boundary">Prior maps and cached per-commit readings are earlier model interpretations. Integration may consult them, but they cannot be cited as proof; claims must still cite observed source or diff receipts.</p>
      <div className="map-consulted-grid">
        <section>
          <h3>Prior maps consulted<span>{priorMaps.length}</span></h3>
          {priorMaps.length ? (
            <ul className="map-consulted-list">
              {priorMaps.map((map) => (
                <li key={map.id}>
                  <strong>{map.displayName || map.id}</strong>
                  <span>{map.id}{map.version ? ` · ${map.version}` : ''}</span>
                  {map.commitSha && <code title={map.commitSha}>@{shortSha(map.commitSha)}</code>}
                  <p>
                    {map.accessedNodeCount ?? '—'} of {map.nodeCount ?? '—'} candidate capabilities looked up
                    {map.unaccessedNodeCount ? ` · ${map.unaccessedNodeCount} never opened` : ''}
                    {map.edgeCount !== null ? ` · ${map.edgeCount} relationships in the map` : ''}
                  </p>
                  {map.artifactSha256 && <small>artifact sha256 {map.artifactSha256.slice(0, 16)}…</small>}
                </li>
              ))}
            </ul>
          ) : <p className="map-empty-field">No prior map was configured or consulted for this run.</p>}
        </section>
        <section>
          <h3>Cached readings used<span>{commitReadings.length}</span></h3>
          {commitReadings.length ? (
            <ul className="map-consulted-list">
              {commitReadings.map((reading, index) => (
                <li key={`${reading.artifactId}:${reading.commitSha}:${index}`}>
                  <strong>{reading.subject || 'Commit reading'}</strong>
                  <span>{reading.artifactId}{reading.repositoryName ? ` · ${reading.repositoryName}` : ''}</span>
                  {reading.commitSha && <code title={reading.commitSha}>@{shortSha(reading.commitSha)}</code>}
                  {reading.readings.map((entry, entryIndex) => (
                    <p key={entryIndex}>
                      <em>Tier {safeText(String(entry.tier ?? '?'))}</em>{' '}
                      {safeText(entry.summary, safeText(entry.intent, safeText(entry.reading, 'Reading recorded; open the raw record for fields.')))}
                    </p>
                  ))}
                  <ObjectDetails value={reading.readings} label="Saved reading fields" />
                </li>
              ))}
            </ul>
          ) : <p className="map-empty-field">No cached per-commit reading was configured or retrieved for this run.</p>}
        </section>
      </div>
    </section>
  )
}

function IntegrationRecord({
  graph,
  onOpenNode,
  known,
  onSelectEvidence,
}: {
  graph: JsonRecord
  onOpenNode: (id: string) => void
  known: (id: string) => boolean
  onSelectEvidence: (id: string) => void
}) {
  const { comparisons, decisions, lineage, edgeLineage } = integrationAccounting(graph)
  if (!comparisons.length && !decisions.length && !lineage.length && !edgeLineage.length) return null
  const edgeText = (edge: JsonRecord) => `${safeText(edge.from, '?')} — ${safeText(edge.type, 'relationship').replaceAll('_', ' ')} → ${safeText(edge.to, '?')}`
  return (
    <section className="map-history-section map-integration" aria-label="Integration record">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">How the integrator consolidated proposals</p>
          <h2>Graph comparisons and decisions</h2>
        </div>
        <span>candidate interpretation</span>
      </div>
      {comparisons.length > 0 && (
        <details className="map-lineage-edges" open>
          <summary>Comparisons with the earlier map · {comparisons.length}</summary>
          <ol className="map-lineage-list">
            {comparisons.map((entry, index) => (
              <li key={`cmp:${index}`}>
                <div className="map-lineage-title">
                  <strong>{safeText(entry.relation, 'relation not recorded')}</strong>
                  <span>{safeText(entry.disposition)}</span>
                </div>
                <p>
                  <NodeRef id={safeText(entry.newNodeId, '?')} onOpenNode={onOpenNode} known={known} />
                  {' compared with '}
                  {safeTextList(entry.existingNodeIds).length
                    ? safeTextList(entry.existingNodeIds).map((id, i) => <span key={id}>{i > 0 && ', '}<NodeRef id={id} onOpenNode={onOpenNode} known={known} /></span>)
                    : 'no earlier capability'}
                </p>
                {safeText(entry.reason) && <p>{safeText(entry.reason)}</p>}
                {safeTextList(entry.uncertainty).length > 0 && <p className="map-empty-field">Uncertainty: {safeTextList(entry.uncertainty).join(' ')}</p>}
                <EvidenceLinks ids={safeTextList(entry.evidenceIds)} onSelect={onSelectEvidence} />
              </li>
            ))}
          </ol>
        </details>
      )}
      {decisions.length > 0 && (
        <details className="map-lineage-edges" open>
          <summary>Global decisions · {decisions.length}</summary>
          <ol className="map-lineage-list">
            {decisions.map((entry, index) => (
              <li key={`dec:${index}`}>
                <div className="map-lineage-title"><strong>{safeText(entry.question, 'Question not recorded')}</strong></div>
                <blockquote>{safeText(entry.decision)}</blockquote>
                {safeText(entry.reason) && <p>{safeText(entry.reason)}</p>}
                {safeTextList(entry.uncertainty).length > 0 && <p className="map-empty-field">Uncertainty: {safeTextList(entry.uncertainty).join(' ')}</p>}
                <EvidenceLinks ids={safeTextList(entry.evidenceIds)} onSelect={onSelectEvidence} />
              </li>
            ))}
          </ol>
        </details>
      )}
      {lineage.length > 0 && (
        <details className="map-lineage-edges">
          <summary>Capability consolidation lineage · {lineage.length}</summary>
          <ol className="map-lineage-list">
            {lineage.map((entry, index) => (
              <li key={`lin:${index}`}>
                <div className="map-lineage-title"><strong>{safeText(entry.decision, 'decision not recorded')}</strong></div>
                <p>
                  <NodeRef id={safeText(entry.originalId, '?')} onOpenNode={onOpenNode} known={known} />
                  {' → '}
                  {safeTextList(entry.successorIds).length
                    ? safeTextList(entry.successorIds).map((id, i) => <span key={id}>{i > 0 && ', '}<NodeRef id={id} onOpenNode={onOpenNode} known={known} /></span>)
                    : 'no successor'}
                </p>
                {safeText(entry.reason) && <p>{safeText(entry.reason)}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {edgeLineage.length > 0 && (
        <details className="map-lineage-edges">
          <summary>Relationship consolidation lineage · {edgeLineage.length}</summary>
          <ol className="map-lineage-list">
            {edgeLineage.map((entry, index) => (
              <li key={`elin:${index}`}>
                <div className="map-lineage-title">
                  <strong>{safeText(entry.decision, 'decision not recorded')}</strong>
                  <span>{safeText(entry.source, 'input')} edge #{typeof entry.originalIndex === 'number' ? entry.originalIndex : '?'}</span>
                </div>
                <p>{recordList(entry.successorEdges).length ? recordList(entry.successorEdges).map(edgeText).join('; ') : 'no successor'}</p>
                {safeText(entry.reason) && <p>{safeText(entry.reason)}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

function ProvenanceSection({ artifact }: { artifact: CandidateMapArtifact }) {
  const provenance = asRecord(artifact.provenance)
  const facts: Array<[string, string]> = [
    ['Engine output version', safeText(artifact.version)],
    ['Run status', safeText(artifact.status)],
    ['Interpretation status', safeText(artifact.interpretationStatus, 'candidate')],
    ['Independent verification', safeText(artifact.independentVerification, 'not-performed')],
  ]
  if (provenance) {
    facts.push(['Run plan sha256', safeText(provenance.runPlanSha256)])
    facts.push(['Integration packet sha256', safeText(provenance.integrationPacketSha256)])
    facts.push(['Baseline output sha256', safeText(provenance.baselineRawSha256)])
    facts.push(['Baseline run plan sha256', safeText(provenance.baselineRunPlanSha256)])
  }
  const shown = facts.filter(([, value]) => value)
  const fingerprints = asRecord(provenance?.outputFingerprints)
  return (
    <section className="map-history-section map-provenance" aria-label="Artifact provenance">
      <div className="map-section-heading">
        <div>
          <p className="map-kicker">Replay pins</p>
          <h2>Provenance</h2>
        </div>
      </div>
      <p>These digests pin the run plan, frozen integration packet and saved worker outputs this map was published from. They identify bytes for replay; they do not validate the interpretation.</p>
      {shown.length > 0 ? (
        <dl className="map-coverage-metrics map-provenance-facts">
          {shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}
        </dl>
      ) : <p className="map-empty-field">No provenance record was included in this artifact.</p>}
      {fingerprints && Object.keys(fingerprints).length > 0 && (
        <details className="map-raw-details">
          <summary>Worker output fingerprints · {Object.keys(fingerprints).length}</summary>
          <dl className="map-coverage-metrics map-provenance-facts">
            {Object.entries(fingerprints).map(([agent, digest]) => <div key={agent}><dt>{agent}</dt><dd><code>{safeText(digest)}</code></dd></div>)}
          </dl>
        </details>
      )}
      <ObjectDetails value={provenance?.priorMapPins} label="Prior-map pins" />
      <ObjectDetails value={provenance?.commitReadingPins} label="Cached-reading pins" />
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
  const [graphView, setGraphView] = useState<'current' | 'baseline'>('current')
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [routeInput, setRouteInput] = useState(sourceUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [routeAttempt, setRouteAttempt] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const loadSequence = useRef(0)
  const routeController = useRef<AbortController | null>(null)

  function selectEvidence(id: string) {
    setSelectedEvidenceId(id)
    inspector.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    inspector.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    setRouteInput(sourceUrl ?? '')
  }, [sourceUrl])

  useEffect(() => {
    if (!sourceUrl) return
    const controller = new AbortController()
    routeController.current = controller
    const sequence = ++loadSequence.current
    setFilter('')
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
        if (!controller.signal.aborted && sequence === loadSequence.current) {
          setArtifact(loaded)
          setGraphView('current')
          setSelectedNodeId(loaded.graph.nodes[0]?.id ?? null)
        }
      } catch (cause) {
        if (!controller.signal.aborted && sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'The local artifact could not be read.')
      } finally {
        if (!controller.signal.aborted && sequence === loadSequence.current) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [sourceUrl, routeAttempt])

  const baselineGraph = artifact?.baselineGraph?.nodes.length ? artifact.baselineGraph : null
  const showingBaseline = graphView === 'baseline' && baselineGraph !== null
  const nodes = (showingBaseline ? baselineGraph?.nodes : artifact?.graph.nodes) ?? []
  const edges = (showingBaseline ? baselineGraph?.edges : artifact?.graph.edges) ?? []
  const currentIds = new Set(artifact?.graph.nodes.map((node) => node.id) ?? [])
  const baselineIds = new Set(baselineGraph?.nodes.map((node) => node.id) ?? [])
  const knownNode = (id: string) => currentIds.has(id) || baselineIds.has(id)
  function openNode(id: string) {
    if (currentIds.has(id)) setGraphView('current')
    else if (baselineIds.has(id)) setGraphView('baseline')
    else return
    setSelectedNodeId(id)
    setSelectedEvidenceId(null)
    document.getElementById('map-capabilities')?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  function switchGraph(view: 'current' | 'baseline') {
    const target = view === 'baseline' ? baselineGraph : artifact?.graph
    setGraphView(view)
    setFilter('')
    setSelectedEvidenceId(null)
    setSelectedNodeId(target?.nodes[0]?.id ?? null)
  }
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null
  // v3 lists history receipts by ID against top-level receipts, so the same body can appear in both lists.
  const receipts = artifact ? [...artifact.receipts, ...artifact.historyReceipts.filter((receipt) => !artifact.receipts.includes(receipt))] : []
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
  const baselineCommitSha = safeText(transition?.fromCommitSha)
  const reviewHistory = asRecord(artifact?.reviewHistory)
  const coverage = asRecord(artifact?.coverage)

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    routeController.current?.abort()
    const sequence = ++loadSequence.current
    setError(null)
    setLoading(true)
    try {
      if (file.size > MAX_ARTIFACT_BYTES) throw new Error(ARTIFACT_SIZE_MESSAGE)
      const body = await file.text()
      const loaded = await parseCandidateMapText(body)
      if (sequence !== loadSequence.current) return
      onSourceUrl(null)
      setFilter('')
      setArtifact(loaded)
      setGraphView('current')
      setSelectedNodeId(loaded.graph.nodes[0]?.id ?? null)
      setSelectedEvidenceId(null)
    } catch (cause) {
      if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : 'The selected file is not valid candidate map JSON.')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  function loadRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const resolved = resolveLocalMapUrl(routeInput, window.location.href)
      if (resolved === sourceUrl) setRouteAttempt((attempt) => attempt + 1)
      else onSourceUrl(resolved)
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
          <p><strong>Observed Git</strong><br />Commit, path, blob, saved source and bounded Git diffs.</p>
        </div>
        <div>
          <span className="map-trust-mark map-trust-mark--candidate" aria-hidden="true">C</span>
          <p><strong>Candidate interpretation</strong><br />Capabilities, relationships, cached readings and prior maps. Review notes qualify claims without verifying them.</p>
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
            <div><strong>{metric(artifact.historyReceipts.length)}</strong><span>history receipts</span></div>
            <div><strong>{reviewNotes.length}</strong><span>review notes</span></div>
          </section>

          <nav className="map-workspace-nav" aria-label="Map sections">
            <a href="#map-capabilities">Capabilities</a>
            <a href="#map-history">History</a>
            <a href="#map-evidence">Evidence store</a>
            <a href="#map-review">Review context</a>
            <a href="#map-coverage">Coverage &amp; omissions</a>
            <a href="#map-provenance">Provenance</a>
          </nav>

          {baselineGraph && (
            <section className="map-graph-toggle" aria-label="Choose which revision's candidate map to show">
              <div role="group" aria-label="Revision">
                <button type="button" aria-pressed={!showingBaseline} className={!showingBaseline ? 'is-selected' : ''} onClick={() => switchGraph('current')}>
                  Current map<small>{artifact.commitSha ? `@${shortSha(artifact.commitSha)}` : 'this revision'} · {artifact.graph.nodes.length} capabilities</small>
                </button>
                <button type="button" aria-pressed={showingBaseline} className={showingBaseline ? 'is-selected' : ''} onClick={() => switchGraph('baseline')}>
                  Baseline map<small>{baselineCommitSha ? `@${shortSha(baselineCommitSha)}` : 'earlier revision'} · {baselineGraph.nodes.length} capabilities</small>
                </button>
              </div>
              <p>{showingBaseline
                ? 'Showing the earlier candidate map this expansion compared against. Its IDs and receipts carry the old: prefix; source receipts were read at the earlier revision.'
                : 'Showing the integrated candidate map at this revision. Switch to the baseline to compare it with the earlier map.'}</p>
            </section>
          )}

          <section id="map-capabilities" className="map-explorer" aria-label="Candidate capability map">
            <nav className="map-node-index" aria-label="Capability list">
              <div className="map-index-heading">
                <div>
                  <p className="map-kicker">{showingBaseline ? 'Baseline candidate map' : 'The candidate map'}</p>
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
                  onSelectEvidence={selectEvidence}
                />
              ) : (
                <div className="map-no-nodes"><h2>No candidate capabilities were proposed.</h2><p>The source and coverage records remain available below.</p></div>
              )}
            </div>

            <aside className="map-inspector-column" ref={inspector} tabIndex={-1} aria-label="Selected evidence">
              <EvidenceInspector receipt={selectedReceipt} missingId={selectedEvidenceId} />
              {selectedNode && (
                <section className="map-inspector-sources">
                  <p className="map-kicker">Available citations</p>
                  <h2>Evidence for this capability</h2>
                  <ul>
                    {selectedNode.evidenceIds.map((id, index) => (
                      <li key={`${index}:${id}`}>
                        <button type="button" onClick={() => selectEvidence(id)}>
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

          <div id="map-history" className="map-anchor-section">
            {transition && <RevisionTransition transition={transition} />}
            {history && <HistoryLineage history={history} onSelectEvidence={selectEvidence} />}
            {history && Object.hasOwn(history, 'priorMaps') && <ConsultedHistory history={history} />}
            <IntegrationRecord graph={artifact.graph} onOpenNode={openNode} known={knownNode} onSelectEvidence={selectEvidence} />
            {!transition && !recordList(history?.lineage).length && !recordList(history?.edgeLineage).length && (
              <section className="map-history-section"><p className="map-kicker">History</p><h2>No cross-revision history included</h2><p>This artifact supplies a snapshot candidate map. It does not establish capability evolution. Open a descendant-revision expansion to inspect observed changes and candidate lineage.</p></section>
            )}
          </div>
          <section id="map-evidence" className="map-history-section" aria-label="Evidence store">
            <p className="map-kicker">Store · saved receipts</p>
            <h2>Inspect the evidence behind the map</h2>
            <p>Open any included receipt, including material not cited by the selected capability. These are the receipts packaged in this output, not the repository's entire evidence store.</p>
            <ul className="map-receipt-catalog">
              {receipts.map((receipt, index) => (
                <li key={`${safeText(receipt.id)}:${index}`}><button type="button" onClick={() => selectEvidence(safeText(receipt.id))}>
                  <strong>{safeText(receipt.id)}</strong><span>{receiptProvenance(receipt.kind).label}</span><GitLocation receipt={receipt} />
                </button></li>
              ))}
            </ul>
            {!receipts.length && <p>No receipts were included in this artifact.</p>}
          </section>
          <div id="map-review" className="map-anchor-section">
            <section className="map-history-section"><p className="map-kicker">Post-inference review</p><h2>Current review context</h2>
              <p>{reviewNotes.length ? `${reviewNotes.length} claim-local notes qualify the current map. Select a capability to read its notes alongside the claim.` : 'No current claim-local review notes were included. Absence of notes is not approval.'}</p>
              <p>Review does not rewrite the candidate graph or become a discovery label. Earlier notes stay attached to their original revision.</p>
              {!recordList(reviewHistory?.entries).length && <p>No earlier review notes were included.</p>}
            </section>
            {reviewHistory && <ReviewHistory reviewHistory={reviewHistory} onSelectEvidence={selectEvidence} />}
          </div>
          <div id="map-coverage" className="map-anchor-section"><CoverageSection artifact={artifact} /></div>
          <div id="map-provenance" className="map-anchor-section"><ProvenanceSection artifact={artifact} /></div>
        </>
      )}
      <footer className="map-footer">
        <span>Candidate map · evidence remains local</span>
        <button type="button" onClick={onBack}>Return to atlas</button>
      </footer>
    </main>
  )
}
