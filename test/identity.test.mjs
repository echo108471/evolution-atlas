import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIdentityMatches } from '../scripts/lib/identity.mjs'
import {
  applyIdentityDecision,
  emptyIdentityDecisions,
  resolveIdentities,
} from '../src/identity.ts'

function record(id, names, email, options = {}) {
  return {
    id,
    names,
    email,
    rawKey: `email:${email}`,
    mailmapKeys: new Set(options.mailmapKeys ?? [`email:${email}`]),
    isBot: options.isBot ?? false,
  }
}

function contributor(id, displayName) {
  return {
    id,
    displayName,
    aliases: [displayName],
    isBot: false,
    firstSeenAt: '2025-01-01T00:00:00Z',
    lastSeenAt: '2025-01-02T00:00:00Z',
  }
}

function datasetWith(contributors) {
  return {
    schemaVersion: '0.1.0',
    analysis: { mode: 'observed-only', historyRange: 'HEAD', mergeDiffStrategy: 'first-parent' },
    repository: { name: 'identity-test', ref: 'main', headSha: 'bbb', commitCount: contributors.length },
    timeRange: {
      firstAuthoredAt: '2025-01-01T00:00:00Z',
      lastAuthoredAt: '2025-01-02T00:00:00Z',
    },
    contributors,
    episodes: contributors.map((entry, index) => ({
      id: `episode:${index}`,
      commitSha: String(index),
      shortSha: String(index),
      subject: `Commit ${index}`,
      authoredAt: `2025-01-0${index + 1}T00:00:00Z`,
      committedAt: `2025-01-0${index + 1}T00:00:00Z`,
      parentShas: [],
      contributorIds: [entry.id],
      codeAreaIds: [],
      changes: [],
      interpretationStatus: 'observed',
    })),
    codeAreas: [],
    featureCandidates: [],
    relationships: [],
  }
}

test('identity matcher emits explainable candidates without exposing email addresses', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['Eugene Cho'], 'echo@example.test'),
    record('contributor:b', ['Eugene Cho'], 'echo@work.test'),
  ])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].status, 'candidate')
  assert.equal(matches[0].confidence, 0.92)
  assert.deepEqual(
    matches[0].signals.map((signal) => signal.kind),
    ['email-handle', 'exact-name'],
  )
  assert.equal(JSON.stringify(matches).includes('@'), false)
})

test('identity matcher treats repository mailmap evidence as explicit', () => {
  const canonical = 'email:canonical@example.test'
  const matches = buildIdentityMatches([
    record('contributor:a', ['Old Name'], 'old@example.test', { mailmapKeys: [canonical] }),
    record('contributor:b', ['Work Name'], 'work@example.test', { mailmapKeys: [canonical] }),
  ])

  assert.equal(matches[0].status, 'confirmed')
  assert.equal(matches[0].confidence, 1)
  assert.equal(matches[0].signals[0].kind, 'mailmap')
})

test('confirmed identity decisions aggregate profiles while preserving raw contributors', () => {
  const dataset = datasetWith([
    contributor('contributor:a', 'Eugene Cho'),
    contributor('contributor:b', 'Eugene Cho'),
  ])
  const initial = resolveIdentities(dataset)
  assert.equal(initial.suggestedCount, 1)
  assert.equal(initial.profiles.length, 2)

  const decisions = applyIdentityDecision(
    emptyIdentityDecisions(dataset.repository.name),
    initial.matches[0].id,
    'merged',
  )
  const merged = resolveIdentities(dataset, decisions)

  assert.equal(merged.profiles.length, 1)
  assert.deepEqual(merged.profiles[0].identityIds, ['contributor:a', 'contributor:b'])
  assert.equal(dataset.contributors.length, 2)
  assert.equal(merged.matches[0].decisionSource, 'user')
})

test('keep-separate decisions block a contradictory transitive merge', () => {
  const dataset = datasetWith([
    contributor('contributor:a', 'Same Name'),
    contributor('contributor:b', 'Same Name'),
    contributor('contributor:c', 'Same Name'),
  ])
  const initial = resolveIdentities(dataset)
  const byPair = new Map(initial.matches.map((match) => [match.identityIds.join('|'), match.id]))
  let decisions = emptyIdentityDecisions(dataset.repository.name)
  decisions = applyIdentityDecision(decisions, byPair.get('contributor:a|contributor:b'), 'merged')
  decisions = applyIdentityDecision(decisions, byPair.get('contributor:a|contributor:c'), 'separate')
  decisions = applyIdentityDecision(decisions, byPair.get('contributor:b|contributor:c'), 'merged')

  const resolution = resolveIdentities(dataset, decisions)
  assert.equal(resolution.profiles.length, 2)
  assert.equal(
    resolution.matches.find(
      (match) => match.identityIds.join('|') === 'contributor:b|contributor:c',
    ).effectiveState,
    'blocked',
  )
})
