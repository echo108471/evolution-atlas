import { scaleTime } from 'd3'

import type {
  AtlasDataset,
  ChangeEpisode,
  CodeArea,
  Contributor,
  FeatureCandidate,
  SemanticEpisodeCandidate,
  StructuralEpisodeCandidate,
} from './model'
import type { ContributorProfile } from './identity'

export type { LifecycleStage } from './model'

export interface StoryEvent {
  id: string
  episode: ChangeEpisode
  time: number
  percent: number
  stack: number
}

export interface StoryLane {
  feature: FeatureCandidate
  events: StoryEvent[]
  lifecycleEvents: LifecycleStoryEvent[]
  startTime: number
  endTime: number
  startPercent: number
  endPercent: number
}

export interface LifecycleStoryEvent {
  id: string
  semanticEpisode: SemanticEpisodeCandidate
  episodes: ChangeEpisode[]
  startTime: number
  endTime: number
  startPercent: number
  endPercent: number
}

export interface StructuralStoryEvent {
  id: string
  structuralEpisode: StructuralEpisodeCandidate
  episode: ChangeEpisode
  time: number
  percent: number
}

export interface CalendarChapter {
  id: string
  label: string
  startTime: number
  endTime: number
  startPercent: number
  widthPercent: number
  commitCount: number
  featureCount: number
}

export interface StoryModel {
  lanes: StoryLane[]
  structuralEvents: StructuralStoryEvent[]
  chapters: CalendarChapter[]
  rangeStart: number
  rangeEnd: number
}

export interface AreaMatrixCell {
  areaId: string
  count: number
  commitShas: string[]
}

export interface AreaMatrixRow {
  feature: FeatureCandidate
  cells: Map<string, AreaMatrixCell>
}

export interface AreaMatrixModel {
  columns: Array<CodeArea & { count: number }>
  rows: AreaMatrixRow[]
  maxCount: number
}

export interface FeatureAssociations {
  contributors: Array<Contributor & { count: number }>
  areas: Array<CodeArea & { count: number }>
  episodes: ChangeEpisode[]
}

export interface ContributorTrailEvent extends StoryEvent {
  isAuthored: boolean
}

export interface ContributorFeatureLane {
  feature: FeatureCandidate
  events: ContributorTrailEvent[]
  lifecycleEvents: LifecycleStoryEvent[]
  authoredEvents: ContributorTrailEvent[]
  startPercent: number
  endPercent: number
}

export interface ContributorAreaLane {
  area: CodeArea
  events: StoryEvent[]
}

export interface ContributorTrailModel {
  contributor: ContributorProfile
  chapters: CalendarChapter[]
  featureLanes: ContributorFeatureLane[]
  areaLanes: ContributorAreaLane[]
  authoredEpisodes: ChangeEpisode[]
  uncitedEpisodes: ChangeEpisode[]
  rangeStart: number
  rangeEnd: number
}

function datasetRange(dataset: AtlasDataset) {
  const fallback = Date.now()
  const first = dataset.timeRange.firstAuthoredAt
    ? new Date(dataset.timeRange.firstAuthoredAt).getTime()
    : dataset.episodes[0]
      ? new Date(dataset.episodes[0].authoredAt).getTime()
      : fallback
  const last = dataset.timeRange.lastAuthoredAt
    ? new Date(dataset.timeRange.lastAuthoredAt).getTime()
    : dataset.episodes.at(-1)
      ? new Date(dataset.episodes.at(-1)!.authoredAt).getTime()
      : first
  return first === last ? [first - 86_400_000, last + 86_400_000] : [first, last]
}

function resolvedEpisodes(feature: FeatureCandidate, episodeBySha: Map<string, ChangeEpisode>) {
  return resolvedEvidence(feature.evidence, episodeBySha)
}

function resolvedEvidence(
  evidence: Array<{ commitSha: string }>,
  episodeBySha: Map<string, ChangeEpisode>,
) {
  const seen = new Set<string>()
  return evidence
    .map((reference) => episodeBySha.get(reference.commitSha))
    .filter((episode): episode is ChangeEpisode => {
      if (!episode || seen.has(episode.commitSha)) return false
      seen.add(episode.commitSha)
      return true
    })
    .sort((left, right) => left.authoredAt.localeCompare(right.authoredAt))
}

function lifecycleForFeature(
  semanticEpisodes: SemanticEpisodeCandidate[],
  featureId: string,
) {
  return semanticEpisodes.filter((episode) => episode.featureId === featureId)
}

function resolvedFeatureHistory(
  feature: FeatureCandidate,
  semanticEpisodes: SemanticEpisodeCandidate[],
  episodeBySha: Map<string, ChangeEpisode>,
) {
  return resolvedEvidence(
    [
      ...feature.evidence,
      ...lifecycleForFeature(semanticEpisodes, feature.id).flatMap((episode) => episode.evidence),
    ],
    episodeBySha,
  )
}

function buildLifecycleEvents(
  semanticEpisodes: SemanticEpisodeCandidate[],
  episodeBySha: Map<string, ChangeEpisode>,
  timeScale: (value: Date) => number,
): LifecycleStoryEvent[] {
  return semanticEpisodes
    .map((semanticEpisode): LifecycleStoryEvent | null => {
      const episodes = resolvedEvidence(semanticEpisode.evidence, episodeBySha)
      if (episodes.length === 0) return null
      const startTime = new Date(episodes[0].authoredAt).getTime()
      const endTime = new Date(episodes.at(-1)!.authoredAt).getTime()
      return {
        id: semanticEpisode.id,
        semanticEpisode,
        episodes,
        startTime,
        endTime,
        startPercent: timeScale(new Date(startTime)),
        endPercent: timeScale(new Date(endTime)),
      }
    })
    .filter((event): event is LifecycleStoryEvent => event !== null)
    .sort(
      (left, right) =>
        left.startTime - right.startTime ||
        left.endTime - right.endTime ||
        left.semanticEpisode.label.localeCompare(right.semanticEpisode.label),
    )
}

function stackOverlappingEvents(events: StoryEvent[]) {
  let lastPercent = -10
  let stack = 0
  for (const event of events) {
    stack = event.percent - lastPercent < 0.7 ? (stack + 1) % 3 : 0
    event.stack = stack
    lastPercent = event.percent
  }
}

export function buildStoryModel(
  dataset: AtlasDataset,
  features: FeatureCandidate[] = dataset.featureCandidates,
  structuralEpisodes: StructuralEpisodeCandidate[] = dataset.structuralEpisodes ?? [],
  semanticEpisodes: SemanticEpisodeCandidate[] = dataset.semanticEpisodes ?? [],
): StoryModel {
  const [rangeStart, rangeEnd] = datasetRange(dataset)
  const timeScale = scaleTime()
    .domain([new Date(rangeStart), new Date(rangeEnd)])
    .range([0, 100])
    .clamp(true)
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))

  const lanes = features
    .map((feature): StoryLane | null => {
      const episodes = resolvedFeatureHistory(feature, semanticEpisodes, episodeBySha)
      if (episodes.length === 0) return null
      const events = episodes.map((episode) => ({
        id: episode.id,
        episode,
        time: new Date(episode.authoredAt).getTime(),
        percent: timeScale(new Date(episode.authoredAt)),
        stack: 0,
      }))
      stackOverlappingEvents(events)
      const lifecycleEvents = buildLifecycleEvents(
        lifecycleForFeature(semanticEpisodes, feature.id),
        episodeBySha,
        timeScale,
      )
      return {
        feature,
        events,
        lifecycleEvents,
        startTime: events[0].time,
        endTime: events.at(-1)!.time,
        startPercent: events[0].percent,
        endPercent: events.at(-1)!.percent,
      }
    })
    .filter((lane): lane is StoryLane => lane !== null)
    .sort(
      (left, right) =>
        left.startTime - right.startTime ||
        right.feature.confidence - left.feature.confidence ||
        left.feature.label.localeCompare(right.feature.label),
    )

  const structuralEvents = structuralEpisodes
    .map((structuralEpisode): StructuralStoryEvent | null => {
      const episode = structuralEpisode.evidence
        .map((reference) => episodeBySha.get(reference.commitSha))
        .find((candidate): candidate is ChangeEpisode => Boolean(candidate))
      if (!episode) return null
      return {
        id: structuralEpisode.id,
        structuralEpisode,
        episode,
        time: new Date(episode.authoredAt).getTime(),
        percent: timeScale(new Date(episode.authoredAt)),
      }
    })
    .filter((event): event is StructuralStoryEvent => event !== null)
    .sort(
      (left, right) =>
        left.time - right.time ||
        right.structuralEpisode.confidence - left.structuralEpisode.confidence,
    )

  const startYear = new Date(rangeStart).getUTCFullYear()
  const endYear = new Date(rangeEnd).getUTCFullYear()
  const chapters: CalendarChapter[] = []

  for (let year = startYear; year <= endYear; year += 1) {
    const startTime = Math.max(rangeStart, Date.UTC(year, 0, 1))
    const endTime = Math.min(rangeEnd, Date.UTC(year + 1, 0, 1) - 1)
    const featureIds = new Set(
      lanes
        .filter((lane) => lane.events.some((event) => event.time >= startTime && event.time <= endTime))
        .map((lane) => lane.feature.id),
    )
    chapters.push({
      id: `year:${year}`,
      label: String(year),
      startTime,
      endTime,
      startPercent: timeScale(new Date(startTime)),
      widthPercent: timeScale(new Date(endTime)) - timeScale(new Date(startTime)),
      commitCount: dataset.episodes.filter((episode) => {
        const time = new Date(episode.authoredAt).getTime()
        return time >= startTime && time <= endTime
      }).length,
      featureCount: featureIds.size,
    })
  }

  return { lanes, structuralEvents, chapters, rangeStart, rangeEnd }
}

export function featureTouchesChapter(
  dataset: AtlasDataset,
  feature: FeatureCandidate,
  chapter: CalendarChapter,
  semanticEpisodes: SemanticEpisodeCandidate[] = dataset.semanticEpisodes ?? [],
) {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  return resolvedFeatureHistory(feature, semanticEpisodes, episodeBySha).some((episode) => {
    const time = new Date(episode.authoredAt).getTime()
    return time >= chapter.startTime && time <= chapter.endTime
  })
}

export function structuralEpisodeTouchesChapter(
  dataset: AtlasDataset,
  structuralEpisode: StructuralEpisodeCandidate,
  chapter: CalendarChapter,
) {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  return structuralEpisode.evidence.some((reference) => {
    const episode = episodeBySha.get(reference.commitSha)
    if (!episode) return false
    const time = new Date(episode.authoredAt).getTime()
    return time >= chapter.startTime && time <= chapter.endTime
  })
}

export function semanticEpisodeTouchesChapter(
  dataset: AtlasDataset,
  semanticEpisode: SemanticEpisodeCandidate,
  chapter: CalendarChapter,
) {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  return resolvedEvidence(semanticEpisode.evidence, episodeBySha).some((episode) => {
    const time = new Date(episode.authoredAt).getTime()
    return time >= chapter.startTime && time <= chapter.endTime
  })
}

export function buildAreaMatrix(
  dataset: AtlasDataset,
  features: FeatureCandidate[] = dataset.featureCandidates,
): AreaMatrixModel {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  const areaById = new Map(dataset.codeAreas.map((area) => [area.id, area]))
  const totals = new Map<string, number>()
  let maxCount = 0

  const rows = features.map((feature) => {
    const cellShas = new Map<string, Set<string>>()
    for (const episode of resolvedEpisodes(feature, episodeBySha)) {
      for (const areaId of episode.codeAreaIds) {
        const shas = cellShas.get(areaId) ?? new Set<string>()
        shas.add(episode.commitSha)
        cellShas.set(areaId, shas)
      }
    }

    const cells = new Map<string, AreaMatrixCell>()
    for (const [areaId, shas] of cellShas) {
      const count = shas.size
      maxCount = Math.max(maxCount, count)
      totals.set(areaId, (totals.get(areaId) ?? 0) + count)
      cells.set(areaId, { areaId, count, commitShas: [...shas].sort() })
    }
    return { feature, cells }
  })

  const columns = [...totals.entries()]
    .map(([areaId, count]) => ({ ...areaById.get(areaId)!, count }))
    .filter((area) => area.id)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  return { columns, rows, maxCount }
}

export function buildContributorTrail(
  dataset: AtlasDataset,
  contributor: Contributor | ContributorProfile,
  features: FeatureCandidate[] = dataset.featureCandidates,
  chapter: CalendarChapter | null = null,
  semanticEpisodes: SemanticEpisodeCandidate[] = dataset.semanticEpisodes ?? [],
): ContributorTrailModel {
  const repositoryStory = buildStoryModel(dataset, features, [], semanticEpisodes)
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  const areaById = new Map(dataset.codeAreas.map((area) => [area.id, area]))
  const timeScale = scaleTime()
    .domain([new Date(repositoryStory.rangeStart), new Date(repositoryStory.rangeEnd)])
    .range([0, 100])
    .clamp(true)

  const resolvedContributor: ContributorProfile = 'identityIds' in contributor
    ? contributor
    : {
        ...contributor,
        identityIds: [contributor.id],
        resolutionStatus: 'observed',
      }
  const identityIds = new Set(resolvedContributor.identityIds)
  const isAuthored = (episode: ChangeEpisode) =>
    episode.contributorIds.some((identityId) => identityIds.has(identityId))
  const authoredEpisodes = dataset.episodes
    .filter(isAuthored)
    .filter((episode) => {
      if (!chapter) return true
      const time = new Date(episode.authoredAt).getTime()
      return time >= chapter.startTime && time <= chapter.endTime
    })
    .sort((left, right) => left.authoredAt.localeCompare(right.authoredAt))
  const authoredIds = new Set(authoredEpisodes.map((episode) => episode.id))

  const featureLanes = features
    .map((feature): ContributorFeatureLane | null => {
      const episodes = resolvedFeatureHistory(feature, semanticEpisodes, episodeBySha)
      const events = episodes.map((episode): ContributorTrailEvent => ({
        id: episode.id,
        episode,
        time: new Date(episode.authoredAt).getTime(),
        percent: timeScale(new Date(episode.authoredAt)),
        stack: 0,
        isAuthored: isAuthored(episode),
      }))
      stackOverlappingEvents(events)
      const authoredEvents = events.filter((event) => event.isAuthored)
      const focusedAuthoredEvents = authoredEvents.filter((event) => authoredIds.has(event.id))
      if (focusedAuthoredEvents.length === 0) return null
      return {
        feature,
        events,
        lifecycleEvents: buildLifecycleEvents(
          lifecycleForFeature(semanticEpisodes, feature.id),
          episodeBySha,
          timeScale,
        ),
        authoredEvents,
        startPercent: events[0].percent,
        endPercent: events.at(-1)!.percent,
      }
    })
    .filter((lane): lane is ContributorFeatureLane => lane !== null)
    .sort(
      (left, right) =>
        left.authoredEvents[0].time - right.authoredEvents[0].time ||
        left.feature.label.localeCompare(right.feature.label),
    )

  const eventsByArea = new Map<string, StoryEvent[]>()
  for (const episode of authoredEpisodes) {
    for (const areaId of episode.codeAreaIds) {
      const events = eventsByArea.get(areaId) ?? []
      events.push({
        id: episode.id,
        episode,
        time: new Date(episode.authoredAt).getTime(),
        percent: timeScale(new Date(episode.authoredAt)),
        stack: 0,
      })
      eventsByArea.set(areaId, events)
    }
  }
  const areaLanes = [...eventsByArea.entries()]
    .map(([areaId, events]) => {
      stackOverlappingEvents(events)
      return { area: areaById.get(areaId)!, events }
    })
    .filter((lane) => lane.area)
    .sort(
      (left, right) =>
        right.events.length - left.events.length || left.area.label.localeCompare(right.area.label),
    )

  const citedCommitShas = new Set(
    [
      ...features.flatMap((feature) => feature.evidence),
      ...semanticEpisodes.flatMap((episode) => episode.evidence),
    ].map((reference) => reference.commitSha),
  )
  const uncitedEpisodes = authoredEpisodes.filter(
    (episode) => !citedCommitShas.has(episode.commitSha),
  )

  return {
    contributor: resolvedContributor,
    chapters: repositoryStory.chapters,
    featureLanes,
    areaLanes,
    authoredEpisodes,
    uncitedEpisodes,
    rangeStart: repositoryStory.rangeStart,
    rangeEnd: repositoryStory.rangeEnd,
  }
}

export function deriveFeatureAssociations(
  dataset: AtlasDataset,
  feature: FeatureCandidate,
  semanticEpisodes: SemanticEpisodeCandidate[] = dataset.semanticEpisodes ?? [],
): FeatureAssociations {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  const contributorById = new Map(dataset.contributors.map((entry) => [entry.id, entry]))
  const areaById = new Map(dataset.codeAreas.map((entry) => [entry.id, entry]))
  const contributorCounts = new Map<string, number>()
  const areaCounts = new Map<string, number>()
  const episodes = resolvedFeatureHistory(feature, semanticEpisodes, episodeBySha)

  for (const episode of episodes) {
    for (const contributorId of episode.contributorIds) {
      contributorCounts.set(contributorId, (contributorCounts.get(contributorId) ?? 0) + 1)
    }
    for (const areaId of episode.codeAreaIds) {
      areaCounts.set(areaId, (areaCounts.get(areaId) ?? 0) + 1)
    }
  }

  const contributors = [...contributorCounts.entries()]
    .map(([id, count]) => ({ ...contributorById.get(id)!, count }))
    .filter((entry) => entry.id)
    .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName))
  const areas = [...areaCounts.entries()]
    .map(([id, count]) => ({ ...areaById.get(id)!, count }))
    .filter((entry) => entry.id)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  return { contributors, areas, episodes }
}
