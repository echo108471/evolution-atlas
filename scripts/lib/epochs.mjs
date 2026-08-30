import { createHash } from 'node:crypto'

/**
 * Epoch detection runs two independent passes over the same history and keeps the
 * disagreement rather than resolving it.
 *
 * A model reads raw commit windows and marks where the work changed character. Two
 * deterministic detectors measure where the distribution of touched paths, and of
 * subject vocabulary, shifts. Neither is shown the other's output: an LLM handed a
 * detector's peaks can only ratify or rank within them, which measures agreement
 * rather than judgment.
 *
 * Measured on a 2,693-commit repository, the two find the same transition at
 * different moments — usually within days, occasionally with the model days ahead of
 * the file layout. So a boundary is recorded as an interval spanning both readings
 * rather than a single commit, and the commits inside it are the genuinely ambiguous
 * ones.
 */

export const EPOCH_METHOD_PREFIX = 'epoch-boundaries'

/** Commits on either side of a candidate position that the focus signals compare. */
const FOCUS_WINDOW = 60
/** Proposals this close came from overlapping request windows: one boundary, seen twice. */
const CLUSTER_RADIUS = 25
/** How far from a proposal a focus peak may sit and still be the same transition. */
const PAIR_REACH = 120
/** Minimum commits between two retained focus peaks. */
const PEAK_SEPARATION = 120

/**
 * Subject words too common across commit messages to distinguish one phase of work
 * from another. Dropping them keeps the vocabulary signal responsive to what changed
 * rather than to how the team writes commit messages.
 */
const SUBJECT_STOP_WORDS = new Set(
  `the a an and or of to for in on with fix fixes fixed add adds added update updates
   updated merge pull request from branch into is it be this that new use using make
   change changes chore feat refactor wip minor more some all not now`.split(/\s+/),
)

function stableId(namespace, value) {
  return `${namespace}:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function pathDistribution(episode) {
  const counts = new Map()
  for (const change of episode.changes) {
    const key = change.path.split('/').slice(0, 2).join('/')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function subjectDistribution(episode) {
  const counts = new Map()
  for (const word of episode.subject.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || SUBJECT_STOP_WORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

function normalizedSum(vectors, start, end) {
  const totals = new Map()
  for (let index = start; index < end; index += 1) {
    for (const [key, value] of vectors[index]) totals.set(key, (totals.get(key) ?? 0) + value)
  }
  let mass = 0
  for (const value of totals.values()) mass += value
  const distribution = new Map()
  for (const [key, value] of totals) distribution.set(key, value / (mass || 1))
  return distribution
}

/** Jensen-Shannon divergence in bits: 0 when identical, 1 when the supports are disjoint. */
function divergence(left, right) {
  let total = 0
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? 0
    const b = right.get(key) ?? 0
    const mean = (a + b) / 2
    if (a > 0) total += (a * Math.log2(a / mean)) / 2
    if (b > 0) total += (b * Math.log2(b / mean)) / 2
  }
  return total
}

function standardize(rows, key) {
  if (rows.length === 0) return
  const mean = rows.reduce((sum, row) => sum + row[key], 0) / rows.length
  const deviation = Math.sqrt(
    rows.reduce((sum, row) => sum + (row[key] - mean) ** 2, 0) / rows.length,
  )
  for (const row of rows) row[`${key}Z`] = deviation === 0 ? 0 : (row[key] - mean) / deviation
}

/**
 * Score every interior commit position by how much the work on either side differs,
 * measured twice: over the paths commits touch, and over the words their subjects use.
 * These are observations about the recorded history, not interpretations of it.
 */
export function buildFocusSignals(episodes, { window = FOCUS_WINDOW } = {}) {
  const paths = episodes.map(pathDistribution)
  const subjects = episodes.map(subjectDistribution)
  const rows = []
  for (let index = window; index <= episodes.length - window; index += 1) {
    rows.push({
      index,
      path: divergence(
        normalizedSum(paths, index - window, index),
        normalizedSum(paths, index, index + window),
      ),
      language: divergence(
        normalizedSum(subjects, index - window, index),
        normalizedSum(subjects, index, index + window),
      ),
    })
  }
  standardize(rows, 'path')
  standardize(rows, 'language')
  return rows
}

/**
 * Keep the strongest positions for one signal, suppressing neighbours so a single broad
 * shift is reported once rather than as a ridge of adjacent commits.
 *
 * `minScore` is what keeps the count from manufacturing peaks: taking the top N always
 * returns N, and on a history with only a few real shifts the tail of that list sits at
 * or below the average divergence. A position that is not more divergent than the
 * repository's own baseline is not evidence of anything.
 */
export function detectFocusPeaks(
  rows,
  kind,
  { count = 14, separation = PEAK_SEPARATION, minScore = 1 } = {},
) {
  const key = kind === 'path' ? 'pathZ' : 'languageZ'
  const kept = []
  for (const row of [...rows].sort((left, right) => right[key] - left[key])) {
    if (row[key] < minScore) break
    if (kept.every((other) => Math.abs(other.index - row.index) >= separation)) kept.push(row)
    if (kept.length >= count) break
  }
  return kept
    .map((row) => ({ index: row.index, kind, score: row[key] }))
    .sort((left, right) => left.index - right.index)
}

/**
 * Fold proposals from overlapping request windows into one boundary each. A boundary
 * seen by two windows carries more weight than one seen by a window that happened to
 * straddle it, so the vote count is retained rather than averaged away.
 */
export function clusterProposals(proposals, { radius = CLUSTER_RADIUS } = {}) {
  const resolved = proposals
    .filter((proposal) => Number.isInteger(proposal.index))
    .sort((left, right) => left.index - right.index)

  const clusters = []
  for (const proposal of resolved) {
    const current = clusters[clusters.length - 1]
    if (current && proposal.index - current.index <= radius) {
      current.members.push(proposal)
      current.index = Math.round((current.index + proposal.index) / 2)
      continue
    }
    clusters.push({ index: proposal.index, members: [proposal] })
  }

  return clusters.map((cluster) => {
    const best = cluster.members.reduce((left, right) =>
      (right.confidence ?? 0) > (left.confidence ?? 0) ? right : left,
    )
    return {
      index: cluster.index,
      votes: new Set(cluster.members.map((member) => member.windowStart)).size,
      confidence: Math.max(...cluster.members.map((member) => member.confidence ?? 0)),
      before: best.before ?? null,
      after: best.after ?? null,
      reason: best.reason ?? null,
    }
  })
}

function dayGap(left, right) {
  return Math.round(Math.abs(new Date(left) - new Date(right)) / 86400000)
}

/**
 * Pair each proposed boundary with the nearest focus peak and record the pair as an
 * interval. Neither reading is treated as authoritative about *when* the phase turned:
 * measured, the model sometimes leads the file layout and sometimes trails it, so the
 * interval spans both rather than assuming an order.
 */
export function buildBoundaryIntervals(clusters, peaks, episodes, { reach = PAIR_REACH } = {}) {
  // Assign each peak to at most one boundary, nearest pairs first. Letting a single
  // focus shift vouch for two separate proposals would count one piece of evidence
  // twice and overstate how much the two passes actually agree.
  const candidatePairs = []
  for (const cluster of clusters) {
    for (const peak of peaks) {
      const distance = Math.abs(peak.index - cluster.index)
      if (distance <= reach) candidatePairs.push({ cluster, peak, distance })
    }
  }
  candidatePairs.sort((left, right) => left.distance - right.distance)

  const pairedPeak = new Map()
  const claimed = new Set()
  for (const { cluster, peak } of candidatePairs) {
    if (pairedPeak.has(cluster) || claimed.has(peak)) continue
    pairedPeak.set(cluster, peak)
    claimed.add(peak)
  }

  const boundaries = clusters.map((cluster) => {
    const paired = pairedPeak.get(cluster) ?? null
    const nearby = paired ? [paired] : []

    const proposedAt = episodes[cluster.index]
    const settledAt = paired ? episodes[paired.index] : null
    const [startIndex, endIndex] = paired
      ? [Math.min(cluster.index, paired.index), Math.max(cluster.index, paired.index)]
      : [cluster.index, cluster.index]

    const signals = [
      {
        kind: 'phase-proposal',
        label: cluster.reason ?? 'A model read the surrounding commits as a change of phase.',
        basis: 'candidate',
        weight: cluster.confidence,
      },
      ...nearby.map((peak) => ({
        kind: peak.kind === 'path' ? 'path-focus-shift' : 'language-focus-shift',
        label:
          peak.kind === 'path'
            ? 'The distribution of touched paths shifts sharply here.'
            : 'The vocabulary of commit subjects shifts sharply here.',
        basis: 'observed',
        weight: Number(peak.score.toFixed(2)),
      })),
    ]

    return {
      id: stableId('epoch-boundary', `${proposedAt.commitSha}:${settledAt?.commitSha ?? ''}`),
      status: 'candidate',
      confidence: Number(cluster.confidence.toFixed(2)),
      votes: cluster.votes,
      // Where a reader would say the work changed character.
      proposedIndex: cluster.index,
      proposedSha: proposedAt.commitSha,
      proposedAt: proposedAt.authoredAt,
      // Where the recorded history measurably changed shape, when it did.
      settledIndex: paired?.index ?? null,
      settledSha: settledAt?.commitSha ?? null,
      settledAt: settledAt?.authoredAt ?? null,
      startIndex,
      endIndex,
      spanCommits: endIndex - startIndex,
      spanDays: settledAt ? dayGap(proposedAt.authoredAt, settledAt.authoredAt) : 0,
      corroborated: paired !== null,
      before: cluster.before,
      after: cluster.after,
      signals,
    }
  })

  const unpaired = peaks
    .filter((peak) => !claimed.has(peak))
    .map((peak) => ({
      index: peak.index,
      kind: peak.kind,
      score: Number(peak.score.toFixed(2)),
      commitSha: episodes[peak.index].commitSha,
      authoredAt: episodes[peak.index].authoredAt,
      subject: episodes[peak.index].subject,
    }))

  return { boundaries, unpairedFocusPeaks: unpaired }
}

/**
 * Cut the history at the retained boundaries. An epoch runs from the end of one
 * boundary interval to the start of the next, so the ambiguous commits inside an
 * interval belong to neither side and are reported as the transition itself.
 */
export function buildEpochs(boundaries, episodes, { minCommits = 40 } = {}) {
  const cuts = [...boundaries].sort((left, right) => left.startIndex - right.startIndex)
  const epochs = []
  let cursor = 0

  for (const boundary of cuts) {
    if (boundary.startIndex - cursor < minCommits) continue
    epochs.push({ startIndex: cursor, endIndex: boundary.startIndex, closedBy: boundary.id })
    cursor = boundary.endIndex
  }
  if (episodes.length - cursor > 0) {
    epochs.push({ startIndex: cursor, endIndex: episodes.length, closedBy: null })
  }

  return epochs.map((epoch, order) => {
    const first = episodes[epoch.startIndex]
    const last = episodes[epoch.endIndex - 1]
    return {
      id: stableId('epoch', `${order}:${first.commitSha}`),
      order,
      startIndex: epoch.startIndex,
      endIndex: epoch.endIndex,
      commitCount: epoch.endIndex - epoch.startIndex,
      firstCommitSha: first.commitSha,
      lastCommitSha: last.commitSha,
      firstAuthoredAt: first.authoredAt,
      lastAuthoredAt: last.authoredAt,
      closedBy: epoch.closedBy,
    }
  })
}
