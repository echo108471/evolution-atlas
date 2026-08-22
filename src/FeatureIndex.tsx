import { useMemo, useState } from 'react'

import { formatSpan } from './dateFormat'
import type { StoryLane } from './story'
import type { FeatureCandidate } from './model'

interface FeatureIndexProps {
  lanes: StoryLane[]
  visibleFeatures: FeatureCandidate[]
  selectedFeatureId: string | null
  onSelectFeature: (id: string) => void
}

/**
 * Left column: the list you pick a candidate from. The search term never leaves this
 * component — nothing outside the index reacts to it, and keeping it here means typing
 * cannot re-render the story or the evidence beside it.
 */
export function FeatureIndex({
  lanes,
  visibleFeatures,
  selectedFeatureId,
  onSelectFeature,
}: FeatureIndexProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleFeatureIds = useMemo(
    () => new Set(visibleFeatures.map((feature) => feature.id)),
    [visibleFeatures],
  )
  // Walking the lanes rather than the features keeps each row's lifecycle and span
  // beside the feature it describes, with no second lookup to fall out of step.
  const matchingLanes = lanes.filter(
    (lane) =>
      visibleFeatureIds.has(lane.feature.id) &&
      lane.feature.label.toLowerCase().includes(normalizedQuery),
  )

  return (
    <div className="feature-index">
      <div className="explorer-rail">
        <div className="feature-index__controls">
          <div className="feature-index__heading">
            <span className="eyebrow">Feature index</span>
            <strong>{matchingLanes.length}</strong>
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
        <div
          className="feature-index__list"
          role="region"
          aria-label="Feature index results"
          tabIndex={0}
        >
          {matchingLanes.map((lane) => {
            const stages = lane.lifecycleEvents.map(
              (event) => event.semanticEpisode.lifecycleStage,
            )
            return (
              <button
                key={lane.feature.id}
                type="button"
                className={selectedFeatureId === lane.feature.id ? 'is-selected' : ''}
                onClick={() => onSelectFeature(lane.feature.id)}
              >
                <strong>{lane.feature.label}</strong>
                <span>{stages.length > 0 ? stages.join(' → ') : 'lifecycle unassigned'}</span>
                <small>{formatSpan(lane)}</small>
              </button>
            )
          })}
          {matchingLanes.length === 0 && (
            <div className="feature-index__empty">No feature names match “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  )
}
