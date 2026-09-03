/** Build bounded, evidence-linked review packets for a provisional capability hierarchy. */

import { createHash } from 'node:crypto'

import { matchNodes } from './capability-stability.mjs'

const unique = (values) => [...new Set(Array.isArray(values) ? values : [])]

const flattenNodes = (nodes, parentId = null, depth = 1, output = []) => {
  for (const node of nodes ?? []) {
    output.push({ ...node, parentId, depth })
    flattenNodes(node.children ?? [], node.id, depth + 1, output)
  }
  return output
}

const compactHierarchy = (nodes) => (nodes ?? []).map((node) => ({
  id: node.id,
  name: node.name,
  summary: node.summary ?? null,
  audience: node.audience ?? 'mixed',
  directCommitCount: node.directCommitCount ?? unique(node.directEvidence).length,
  rollupCommitCount: node.commitCount ?? unique(node.rollupEvidence).length,
  children: compactHierarchy(node.children),
}))

const hierarchyIdentity = (nodes) => (nodes ?? []).map((node) => ({
  id: node.id,
  name: node.name,
  summary: node.summary ?? null,
  audience: node.audience ?? 'mixed',
  children: hierarchyIdentity(node.children),
}))

const readingRecord = (reading) => ({
  commitSha: reading.commitSha,
  shortSha: reading.shortSha,
  authoredAt: reading.authoredAt,
  subject: reading.subject,
  reading: (reading.tier2 ?? reading.tier1)?.summary ?? reading.reading ?? null,
})

const sampleAcrossSpan = (values, limit) => {
  if (values.length <= limit) return values
  if (limit <= 1) return values.slice(0, Math.max(0, limit))
  const indices = new Set()
  for (let index = 0; index < limit; index += 1) {
    indices.add(Math.round(index * (values.length - 1) / (limit - 1)))
  }
  return [...indices].map((index) => values[index])
}

const nodeView = (node) => ({
  id: node.id,
  name: node.name,
  summary: node.summary ?? null,
  parentId: node.parentId,
  depth: node.depth,
  evidence: unique(node.rollupEvidence ?? node.directEvidence),
})

const overlapRecord = (match) => match ? {
  intersection: match.intersection,
  union: match.union,
  jaccard: match.jaccard,
  baselineCoverage: match.leftCoverage,
  alternativeCoverage: match.rightCoverage,
} : null

function assertCompatible(readings, baseline, alternatives, disagreementDataset, critics) {
  if (alternatives.length === 0) throw new Error('at least one alternative hierarchy is required')
  if (critics.length < 2) throw new Error('at least two blind critics are required')
  const repository = readings.repository
  const headSha = readings.headSha
  const readingShas = (readings.readings ?? []).map((reading) => reading.commitSha).sort()
  const documents = [baseline, ...alternatives, disagreementDataset, ...critics]
  for (const document of documents) {
    if (document.repository !== repository || document.headSha !== headSha) {
      throw new Error('hierarchy-review inputs must describe the same repository head')
    }
  }
  for (const document of [baseline, ...alternatives]) {
    const commits = Object.keys(document.commits ?? {}).sort()
    if (commits.length !== readingShas.length || commits.some((sha, index) => sha !== readingShas[index])) {
      throw new Error('hierarchy runs must contain the complete reading universe')
    }
  }
  const inductionRequests = new Set([baseline, ...alternatives].map(
    (document) => document.protocol?.requestSha256,
  ))
  if (inductionRequests.size !== 1 || inductionRequests.has(undefined)) {
    throw new Error('hierarchy runs must share one induction request')
  }
  const criticRequests = new Set(critics.map((document) => document.protocol?.requestSha256))
  if (criticRequests.size !== 1 || criticRequests.has(undefined)) {
    throw new Error('blind critics must share one request')
  }
  if (critics.some((document) => document.protocol?.candidateUnionVisible !== false)) {
    throw new Error('hierarchy review accepts blind critics only')
  }
  if (critics.some((document) =>
    document.source?.disagreementContentSha256 !== disagreementDataset.protocol?.contentSha256)) {
    throw new Error('blind critics must describe the supplied disagreement dataset')
  }
  if (JSON.stringify(hierarchyIdentity(baseline.capabilities)) !==
    JSON.stringify(hierarchyIdentity(disagreementDataset.hierarchy))) {
    throw new Error('disagreement dataset must use the baseline hierarchy')
  }
  return {
    inductionRequestSha256: [...inductionRequests][0],
    criticRequestSha256: [...criticRequests][0],
  }
}

export function buildCapabilityHierarchyReviewDataset(
  readings,
  baseline,
  alternatives,
  disagreementDataset,
  critics,
  { samplesPerSet = 2, minimumGapRecurrence = Math.floor(critics.length / 2) + 1 } = {},
) {
  const source = assertCompatible(
    readings, baseline, alternatives, disagreementDataset, critics,
  )
  const readingBySha = new Map((readings.readings ?? []).map(
    (reading) => [reading.commitSha, readingRecord(reading)],
  ))
  const readingOrder = new Map((readings.readings ?? []).map(
    (reading, index) => [reading.commitSha, index],
  ))
  const evidence = []
  const evidenceIdBySha = new Map()
  const addEvidence = (sha) => {
    if (!readingBySha.has(sha)) throw new Error(`review evidence cites unknown commit ${sha}`)
    if (!evidenceIdBySha.has(sha)) {
      const id = `R${evidence.length}`
      evidenceIdBySha.set(sha, id)
      evidence.push({ id, ...readingBySha.get(sha) })
    }
    return evidenceIdBySha.get(sha)
  }
  const ordered = (shas) => unique(shas).sort(
    (left, right) => readingOrder.get(left) - readingOrder.get(right),
  )
  const sampleIds = (shas) => sampleAcrossSpan(ordered(shas), samplesPerSet).map(addEvidence)

  const nodeContext = []
  const exemplarsByNode = new Map()
  for (const exemplar of disagreementDataset.stableExemplars ?? []) {
    const values = exemplarsByNode.get(exemplar.capabilityId) ?? []
    values.push(exemplar.commitSha)
    exemplarsByNode.set(exemplar.capabilityId, values)
  }
  for (const node of flattenNodes(baseline.capabilities ?? [])) {
    nodeContext.push({
      nodeId: node.id,
      stableExemplarIds: ordered(exemplarsByNode.get(node.id) ?? []).map(addEvidence),
    })
  }

  const gapSignals = []
  for (const [input, disagreement] of (disagreementDataset.disagreements ?? []).entries()) {
    const decisions = critics.map((critic) => critic.decisions?.find(
      (decision) => decision.input === input && decision.commitSha === disagreement.commitSha,
    ))
    if (decisions.some((decision) => !decision)) {
      throw new Error(`blind critic omitted disagreement input ${input}`)
    }
    const gaps = decisions.filter((decision) => decision.verdict === 'map_insufficient')
    if (gaps.length < minimumGapRecurrence) continue
    gapSignals.push({
      id: `G${gapSignals.length}`,
      kind: 'recurring_map_gap',
      recurrence: { mapInsufficient: gaps.length, criticRuns: critics.length },
      evidenceIds: [addEvidence(disagreement.commitSha)],
      reasons: unique(gaps.map((decision) => decision.reason).filter(Boolean)),
    })
  }

  const boundarySignals = []
  const unmatchedAlternativeSignals = []
  const baselineNodes = flattenNodes(baseline.capabilities ?? []).map(nodeView)
  for (const [runIndex, alternative] of alternatives.entries()) {
    const alternativeId = `alternative-${runIndex + 1}`
    const alternativeNodes = flattenNodes(alternative.capabilities ?? []).map(nodeView)
    for (const depth of unique(baselineNodes.map((node) => node.depth))) {
      const left = baselineNodes.filter((node) => node.depth === depth)
      const right = alternativeNodes.filter((node) => node.depth === depth)
      const comparison = matchNodes(left, right)
      const matchByBaseline = new Map(comparison.matches.map((match) => [match.left.id, match]))
      const alternativesByBaseline = new Map(comparison.alternatives.map(
        (entry) => [entry.node.id, entry.candidates],
      ))
      const rightById = new Map(right.map((node) => [node.id, node]))
      for (const baselineNode of left) {
        const match = matchByBaseline.get(baselineNode.id)
        const alternativeNode = match ? rightById.get(match.right.id) : null
        const alternativeEvidence = new Set(alternativeNode?.evidence ?? [])
        const baselineEvidence = new Set(baselineNode.evidence)
        const shared = baselineNode.evidence.filter((sha) => alternativeEvidence.has(sha))
        const baselineOnly = baselineNode.evidence.filter((sha) => !alternativeEvidence.has(sha))
        const alternativeOnly = (alternativeNode?.evidence ?? []).filter(
          (sha) => !baselineEvidence.has(sha),
        )
        boundarySignals.push({
          id: `B${boundarySignals.length}`,
          kind: 'cross_run_boundary',
          alternativeRun: alternativeId,
          baselineNodeId: baselineNode.id,
          alternativeNode: alternativeNode ? {
            id: alternativeNode.id,
            name: alternativeNode.name,
            summary: alternativeNode.summary,
            parentId: alternativeNode.parentId,
          } : null,
          overlap: overlapRecord(match),
          competingAlternativeNodes: (alternativesByBaseline.get(baselineNode.id) ?? []).map(
            (candidate) => ({
              id: candidate.node.id,
              name: candidate.node.name,
              ...overlapRecord(candidate),
            }),
          ),
          evidenceIds: {
            shared: sampleIds(shared),
            baselineOnly: sampleIds(baselineOnly),
            alternativeOnly: sampleIds(alternativeOnly),
          },
        })
      }
      for (const unmatched of comparison.unmatchedRight) {
        const node = rightById.get(unmatched.id)
        unmatchedAlternativeSignals.push({
          id: `U${unmatchedAlternativeSignals.length}`,
          kind: 'unmatched_alternative_node',
          alternativeRun: alternativeId,
          alternativeNode: {
            id: node.id,
            name: node.name,
            summary: node.summary,
            parentId: node.parentId,
          },
          evidenceIds: sampleIds(node.evidence),
        })
      }
    }
  }

  const dataset = {
    schemaVersion: '0.1.0',
    method: 'evidence-bounded-capability-hierarchy-review',
    repository: readings.repository,
    headSha: readings.headSha,
    source: {
      ...source,
      baselineHierarchyRequestSha256: baseline.protocol?.requestSha256 ?? null,
      alternativeHierarchyRuns: alternatives.length,
      blindCriticRuns: critics.length,
      disagreementContentSha256: disagreementDataset.protocol?.contentSha256 ?? null,
    },
    hierarchy: compactHierarchy(baseline.capabilities),
    nodeContext,
    signals: { gapSignals, boundarySignals, unmatchedAlternativeSignals },
    evidence,
    shape: {
      hierarchyNodes: baselineNodes.length,
      nodeContexts: nodeContext.length,
      gapSignals: gapSignals.length,
      boundarySignals: boundarySignals.length,
      unmatchedAlternativeSignals: unmatchedAlternativeSignals.length,
      evidenceReadings: evidence.length,
      samplesPerSet,
      minimumGapRecurrence,
    },
  }
  dataset.protocol = {
    contentSha256: createHash('sha256').update(JSON.stringify({
      repository: dataset.repository,
      headSha: dataset.headSha,
      hierarchy: dataset.hierarchy,
      nodeContext: dataset.nodeContext,
      signals: dataset.signals,
      evidence: dataset.evidence,
    })).digest('hex'),
  }
  return dataset
}
