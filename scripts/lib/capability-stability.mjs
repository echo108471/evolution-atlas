/**
 * Label-independent comparison of blind capability-induction runs.
 *
 * Names are retained only to make the report inspectable. Matching and every
 * agreement metric below use cited commit SHAs exclusively.
 */

const unique = (values) => [...new Set(Array.isArray(values) ? values : [])]
const set = (values) => new Set(unique(values))

export function jaccard(leftValues, rightValues) {
  const left = set(leftValues)
  const right = set(rightValues)
  if (left.size === 0 && right.size === 0) return 1
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

const evidenceOverlap = (leftValues, rightValues) => {
  const left = set(leftValues)
  const right = set(rightValues)
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  const union = left.size + right.size - intersection
  return {
    intersection,
    union,
    jaccard: union === 0 ? 1 : intersection / union,
    leftCoverage: left.size === 0 ? 0 : intersection / left.size,
    rightCoverage: right.size === 0 ? 0 : intersection / right.size,
  }
}

const describeNode = (node, parentId = null) => ({
  id: node.id,
  name: node.name,
  parentId,
  evidence: unique(node.rollupEvidence ?? node.directEvidence),
})

const topNodes = (document) => (document.capabilities ?? []).map((node) => describeNode(node))

const childNodes = (document) => (document.capabilities ?? []).flatMap((parent) =>
  (parent.children ?? []).map((node) => describeNode(node, parent.id)))

// Exact maximum-weight one-to-one assignment. Dummy rows and columns have zero
// weight, so evidence-disjoint nodes remain unmatched instead of being paired by
// list position. This is the Hungarian algorithm expressed as minimization.
function maximumWeightAssignment(weights) {
  const size = Math.max(weights.length, ...weights.map((row) => row.length), 0)
  if (size === 0) return []
  const square = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => weights[row]?.[column] ?? 0))
  const u = new Array(size + 1).fill(0)
  const v = new Array(size + 1).fill(0)
  const p = new Array(size + 1).fill(0)
  const way = new Array(size + 1).fill(0)

  for (let row = 1; row <= size; row += 1) {
    p[0] = row
    let column0 = 0
    const minimum = new Array(size + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Array(size + 1).fill(false)
    do {
      used[column0] = true
      const row0 = p[column0]
      let delta = Number.POSITIVE_INFINITY
      let column1 = 0
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue
        const cost = -square[row0 - 1][column - 1] - u[row0] - v[column]
        if (cost < minimum[column]) {
          minimum[column] = cost
          way[column] = column0
        }
        if (minimum[column] < delta) {
          delta = minimum[column]
          column1 = column
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]] += delta
          v[column] -= delta
        } else {
          minimum[column] -= delta
        }
      }
      column0 = column1
    } while (p[column0] !== 0)

    do {
      const column1 = way[column0]
      p[column0] = p[column1]
      column0 = column1
    } while (column0 !== 0)
  }

  const assignment = new Array(size).fill(-1)
  for (let column = 1; column <= size; column += 1) {
    if (p[column] > 0) assignment[p[column] - 1] = column - 1
  }
  return assignment
}

export function matchNodes(leftNodes, rightNodes) {
  const overlaps = leftNodes.map((left) => rightNodes.map((right) =>
    evidenceOverlap(left.evidence, right.evidence)))
  const assignment = maximumWeightAssignment(overlaps.map((row) => row.map((value) => value.jaccard)))
  const matches = []
  const matchedLeft = new Set()
  const matchedRight = new Set()

  for (let leftIndex = 0; leftIndex < leftNodes.length; leftIndex += 1) {
    const rightIndex = assignment[leftIndex]
    if (rightIndex < 0 || rightIndex >= rightNodes.length) continue
    const overlap = overlaps[leftIndex][rightIndex]
    if (overlap.intersection === 0) continue
    matchedLeft.add(leftIndex)
    matchedRight.add(rightIndex)
    matches.push({
      left: { id: leftNodes[leftIndex].id, name: leftNodes[leftIndex].name },
      right: { id: rightNodes[rightIndex].id, name: rightNodes[rightIndex].name },
      ...overlap,
    })
  }

  const alternatives = leftNodes.map((left, leftIndex) => ({
    node: { id: left.id, name: left.name },
    candidates: rightNodes.map((right, rightIndex) => ({
      node: { id: right.id, name: right.name },
      ...overlaps[leftIndex][rightIndex],
    })).filter((candidate) => candidate.intersection > 0)
      .sort((a, b) => b.jaccard - a.jaccard || b.intersection - a.intersection)
      .slice(0, 3),
  })).filter((entry) => entry.candidates.length > 1)

  return {
    matches,
    unmatchedLeft: leftNodes.filter((_, index) => !matchedLeft.has(index)).map(({ id, name }) => ({ id, name })),
    unmatchedRight: rightNodes.filter((_, index) => !matchedRight.has(index)).map(({ id, name }) => ({ id, name })),
    alternatives,
  }
}

const pairKey = (left, right) => left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`

function coMembershipPairs(nodes) {
  const pairs = new Set()
  for (const node of nodes) {
    const evidence = unique(node.evidence).sort()
    for (let left = 0; left < evidence.length; left += 1) {
      for (let right = left + 1; right < evidence.length; right += 1) {
        pairs.add(pairKey(evidence[left], evidence[right]))
      }
    }
  }
  return pairs
}

function setAgreement(left, right) {
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  const union = left.size + right.size - shared
  return {
    left: left.size,
    right: right.size,
    shared,
    jaccard: union === 0 ? 1 : shared / union,
    f1: left.size + right.size === 0 ? 1 : (2 * shared) / (left.size + right.size),
  }
}

function directAssignmentCounts(document) {
  const counts = new Map()
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      for (const sha of unique(node.directEvidence)) counts.set(sha, (counts.get(sha) ?? 0) + 1)
      visit(node.children)
    }
  }
  visit(document.capabilities)
  return counts
}

const summarizeMatches = (result) => {
  const similarities = result.matches.map((match) => match.jaccard)
  return {
    matched: result.matches.length,
    unmatchedLeft: result.unmatchedLeft.length,
    unmatchedRight: result.unmatchedRight.length,
    meanMatchedJaccard: similarities.length === 0
      ? 0
      : similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
  }
}

function comparePair(left, right, leftId, rightId) {
  const leftTop = topNodes(left)
  const rightTop = topNodes(right)
  const leftChildren = childNodes(left)
  const rightChildren = childNodes(right)
  const top = matchNodes(leftTop, rightTop)
  const children = matchNodes(leftChildren, rightChildren)
  const topParentMatches = new Map(top.matches.map((match) => [match.left.id, match.right.id]))
  const childByIdLeft = new Map(leftChildren.map((node) => [node.id, node]))
  const childByIdRight = new Map(rightChildren.map((node) => [node.id, node]))
  const comparableChildMatches = children.matches.filter((match) =>
    topParentMatches.has(childByIdLeft.get(match.left.id)?.parentId))
  const stableParentMatches = comparableChildMatches.filter((match) =>
    topParentMatches.get(childByIdLeft.get(match.left.id)?.parentId) ===
      childByIdRight.get(match.right.id)?.parentId)
  const stableParents = stableParentMatches.length
  const comparableParentEvidence = comparableChildMatches.reduce(
    (sum, match) => sum + match.intersection, 0)
  const stableParentEvidence = stableParentMatches.reduce(
    (sum, match) => sum + match.intersection, 0)
  const comparableParentSimilarity = comparableChildMatches.reduce(
    (sum, match) => sum + match.jaccard, 0)
  const stableParentSimilarity = stableParentMatches.reduce(
    (sum, match) => sum + match.jaccard, 0)

  const leftCounts = directAssignmentCounts(left)
  const rightCounts = directAssignmentCounts(right)
  const assigned = setAgreement(new Set(leftCounts.keys()), new Set(rightCounts.keys()))
  const unassigned = setAgreement(set(left.unassigned), set(right.unassigned))
  const overlap = setAgreement(
    new Set([...leftCounts].filter(([, count]) => count > 1).map(([sha]) => sha)),
    new Set([...rightCounts].filter(([, count]) => count > 1).map(([sha]) => sha)),
  )

  return {
    runs: [leftId, rightId],
    shape: {
      left: left.shape,
      right: right.shape,
    },
    assignmentAgreement: assigned,
    unassignedAgreement: unassigned,
    overlapAgreement: overlap,
    umbrellaCoMembership: setAgreement(coMembershipPairs(leftTop), coMembershipPairs(rightTop)),
    childCoMembership: setAgreement(coMembershipPairs(leftChildren), coMembershipPairs(rightChildren)),
    parentRelationshipAgreement: {
      comparableMatchedChildren: comparableChildMatches.length,
      sameMatchedParent: stableParents,
      share: comparableChildMatches.length === 0 ? null : stableParents / comparableChildMatches.length,
      comparableIntersection: comparableParentEvidence,
      sameParentIntersection: stableParentEvidence,
      intersectionWeightedShare: comparableParentEvidence === 0
        ? null
        : stableParentEvidence / comparableParentEvidence,
      similarityWeightedShare: comparableParentSimilarity === 0
        ? null
        : stableParentSimilarity / comparableParentSimilarity,
    },
    umbrellaMatching: { ...summarizeMatches(top), ...top },
    childMatching: { ...summarizeMatches(children), ...children },
  }
}

const numericSummary = (values) => {
  const ordered = [...values].sort((a, b) => a - b)
  if (ordered.length === 0) return null
  const middle = Math.floor(ordered.length / 2)
  return {
    min: ordered[0],
    median: ordered.length % 2 === 1
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2,
    mean: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
    max: ordered.at(-1),
  }
}

function assertComparable(documents, { allowMixedProtocols = false } = {}) {
  const [first, ...rest] = documents
  if (!first) throw new Error('at least two induction documents are required')
  if (documents.length < 2) throw new Error('at least two induction documents are required')
  for (const document of rest) {
    if (document.repository !== first.repository) throw new Error('runs describe different repositories')
    if (document.headSha !== first.headSha) throw new Error('runs describe different repository heads')
    if (!allowMixedProtocols && document.schemaVersion !== first.schemaVersion) {
      throw new Error('runs use different parsed-document schemas')
    }
    const firstCommits = Object.keys(first.commits ?? {}).sort()
    const commits = Object.keys(document.commits ?? {}).sort()
    if (firstCommits.length !== commits.length || firstCommits.some((sha, index) => sha !== commits[index])) {
      throw new Error('runs do not contain the same commit-reading universe')
    }
  }
  const comparisonFingerprints = unique(documents.map((document) =>
    document.protocol?.comparisonSha256 ?? document.protocol?.requestSha256).filter(Boolean))
  const missingComparisonFingerprints = documents.filter((document) =>
    !(document.protocol?.comparisonSha256 ?? document.protocol?.requestSha256)).length
  if (!allowMixedProtocols && (comparisonFingerprints.length !== 1 || missingComparisonFingerprints > 0)) {
    throw new Error('runs do not prove a shared comparison protocol; use compatible fingerprinted runs')
  }
  const requestFingerprints = unique(documents.map((document) =>
    document.protocol?.requestSha256).filter(Boolean))
  const requestsIdentical = requestFingerprints.length === 1 &&
    documents.every((document) => document.protocol?.requestSha256)
  return {
    comparisonFingerprint: comparisonFingerprints.length === 1 && missingComparisonFingerprints === 0
      ? comparisonFingerprints[0]
      : null,
    requestFingerprint: requestsIdentical ? requestFingerprints[0] : null,
  }
}

export function compareInductionRuns(documents, { runIds, allowMixedProtocols = false } = {}) {
  const protocolFingerprints = assertComparable(documents, { allowMixedProtocols })
  const ids = runIds ?? documents.map((_, index) => `run-${index + 1}`)
  if (ids.length !== documents.length) throw new Error('runIds must identify every document')
  const pairwise = []
  for (let left = 0; left < documents.length; left += 1) {
    for (let right = left + 1; right < documents.length; right += 1) {
      pairwise.push(comparePair(documents[left], documents[right], ids[left], ids[right]))
    }
  }

  const metric = (reader) => numericSummary(pairwise.map(reader).filter((value) => value != null))
  return {
    schemaVersion: '0.1.0',
    method: 'label-independent-evidence-set-stability',
    repository: documents[0].repository,
    headSha: documents[0].headSha,
    protocol: {
      comparisonSha256: protocolFingerprints.comparisonFingerprint,
      comparable: protocolFingerprints.comparisonFingerprint != null,
      requestSha256: protocolFingerprints.requestFingerprint,
      requestsIdentical: protocolFingerprints.requestFingerprint != null,
      parsedDocumentSchemas: unique(documents.map((document) => document.schemaVersion ?? null)),
    },
    runs: ids.map((id, index) => ({
      id,
      shape: documents[index].shape,
      usage: documents[index].usage ?? null,
    })),
    aggregate: {
      comparisons: pairwise.length,
      assignmentF1: metric((pair) => pair.assignmentAgreement.f1),
      unassignedF1: metric((pair) => pair.unassignedAgreement.f1),
      overlapF1: metric((pair) => pair.overlapAgreement.f1),
      umbrellaCoMembershipF1: metric((pair) => pair.umbrellaCoMembership.f1),
      childCoMembershipF1: metric((pair) => pair.childCoMembership.f1),
      umbrellaMatchedJaccard: metric((pair) => pair.umbrellaMatching.meanMatchedJaccard),
      childMatchedJaccard: metric((pair) => pair.childMatching.meanMatchedJaccard),
      parentRelationshipShare: metric((pair) => pair.parentRelationshipAgreement.share),
      parentRelationshipIntersectionWeightedShare: metric(
        (pair) => pair.parentRelationshipAgreement.intersectionWeightedShare,
      ),
      parentRelationshipSimilarityWeightedShare: metric(
        (pair) => pair.parentRelationshipAgreement.similarityWeightedShare,
      ),
    },
    pairwise,
  }
}
