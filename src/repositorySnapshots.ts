import type {
  AtlasDataset,
  ChangeEpisode,
  StructuralEpisodeCandidate,
} from './model'
import type { StoryModel } from './story'
import { trackKeyForPath, trackLabel } from './directoryLifespans'

export interface RepositorySnapshotChild {
  label: string
  path: string
  fileCount: number
}

export interface RepositorySnapshotNode {
  label: string
  path: string
  fileCount: number
  children: RepositorySnapshotChild[]
  groupedPathCount?: number
}

export interface RepositoryCheckpointChanges {
  commitCount: number
  added: number
  removed: number
  modified: number
  moved: number
  /** Every changed path in the interval, already scoped. */
  paths: string[]
}

export interface RepositoryCheckpoint {
  id: string
  index: number
  episode: ChangeEpisode
  label: string
  kind: 'initial' | 'interval' | 'structural' | 'current'
  percent: number
  nodes: RepositorySnapshotNode[]
  totalFiles: number
  structuralEpisodes: StructuralEpisodeCandidate[]
  changes: RepositoryCheckpointChanges
}

export interface RepositoryTimeMachineModel {
  checkpoints: RepositoryCheckpoint[]
  rangeStart: number
  rangeEnd: number
}

const MAX_VISIBLE_NODES = 12
const MAX_VISIBLE_CHILDREN = 7

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function timePercent(value: number, start: number, end: number) {
  if (start === end) return 50
  return clampPercent(((value - start) / (end - start)) * 100)
}

function applyEpisode(paths: Set<string>, episode: ChangeEpisode) {
  for (const change of episode.changes) {
    if (change.status === 'D') {
      paths.delete(change.path)
      continue
    }
    if (change.status === 'R' && change.previousPath) {
      paths.delete(change.previousPath)
    }
    paths.add(change.path)
  }
}

function inScope(path: string, scopePath: string) {
  return scopePath === '' || path === scopePath || path.startsWith(`${scopePath}/`)
}

function aggregateChildren(path: string, counts: Map<string, number>) {
  const children = [...counts.entries()]
    .map(([label, fileCount]) => ({
      label,
      path: path ? `${path}/${label}` : label,
      fileCount,
    }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount || left.label.localeCompare(right.label),
    )

  if (children.length <= MAX_VISIBLE_CHILDREN) return children
  const visible = children.slice(0, MAX_VISIBLE_CHILDREN - 1)
  const grouped = children.slice(MAX_VISIBLE_CHILDREN - 1)
  visible.push({
    label: `${grouped.length} other entries`,
    path,
    fileCount: grouped.reduce((sum, child) => sum + child.fileCount, 0),
  })
  return visible
}

/** Immediate children of `scopePath`, each with its own first level of entries. */
function aggregateSnapshot(paths: Set<string>, scopePath: string): RepositorySnapshotNode[] {
  const groups = new Map<string, { fileCount: number; children: Map<string, number> }>()

  for (const path of paths) {
    const key = trackKeyForPath(path, scopePath)
    if (key === null) continue
    const relative = scopePath ? path.slice(scopePath.length + 1) : path
    // The files-here node lists filenames; a directory node lists its own entries.
    const remainder = key === '' ? relative : relative.slice(key.length + 1)
    const child = remainder.includes('/')
      ? remainder.slice(0, remainder.indexOf('/'))
      : remainder
    const group = groups.get(key) ?? { fileCount: 0, children: new Map<string, number>() }
    group.fileCount += 1
    group.children.set(child, (group.children.get(child) ?? 0) + 1)
    groups.set(key, group)
  }

  const nodes = [...groups.entries()]
    .map(([key, group]): RepositorySnapshotNode => ({
      label: trackLabel(key, scopePath),
      path: scopePath ? (key ? `${scopePath}/${key}` : scopePath) : key,
      fileCount: group.fileCount,
      children: aggregateChildren(
        scopePath ? (key ? `${scopePath}/${key}` : scopePath) : key,
        group.children,
      ),
    }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount || left.label.localeCompare(right.label),
    )

  if (nodes.length <= MAX_VISIBLE_NODES) return nodes
  const visible = nodes.slice(0, MAX_VISIBLE_NODES - 1)
  const grouped = nodes.slice(MAX_VISIBLE_NODES - 1)
  visible.push({
    label: 'Other directories',
    path: scopePath,
    fileCount: grouped.reduce((sum, node) => sum + node.fileCount, 0),
    groupedPathCount: grouped.length,
    children: grouped.map((node) => ({
      label: node.label,
      path: node.path,
      fileCount: node.fileCount,
    })),
  })
  return visible
}

function summarizeChanges(
  episodes: ChangeEpisode[],
  scopePath: string,
): RepositoryCheckpointChanges {
  let added = 0
  let removed = 0
  let modified = 0
  let moved = 0
  let commitCount = 0
  const seen = new Set<string>()
  const paths: string[] = []

  for (const episode of episodes) {
    let touchedScope = false
    for (const change of episode.changes) {
      const relevant =
        inScope(change.path, scopePath) ||
        (change.previousPath ? inScope(change.previousPath, scopePath) : false)
      if (!relevant) continue
      touchedScope = true

      if (change.status === 'R') moved += 1
      else if (change.status === 'D') removed += 1
      else if (change.status === 'A' || change.status === 'C') added += 1
      else modified += 1

      const label = change.previousPath
        ? `${change.previousPath} → ${change.path}`
        : change.path
      if (!seen.has(label)) {
        seen.add(label)
        paths.push(label)
      }
    }
    if (touchedScope) commitCount += 1
  }

  return { commitCount, added, removed, modified, moved, paths }
}

function checkpointLabel(episode: ChangeEpisode) {
  return new Date(episode.authoredAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function buildRepositoryTimeMachine(
  dataset: AtlasDataset,
  story: StoryModel,
  scopePath = '',
): RepositoryTimeMachineModel {
  if (dataset.episodes.length === 0) {
    return { checkpoints: [], rangeStart: story.rangeStart, rangeEnd: story.rangeEnd }
  }

  const episodeIndexBySha = new Map(
    dataset.episodes.map((episode, index) => [episode.commitSha, index]),
  )
  const structuralByIndex = new Map<number, StructuralEpisodeCandidate[]>()
  for (const event of story.structuralEvents) {
    const index = episodeIndexBySha.get(event.episode.commitSha)
    if (index === undefined) continue
    const candidates = structuralByIndex.get(index) ?? []
    candidates.push(event.structuralEpisode)
    structuralByIndex.set(index, candidates)
  }

  const checkpointIndexes = new Set<number>([0, dataset.episodes.length - 1])
  for (const index of structuralByIndex.keys()) checkpointIndexes.add(index)

  // Month boundaries keep the "since previous checkpoint" summary at a scale a
  // reader can actually hold; year boundaries left intervals of 500+ commits.
  const firstIndexByMonth = new Map<string, number>()
  dataset.episodes.forEach((episode, index) => {
    const date = new Date(episode.authoredAt)
    const month = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    if (!firstIndexByMonth.has(month)) firstIndexByMonth.set(month, index)
  })
  for (const index of firstIndexByMonth.values()) checkpointIndexes.add(index)

  const orderedIndexes = [...checkpointIndexes].sort((left, right) => left - right)
  const snapshotsByIndex = new Map<number, RepositorySnapshotNode[]>()
  const totalFilesByIndex = new Map<number, number>()
  const currentPaths = new Set<string>()
  const neededIndexes = new Set(orderedIndexes)

  dataset.episodes.forEach((episode, index) => {
    applyEpisode(currentPaths, episode)
    if (!neededIndexes.has(index)) return
    snapshotsByIndex.set(index, aggregateSnapshot(currentPaths, scopePath))
    let scopedTotal = 0
    for (const path of currentPaths) {
      if (trackKeyForPath(path, scopePath) !== null) scopedTotal += 1
    }
    totalFilesByIndex.set(index, scopedTotal)
  })

  let previousIndex = -1
  const checkpoints = orderedIndexes.map((index): RepositoryCheckpoint => {
    const episode = dataset.episodes[index]
    const structuralEpisodes = structuralByIndex.get(index) ?? []
    const isInitial = index === 0
    const isCurrent = index === dataset.episodes.length - 1
    const kind: RepositoryCheckpoint['kind'] = structuralEpisodes.length > 0
      ? 'structural'
      : isInitial
        ? 'initial'
        : isCurrent
          ? 'current'
          : 'interval'
    const label = structuralEpisodes[0]?.label ??
      (isInitial
        ? 'Initial repository state'
        : isCurrent
          ? 'Current repository state'
          : checkpointLabel(episode))
    const intervalEpisodes = dataset.episodes.slice(previousIndex + 1, index + 1)
    previousIndex = index

    return {
      id: `checkpoint:${episode.commitSha}`,
      index,
      episode,
      label,
      kind,
      percent: timePercent(
        new Date(episode.authoredAt).getTime(),
        story.rangeStart,
        story.rangeEnd,
      ),
      nodes: snapshotsByIndex.get(index) ?? [],
      totalFiles: totalFilesByIndex.get(index) ?? 0,
      structuralEpisodes,
      changes: summarizeChanges(intervalEpisodes, scopePath),
    }
  })

  return { checkpoints, rangeStart: story.rangeStart, rangeEnd: story.rangeEnd }
}
