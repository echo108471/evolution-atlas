import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { EvidenceRail } from './EvidenceRail'
import { FeatureIndex } from './FeatureIndex'
import { FeatureStory } from './FeatureStory'
import type { StoryModel } from './story'
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

/**
 * The three-column area itself: pick on the left, read in the middle, verify on the
 * right. This component owns the grid and the routing of props to each column, and
 * nothing else — the columns own their own scroll behaviour and local state.
 */
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
  const selectedLane = useMemo(
    () =>
      selectedFeature
        ? (story.lanes.find((lane) => lane.feature.id === selectedFeature.id) ?? null)
        : null,
    [story.lanes, selectedFeature],
  )

  return (
    <section className="explorer-shell">
      <FeatureIndex
        lanes={story.lanes}
        visibleFeatures={visibleFeatures}
        selectedFeatureId={selectedFeature?.id ?? null}
        onSelectFeature={onSelectFeature}
      />

      <FeatureStory
        dataset={dataset}
        lane={selectedLane}
        chapters={story.chapters}
        selectedFeatureId={selectedFeature?.id ?? null}
        selectedId={selectedId}
        selectedChapterId={selectedChapterId}
        selectedLifecycleStage={selectedLifecycleStage}
        onSelect={onSelect}
        onViewAllEvidence={onViewAllEvidence}
      />

      <EvidenceRail selectedId={selectedId}>{inspector}</EvidenceRail>
    </section>
  )
}
