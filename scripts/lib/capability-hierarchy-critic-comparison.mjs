/** Compare hierarchy-critic proposals by structural targets and cited evidence, not wording. */

import { jaccard, matchNodes } from './capability-stability.mjs'

const unique = (values) => [...new Set(Array.isArray(values) ? values : [])]

export function hierarchyProposalKey(proposal) {
  const targets = unique(proposal.targetNodeIds).sort().join(',')
  const parent = proposal.proposedParentId ?? 'top-level'
  if (proposal.operation === 'add_node') {
    const signals = unique(proposal.signalIds).sort()
    const support = signals.length > 0
      ? `signals:${signals.join(',')}`
      : `evidence:${unique(proposal.evidenceIds).sort().join(',')}`
    return `${proposal.operation}|${parent}|${support}`
  }
  return `${proposal.operation}|${targets}|${parent}`
}

const setAgreement = (leftValues, rightValues) => {
  const left = new Set(leftValues)
  const right = new Set(rightValues)
  const shared = [...left].filter((value) => right.has(value)).length
  const union = left.size + right.size - shared
  return {
    left: left.size,
    right: right.size,
    shared,
    jaccard: union === 0 ? 1 : shared / union,
    f1: left.size + right.size === 0 ? 1 : 2 * shared / (left.size + right.size),
  }
}

const distribution = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return {
    min: sorted[0],
    median: sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted.at(-1),
  }
}

const proposalMap = (document, id) => {
  const entries = (document.proposals ?? []).map((proposal) => [hierarchyProposalKey(proposal), proposal])
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error(`${id} contains multiple proposals for one structural target`)
  }
  return new Map(entries)
}

const replacementSimilarity = (left, right) => {
  if (left.operation !== 'split_node' || right.operation !== 'split_node') return null
  const prepare = (proposal) => (proposal.replacementNodes ?? []).map((replacement, index) => ({
    id: `replacement-${index}`,
    name: replacement.name,
    evidence: replacement.evidenceIds ?? [],
  }))
  const match = matchNodes(prepare(left), prepare(right))
  const similarities = match.matches.map((entry) => entry.jaccard)
  return {
    left: left.replacementNodes?.length ?? 0,
    right: right.replacementNodes?.length ?? 0,
    matched: match.matches.length,
    meanMatchedEvidenceJaccard: similarities.length === 0
      ? 0
      : similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
  }
}

function comparePair(left, right, leftId, rightId) {
  const maps = [proposalMap(left, leftId), proposalMap(right, rightId)]
  const keys = maps.map((map) => [...map.keys()])
  const agreement = setAgreement(keys[0], keys[1])
  const sharedKeys = keys[0].filter((key) => maps[1].has(key))
  const evidenceSimilarities = []
  const signalSimilarities = []
  const replacements = []
  for (const key of sharedKeys) {
    const proposals = maps.map((map) => map.get(key))
    evidenceSimilarities.push(jaccard(proposals[0].evidenceIds, proposals[1].evidenceIds))
    signalSimilarities.push(jaccard(proposals[0].signalIds, proposals[1].signalIds))
    const replacement = replacementSimilarity(...proposals)
    if (replacement) replacements.push({ key, ...replacement })
  }
  return {
    runs: [leftId, rightId],
    operationTargetAgreement: agreement,
    matchedProposalEvidenceJaccard: distribution(evidenceSimilarities),
    matchedProposalSignalJaccard: distribution(signalSimilarities),
    splitReplacementComparisons: replacements,
  }
}

function assertComparable(documents) {
  if (documents.length < 2) throw new Error('at least two hierarchy critics are required')
  const [first, ...rest] = documents
  for (const document of rest) {
    if (document.repository !== first.repository || document.headSha !== first.headSha) {
      throw new Error('hierarchy critics describe different repository heads')
    }
    if (document.source?.hierarchyReviewContentSha256 !==
      first.source?.hierarchyReviewContentSha256) {
      throw new Error('hierarchy critics used different review packets')
    }
    if (document.protocol?.requestSha256 !== first.protocol?.requestSha256) {
      throw new Error('hierarchy critics used different requests')
    }
    if (document.protocol?.model !== first.protocol?.model) {
      throw new Error('hierarchy critics used different models')
    }
  }
  if (!first.source?.hierarchyReviewContentSha256 || !first.protocol?.requestSha256 ||
    !first.protocol?.model) {
    throw new Error('hierarchy critics require complete provenance')
  }
}

const meanPairwiseJaccard = (proposals, reader) => {
  const values = []
  for (let left = 0; left < proposals.length; left += 1) {
    for (let right = left + 1; right < proposals.length; right += 1) {
      values.push(jaccard(reader(proposals[left]), reader(proposals[right])))
    }
  }
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function compareHierarchyCritics(documents, { runIds } = {}) {
  assertComparable(documents)
  const ids = runIds ?? documents.map((_, index) => `run-${index + 1}`)
  if (ids.length !== documents.length) throw new Error('runIds must identify every document')
  const maps = documents.map((document, index) => proposalMap(document, ids[index]))
  const pairwise = []
  for (let left = 0; left < documents.length; left += 1) {
    for (let right = left + 1; right < documents.length; right += 1) {
      pairwise.push(comparePair(documents[left], documents[right], ids[left], ids[right]))
    }
  }
  const allKeys = unique(maps.flatMap((map) => [...map.keys()])).sort()
  const proposalRecurrence = allKeys.map((key) => {
    const occurrences = maps.flatMap((map, run) => map.has(key)
      ? [{ runId: ids[run], proposal: map.get(key) }]
      : [])
    const proposals = occurrences.map((entry) => entry.proposal)
    const first = proposals[0]
    return {
      key,
      operation: first.operation,
      targetNodeIds: first.targetNodeIds,
      proposedParentId: first.proposedParentId,
      runCount: occurrences.length,
      recurrenceShare: occurrences.length / documents.length,
      runs: occurrences.map((entry) => entry.runId),
      proposedNames: unique(proposals.flatMap((proposal) => [
        proposal.name,
        ...(proposal.replacementNodes ?? []).map((replacement) => replacement.name),
      ]).filter(Boolean)),
      confidences: unique(proposals.map((proposal) => proposal.confidence)),
      evidenceIds: {
        union: unique(proposals.flatMap((proposal) => proposal.evidenceIds)).sort(),
        intersection: unique(first.evidenceIds).filter((id) =>
          proposals.every((proposal) => proposal.evidenceIds.includes(id))).sort(),
        meanPairwiseJaccard: meanPairwiseJaccard(proposals, (proposal) => proposal.evidenceIds),
      },
      signalIds: {
        union: unique(proposals.flatMap((proposal) => proposal.signalIds)).sort(),
        intersection: unique(first.signalIds).filter((id) =>
          proposals.every((proposal) => proposal.signalIds.includes(id))).sort(),
        meanPairwiseJaccard: meanPairwiseJaccard(proposals, (proposal) => proposal.signalIds),
      },
    }
  })
  const metric = (reader) => distribution(pairwise.map(reader).filter((value) => value != null))
  const runReviewedShares = documents.map((document) => document.shape.hierarchyNodes === 0
    ? 1
    : document.shape.reviewedNodes / document.shape.hierarchyNodes)
  const runSignalShares = documents.map((document) => document.shape.signals === 0
    ? 1
    : document.shape.accountedSignals / document.shape.signals)
  const allRunsComplete = documents.every((document) =>
    document.shape.reviewedNodes === document.shape.hierarchyNodes &&
    document.shape.accountedSignals === document.shape.signals)
  return {
    schemaVersion: '0.1.0',
    method: 'label-independent-hierarchy-critic-proposal-stability',
    repository: documents[0].repository,
    headSha: documents[0].headSha,
    protocol: {
      model: documents[0].protocol.model,
      requestSha256: documents[0].protocol.requestSha256,
      hierarchyReviewContentSha256: documents[0].source.hierarchyReviewContentSha256,
    },
    runs: ids.map((id, index) => ({
      id,
      shape: documents[index].shape,
      usage: documents[index].usage ?? null,
    })),
    aggregate: {
      comparisons: pairwise.length,
      operationTargetF1: metric((pair) => pair.operationTargetAgreement.f1),
      operationTargetJaccard: metric((pair) => pair.operationTargetAgreement.jaccard),
      matchedProposalEvidenceJaccard: metric(
        (pair) => pair.matchedProposalEvidenceJaccard?.mean,
      ),
      matchedProposalSignalJaccard: metric(
        (pair) => pair.matchedProposalSignalJaccard?.mean,
      ),
      reviewedNodeShare: distribution(runReviewedShares),
      accountedSignalShare: distribution(runSignalShares),
    },
    qualityGate: {
      allRunsComplete,
      eligibleForAutomaticRevision: allRunsComplete,
    },
    proposalRecurrence: proposalRecurrence.map((proposal) => ({
      ...proposal,
      recursAcrossAllRuns: proposal.runCount === documents.length,
      eligibleForAutomaticRevision: allRunsComplete && proposal.runCount === documents.length,
    })),
    pairwise,
  }
}
