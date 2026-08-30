import { useMemo, useState } from 'react'

import type { AtlasDataset } from './model'
import {
  boundariesById,
  levelLabel,
  type Period,
  type PeriodBoundary,
  type PeriodDocument,
} from './periods'
import { formatDate } from './dateFormat'

interface PeriodBandsProps {
  dataset: AtlasDataset
  document: PeriodDocument
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'is-strong'
  if (confidence >= 0.7) return 'is-moderate'
  return 'is-weak'
}

function BoundaryDetail({ boundary, dataset }: { boundary: PeriodBoundary; dataset: AtlasDataset }) {
  const proposed = dataset.episodes[boundary.proposedIndex]
  const settled = boundary.settledIndex === null ? null : dataset.episodes[boundary.settledIndex]

  return (
    <div className="period-boundary-detail">
      <p className="period-boundary-shift">
        <span>{boundary.before ?? 'unstated'}</span>
        <span aria-hidden="true">→</span>
        <span>{boundary.after ?? 'unstated'}</span>
      </p>

      <dl className="period-boundary-readings">
        <div>
          <dt>Read as a change of phase</dt>
          <dd>
            <code>{proposed.shortSha}</code> {formatDate(proposed.authoredAt)}
            <span className="period-note">{proposed.subject}</span>
          </dd>
        </div>
        {settled ? (
          <div>
            <dt>History measurably changed shape</dt>
            <dd>
              <code>{settled.shortSha}</code> {formatDate(settled.authoredAt)}
              <span className="period-note">{settled.subject}</span>
            </dd>
          </div>
        ) : (
          <div>
            <dt>History measurably changed shape</dt>
            <dd className="period-absent">
              No focus shift near this point. The work changed character without the file
              layout or commit vocabulary changing with it.
            </dd>
          </div>
        )}
      </dl>

      {boundary.corroborated && (
        <p className="period-note">
          The two readings sit {boundary.spanCommits} commit{boundary.spanCommits === 1 ? '' : 's'}
          {boundary.spanDays > 0 ? ` and ${boundary.spanDays} day${boundary.spanDays === 1 ? '' : 's'}` : ''} apart.
          Commits between them belong to no period; they are the transition.
        </p>
      )}

      <ul className="period-signals">
        {boundary.signals.map((signal, order) => (
          <li key={`${signal.kind}-${order}`} className={`is-${signal.basis}`}>
            <span className="period-signal-basis">
              {signal.basis === 'observed' ? 'Observed' : 'Candidate'}
            </span>
            <span>{signal.label}</span>
            <code>{signal.weight.toFixed(2)}</code>
          </li>
        ))}
      </ul>

      <p className="period-note">
        Proposed by {boundary.votes} of the overlapping request window{boundary.votes === 1 ? '' : 's'}
        that could have seen it.
      </p>
    </div>
  )
}

export function PeriodBands({ dataset, document }: PeriodBandsProps) {
  const [openBoundaryId, setOpenBoundaryId] = useState<string | null>(null)
  const [openPeriodId, setOpenPeriodId] = useState<string | null>(null)

  const boundaries = useMemo(() => boundariesById(document), [document])
  const total = document.commitCount
  // Coarsest level first, so the page reads from the largest arc down to its parts.
  const levels = useMemo(() => [...document.levels].reverse(), [document.levels])

  const renderBand = (period: Period, levelIndex: number) => {
    const width = (period.commitCount / total) * 100
    const boundary = period.closedBy ? boundaries.get(period.closedBy) ?? null : null
    const isOpen = openPeriodId === period.id
    const unnamed = !period.label

    return (
      <button
        key={period.id}
        type="button"
        style={{ width: `${width}%` }}
        className={[
          'period-band',
          isOpen ? 'is-open' : '',
          period.coherent === false ? 'is-incoherent' : '',
          unnamed ? 'is-unnamed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setOpenPeriodId(isOpen ? null : period.id)}
        aria-expanded={isOpen}
        title={period.label ?? undefined}
      >
        <span className="period-band-label">{period.label ?? 'Unnamed'}</span>
        <span className="period-band-meta">
          {period.commitCount} commits
          {boundary && levelIndex === levels.length - 1 ? ' ·' : ''}
        </span>
      </button>
    )
  }

  const openPeriod = useMemo(
    () => document.levels.flat().find((period) => period.id === openPeriodId) ?? null,
    [document.levels, openPeriodId],
  )

  return (
    <section className="period-bands">
      <header className="period-header">
        <h2>Periods</h2>
        <p>
          {document.hierarchy.rationale} Every period is a candidate reading of the history;
          the focus shifts cited beside each boundary are observations.
        </p>
        <p className="period-note">
          Produced by <code>{document.method}</code>.
        </p>
      </header>

      <div className="period-scale">
        {levels.map((periods, levelIndex) => {
          const name = document.hierarchy.levelNames[document.levels.length - 1 - levelIndex] ?? 'level'
          return (
            <div className="period-level" key={name}>
              <p className="period-level-name">{levelLabel(name, periods.length)}</p>
              <div className="period-row">{periods.map((period) => renderBand(period, levelIndex))}</div>
            </div>
          )
        })}
      </div>

      {openPeriod && (
        <article className="period-detail">
          <h3>{openPeriod.label ?? 'Unnamed period'}</h3>
          <p className="period-detail-span">
            {formatDate(openPeriod.firstAuthoredAt)} – {formatDate(openPeriod.lastAuthoredAt)} ·{' '}
            {openPeriod.commitCount} commits
          </p>
          {openPeriod.summary && <p>{openPeriod.summary}</p>}
          {openPeriod.coherent === false && (
            <p className="period-warning">
              The model could not find a common thread here. That is evidence about where the
              boundaries were drawn, not only about the work.
            </p>
          )}
          {openPeriod.labelStatus === 'failed' && (
            <p className="period-warning">Naming this period failed; it is shown unlabeled.</p>
          )}
        </article>
      )}

      <section className="period-boundaries">
        <h3>Boundaries</h3>
        <p className="period-note">
          {document.boundaries.filter((boundary) => boundary.corroborated).length} of{' '}
          {document.boundaries.length} were corroborated by an independent focus shift.
        </p>
        <ul>
          {document.boundaries.map((boundary) => {
            const isOpen = openBoundaryId === boundary.id
            const episode = dataset.episodes[boundary.proposedIndex]
            return (
              <li key={boundary.id} className={confidenceClass(boundary.confidence)}>
                <button
                  type="button"
                  onClick={() => setOpenBoundaryId(isOpen ? null : boundary.id)}
                  aria-expanded={isOpen}
                >
                  <span className="period-boundary-date">{formatDate(boundary.proposedAt)}</span>
                  <span className="period-boundary-subject">{episode.subject}</span>
                  <span className="period-boundary-tag">
                    {boundary.corroborated ? 'corroborated' : 'proposal only'}
                  </span>
                  <code>{boundary.confidence.toFixed(2)}</code>
                </button>
                {isOpen && <BoundaryDetail boundary={boundary} dataset={dataset} />}
              </li>
            )
          })}
        </ul>
      </section>

      {document.unpairedFocusPeaks.length > 0 && (
        <section className="period-unpaired">
          <h3>Focus shifts with no proposed boundary</h3>
          <p className="period-note">
            The recorded history changed shape here, but nothing read it as a change of phase.
            These are kept rather than discarded: they are where the two passes disagree.
          </p>
          <ul>
            {document.unpairedFocusPeaks.map((peak) => (
              <li key={`${peak.kind}-${peak.index}`}>
                <span className="period-boundary-date">{formatDate(peak.authoredAt)}</span>
                <span className="period-boundary-subject">{peak.subject}</span>
                <span className="period-boundary-tag">{peak.kind}</span>
                <code>{peak.score.toFixed(2)}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
