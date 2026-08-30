/**
 * Situating context for a single commit, assembled from observed history alone.
 *
 * A commit read in isolation cannot be understood: `fix: handle null in parser` says
 * nothing about what was being built. The obvious fix is a rolling summary carried
 * forward by the model, but that makes commit N+1 depend on the output for commit N,
 * which forces the entire history through one sequential chain and defeats prompt
 * caching. Region-owning agents were the other candidate and have the same defect in a
 * milder form.
 *
 * Everything here is instead derived from the atlas: which areas the commit touches, how
 * old they are, which of its paths are appearing or disappearing, and what else was
 * recently happening in the same part of the tree. That is enough to situate the change,
 * it costs nothing, and it depends on no other model call - so every commit in a history
 * can be analyzed in parallel.
 */

const RECENT_NEIGHBOURS = 8
const MAX_PATHS_SHOWN = 14
const MAX_SUBJECT = 100

/**
 * One pass over the history, giving every later lookup O(1) access to when a path or an
 * area was first and last touched, and in what order.
 */
export function buildContextIndex(episodes) {
  const pathFirstSeen = new Map()
  const pathLastSeen = new Map()
  const areaCommits = new Map()
  const areaFirstSeen = new Map()

  episodes.forEach((episode, index) => {
    for (const change of episode.changes ?? []) {
      if (!pathFirstSeen.has(change.path)) pathFirstSeen.set(change.path, index)
      pathLastSeen.set(change.path, index)
      if (change.previousPath && !pathFirstSeen.has(change.previousPath)) {
        pathFirstSeen.set(change.previousPath, index)
      }
    }
    for (const areaId of episode.codeAreaIds ?? []) {
      if (!areaFirstSeen.has(areaId)) areaFirstSeen.set(areaId, index)
      const commits = areaCommits.get(areaId) ?? []
      commits.push(index)
      areaCommits.set(areaId, commits)
    }
  })

  return { pathFirstSeen, pathLastSeen, areaCommits, areaFirstSeen }
}

const dayGap = (from, to) => {
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null
}

/**
 * The commits immediately before this one that touched the same areas. This is the
 * "what was going on here lately" signal, and it is what a rolling state would have
 * carried - recovered by lookup instead of by generation.
 *
 * Commits are indexed in topological order, which is the order they were built in, but
 * not the order they were authored in: 6.8% of adjacent pairs in the pilot run backwards
 * by date. Neighbours authored after this commit are dropped rather than reported as
 * "earlier", which is how the epoch pass first produced periods that ended before they
 * began.
 */
function recentNeighbours(episodes, contextIndex, episodeIndex, limit) {
  const authoredAt = episodes[episodeIndex].authoredAt
  const seen = new Set()
  const collected = []
  for (const areaId of episodes[episodeIndex].codeAreaIds ?? []) {
    const commits = contextIndex.areaCommits.get(areaId) ?? []
    // The list is ascending, so walk back from the current position.
    for (let cursor = commits.length - 1; cursor >= 0; cursor -= 1) {
      const candidate = commits[cursor]
      if (candidate >= episodeIndex) continue
      if (seen.has(candidate)) continue
      seen.add(candidate)
      if (episodes[candidate].authoredAt > authoredAt) continue
      collected.push(candidate)
      if (collected.length >= limit * 2) break
    }
  }
  return collected.sort((left, right) => right - left).slice(0, limit).reverse()
}

/**
 * Build the situation for one commit. `dataset` supplies area labels; `contextIndex`
 * comes from `buildContextIndex` and is reused across every commit in a run.
 */
export function situate(dataset, contextIndex, episodeIndex, { neighbours = RECENT_NEIGHBOURS } = {}) {
  const episodes = dataset.episodes
  const episode = episodes[episodeIndex]
  const areaLabels = new Map(dataset.codeAreas.map((area) => [area.id, area.label]))

  const areas = (episode.codeAreaIds ?? []).map((areaId) => {
    const firstIndex = contextIndex.areaFirstSeen.get(areaId) ?? episodeIndex
    const commits = contextIndex.areaCommits.get(areaId) ?? []
    const priorCommits = commits.filter((index) => index < episodeIndex).length
    return {
      id: areaId,
      label: areaLabels.get(areaId) ?? areaId,
      isNew: firstIndex === episodeIndex,
      priorCommits,
      ageDays: dayGap(episodes[firstIndex].authoredAt, episode.authoredAt),
    }
  })

  const changes = (episode.changes ?? []).map((change) => ({
    path: change.path,
    previousPath: change.previousPath ?? null,
    status: change.status,
    isNewPath: contextIndex.pathFirstSeen.get(change.path) === episodeIndex,
    isLastTouch: contextIndex.pathLastSeen.get(change.path) === episodeIndex,
  }))

  const neighbourIndices = recentNeighbours(episodes, contextIndex, episodeIndex, neighbours)

  return {
    index: episodeIndex,
    position: episodeIndex + 1,
    total: episodes.length,
    commitSha: episode.commitSha,
    shortSha: episode.shortSha,
    subject: episode.subject,
    authoredAt: episode.authoredAt,
    areas,
    changes,
    newPathCount: changes.filter((change) => change.isNewPath).length,
    deletedCount: changes.filter((change) => change.status === 'D').length,
    renamedCount: changes.filter((change) => change.previousPath).length,
    recent: neighbourIndices.map((index) => ({
      shortSha: episodes[index].shortSha,
      authoredAt: episodes[index].authoredAt,
      subject: episodes[index].subject,
      daysBefore: dayGap(episodes[index].authoredAt, episode.authoredAt),
    })),
  }
}

const describeArea = (area) => {
  if (area.isNew) return `${area.label} (first appears in this commit)`
  const age = area.ageDays === null ? 'unknown age' : `${area.ageDays}d old`
  return `${area.label} (${area.priorCommits} prior commits, ${age})`
}

const describeChange = (change) => {
  const marks = []
  if (change.isNewPath) marks.push('new')
  if (change.status === 'D') marks.push('deleted')
  if (change.previousPath) marks.push(`renamed from ${change.previousPath}`)
  return `  ${change.path}${marks.length > 0 ? `  [${marks.join(', ')}]` : ''}`
}

/** Render a situation as the prompt text a tier sees. */
export function renderContext(situation) {
  const lines = [
    `Commit ${situation.position} of ${situation.total}, authored ${situation.authoredAt.slice(0, 10)}.`,
    '',
    'Parts of the tree it touches:',
    ...(situation.areas.length > 0
      ? situation.areas.map((area) => `  ${describeArea(area)}`)
      : ['  none recorded']),
    '',
    `Files changed (${situation.changes.length}):`,
    ...situation.changes.slice(0, MAX_PATHS_SHOWN).map(describeChange),
  ]

  if (situation.changes.length > MAX_PATHS_SHOWN) {
    lines.push(`  ... and ${situation.changes.length - MAX_PATHS_SHOWN} more`)
  }

  if (situation.recent.length > 0) {
    lines.push('', 'Recent work in the same parts of the tree, oldest first:')
    for (const neighbour of situation.recent) {
      const when = neighbour.daysBefore === null ? '' : ` (${neighbour.daysBefore}d earlier)`
      lines.push(`  ${neighbour.subject.slice(0, MAX_SUBJECT)}${when}`)
    }
  }

  return lines.join('\n')
}
