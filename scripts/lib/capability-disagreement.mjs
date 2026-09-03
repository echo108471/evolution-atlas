/**
 * Build the evidence set for a fixed-hierarchy assignment critic.
 *
 * The saved dataset preserves repeated-run alternatives for later measurement. Model-facing
 * rendering deliberately withholds run identity and frequency so a critic cannot ratify the
 * plurality instead of reading the evidence.
 */

import { createHash } from 'node:crypto'

import { renderCapabilityHierarchy } from './capability-assignment.mjs'

const flattenNodes = (nodes) => nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])])

const directAssignments = (document, commitShas) => {
  const assignments = new Map(commitShas.map((sha) => [sha, new Set()]))
  for (const node of flattenNodes(document.capabilities ?? [])) {
    for (const sha of node.directEvidence ?? []) {
      if (!assignments.has(sha)) throw new Error(`assignment cites unknown commit ${sha}`)
      assignments.get(sha).add(node.id)
    }
  }
  return assignments
}

const assignmentKey = (ids) => [...ids].sort().join('|')

const sampleAcrossSpan = (values, limit) => {
  if (values.length <= limit) return values
  if (limit <= 1) return values.slice(0, Math.max(0, limit))
  const indices = new Set()
  for (let index = 0; index < limit; index += 1) {
    indices.add(Math.round(index * (values.length - 1) / (limit - 1)))
  }
  return [...indices].map((index) => values[index])
}

const readingRecord = (reading) => ({
  commitSha: reading.commitSha,
  shortSha: reading.shortSha,
  authoredAt: reading.authoredAt,
  subject: reading.subject,
  reading: (reading.tier2 ?? reading.tier1)?.summary ?? null,
})

function assertComparable(readingsDocument, capabilityDocument, assignmentDocuments) {
  if (assignmentDocuments.length < 2) throw new Error('at least two assignment runs are required')
  const repository = readingsDocument.repository
  const headSha = readingsDocument.headSha
  const hierarchy = renderCapabilityHierarchy(capabilityDocument)
  const requestSha256 = assignmentDocuments[0].protocol?.requestSha256
  const readingShas = (readingsDocument.readings ?? []).map((reading) => reading.commitSha).sort()
  if (!requestSha256) throw new Error('assignment runs require a complete-request fingerprint')

  for (const document of assignmentDocuments) {
    if (document.repository !== repository || document.headSha !== headSha) {
      throw new Error('readings and assignment runs must describe the same repository head')
    }
    if (document.protocol?.requestSha256 !== requestSha256) {
      throw new Error('assignment runs must use an identical complete request')
    }
    if (document.readingCount != null && document.readingCount !== readingShas.length) {
      throw new Error('assignment runs must use the complete reading universe')
    }
    if (document.commits) {
      const assignedShas = Object.keys(document.commits).sort()
      if (assignmentKey(assignedShas) !== assignmentKey(readingShas)) {
        throw new Error('assignment runs must use the complete reading universe')
      }
    }
    if (renderCapabilityHierarchy(document) !== hierarchy) {
      throw new Error('assignment runs must use the same fixed hierarchy')
    }
  }
  if (capabilityDocument.repository !== repository || capabilityDocument.headSha !== headSha) {
    throw new Error('readings and fixed hierarchy must describe the same repository head')
  }
  if (renderCapabilityHierarchy(capabilityDocument) !== hierarchy) {
    throw new Error('fixed hierarchy does not match the assignment runs')
  }
  return requestSha256
}

export function buildCapabilityDisagreementDataset(
  readingsDocument,
  capabilityDocument,
  assignmentDocuments,
  { exemplarsPerCapability = 3 } = {},
) {
  const requestSha256 = assertComparable(
    readingsDocument,
    capabilityDocument,
    assignmentDocuments,
  )
  const readings = readingsDocument.readings ?? []
  const commitShas = readings.map((reading) => reading.commitSha)
  if (new Set(commitShas).size !== commitShas.length) throw new Error('readings contain duplicate commits')
  const readingBySha = new Map(readings.map((reading) => [reading.commitSha, reading]))
  const assignments = assignmentDocuments.map((document) => directAssignments(document, commitShas))
  const disagreements = []
  const stableCommitShas = []

  for (const sha of commitShas) {
    const sets = assignments.map((assignment) => assignment.get(sha))
    const alternatives = new Map()
    for (const ids of sets) {
      const key = assignmentKey(ids)
      const existing = alternatives.get(key) ?? { capabilityIds: [...ids].sort(), occurrences: 0 }
      existing.occurrences += 1
      alternatives.set(key, existing)
    }
    if (alternatives.size === 1) {
      stableCommitShas.push(sha)
      continue
    }
    disagreements.push({
      ...readingRecord(readingBySha.get(sha)),
      candidateCapabilityIds: [...new Set(sets.flatMap((set) => [...set]))].sort(),
      alternatives: [...alternatives.values()].sort((left, right) =>
        assignmentKey(left.capabilityIds).localeCompare(assignmentKey(right.capabilityIds))),
    })
  }

  const stableShaSet = new Set(stableCommitShas)
  const stableExemplars = []
  const firstAssignments = assignments[0]
  for (const node of flattenNodes(capabilityDocument.capabilities ?? [])) {
    const eligible = commitShas.filter((sha) =>
      stableShaSet.has(sha) && firstAssignments.get(sha).has(node.id))
    for (const sha of sampleAcrossSpan(eligible, exemplarsPerCapability)) {
      stableExemplars.push({
        id: `E${stableExemplars.length}`,
        capabilityId: node.id,
        ...readingRecord(readingBySha.get(sha)),
      })
    }
  }

  const hierarchy = JSON.parse(renderCapabilityHierarchy(capabilityDocument))
  const dataset = {
    schemaVersion: '0.1.0',
    method: 'fixed-hierarchy-capability-assignment-disagreements',
    repository: readingsDocument.repository,
    headSha: readingsDocument.headSha,
    readingCount: readings.length,
    source: {
      assignmentRuns: assignmentDocuments.length,
      assignmentRequestSha256: requestSha256,
      hierarchyRequestSha256: capabilityDocument.protocol?.requestSha256 ?? null,
    },
    hierarchy,
    stableExemplars,
    disagreements,
    shape: {
      assignmentRuns: assignmentDocuments.length,
      totalCommits: readings.length,
      stableCommits: stableCommitShas.length,
      disagreementCommits: disagreements.length,
      stableExemplars: stableExemplars.length,
      distinctCandidateEdges: disagreements.reduce(
        (sum, disagreement) => sum + disagreement.candidateCapabilityIds.length, 0),
    },
  }
  dataset.protocol = {
    contentSha256: createHash('sha256').update(JSON.stringify({
      repository: dataset.repository,
      headSha: dataset.headSha,
      hierarchy: dataset.hierarchy,
      stableExemplars: dataset.stableExemplars,
      disagreements: dataset.disagreements,
    })).digest('hex'),
  }
  return dataset
}
