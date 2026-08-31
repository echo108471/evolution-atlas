/**
 * Grouping commits into capabilities, and measuring whether interpretation earns its
 * cost.
 *
 * Two arms, deliberately kept apart. The deterministic arm sees only observed Git facts -
 * paths and subject words - and never a model's reading. It is the baseline the roadmap
 * has wanted since the beginning: until it exists, nobody can say whether the
 * interpretation stage beats a simple script, and that is the most decision-relevant
 * number in the project.
 *
 * The model arm groups the capability names the readings proposed. Blind tier-2 reading
 * measured those names overlapping only 0.31 between two models reading the same commit,
 * so string matching them is known in advance to fail; the arm exists to find out whether
 * anything else does.
 *
 * Neither arm is shown the other's output, for the same reason tier 2 is not shown tier
 * 1's: a clustering told what the answer looks like will reproduce it.
 */

/** Words too common in commit subjects to distinguish one capability from another. */
const SUBJECT_STOPWORDS = new Set([
  'add', 'added', 'adds', 'adding', 'update', 'updated', 'updates', 'updating', 'fix',
  'fixed', 'fixes', 'fixing', 'remove', 'removed', 'removes', 'change', 'changed',
  'changes', 'refactor', 'refactored', 'improve', 'improved', 'improvement', 'merge',
  'pull', 'request', 'branch', 'from', 'into', 'the', 'and', 'for', 'with', 'that',
  'this', 'some', 'more', 'new', 'use', 'used', 'using', 'make', 'made', 'test', 'tests',
  'feat', 'chore', 'docs', 'wip', 'minor', 'small', 'clean', 'cleanup', 'now', 'not',
])

const tokenize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !SUBJECT_STOPWORDS.has(token))

/**
 * Directories a commit touches, at every depth. Depth matters: two commits under
 * `frontend/` share very little, two under `frontend/src/components/search/` share a
 * great deal, and counting every prefix lets the deeper agreement outweigh the shallow.
 */
export function pathDirectories(episode) {
  const directories = new Set()
  for (const change of episode.changes ?? []) {
    const segments = change.path.split('/')
    segments.pop()
    for (let depth = 1; depth <= segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'))
    }
  }
  return directories
}

export function commitFeatures(episode) {
  return { directories: pathDirectories(episode), tokens: new Set(tokenize(episode.subject)) }
}

export function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  for (const value of small) if (large.has(value)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * Observed-only similarity. Paths carry more weight than words because a path is where
 * the change actually landed, while a subject is whatever the author felt like typing.
 */
export function observedSimilarity(left, right) {
  return 0.65 * jaccard(left.directories, right.directories) + 0.35 * jaccard(left.tokens, right.tokens)
}

/**
 * Four channels of evidence about one commit, kept apart so an arm can be defined by which
 * channels it is allowed to see.
 *
 * The first two are observed Git facts. The last two exist only if interpretation ran. The
 * split is what makes the interesting question answerable: hold the clustering algorithm
 * fixed and vary only the evidence, and whatever changes belongs to the evidence rather
 * than to the method. The existing model arm could not support that claim, because it
 * changed the input and the algorithm at the same time.
 */
export function evidenceChannels(episode, reading) {
  return {
    directories: pathDirectories(episode),
    subject: new Set(tokenize(episode?.subject)),
    capability: new Set(tokenize(reading?.capability)),
    summary: new Set(tokenize(reading?.summary)),
  }
}

/**
 * Channel weights per arm.
 *
 * `OBSERVED` reproduces the baseline exactly. `READING` mirrors its shape - the short label
 * carries more than the prose, as the path carries more than the subject.
 *
 * `COMBINED` is the unweighted mean of the two, deliberately. With no gold set there is
 * nothing to tune a mixture against, so tuning one would amount to fitting the weights to
 * whichever arm looked better afterwards and then reporting that as a finding.
 */
export const OBSERVED_CHANNELS = { directories: 0.65, subject: 0.35, capability: 0, summary: 0 }
export const READING_CHANNELS = { directories: 0, subject: 0, capability: 0.65, summary: 0.35 }
export const COMBINED_CHANNELS = {
  directories: 0.325, subject: 0.175, capability: 0.325, summary: 0.175,
}

export function channelSimilarity(left, right, weights) {
  let total = 0
  for (const channel of Object.keys(weights)) {
    const weight = weights[channel]
    if (!weight) continue
    total += weight * jaccard(left[channel], right[channel])
  }
  return total
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index)
  }

  find(index) {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index]]
      index = this.parent[index]
    }
    return index
  }

  union(left, right) {
    const a = this.find(left)
    const b = this.find(right)
    if (a !== b) this.parent[b] = a
  }
}

function componentsOf(size, edges) {
  const sets = new DisjointSet(size)
  for (const [left, right] of edges) sets.union(left, right)
  const groups = new Map()
  for (let index = 0; index < size; index += 1) {
    const root = sets.find(index)
    const members = groups.get(root) ?? []
    members.push(index)
    groups.set(root, members)
  }
  return [...groups.values()].sort((left, right) => right.length - left.length)
}

/**
 * The deterministic baseline: cluster commits by what they touched and what they were
 * called, with no interpretation involved.
 */
export function clusterObserved(episodes, options = {}) {
  return clusterFeatures(episodes.map((episode) => evidenceChannels(episode, null)), {
    ...options,
    weights: OBSERVED_CHANNELS,
  })
}

/**
 * The clustering itself, shared by every arm so that no arm can win by being clustered
 * differently.
 *
 * `mutual-knn` is the default and the fair version. Linking every pair above a threshold
 * and taking connected components chains transitively - a and b are similar, b and c are
 * similar, and a repository ends up as one cluster of 568 commits out of 606 at every
 * threshold tried. Requiring each commit to be among the other's nearest neighbours, in
 * both directions, breaks the chain without needing a tuned cutoff. `threshold` is kept as
 * a floor so a commit with no real neighbour stays a singleton rather than being dragged
 * into whichever cluster is least dissimilar.
 *
 * A baseline exists to be beaten honestly. Leaving it as single-linkage would have made
 * the comparison meaningless. The defaults were chosen for producing no dominant cluster
 * on the pilot - the largest holds 17 of 606 units - rather than for any downstream score.
 */
export function clusterFeatures(
  features,
  { threshold = 0.35, method = 'mutual-knn', neighbours = 3, weights = OBSERVED_CHANNELS } = {},
) {
  const size = features.length
  const edges = []

  if (method === 'components') {
    for (let left = 0; left < size; left += 1) {
      for (let right = left + 1; right < size; right += 1) {
        if (channelSimilarity(features[left], features[right], weights) >= threshold) {
          edges.push([left, right])
        }
      }
    }
    return componentsOf(size, edges)
  }

  const nearest = []
  for (let index = 0; index < size; index += 1) {
    const scored = []
    for (let other = 0; other < size; other += 1) {
      if (other === index) continue
      const score = channelSimilarity(features[index], features[other], weights)
      if (score >= threshold) scored.push({ other, score })
    }
    scored.sort((left, right) => right.score - left.score)
    nearest.push(new Set(scored.slice(0, neighbours).map((entry) => entry.other)))
  }

  for (let index = 0; index < size; index += 1) {
    for (const other of nearest[index]) {
      if (other > index && nearest[other].has(index)) edges.push([index, other])
    }
  }
  return componentsOf(size, edges)
}

/** Group readings by an assignment of each index to a canonical capability name. */
export function clusterByAssignment(count, assignment) {
  const groups = new Map()
  for (let index = 0; index < count; index += 1) {
    const key = assignment.get(index) ?? `unassigned:${index}`
    const members = groups.get(key) ?? []
    members.push(index)
    groups.set(key, members)
  }
  return [...groups.entries()]
    .map(([label, members]) => ({ label, members }))
    .sort((left, right) => right.members.length - left.members.length)
}

/**
 * How far two clusterings of the same commits agree, counted over pairs.
 *
 * Cluster counts alone cannot be compared - one arm can look better simply by splitting
 * more - so agreement is measured on the question that matters: given two commits, do
 * both arms put them in the same capability? Reported as precision and recall of the
 * model arm against the baseline, with neither treated as truth.
 */
export function pairwiseAgreement(left, right, size) {
  const labelOf = (clusters) => {
    const labels = new Array(size).fill(-1)
    clusters.forEach((members, order) => {
      for (const index of members) labels[index] = order
    })
    return labels
  }

  const leftLabels = labelOf(left)
  const rightLabels = labelOf(right)
  let both = 0
  let leftOnly = 0
  let rightOnly = 0

  for (let a = 0; a < size; a += 1) {
    for (let b = a + 1; b < size; b += 1) {
      const together = leftLabels[a] === leftLabels[b] && leftLabels[a] !== -1
      const alsoTogether = rightLabels[a] === rightLabels[b] && rightLabels[a] !== -1
      if (together && alsoTogether) both += 1
      else if (together) leftOnly += 1
      else if (alsoTogether) rightOnly += 1
    }
  }

  const precision = both + rightOnly === 0 ? 0 : both / (both + rightOnly)
  const recall = both + leftOnly === 0 ? 0 : both / (both + leftOnly)
  return {
    pairsTogetherInBoth: both,
    pairsOnlyInFirst: leftOnly,
    pairsOnlyInSecond: rightOnly,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  }
}

/**
 * How often repeated runs of the same non-deterministic method put the same two commits
 * together.
 *
 * A method that groups differently each time is not a method, however good any one run
 * looks. Cluster counts hide this - two runs can both produce eighty groups and share
 * almost no membership - so stability is counted over commit pairs, the same unit the
 * agreement measure uses. `alwaysShare` is the number that matters: of every pair grouped
 * by any run, the fraction grouped by all of them.
 */
export function groupingStability(clusterings) {
  const runs = clusterings.length
  const counts = new Map()
  for (const clusters of clusterings) {
    for (const members of clusters) {
      if (members.length < 2) continue
      for (let a = 0; a < members.length; a += 1) {
        for (let b = a + 1; b < members.length; b += 1) {
          const [low, high] = members[a] < members[b] ? [members[a], members[b]] : [members[b], members[a]]
          const key = `${low}:${high}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
    }
  }

  const histogram = new Array(runs + 1).fill(0)
  for (const count of counts.values()) histogram[count] += 1
  const everPaired = counts.size
  const alwaysPaired = histogram[runs] ?? 0
  return {
    runs,
    everPaired,
    alwaysPaired,
    alwaysShare: everPaired === 0 ? 0 : alwaysPaired / everPaired,
    pairsByRunCount: histogram,
  }
}

/** Shape of a clustering, so two arms can be compared before either is named. */
export function clusteringShape(clusters, size) {
  const sizes = clusters.map((members) => (Array.isArray(members) ? members.length : members.members.length))
  const singletons = sizes.filter((value) => value === 1).length
  const grouped = size - singletons
  return {
    clusters: clusters.length,
    largest: sizes[0] ?? 0,
    singletons,
    groupedShare: size === 0 ? 0 : grouped / size,
    medianSize: sizes.length === 0 ? 0 : sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)],
  }
}
