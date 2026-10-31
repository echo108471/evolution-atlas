import { useEffect, useRef } from 'react'

import { FeatureFocus } from './FeatureFocus'
import type { CalendarChapter, StoryLane } from './story'
import type { AtlasDataset, LifecycleStage } from './model'

/** Matches the stylesheet breakpoint where the explorer collapses to one column. */
const SINGLE_COLUMN_QUERY = '(max-width: 880px)'

interface FeatureStoryProps {
  dataset: AtlasDataset
  lane: StoryLane | null
  chapters: CalendarChapter[]
  selectedFeatureId: string | null
  selectedId: string | null
  selectedChapterId: string | null
  selectedLifecycleStage: LifecycleStage | 'all'
  /** A feature the user explicitly asked for (deep link or index choice). */
  revealFeatureId?: string | null
  onSelect: (id: string) => void
  onViewAllEvidence: (id: string) => void
}

/**
 * Middle column: one independently scrollable reading pane beside the feature index
 * and evidence inspector. At narrower widths CSS returns all three to document flow.
 */
export function FeatureStory({
  dataset,
  lane,
  chapters,
  selectedFeatureId,
  selectedId,
  selectedChapterId,
  selectedLifecycleStage,
  revealFeatureId = null,
  onSelect,
  onViewAllEvidence,
}: FeatureStoryProps) {
  const storyRef = useRef<HTMLDivElement>(null)

  // A new selection starts at the beginning of its own pane without moving the
  // surrounding page or either neighboring pane.
  useEffect(() => {
    const pane = storyRef.current
    if (pane) pane.scrollTop = 0
  }, [selectedFeatureId])

  // In the single-column layout the story sits below the feature index, so an explicitly
  // requested feature would otherwise open thousands of pixels down the page. Bring it
  // into view; a default selection (no feature in the URL) leaves the page where it is.
  useEffect(() => {
    const pane = storyRef.current
    if (!pane || !revealFeatureId || revealFeatureId !== selectedFeatureId) return
    if (typeof window.matchMedia !== 'function' || !window.matchMedia(SINGLE_COLUMN_QUERY).matches) return
    const frame = window.requestAnimationFrame(() => pane.scrollIntoView({ block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [revealFeatureId, selectedFeatureId])

  return (
    <div
      ref={storyRef}
      className="explorer-main"
      role="region"
      aria-label="Selected feature story"
      tabIndex={0}
    >
      <div className="explorer-story">
        {lane ? (
          <FeatureFocus
            dataset={dataset}
            lane={lane}
            chapters={chapters}
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
    </div>
  )
}
