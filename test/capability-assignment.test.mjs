import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASSIGNMENT_SYSTEM_PROMPT,
  buildCapabilityAssignmentRequest,
  fingerprintAssignmentComparison,
  parseCapabilityAssignmentPayload,
  renderCapabilityHierarchy,
} from '../scripts/lib/capability-assignment.mjs'
import { fingerprintInductionRequest } from '../scripts/lib/capability-induction.mjs'

const readings = [0, 1, 2, 3].map((index) => ({
  commitSha: `full-${index}`,
  authoredAt: `2025-01-0${index + 1}T00:00:00Z`,
  subject: `change ${index}`,
  tier1: { summary: `Does thing ${index}.`, capability: `Thing ${index}` },
}))

const hierarchy = (suffix = '') => ({
  repository: 'test',
  headSha: 'head',
  capabilities: [{
    id: 'capability:0', name: `Umbrella${suffix}`, summary: 'Broad outcome.', audience: 'user',
    directEvidence: ['secret-old-evidence'], rollupEvidence: ['secret-old-evidence'],
    children: [{
      id: 'capability:0.0', name: 'Child', summary: 'Narrow outcome.', audience: 'user',
      directEvidence: ['also-secret'], rollupEvidence: ['also-secret'], children: [],
    }],
  }],
})

const payload = (value, extra = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage: { cost: 0.01 },
  ...extra,
})

test('the assignment prompt fixes the hierarchy while permitting zero or many labels', () => {
  assert.match(ASSIGNMENT_SYSTEM_PROMPT, /Do not add, remove, merge, split, rename, or\s+reparent/i)
  assert.match(ASSIGNMENT_SYSTEM_PROMPT, /zero, one, or several/i)
  assert.match(ASSIGNMENT_SYSTEM_PROMPT, /most specific/i)
})

test('rendering withholds the discovery pass evidence memberships', () => {
  const rendered = renderCapabilityHierarchy(hierarchy())
  assert.match(rendered, /Umbrella/)
  assert.match(rendered, /capability:0\.0/)
  assert.doesNotMatch(rendered, /secret-old-evidence|also-secret|directEvidence|rollupEvidence/)
})

test('full request fingerprints differ by hierarchy while comparison fingerprints do not', () => {
  const first = buildCapabilityAssignmentRequest(readings, hierarchy(), { model: 'test' })
  const changed = buildCapabilityAssignmentRequest(readings, hierarchy(' renamed'), { model: 'test' })
  assert.notEqual(fingerprintInductionRequest(first), fingerprintInductionRequest(changed))
  assert.equal(
    fingerprintAssignmentComparison(readings, { model: 'test' }),
    fingerprintAssignmentComparison(readings, { model: 'test' }),
  )
})

test('parsing preserves the fixed hierarchy and supports overlapping assignments', () => {
  const result = parseCapabilityAssignmentPayload(payload({
    evidenceByCapability: {
      'capability:0': [0],
      'capability:0.0': [1, 2],
    },
    unassigned: [3],
  }), readings, hierarchy())
  assert.equal(result.capabilities[0].name, 'Umbrella')
  assert.deepEqual(result.capabilities[0].directEvidence, ['full-0'])
  assert.deepEqual(result.capabilities[0].rollupEvidence, ['full-0', 'full-1', 'full-2'])
  assert.equal(result.shape.assignedCommits, 3)
  assert.equal(result.shape.overlappingCommits, 0)
  assert.deepEqual(result.unassigned, ['full-3'])
})

test('parser diagnoses unknown ids, omissions, empty nodes, and redundant ancestors', () => {
  const result = parseCapabilityAssignmentPayload(payload({
    evidenceByCapability: {
      'capability:0': [0],
      'capability:0.0': [0],
      'capability:missing': [1],
    },
    unassigned: [2],
  }), readings, hierarchy())
  assert.deepEqual(result.diagnostics.unknownCapabilityIds, ['capability:missing'])
  assert.equal(result.diagnostics.omittedByModel, 2)
  assert.equal(result.diagnostics.removedRedundantAncestorAssignments, 1)
  assert.deepEqual(result.capabilities[0].directEvidence, [])
  assert.deepEqual(result.capabilities[0].children[0].directEvidence, ['full-0'])
  assert.equal(result.shape.overlappingCommits, 0)
  assert.deepEqual(result.unassigned, ['full-2', 'full-1', 'full-3'])
})

test('a fixed capability with no new support remains visible as empty', () => {
  const result = parseCapabilityAssignmentPayload(payload({
    evidenceByCapability: {},
    unassigned: [0, 1, 2, 3],
  }), readings, hierarchy())
  assert.equal(result.capabilities.length, 1)
  assert.equal(result.capabilities[0].children.length, 1)
  assert.equal(result.capabilities[0].commitCount, 0)
  assert.deepEqual(result.diagnostics.emptyCapabilities, ['capability:0', 'capability:0.0'])
})

test('truncated paid assignment output fails explicitly', () => {
  assert.throws(
    () => parseCapabilityAssignmentPayload(payload({}, {
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    }), readings, hierarchy()),
    /truncated/,
  )
})
