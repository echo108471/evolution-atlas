import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INDUCTION_SYSTEM_PROMPT,
  MAX_INDUCTION_DEPTH,
  buildInductionRequest,
  fingerprintInductionRequest,
  parseInductionPayload,
  renderReadings,
} from '../scripts/lib/capability-induction.mjs'

const reading = (index, overrides = {}) => ({
  commitSha: `full-${index}`,
  shortSha: `short-${index}`,
  authoredAt: `2025-01-0${index + 1}T00:00:00Z`,
  subject: `change ${index}`,
  tier1: { summary: `Does thing ${index}.`, capability: `Thing ${index}` },
  tier2: null,
  ...overrides,
})

const payload = (value, extra = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage: { cost: 0.01 },
  ...extra,
})

test('the induction prompt has no repository answer or target count', () => {
  assert.doesNotMatch(INDUCTION_SYSTEM_PROMPT, /course|professor|cattle|etl|thirteen|13 capabilities/i)
  assert.match(INDUCTION_SYSTEM_PROMPT, /no target number/i)
  assert.match(INDUCTION_SYSTEM_PROMPT, /majority/i)
  assert.match(INDUCTION_SYSTEM_PROMPT, /more than one\s+capability/i)
  assert.match(INDUCTION_SYSTEM_PROMPT, /at most two levels/i)
  assert.equal(MAX_INDUCTION_DEPTH, 2)
})

test('the request exposes readings globally without calling them a gold taxonomy', () => {
  const readings = [reading(0)]
  const body = buildInductionRequest(readings, { model: 'test' })
  const rendered = JSON.stringify(body)
  assert.match(rendered, /Does thing 0/)
  assert.match(rendered, /Per-commit label: Thing 0/)
  assert.doesNotMatch(rendered, /gold|maintainer-provided categories|target count/i)
  assert.match(renderReadings(readings), /^0\. 2025-01-01 change 0/m)
})

test('the request fingerprint changes when any experimental input changes', () => {
  const original = buildInductionRequest([reading(0)], { model: 'test' })
  const same = buildInductionRequest([reading(0)], { model: 'test' })
  const changed = buildInductionRequest([reading(0, { subject: 'different' })], { model: 'test' })
  assert.equal(fingerprintInductionRequest(original), fingerprintInductionRequest(same))
  assert.notEqual(fingerprintInductionRequest(original), fingerprintInductionRequest(changed))
})

test('parsing preserves hierarchy and overlapping evidence', () => {
  const readings = [reading(0), reading(1), reading(2), reading(3)]
  const result = parseInductionPayload(payload({
    capabilities: [
      {
        name: 'Umbrella', summary: 'Broad outcome.', audience: 'user', evidence: [0],
        children: [
          { name: 'Child A', summary: 'A.', audience: 'user', evidence: [1, 2], children: [] },
          { name: 'Child B', summary: 'B.', audience: 'developer', evidence: [2], children: [] },
        ],
      },
    ],
    unassigned: [3],
  }), readings)

  const umbrella = result.capabilities[0]
  assert.deepEqual(umbrella.directEvidence, ['full-0'])
  assert.deepEqual(umbrella.rollupEvidence, ['full-0', 'full-1', 'full-2'])
  assert.equal(umbrella.commitCount, 3)
  assert.equal(result.shape.topLevelCapabilities, 1)
  assert.equal(result.shape.totalCapabilities, 3)
  assert.equal(result.shape.assignedCommits, 3)
  assert.equal(result.shape.overlappingCommits, 1)
  assert.equal(result.shape.assignments, 4)
  assert.deepEqual(result.unassigned, ['full-3'])
})

test('omitted inputs become explicit unassigned diagnostics without repaying', () => {
  const readings = [reading(0), reading(1), reading(2)]
  const result = parseInductionPayload(payload({
    capabilities: [{ name: 'One', summary: 'One.', audience: 'unknown', evidence: ['0', 0, 99], children: [] }],
    unassigned: [],
  }), readings)
  assert.equal(result.capabilities[0].audience, 'mixed')
  assert.deepEqual(result.capabilities[0].directEvidence, ['full-0'])
  assert.deepEqual(result.unassigned, ['full-1', 'full-2'])
  assert.equal(result.diagnostics.droppedByModel, 2)
})

test('a commit cited by a capability cannot also remain unassigned', () => {
  const readings = [reading(0)]
  const result = parseInductionPayload(payload({
    capabilities: [{ name: 'One', summary: 'One.', audience: 'user', evidence: [0], children: [] }],
    unassigned: [0],
  }), readings)
  assert.deepEqual(result.unassigned, [])
  assert.equal(result.shape.coverage, 1)
})

test('an unsupported leaf is rejected while an umbrella supported by children remains', () => {
  const readings = [reading(0)]
  const result = parseInductionPayload(payload({
    capabilities: [{
      name: 'Umbrella', summary: 'Umbrella.', audience: 'user', evidence: [],
      children: [
        { name: 'Supported', summary: 'Supported.', audience: 'user', evidence: [0], children: [] },
        { name: 'Empty claim', summary: 'Unsupported.', audience: 'user', evidence: [], children: [] },
      ],
    }],
    unassigned: [],
  }), readings)
  assert.equal(result.capabilities.length, 1)
  assert.deepEqual(result.capabilities[0].children.map((child) => child.name), ['Supported'])
  assert.deepEqual(result.capabilities[0].rollupEvidence, ['full-0'])
  assert.equal(result.diagnostics.emptyNodes, 1)
})

test('truncated paid output fails explicitly', () => {
  const readings = [reading(0)]
  assert.throws(
    () => parseInductionPayload(payload({}, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), readings),
    /truncated/,
  )
})

test('the current experiment rejects a third generated level', () => {
  const readings = [reading(0)]
  const response = payload({
    capabilities: [{
      name: 'Level one', evidence: [], children: [{
        name: 'Level two', evidence: [], children: [{
          name: 'Level three', evidence: [0], children: [],
        }],
      }],
    }],
    unassigned: [],
  })
  assert.throws(() => parseInductionPayload(response, readings), /2-level experiment/)
})
