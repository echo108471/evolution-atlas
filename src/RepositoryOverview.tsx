import { useMemo } from 'react'

import { LIFECYCLE_STAGES } from './lifecycle'
import type {
  AtlasDataset,
  LifecycleStage,
  SemanticEpisodeCandidate,
  StructuralEpisodeCandidate,
} from './model'
import type { CalendarChapter, StoryLane, StoryModel } from './story'

interface RepositoryOverviewProps {
  dataset: AtlasDataset
  story: StoryModel
  selectedChapterId: string | null
  onSelectChapter: (id: string | null) => void
  onExplore: () => void
  onExploreFeature: (id: string) => void
  onExploreStage: (stage: LifecycleStage) => void
  onInspect: (id: string) => void
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function evidenceTime(
  candidate: SemanticEpisodeCandidate | StructuralEpisodeCandidate,
  episodeTimeBySha: Map<string, number>,
) {
  return candidate.evidence
    .map((reference) => episodeTimeBySha.get(reference.commitSha) ?? 0)
    .reduce((latest, time) => Math.max(latest, time), 0)
}

function featureCardData(lane: StoryLane) {
  const stages = lane.lifecycleEvents.map((event) => event.semanticEpisode.lifecycleStage)
  return {
    stages,
    span: `${formatDate(lane.startTime)} – ${formatDate(lane.endTime)}`,
    eventCount: lane.events.length,
  }
}

function ChapterActivity({
  chapter,
  dataset,
  selected,
  onSelect,
}: {
  chapter: CalendarChapter
  dataset: AtlasDataset
  selected: boolean
  onSelect: () => void
}) {
  const episodeTimeBySha = useMemo(
    () => new Map(dataset.episodes.map((episode) => [episode.commitSha, new Date(episode.authoredAt).getTime()])),
    [dataset.episodes],
  )
  const lifecycleCounts = Object.fromEntries(
    LIFECYCLE_STAGES.map((stage) => [
      stage,
      (dataset.semanticEpisodes ?? []).filter((candidate) => {
        if (candidate.lifecycleStage !== stage) return false
        return candidate.evidence.some((reference) => {
          const time = episodeTimeBySha.get(reference.commitSha)
          return time !== undefined && time >= chapter.startTime && time <= chapter.endTime
        })
      }).length,
    ]),
  ) as Record<LifecycleStage, number>
  const total = Object.values(lifecycleCounts).reduce((sum, count) => sum + count, 0)

  return (
    <button
      type="button"
      className={`activity-chapter${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="activity-chapter__label">
        <strong>{chapter.label}</strong>
        <small>{chapter.featureCount} cited feature candidates</small>
      </span>
      <span className="activity-chapter__bar" aria-hidden="true">
        {LIFECYCLE_STAGES.filter((stage) => lifecycleCounts[stage] > 0).map((stage) => (
          <i
            key={stage}
            className={`activity-segment activity-segment--${stage}`}
            style={{ flexGrow: lifecycleCounts[stage] }}
          />
        ))}
      </span>
      <span className="activity-chapter__count">{total} lifecycle episodes</span>
    </button>
  )
}

export function RepositoryOverview({
  dataset,
  story,
  selectedChapterId,
  onSelectChapter,
  onExplore,
  onExploreFeature,
  onExploreStage,
  onInspect,
}: RepositoryOverviewProps) {
  const episodeTimeBySha = useMemo(
    () => new Map(dataset.episodes.map((episode) => [episode.commitSha, new Date(episode.authoredAt).getTime()])),
    [dataset.episodes],
  )
  const stageCounts = Object.fromEntries(
    LIFECYCLE_STAGES.map((stage) => [
      stage,
      (dataset.semanticEpisodes ?? []).filter((episode) => episode.lifecycleStage === stage).length,
    ]),
  ) as Record<LifecycleStage, number>
  const selectedChapter = story.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null
  const recentLanes = story.lanes
    .filter(
      (lane) =>
        !selectedChapter ||
        lane.events.some(
          (event) => event.time >= selectedChapter.startTime && event.time <= selectedChapter.endTime,
        ),
    )
    .sort((left, right) => right.endTime - left.endTime || left.feature.label.localeCompare(right.feature.label))
    .slice(0, 8)
  const recentStructural = (dataset.structuralEpisodes ?? [])
    .filter((episode) => {
      if (!selectedChapter) return true
      return episode.evidence.some((reference) => {
        const time = episodeTimeBySha.get(reference.commitSha)
        return time !== undefined && time >= selectedChapter.startTime && time <= selectedChapter.endTime
      })
    })
    .sort(
      (left, right) =>
        evidenceTime(right, episodeTimeBySha) - evidenceTime(left, episodeTimeBySha) ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 4)

  return (
    <div className="overview">
      <section className="overview-hero">
        <div>
          <span className="eyebrow">Repository overview</span>
          <h2>Read the codebase as a history of capabilities.</h2>
          <p>
            Start with a calendar chapter or lifecycle stage, then follow one feature into the
            commits, paths, and contributor associations that support it.
          </p>
        </div>
        <button type="button" className="primary-action" onClick={onExplore}>
          Explore feature stories
        </button>
      </section>

      <section className="overview-metrics" aria-label="Repository evidence summary">
        <div><strong>{dataset.featureCandidates.length}</strong><span>candidate features</span></div>
        <div><strong>{dataset.semanticEpisodes?.length ?? 0}</strong><span>lifecycle episodes</span></div>
        <div><strong>{dataset.structuralEpisodes?.length ?? 0}</strong><span>structural episodes</span></div>
        <div><strong>{dataset.episodes.length.toLocaleString()}</strong><span>observed commits</span></div>
      </section>

      <section className="overview-section change-river" aria-labelledby="change-river-heading">
        <div className="overview-section__heading">
          <div>
            <span className="eyebrow">Change over time</span>
            <h2 id="change-river-heading">Calendar chapters</h2>
          </div>
          {selectedChapterId && (
            <button type="button" className="quiet-action" onClick={() => onSelectChapter(null)}>
              Show entire history
            </button>
          )}
        </div>
        <div className="activity-chapters">
          {story.chapters.map((chapter) => (
            <ChapterActivity
              key={chapter.id}
              chapter={chapter}
              dataset={dataset}
              selected={selectedChapterId === chapter.id}
              onSelect={() => onSelectChapter(selectedChapterId === chapter.id ? null : chapter.id)}
            />
          ))}
        </div>
        <div className="activity-legend" aria-label="Lifecycle stage totals">
          {LIFECYCLE_STAGES.map((stage) => (
            <button key={stage} type="button" onClick={() => onExploreStage(stage)}>
              <i className={`legend-mark legend-mark--${stage}`} />
              <span>{stage}</span>
              <strong>{stageCounts[stage]}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="overview-section" aria-labelledby="recent-features-heading">
        <div className="overview-section__heading">
          <div>
            <span className="eyebrow">Continue exploring</span>
            <h2 id="recent-features-heading">
              {selectedChapter ? `${selectedChapter.label} feature stories` : 'Recently evidenced feature stories'}
            </h2>
          </div>
          <button type="button" className="quiet-action" onClick={onExplore}>View all features</button>
        </div>
        <div className="feature-card-grid">
          {recentLanes.map((lane) => {
            const card = featureCardData(lane)
            return (
              <button key={lane.feature.id} type="button" onClick={() => onExploreFeature(lane.feature.id)}>
                <span className="feature-card__span">{card.span}</span>
                <strong>{lane.feature.label}</strong>
                <span className="feature-card__stages">
                  {card.stages.slice(0, 5).map((stage, index) => (
                    <i key={`${stage}:${index}`} className={`legend-mark legend-mark--${stage}`} title={stage} />
                  ))}
                  {card.stages.length === 0 && <small>lifecycle unassigned</small>}
                </span>
                <small>{card.eventCount} cited commits · {Math.round(lane.feature.confidence * 100)}% confidence</small>
              </button>
            )
          })}
        </div>
        <p className="method-note">Ordered by the latest cited evidence, not by importance or impact.</p>
      </section>

      {recentStructural.length > 0 && (
        <section className="overview-section" aria-labelledby="structure-heading">
          <div className="overview-section__heading">
            <div>
              <span className="eyebrow">Repository structure</span>
              <h2 id="structure-heading">Recent candidate reorganizations</h2>
            </div>
          </div>
          <div className="structure-card-list">
            {recentStructural.map((episode) => (
              <button key={episode.id} type="button" onClick={() => onInspect(episode.id)}>
                <span className="structure-card__mark" aria-hidden="true" />
                <span>
                  <strong>{episode.label}</strong>
                  <small>{episode.mappings.length} prefix mappings · {Math.round(episode.confidence * 100)}%</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="method-disclosure overview-method">
        <summary>Evidence and interpretation boundaries</summary>
        <p>
          Feature, lifecycle, and structural labels are candidate interpretations linked to Git evidence.
          Authorship is an observed association, not complete ownership. Counts describe the available
          repository record and are not performance or impact measures.
        </p>
      </details>
    </div>
  )
}
