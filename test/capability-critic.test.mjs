import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BLIND_CRITIC_SYSTEM_PROMPT,
  CRITIC_SYSTEM_PROMPT,
  buildCapabilityCriticRequest,
  parseCapabilityCriticPayload,
  renderCriticEvidence,
} from '../scripts/lib/capability-critic.mjs'

const dataset = {
  repository: 'test', headSha: 'head',
  hierarchy: [{
    id: 'capability:0', name: 'Umbrella', summary: 'Broad.', audience: 'user',
    children: [{
      id: 'capability:0.0', name: 'Child', summary: 'Narrow.', audience: 'user', children: [],
    }],
  }, {
    id: 'capability:1', name: 'Other', summary: 'Other.', audience: 'developer', children: [],
  }],
  stableExemplars: [{
    id: 'E0', capabilityId: 'capability:0.0', commitSha: 'stable',
    authoredAt: '2025-01-01T00:00:00Z', subject: 'stable change', reading: 'Stable evidence.',
  }],
  disagreements: [{
    commitSha: 'full-0', authoredAt: '2025-01-02T00:00:00Z', subject: 'change 0',
    reading: 'Disputed evidence.', candidateCapabilityIds: ['capability:0', 'capability:0.0'],
    alternatives: [
      { capabilityIds: ['capability:0'], occurrences: 1 },
      { capabilityIds: ['capability:0.0'], occurrences: 2 },
    ],
  }, {
    commitSha: 'full-1', authoredAt: '2025-01-03T00:00:00Z', subject: 'change 1',
    reading: 'More disputed evidence.', candidateCapabilityIds: ['capability:0.0'],
    alternatives: [
      { capabilityIds: [], occurrences: 1 },
      { capabilityIds: ['capability:0.0'], occurrences: 2 },
    ],
  }, {
    commitSha: 'full-2', authoredAt: '2025-01-04T00:00:00Z', subject: 'change 2',
    reading: 'Unreturned evidence.', candidateCapabilityIds: ['capability:1'],
    alternatives: [
      { capabilityIds: [], occurrences: 1 },
      { capabilityIds: ['capability:1'], occurrences: 2 },
    ],
  }],
  shape: { disagreementCommits: 3, stableExemplars: 1 },
}

const payload = (value, extra = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
  usage: { cost: 0.02 },
  ...extra,
})

test('critic prompt withholds vote counts and permits independent abstention', () => {
  assert.match(CRITIC_SYSTEM_PROMPT, /vote counts,[\s\S]*withheld/i)
  assert.match(CRITIC_SYSTEM_PROMPT, /map_insufficient/)
  assert.match(CRITIC_SYSTEM_PROMPT, /No maintainer taxonomy/i)
  const rendered = renderCriticEvidence(dataset, { showCandidateUnion: true })
  assert.match(rendered, /Candidate ID union: capability:0, capability:0\.0/)
  assert.match(rendered, /E0 -> capability:0\.0/)
  assert.doesNotMatch(rendered, /occurrences|"alternatives"|assignment run/i)
  const request = buildCapabilityCriticRequest(
    dataset,
    { model: 'test', showCandidateUnion: true },
  )
  assert.equal(request.model, 'test')

  const blind = buildCapabilityCriticRequest(dataset, { model: 'test' })
  assert.equal(blind.messages[0].content, BLIND_CRITIC_SYSTEM_PROMPT)
  assert.doesNotMatch(blind.messages[1].content, /Candidate ID union|capability:0, capability:0\.0/)
})

test('critic parsing validates ids, removes redundant ancestors, and preserves abstentions', () => {
  const result = parseCapabilityCriticPayload(payload({ decisions: [{
    input: 0,
    verdict: 'assign',
    selectedCapabilityIds: ['capability:0', 'capability:0.0', 'capability:missing'],
    plausibleCapabilityIds: [],
    unassignedPlausible: false,
    referenceExemplarIds: ['E0', 'E-missing'],
    reason: 'The child is specific.',
  }, {
    input: 1,
    verdict: 'ambiguous',
    selectedCapabilityIds: ['capability:1'],
    plausibleCapabilityIds: ['capability:0.0'],
    unassignedPlausible: true,
    referenceExemplarIds: [],
    reason: 'The reading is underspecified.',
  }] }), dataset)
  assert.deepEqual(result.decisions[0].selectedCapabilityIds, ['capability:0.0'])
  assert.deepEqual(result.decisions[0].referenceExemplarIds, ['E0'])
  assert.equal(result.decisions[0].matchesObservedAlternative, true)
  assert.deepEqual(result.decisions[1].selectedCapabilityIds, [])
  assert.deepEqual(result.decisions[1].plausibleCapabilityIds, ['capability:1', 'capability:0.0'])
  assert.deepEqual(result.decisions[1].outsideCandidateIds, ['capability:1'])
  assert.equal(result.decisions[2].verdict, 'missing')
  assert.deepEqual(result.diagnostics.unknownCapabilityIds, ['capability:missing'])
  assert.deepEqual(result.diagnostics.unknownExemplarIds, ['E-missing'])
  assert.deepEqual(result.diagnostics.omittedInputs, [2])
  assert.deepEqual(result.diagnostics.removedRedundantAncestorIds, ['capability:0'])
})

test('truncated critic output fails explicitly', () => {
  assert.throws(() => parseCapabilityCriticPayload(payload({}, {
    choices: [{ finish_reason: 'length', message: { content: '{}' } }],
  }), dataset), /truncated/)
})
