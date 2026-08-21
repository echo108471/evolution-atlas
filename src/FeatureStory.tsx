import { useEffect, useRef } from 'react'

import { FeatureFocus } from './FeatureFocus'
import type { CalendarChapter, StoryLane } from './story'
import type { AtlasDataset, LifecycleStage } from './model'

interface FeatureStoryProps {
  dataset: AtlasDataset
  lane: StoryLane | null
  chapters: CalendarChapter[]
  selectedFeatureId: string | null
  selectedId: string | null
  selectedChapterId: string | null
  selectedLifecycleStage: LifecycleStage | 'all'
  onSelect: (id: string) => void
  onViewAllEvidence: (id: string) => void
}

/**
 * Middle column: the only one that scrolls with the page. The index and the evidence
 * rails pin beside it, so this column's height is what the page's height is.
 */
export function FeatureStory({
  dataset,
  lane,
  chapters,
  selectedFeatureId,
  selectedId,
  selectedChapterId,
  selectedLifecycleStage,
  onSelect,
  onViewAllEvidence,
}: FeatureStoryProps) {
  const storyRef = useRef<HTMLDivElement>(null)

  // A new story should start at its own beginning, but only for a reader who has
  // already scrolled into the previous one. Pulling the page up under someone who
  // is still above the story would be a jump they never asked for.
  useEffect(() => {
    const pane = storyRef.current
    if (!pane || pane.getBoundingClientRect().top >= 0) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    pane.scrollIntoView({ block: 'start', behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [selectedFeatureId])

  return (
    <div className="explorer-main">
      {/* Orientation rides in the story column rather than above the shell. Above it,
          every reader had to scroll the intro's full height before the rails reached
          their pinned position, so the opening third of the page moved all three
          columns at once. Here the rails are pinned from the first pixel. */}
      <section className="section-intro">
        <div>
          <span className="eyebrow">Feature stories</span>
          <h1>Follow one feature from claim to evidence.</h1>
          <p>
            Each candidate groups commits that appear to serve a single capability. Pick one
            from the index, follow its lifecycle across the timeline, then open any episode or
            commit mark to read what the claim rests on.
          </p>
        </div>
        <p className="section-intro__note">
          Feature groupings and lifecycle labels are candidate interpretations, not established
          facts. Contributor counts describe Git authorship, not ownership or performance.
        </p>
      </section>

      <div ref={storyRef} className="explorer-story">
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
