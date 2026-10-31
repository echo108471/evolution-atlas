/**
 * Assign every saved reading against an already-discovered capability map.
 *
 * The hierarchy is fixed and its original evidence is deliberately withheld. This
 * isolates evidence assignment from hierarchy discovery while still allowing zero,
 * one, or several direct assignments per commit.
 */

import { extractJson } from './phase-model.mjs'
import { requestChatCompletion } from './openai-provider.mjs'
import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  fingerprintInductionRequest,
  renderReadings,
} from './capability-induction.mjs'

export { API_KEY_ENV, DEFAULT_MODEL }

const REQUEST_TIMEOUT_MS = 600000

export const ASSIGNMENT_SYSTEM_PROMPT = `You are assigning repository evidence to an
already-discovered candidate capability hierarchy.

The hierarchy is fixed for this experiment. Do not add, remove, merge, split, rename, or
reparent capabilities. Decide only which numbered commit readings directly support which
existing capability IDs.

A capability is a durable outcome or behavior recognizable to a user, developer, or
operator. A commit may directly support zero, one, or several capabilities. Use several
when the change is genuinely cross-cutting, not merely because an umbrella contains the
most specific child.

Attach evidence to the most specific capability it directly supports. Do not repeat a
commit on an ancestor solely because it supports a child. Assign directly to an umbrella
only when the reading supports the broader outcome but no child describes it. Leave
routine maintenance, ambiguous work, and evidence unrelated to the candidate map
unassigned.

Use only the supplied hierarchy and readings. Every input number must appear in at least
one capability array or in unassigned.

Reply with JSON only, no prose or fences:

{"evidenceByCapability": {"capability:id": [number, ...]},
"unassigned": [number, ...]}`

const cleanIndexList = (values, count) => {
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const index = Number.parseInt(value, 10)
    if (Number.isInteger(index) && index >= 0 && index < count) seen.add(index)
  }
  return [...seen]
}

const hierarchyNode = (node) => ({
  id: node.id,
  name: node.name,
  summary: node.summary ?? null,
  audience: node.audience ?? 'mixed',
  children: (node.children ?? []).map(hierarchyNode),
})

export function renderCapabilityHierarchy(capabilityDocument) {
  return JSON.stringify((capabilityDocument.capabilities ?? []).map(hierarchyNode), null, 2)
}

export function buildCapabilityAssignmentRequest(
  readings,
  capabilityDocument,
  { model = DEFAULT_MODEL } = {},
) {
  return {
    model,
    max_completion_tokens: 30000,
    messages: [
      { role: 'system', content: ASSIGNMENT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Candidate hierarchy (its prior evidence assignments have been withheld):

${renderCapabilityHierarchy(capabilityDocument)}

Commit readings, oldest first:

${renderReadings(readings)}

Assign all ${readings.length} readings against the fixed candidate hierarchy.`,
      },
    ],
  }
}

export function fingerprintAssignmentComparison(readings, { model = DEFAULT_MODEL } = {}) {
  return fingerprintInductionRequest({
    experiment: 'fixed-hierarchy-capability-evidence-assignment-v1',
    model,
    max_completion_tokens: 30000,
    systemPrompt: ASSIGNMENT_SYSTEM_PROMPT,
    renderedReadings: renderReadings(readings),
  })
}

const flattenNodes = (nodes) => nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])])

function rebuildNode(node, readings, evidenceById, assignedCounts) {
  const evidenceIndices = evidenceById.get(node.id) ?? []
  for (const index of evidenceIndices) assignedCounts[index] += 1
  const children = (node.children ?? []).map((child) =>
    rebuildNode(child, readings, evidenceById, assignedCounts))
  const directEvidence = evidenceIndices.map((index) => readings[index].commitSha)
  const rollupEvidence = [...new Set([
    ...directEvidence,
    ...children.flatMap((child) => child.rollupEvidence),
  ])]
  return {
    ...hierarchyNode(node),
    interpretationStatus: 'candidate',
    directEvidence,
    rollupEvidence,
    directCommitCount: directEvidence.length,
    commitCount: rollupEvidence.length,
    children,
  }
}

function removeRedundantAncestorAssignments(capabilities, evidenceById) {
  const removedIndices = new Set()
  const visit = (node) => {
    const descendantIndices = new Set(flattenNodes(node.children ?? []).flatMap((child) =>
      evidenceById.get(child.id) ?? []))
    const direct = evidenceById.get(node.id) ?? []
    const kept = direct.filter((index) => {
      if (!descendantIndices.has(index)) return true
      removedIndices.add(index)
      return false
    })
    evidenceById.set(node.id, kept)
    for (const child of node.children ?? []) visit(child)
  }
  for (const capability of capabilities) visit(capability)
  return [...removedIndices]
}

export function parseCapabilityAssignmentPayload(payload, readings, capabilityDocument) {
  if (payload.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  if (choice.finish_reason === 'length') throw new Error('capability assignment output was truncated')

  const raw = extractJson(choice.message?.content ?? '')
  const knownNodes = flattenNodes(capabilityDocument.capabilities ?? [])
  const knownIds = new Set(knownNodes.map((node) => node.id))
  const rawEvidence = raw.evidenceByCapability && typeof raw.evidenceByCapability === 'object'
    ? raw.evidenceByCapability
    : {}
  const evidenceById = new Map()
  const unknownCapabilityIds = []
  for (const [id, values] of Object.entries(rawEvidence)) {
    if (!knownIds.has(id)) {
      unknownCapabilityIds.push(id)
      continue
    }
    evidenceById.set(id, cleanIndexList(values, readings.length))
  }
  const redundantAncestorIndices = removeRedundantAncestorAssignments(
    capabilityDocument.capabilities ?? [],
    evidenceById,
  )

  const assignedCounts = new Array(readings.length).fill(0)
  const capabilities = (capabilityDocument.capabilities ?? []).map((node) =>
    rebuildNode(node, readings, evidenceById, assignedCounts))
  const modelUnassigned = new Set(cleanIndexList(raw.unassigned, readings.length))
  const omittedIndices = []
  for (let index = 0; index < readings.length; index += 1) {
    if (assignedCounts[index] === 0 && !modelUnassigned.has(index)) {
      modelUnassigned.add(index)
      omittedIndices.push(index)
    }
    if (assignedCounts[index] > 0) modelUnassigned.delete(index)
  }

  const assigned = assignedCounts.filter((count) => count > 0).length
  const overlapping = assignedCounts.filter((count) => count > 1).length
  const rebuiltNodes = flattenNodes(capabilities)
  return {
    capabilities,
    unassigned: [...modelUnassigned].map((index) => readings[index].commitSha),
    shape: {
      topLevelCapabilities: capabilities.length,
      totalCapabilities: rebuiltNodes.length,
      maxDepth: rebuiltNodes.reduce(
        (maximum, node) => Math.max(maximum, node.id.split('.').length), 0),
      assignedCommits: assigned,
      unassignedCommits: readings.length - assigned,
      coverage: readings.length === 0 ? 0 : assigned / readings.length,
      overlappingCommits: overlapping,
      overlapShare: assigned === 0 ? 0 : overlapping / assigned,
      assignments: assignedCounts.reduce((sum, count) => sum + count, 0),
    },
    diagnostics: {
      unknownCapabilityIds,
      emptyCapabilities: rebuiltNodes.filter((node) => node.commitCount === 0).map((node) => node.id),
      omittedByModel: omittedIndices.length,
      omittedCommitShas: omittedIndices.map((index) => readings[index].commitSha),
      removedRedundantAncestorAssignments: redundantAncestorIndices.length,
      removedRedundantAncestorCommitShas: redundantAncestorIndices.map(
        (index) => readings[index].commitSha,
      ),
    },
    usage: payload.usage ?? null,
  }
}

export async function requestCapabilityAssignmentPayload(
  readings,
  capabilityDocument,
  { model = DEFAULT_MODEL, apiKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  return requestChatCompletion(buildCapabilityAssignmentRequest(readings, capabilityDocument, { model }), { apiKey, fetchImpl, timeoutMs, timeoutMessage: 'capability assignment' })
}
