import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { LIFECYCLE_STAGES } from './lifecycle'
import type {
  CalendarChapter,
  StoryLane,
  StoryModel,
} from './story'
import { deriveFeatureAssociations } from './story'
import type { AtlasDataset, FeatureCandidate, LifecycleStage } from './model'

interface FeatureExplorerProps {
  dataset: AtlasDataset
  story: StoryModel
  visibleFeatures: FeatureCandidate[]
  selectedFeature: FeatureCandidate | null
  selectedId: string | null
  selectedChapterId: string | null
  selectedLifecycleStage: LifecycleStage | 'all'
  onSelect: (id: string) => void
  onSelectFeature: (id: string) => void
  onViewAllEvidence: (id: string) => void
  inspector: ReactNode
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatSpan(lane: StoryLane) {
  const start = formatDate(new Date(lane.startTime).toISOString())
  const end = formatDate(new Date(lane.endTime).toISOString())
  return start === end ? start : `${start} – ${end}`
}

/**
 * Marks at either end of the track would have their centred tooltip clipped by the
 * story page, which owns its overflow. Anchor those inward instead.
 */
function tooltipAnchor(percent: number) {
  if (percent < 14) return 'start'
  if (percent > 86) return 'end'
  return undefined
}

function LifecycleLegend() {
  return (
    <div className="visual-legend" aria-label="Lifecycle legend">
      {LIFECYCLE_STAGES.map((stage) => (
        <span key={stage}>
          <i className={`legend-mark legend-mark--${stage}`} />
          {stage}
        </span>
      ))}
      <span><i className="legend-mark legend-mark--commit" />cited commit</span>
    </div>
  )
}

function FeatureFocus({
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
        <LifecycleLegend />
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

export function FeatureExplorer({
  dataset,
  story,
  visibleFeatures,
  selectedFeature,
  selectedId,
  selectedChapterId,
  selectedLifecycleStage,
  onSelect,
  onSelectFeature,
  onViewAllEvidence,
  inspector,
}: FeatureExplorerProps) {
  const [query, setQuery] = useState('')
  const storyPaneRef = useRef<HTMLDivElement>(null)
  const evidencePaneRef = useRef<HTMLElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const laneByFeatureId = useMemo(
    () => new Map(story.lanes.map((lane) => [lane.feature.id, lane])),
    [story.lanes],
  )
  const visibleFeatureIds = useMemo(
    () => new Set(visibleFeatures.map((feature) => feature.id)),
    [visibleFeatures],
  )
  const matchingFeatures = story.lanes
    .map((lane) => lane.feature)
    .filter(
      (feature) =>
        visibleFeatureIds.has(feature.id) && feature.label.toLowerCase().includes(normalizedQuery),
  )
  const selectedLane = selectedFeature ? laneByFeatureId.get(selectedFeature.id) ?? null : null

  useEffect(() => {
    if (storyPaneRef.current) storyPaneRef.current.scrollTop = 0
  }, [selectedFeature?.id])

  useEffect(() => {
    if (evidencePaneRef.current) evidencePaneRef.current.scrollTop = 0
  }, [selectedId])

  return (
    <section className="explorer-shell">
      <div className="explorer-flow" aria-label="Feature story workflow">
        <div className="explorer-flow__step is-active">
          <span className="explorer-flow__number">01</span>
          <div>
            <strong>Choose a candidate</strong>
            <small>{matchingFeatures.length} features in the current scope</small>
          </div>
        </div>
        <div className={`explorer-flow__step${selectedLane ? ' is-active' : ''}`}>
          <span className="explorer-flow__number">02</span>
          <div>
            <strong>Follow the lifecycle</strong>
            <small>{selectedLane ? selectedLane.feature.label : 'Select a feature on the left'}</small>
          </div>
        </div>
        <div className={`explorer-flow__step${selectedId ? ' is-active' : ''}`}>
          <span className="explorer-flow__number">03</span>
          <div>
            <strong>Verify the evidence</strong>
            <small>
              {selectedId === selectedFeature?.id
                ? 'Aggregate feature evidence'
                : selectedId
                  ? 'Selected claim evidence'
                  : 'Select an episode or commit mark'}
            </small>
          </div>
        </div>
      </div>

      <aside className="feature-index explorer-pane" aria-label="Feature index" tabIndex={0}>
        <div className="feature-index__controls">
          <div className="feature-index__heading">
            <span className="eyebrow">Feature index</span>
            <strong>{matchingFeatures.length}</strong>
          </div>
          <label className="feature-search">
            <span className="sr-only">Find a candidate feature</span>
            <input
              type="search"
              value={query}
              placeholder="Find a feature…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="feature-index__list">
          {matchingFeatures.map((feature) => {
            const lane = laneByFeatureId.get(feature.id)
            const stages = lane?.lifecycleEvents.map((event) => event.semanticEpisode.lifecycleStage) ?? []
            return (
              <button
                key={feature.id}
                type="button"
                className={selectedFeature?.id === feature.id ? 'is-selected' : ''}
                onClick={() => onSelectFeature(feature.id)}
              >
                <strong>{feature.label}</strong>
                <span>{stages.length > 0 ? stages.join(' → ') : 'lifecycle unassigned'}</span>
                <small>{lane ? formatSpan(lane) : `${Math.round(feature.confidence * 100)}% confidence`}</small>
              </button>
            )
          })}
          {matchingFeatures.length === 0 && (
            <div className="feature-index__empty">No feature names match “{query}”.</div>
          )}
        </div>
      </aside>

      <div
        ref={storyPaneRef}
        className="explorer-main explorer-pane"
        role="region"
        aria-label="Selected feature story"
        tabIndex={0}
      >
        {selectedLane ? (
          <FeatureFocus
            dataset={dataset}
            lane={selectedLane}
            chapters={story.chapters}
            selectedId={selectedId}
            selectedChapterId={selectedChapterId}
            selectedLifecycleStage={selectedLifecycleStage}
            onSelect={onSelect}
            onViewAllEvidence={onViewAllEvidence}
          />
        ) : (
          <div className="explorer-empty">
            <span className="eyebrow">Feature story</span>
            <h2>Choose a feature to trace its evolution.</h2>
            <p>Search the feature index or remove a filter to restore matching candidates.</p>
          </div>
        )}
      </div>

      <aside
        ref={evidencePaneRef}
        className="explorer-inspector explorer-pane"
        aria-label="Evidence inspector"
        tabIndex={0}
      >
        {inspector}
      </aside>
    </section>
  )
}
