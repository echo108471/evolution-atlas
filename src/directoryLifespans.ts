import type { AtlasDataset } from './model'
import type { StoryModel } from './story'

/**
 * Directory lifespan model.
 *
 * The repository section reads structure as continuity rather than as a state at
 * one instant: every directory inside the current scope becomes a band whose
 * thickness follows its observed file count across the whole history. Bands are
 * observed path counts. Prefix transitions are candidate interpretations and stay
 * visually distinct from the bands they connect.
 */

export interface DirectoryTrack {
  /** Scope-relative segment. An empty key holds files stored directly in scope. */
  key: string
  path: string
  label: string
  /** Observed file count per sampled column, zero outside the directory's lifespan. */
  samples: number[]
  peakFileCount: number
  currentFileCount: number
  firstSeenTime: number | null
  /** Time the directory last emptied, or null while it still holds files. */
  emptiedTime: number | null
  firstPercent: number
  lastPercent: number
  isActive: boolean
  hasChildren: boolean
  /** Set on the aggregate row that stands in for directories below the display cap. */
  groupedTrackCount?: number
}

export interface ShapeTransition {
  id: string
  episodeId: string
  label: string
  fromKey: string
  toKey: string
  fromLabel: string
  toLabel: string
  fileCount: number
  confidence: number
  time: number
  percent: number
  shortSha: string
}

export interface ShapeMarker {
  id: string
  label: string
  time: number
  percent: number
  confidence: number
  shortSha: string
  withinScope: boolean
}

export interface RepositoryShapeModel {
  scopePath: string
  columns: number
  tracks: DirectoryTrack[]
  transitions: ShapeTransition[]
  markers: ShapeMarker[]
  rangeStart: number
  rangeEnd: number
  peakFileCount: number
  filesInScopeAtEnd: number
  hiddenTrackCount: number
}

const SHAPE_COLUMNS = 168
const MAX_TRACKS = 14

const ROOT_FILES_LABEL = '(files here)'

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function timePercent(value: number, start: number, end: number) {
  if (start === end) return 50
  return clampPercent(((value - start) / (end - start)) * 100)
}

/**
 * Resolve the scope-relative directory a path belongs to.
 * Returns null when the path sits outside the current scope.
 */
export function trackKeyForPath(path: string, scopePath: string): string | null {
  if (scopePath) {
    if (!path.startsWith(`${scopePath}/`)) return null
    const relative = path.slice(scopePath.length + 1)
    const slash = relative.indexOf('/')
    return slash === -1 ? '' : relative.slice(0, slash)
  }
  const slash = path.indexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Resolve a structural prefix to the track that represents it in the current scope. */
function trackKeyForPrefix(prefix: string, scopePath: string): string | null {
  if (!scopePath) {
    const slash = prefix.indexOf('/')
    return slash === -1 ? prefix : prefix.slice(0, slash)
  }
  if (prefix === scopePath) return ''
  if (!prefix.startsWith(`${scopePath}/`)) return null
  const relative = prefix.slice(scopePath.length + 1)
  const slash = relative.indexOf('/')
  return slash === -1 ? relative : relative.slice(0, slash)
}

export function trackLabel(key: string, scopePath = '') {
  if (key !== '') return key
  return scopePath ? ROOT_FILES_LABEL : '(root files)'
}

/** How a transition endpoint reads when it resolves to the scope itself. */
function endpointLabel(key: string, scopePath: string) {
  if (key !== '') return key
  return scopePath || 'repository root'
}

export function scopeLabel(scopePath: string) {
  return scopePath === '' ? 'repository root' : scopePath
}

function pathHasChildren(path: string, key: string, scopePath: string) {
  const prefix = scopePath ? `${scopePath}/${key}/` : `${key}/`
  return key !== '' && path.startsWith(prefix) && path.slice(prefix.length).includes('/')
}

export function buildRepositoryShape(
  dataset: AtlasDataset,
  story: StoryModel,
  scopePath = '',
): RepositoryShapeModel {
  const rangeStart = story.rangeStart
  const rangeEnd = story.rangeEnd
  const empty: RepositoryShapeModel = {
    scopePath,
    columns: SHAPE_COLUMNS,
    tracks: [],
    transitions: [],
    markers: [],
    rangeStart,
    rangeEnd,
    peakFileCount: 0,
    filesInScopeAtEnd: 0,
    hiddenTrackCount: 0,
  }
  if (dataset.episodes.length === 0) return empty

  // Replay in dataset (commit) order, exactly as the checkpoint model does. Author
  // dates are not monotonic across rebases, so sorting by them would reconstruct a
  // different tree than the snapshot beside it.
  const episodes = dataset.episodes

  const paths = new Set<string>()
  const counts = new Map<string, number>()
  const series = new Map<string, number[]>()
  const firstSeen = new Map<string, number>()
  const emptied = new Map<string, number>()
  const withChildren = new Set<string>()

  const span = Math.max(rangeEnd - rangeStart, 1)
  const columnFor = (time: number) =>
    Math.max(
      0,
      Math.min(
        SHAPE_COLUMNS - 1,
        Math.floor(((time - rangeStart) / span) * (SHAPE_COLUMNS - 1)),
      ),
    )

  const seriesFor = (key: string) => {
    const existing = series.get(key)
    if (existing) return existing
    const created = new Array<number>(SHAPE_COLUMNS).fill(0)
    series.set(key, created)
    return created
  }

  const addPath = (path: string, time: number) => {
    if (paths.has(path)) return
    paths.add(path)
    const key = trackKeyForPath(path, scopePath)
    if (key === null) return
    if (pathHasChildren(path, key, scopePath)) withChildren.add(key)
    const next = (counts.get(key) ?? 0) + 1
    counts.set(key, next)
    seriesFor(key)
    if (!firstSeen.has(key)) firstSeen.set(key, time)
    if (next > 0) emptied.delete(key)
  }

  const removePath = (path: string, time: number) => {
    if (!paths.delete(path)) return
    const key = trackKeyForPath(path, scopePath)
    if (key === null) return
    const next = Math.max(0, (counts.get(key) ?? 0) - 1)
    counts.set(key, next)
    if (next === 0) emptied.set(key, time)
  }

  let columnIndex = 0
  const writeColumn = (index: number) => {
    for (const [key, count] of counts) seriesFor(key)[index] = count
  }

  for (const episode of episodes) {
    const time = new Date(episode.authoredAt).getTime()
    const column = columnFor(time)
    while (columnIndex < column) {
      writeColumn(columnIndex)
      columnIndex += 1
    }
    for (const change of episode.changes) {
      if (change.status === 'D') {
        removePath(change.path, time)
        continue
      }
      if (change.status === 'R' && change.previousPath) {
        removePath(change.previousPath, time)
      }
      addPath(change.path, time)
    }
  }
  while (columnIndex < SHAPE_COLUMNS) {
    writeColumn(columnIndex)
    columnIndex += 1
  }

  const transitionKeys = new Set<string>()
  const transitions: ShapeTransition[] = []
  const markers: ShapeMarker[] = []

  for (const event of story.structuralEvents) {
    const merged = new Map<string, ShapeTransition>()
    for (const mapping of event.structuralEpisode.mappings) {
      const fromKey = trackKeyForPrefix(mapping.fromPrefix, scopePath)
      const toKey = trackKeyForPrefix(mapping.toPrefix, scopePath)
      if (fromKey === null || toKey === null || fromKey === toKey) continue
      const pairKey = `${fromKey}->${toKey}`
      const existing = merged.get(pairKey)
      if (existing) {
        existing.fileCount += mapping.fileCount
        continue
      }
      merged.set(pairKey, {
        id: `${event.id}:${pairKey}`,
        episodeId: event.id,
        label: event.structuralEpisode.label,
        fromKey,
        toKey,
        fromLabel: endpointLabel(fromKey, scopePath),
        toLabel: endpointLabel(toKey, scopePath),
        fileCount: mapping.fileCount,
        confidence: event.structuralEpisode.confidence,
        time: event.time,
        percent: event.percent,
        shortSha: event.episode.shortSha,
      })
    }
    for (const transition of merged.values()) {
      transitions.push(transition)
      transitionKeys.add(transition.fromKey)
      transitionKeys.add(transition.toKey)
    }
    markers.push({
      id: event.id,
      label: event.structuralEpisode.label,
      time: event.time,
      percent: event.percent,
      confidence: event.structuralEpisode.confidence,
      shortSha: event.episode.shortSha,
      withinScope: merged.size > 0,
    })
  }

  const allTracks = [...series.entries()].map(([key, samples]): DirectoryTrack => {
    let peakFileCount = 0
    let firstColumn = -1
    let lastColumn = -1
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index]
      if (value > peakFileCount) peakFileCount = value
      if (value > 0) {
        if (firstColumn === -1) firstColumn = index
        lastColumn = index
      }
    }
    const currentFileCount = counts.get(key) ?? 0
    const columnPercent = (column: number) =>
      column < 0 ? 0 : clampPercent((column / (SHAPE_COLUMNS - 1)) * 100)

    return {
      key,
      path: scopePath ? (key ? `${scopePath}/${key}` : scopePath) : key,
      label: trackLabel(key, scopePath),
      samples,
      peakFileCount,
      currentFileCount,
      firstSeenTime: firstSeen.get(key) ?? null,
      emptiedTime: currentFileCount === 0 ? emptied.get(key) ?? null : null,
      firstPercent: columnPercent(firstColumn),
      lastPercent: columnPercent(lastColumn),
      isActive: currentFileCount > 0,
      hasChildren: withChildren.has(key),
    }
  })

  const ranked = allTracks
    .filter((track) => track.peakFileCount > 0)
    .sort(
      (left, right) =>
        // Loose files in the scope are not a directory, so they settle below the rows
        // that are; the rest rank by how much of the tree they ever held.
        Number(left.key === '') - Number(right.key === '') ||
        right.peakFileCount - left.peakFileCount ||
        left.label.localeCompare(right.label),
    )

  let tracks = ranked
  let hiddenTrackCount = 0
  if (ranked.length > MAX_TRACKS) {
    // Never hide a directory that a candidate transition points at: the link
    // would otherwise connect a row the reader cannot see.
    const kept: DirectoryTrack[] = []
    const grouped: DirectoryTrack[] = []
    for (const track of ranked) {
      const required = transitionKeys.has(track.key)
      if (required || kept.length < MAX_TRACKS - 1) kept.push(track)
      else grouped.push(track)
    }
    if (grouped.length > 0) {
      const samples = new Array<number>(SHAPE_COLUMNS).fill(0)
      for (const track of grouped) {
        for (let index = 0; index < SHAPE_COLUMNS; index += 1) {
          samples[index] += track.samples[index]
        }
      }
      let peakFileCount = 0
      let firstColumn = -1
      let lastColumn = -1
      for (let index = 0; index < samples.length; index += 1) {
        if (samples[index] > peakFileCount) peakFileCount = samples[index]
        if (samples[index] > 0) {
          if (firstColumn === -1) firstColumn = index
          lastColumn = index
        }
      }
      const currentFileCount = grouped.reduce(
        (sum, track) => sum + track.currentFileCount,
        0,
      )
      kept.push({
        key: ' grouped',
        path: scopePath,
        label: `${grouped.length} smaller director${grouped.length === 1 ? 'y' : 'ies'}`,
        samples,
        peakFileCount,
        currentFileCount,
        firstSeenTime: null,
        emptiedTime: null,
        firstPercent: firstColumn < 0 ? 0 : clampPercent((firstColumn / (SHAPE_COLUMNS - 1)) * 100),
        lastPercent: lastColumn < 0 ? 0 : clampPercent((lastColumn / (SHAPE_COLUMNS - 1)) * 100),
        isActive: currentFileCount > 0,
        hasChildren: false,
        groupedTrackCount: grouped.length,
      })
      hiddenTrackCount = grouped.length
    }
    tracks = kept
  }

  const peakFileCount = tracks.reduce(
    (peak, track) => Math.max(peak, track.peakFileCount),
    0,
  )
  const filesInScopeAtEnd = tracks.reduce(
    (sum, track) => sum + track.currentFileCount,
    0,
  )

  return {
    scopePath,
    columns: SHAPE_COLUMNS,
    tracks,
    transitions,
    markers,
    rangeStart,
    rangeEnd,
    peakFileCount,
    filesInScopeAtEnd,
    hiddenTrackCount,
  }
}

/** Scope paths a reader can drill into from the current scope. */
export function childScopePath(scopePath: string, track: DirectoryTrack) {
  if (!track.hasChildren || track.key === '' || track.groupedTrackCount) return null
  return scopePath ? `${scopePath}/${track.key}` : track.key
}

export function scopeBreadcrumb(scopePath: string) {
  if (!scopePath) return [{ label: 'repository root', path: '' }]
  const parts = scopePath.split('/').filter(Boolean)
  const crumbs = [{ label: 'repository root', path: '' }]
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}

export function shapeTimeAtPercent(percent: number, model: RepositoryShapeModel) {
  const ratio = clampPercent(percent) / 100
  return model.rangeStart + ratio * (model.rangeEnd - model.rangeStart)
}

export function shapePercentForTime(time: number, model: RepositoryShapeModel) {
  return timePercent(time, model.rangeStart, model.rangeEnd)
}
