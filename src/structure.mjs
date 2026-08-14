export const STRUCTURE_METHOD = 'deterministic-structure-v1'

function stableId(namespace, value) {
  let left = 0xdeadbeef ^ value.length
  let right = 0x41c6ce57 ^ value.length
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index)
    left = Math.imul(left ^ character, 2654435761)
    right = Math.imul(right ^ character, 1597334677)
  }
  left = Math.imul(left ^ (left >>> 16), 2246822507) ^ Math.imul(right ^ (right >>> 13), 3266489909)
  right = Math.imul(right ^ (right >>> 16), 2246822507) ^ Math.imul(left ^ (left >>> 13), 3266489909)
  const digest = `${(right >>> 0).toString(16).padStart(8, '0')}${(left >>> 0).toString(16).padStart(8, '0')}`
  return `${namespace}:${digest}`
}

function segments(path) {
  return path.split('/').filter(Boolean)
}

function commonSuffixLength(leftPath, rightPath) {
  const left = segments(leftPath)
  const right = segments(rightPath)
  let length = 0
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1
  }
  return length
}

function prefixMapping(previousPath, path) {
  const previous = segments(previousPath)
  const current = segments(path)
  const suffixLength = commonSuffixLength(previousPath, path)
  if (suffixLength === 0) return null
  const fromPrefix = previous.slice(0, previous.length - suffixLength).join('/')
  const toPrefix = current.slice(0, current.length - suffixLength).join('/')
  if (fromPrefix === toPrefix) return null
  return { fromPrefix, toPrefix, suffixLength }
}

function renameTransitions(changes) {
  return changes
    .filter((change) => change.status === 'R' && change.previousPath && change.previousPath !== change.path)
    .map((change) => {
      const mapping = prefixMapping(change.previousPath, change.path)
      if (!mapping) return null
      const parsedSimilarity = Number.parseInt(change.similarity ?? '', 10)
      const similarity = Number.isFinite(parsedSimilarity) ? parsedSimilarity / 100 : 0.75
      return {
        previousPath: change.previousPath,
        path: change.path,
        basis: 'git-rename',
        confidence: Math.max(0.5, Math.min(1, similarity)),
        similarity: Number.isFinite(parsedSimilarity) ? parsedSimilarity : undefined,
        ...mapping,
      }
    })
    .filter(Boolean)
}

function pairedDeleteAddTransitions(changes) {
  const deleted = changes.filter((change) => change.status === 'D')
  const added = changes.filter((change) => change.status === 'A')
  const candidates = []
  const addedByTail = new Map()
  added.forEach((created, createdIndex) => {
    const key = segments(created.path).slice(-2).join('/')
    const entries = addedByTail.get(key) ?? []
    entries.push({ created, createdIndex })
    addedByTail.set(key, entries)
  })

  deleted.forEach((removed, removedIndex) => {
    const key = segments(removed.path).slice(-2).join('/')
    const possibleMatches = addedByTail.get(key) ?? []
    if (possibleMatches.length > 16) return
    possibleMatches.forEach(({ created, createdIndex }) => {
      const mapping = prefixMapping(removed.path, created.path)
      if (!mapping || mapping.suffixLength < 2) return
      const longestPath = Math.max(segments(removed.path).length, segments(created.path).length)
      const pathContinuity = mapping.suffixLength / longestPath
      candidates.push({ removed, created, removedIndex, createdIndex, pathContinuity, ...mapping })
    })
  })

  candidates.sort(
    (left, right) =>
      right.pathContinuity - left.pathContinuity ||
      left.removed.path.localeCompare(right.removed.path) ||
      left.created.path.localeCompare(right.created.path),
  )
  const usedRemoved = new Set()
  const usedCreated = new Set()
  const transitions = []
  for (const candidate of candidates) {
    if (usedRemoved.has(candidate.removedIndex) || usedCreated.has(candidate.createdIndex)) continue
    usedRemoved.add(candidate.removedIndex)
    usedCreated.add(candidate.createdIndex)
    transitions.push({
      previousPath: candidate.removed.path,
      path: candidate.created.path,
      basis: 'delete-add-path-continuity',
      confidence: Number(Math.min(0.68, 0.45 + candidate.pathContinuity * 0.23).toFixed(2)),
      fromPrefix: candidate.fromPrefix,
      toPrefix: candidate.toPrefix,
      suffixLength: candidate.suffixLength,
    })
  }
  return transitions
}

function displayPrefix(prefix) {
  return prefix || 'repository root'
}

function labelForMappings(mappings) {
  const dominant = mappings[0]
  const total = mappings.reduce((sum, mapping) => sum + mapping.fileCount, 0)
  if (dominant.fileCount / total < 0.75) return 'Repository layout reorganization'
  if (dominant.fromPrefix && !dominant.toPrefix) {
    return `Promote ${dominant.fromPrefix} contents to repository root`
  }
  if (!dominant.fromPrefix && dominant.toPrefix) {
    return `Move repository root files into ${dominant.toPrefix}`
  }
  return `Reorganize ${displayPrefix(dominant.fromPrefix)} into ${displayPrefix(dominant.toPrefix)}`
}

function buildEpisodeCandidate(episode) {
  const transitions = [...renameTransitions(episode.changes), ...pairedDeleteAddTransitions(episode.changes)]
  if (transitions.length < 3) return null

  const mappingCounts = new Map()
  for (const transition of transitions) {
    const key = `${transition.fromPrefix}\0${transition.toPrefix}`
    const existing = mappingCounts.get(key) ?? {
      fromPrefix: transition.fromPrefix,
      toPrefix: transition.toPrefix,
      fileCount: 0,
    }
    existing.fileCount += 1
    mappingCounts.set(key, existing)
  }
  const mappings = [...mappingCounts.values()].sort(
    (left, right) =>
      right.fileCount - left.fileCount ||
      left.fromPrefix.localeCompare(right.fromPrefix) ||
      left.toPrefix.localeCompare(right.toPrefix),
  )
  const dominantRatio = mappings[0].fileCount / transitions.length
  const corroboratedCount = mappings
    .filter((mapping) => mapping.fileCount >= 2)
    .reduce((sum, mapping) => sum + mapping.fileCount, 0)
  if (dominantRatio < 0.6 && (transitions.length < 6 || corroboratedCount / transitions.length < 0.7)) {
    return null
  }

  const averageConfidence =
    transitions.reduce((sum, transition) => sum + transition.confidence, 0) / transitions.length
  const inferredCount = transitions.filter(
    (transition) => transition.basis === 'delete-add-path-continuity',
  ).length
  const inferredRatio = inferredCount / transitions.length
  const volume = Math.min(1, Math.max(0, (transitions.length - 2) / 8))
  const confidence = Math.max(
    0.5,
    Math.min(
      0.98,
      0.55 + averageConfidence * 0.22 + dominantRatio * 0.12 + volume * 0.08 - inferredRatio * 0.18,
    ),
  )
  const renameCount = transitions.length - inferredCount
  const basisDescription = [
    renameCount > 0 ? `${renameCount} Git rename record${renameCount === 1 ? '' : 's'}` : null,
    inferredCount > 0
      ? `${inferredCount} cautious delete/add path pairing${inferredCount === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const mappingDescription = mappings
    .slice(0, 3)
    .map(
      (mapping) =>
        `${displayPrefix(mapping.fromPrefix)} → ${displayPrefix(mapping.toPrefix)} (${mapping.fileCount})`,
    )
    .join(', ')

  return {
    id: stableId('structural', `${episode.commitSha}:${mappings.map((mapping) => `${mapping.fromPrefix}>${mapping.toPrefix}`).join('|')}`),
    kind: 'repository-reorganization',
    label: labelForMappings(mappings),
    status: 'candidate',
    confidence: Number(confidence.toFixed(2)),
    method: STRUCTURE_METHOD,
    rationale: `${basisDescription} show a concentrated path transition: ${mappingDescription}. This establishes an observable repository-layout change, not why it was made.`,
    evidence: [
      {
        commitSha: episode.commitSha,
        paths: [...new Set(transitions.flatMap((transition) => [transition.previousPath, transition.path]))].sort(),
      },
    ],
    mappings,
    transitions: transitions.map(({ suffixLength: _suffixLength, ...transition }) => transition),
  }
}

export function buildStructuralEpisodes(episodes) {
  return episodes.map(buildEpisodeCandidate).filter(Boolean)
}
