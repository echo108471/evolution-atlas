import { useMemo } from 'react'

import { LIFECYCLE_STAGES } from './lifecycle'
import { formatDate } from './dateFormat'
import type { CalendarChapter, StoryLane } from './story'
import { deriveFeatureAssociations } from './story'
import type { AtlasDataset, LifecycleStage } from './model'

/**
 * Marks at either end of the track would have their centred tooltip clipped by the
 * story page, which owns its overflow. Anchor those inward instead.
 */
function tooltipAnchor(percent: number) {
  if (percent < 14) return 'start'
  if (percent > 86) return 'end'
  return undefined
}

/**
 * Keys this track, not the stage vocabulary. A mark for a stage this feature never
 * reached would advertise evidence that is not on the timeline, and a mark drawn at
 * full strength while the track is dimmed would misstate what the filter is hiding.
 */
function TimelineKey({
  lane,
  selectedLifecycleStage,
}: {
  lane: StoryLane
  selectedLifecycleStage: LifecycleStage | 'all'
}) {
  const presentStages = LIFECYCLE_STAGES.filter((stage) =>
    lane.lifecycleEvents.some((event) => event.semanticEpisode.lifecycleStage === stage),
  )
  if (presentStages.length === 0 && lane.events.length === 0) return null

  return (
    <div className="visual-legend" aria-label="Timeline key">
      {presentStages.map((stage) => {
        const isDimmed = selectedLifecycleStage !== 'all' && selectedLifecycleStage !== stage
        return (
          <span key={stage} className={isDimmed ? 'is-dimmed' : ''}>
            <i className={`legend-mark legend-mark--${stage}`} />
            {stage}
            {isDimmed && <span className="sr-only"> (dimmed by the current stage filter)</span>}
          </span>
        )
      })}
      {lane.events.length > 0 && (
        <span><i className="legend-mark legend-mark--commit" />cited commit</span>
      )}
      {lane.events.length > 1 && (
        <span><i className="legend-mark legend-mark--connector" />navigation link, not continuous work</span>
      )}
    </div>
  )
}

export function FeatureFocus({
  dataset,
  lane,
  chapters,
  selectedId,
  selectedChapterId,
  selectedLifecycleStage,
  onSelect,
  onViewAllEvidence,
}: {
  dataset: AtlasDataset
  lane: StoryLane
  chapters: CalendarChapter[]
  selectedId: string | null
  selectedChapterId: string | null
  selectedLifecycleStage: LifecycleStage | 'all'
  onSelect: (id: string) => void
  onViewAllEvidence: (id: string) => void
}) {
  const associations = useMemo(
    () => deriveFeatureAssociations(dataset, lane.feature),
    [dataset, lane.feature],
  )

  return (
    <article className="feature-focus">
      <header className="feature-focus__header">
        <div>
          <span className="eyebrow">Selected feature story</span>
          <h2>{lane.feature.label}</h2>
          <p>{lane.feature.rationale ?? 'This candidate groups repository evidence into one capability trail.'}</p>
        </div>
        <div className="feature-focus__confidence">
          <strong>{Math.round(lane.feature.confidence * 100)}%</strong>
          <span>candidate confidence</span>
          <button
            type="button"
            className={selectedId === lane.feature.id ? 'is-active' : ''}
            aria-pressed={selectedId === lane.feature.id}
            onClick={() => onViewAllEvidence(lane.feature.id)}
          >
            View all feature evidence
          </button>
        </div>
      </header>

      <section className="feature-focus__timeline" aria-label={`${lane.feature.label} timeline`}>
        <div className="feature-focus__timeline-heading">
          <span className="eyebrow">Timeline orientation</span>
          <small>Select a lifecycle bar or commit mark to inspect its evidence.</small>
        </div>
        <div className="focus-axis" aria-hidden="true">
          {chapters.map((chapter) => (
            <span
              key={chapter.id}
              className={selectedChapterId === chapter.id ? 'is-selected' : ''}
              style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
            >
              {chapter.label}
            </span>
          ))}
        </div>

        <div className="focus-track">
          {chapters.map((chapter) => (
            <span
              key={chapter.id}
              className={`focus-track__chapter${selectedChapterId === chapter.id ? ' is-selected' : ''}`}
              style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
            />
          ))}
          {lane.events.length > 1 && (
            <span
              className="focus-track__span"
              style={{
                left: `${lane.startPercent}%`,
                width: `${Math.max(lane.endPercent - lane.startPercent, 0.3)}%`,
              }}
            />
          )}
          {lane.events.map((event) => (
            <button
              key={event.id}
              type="button"
              className={`focus-commit${selectedId === event.id ? ' is-selected' : ''}`}
              style={{ left: `${event.percent}%` }}
              aria-label={`${event.episode.shortSha}: ${event.episode.subject}`}
              data-tooltip={`${formatDate(event.episode.authoredAt)} · ${event.episode.subject}`}
              data-tooltip-anchor={tooltipAnchor(event.percent)}
              onClick={() => onSelect(event.id)}
            />
          ))}
          {lane.lifecycleEvents.map((event, index) => {
            const stage = event.semanticEpisode.lifecycleStage
            const isDimmed = selectedLifecycleStage !== 'all' && selectedLifecycleStage !== stage
            return (
              <button
                key={event.id}
                type="button"
                className={`focus-lifecycle focus-lifecycle--${stage}${selectedId === event.id ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                style={{
                  left: `${event.startPercent}%`,
                  width: `${Math.max(event.endPercent - event.startPercent, 1.2)}%`,
                  top: `${18 + (index % 4) * 12}px`,
                }}
                aria-label={`${stage}: ${event.semanticEpisode.label}`}
                data-tooltip={`${stage} · ${event.semanticEpisode.label}`}
                data-tooltip-anchor={tooltipAnchor(event.startPercent)}
                onClick={() => onSelect(event.id)}
              />
            )
          })}
        </div>
        <TimelineKey lane={lane} selectedLifecycleStage={selectedLifecycleStage} />
      </section>

      <div className="feature-focus__context">
        <section>
          <span className="eyebrow">Observed footprint</span>
          <h3>Code areas</h3>
          <div className="context-chips">
            {associations.areas.map((area) => (
              <button key={area.id} type="button" onClick={() => onSelect(area.id)}>
                {area.label}<small>{area.count}</small>
              </button>
            ))}
          </div>
        </section>
        {associations.contributors.length > 0 && (
          <section>
            <span className="eyebrow">Git associations</span>
            <h3>Contributors</h3>
            <div className="context-chips">
              {associations.contributors.map((contributor) => (
                <button key={contributor.id} type="button" onClick={() => onSelect(contributor.id)}>
                  {contributor.displayName}<small>{contributor.count}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="lifecycle-cards" aria-labelledby="lifecycle-heading">
        <div className="subsection-heading">
          <div>
            <span className="eyebrow">Candidate lifecycle</span>
            <h3 id="lifecycle-heading">What changed, in sequence</h3>
          </div>
          <span>{lane.lifecycleEvents.length} episodes</span>
        </div>
        {lane.lifecycleEvents.length > 0 ? (
          <ol>
            {lane.lifecycleEvents.map((event) => {
              const firstEvidence = event.episodes[0]
              const stage = event.semanticEpisode.lifecycleStage
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    className={selectedId === event.id ? 'is-selected' : ''}
                    onClick={() => onSelect(event.id)}
                  >
                    <span className={`lifecycle-badge lifecycle-badge--${stage}`}>{stage}</span>
                    <span className="lifecycle-card__outcome">
                      <strong>{event.semanticEpisode.label}</strong>
                      <small>{firstEvidence ? formatDate(firstEvidence.authoredAt) : 'Date unavailable'}</small>
                    </span>
                    <span className="lifecycle-card__action">Inspect evidence</span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="empty-state">No lifecycle episodes match the current evidence preset.</div>
        )}
      </section>

      <details className="method-disclosure">
        <summary>How to read this feature story</summary>
        <p>
          The line connects cited evidence for navigation; it does not claim continuous development.
          Lifecycle labels are candidate interpretations, and contributor counts describe Git author
          associations rather than ownership or performance.
        </p>
      </details>
    </article>
  )
}
