import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIdentityMatches } from '../scripts/lib/identity.mjs'
import {
  applyIdentityDecision,
  DEFAULT_AUTO_MERGE_THRESHOLD,
  emptyIdentityDecisions,
  parseIdentityDecisions,
  resolveIdentities,
  setAutoMergeThreshold,
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

function datasetWith(contributors, identityMatches) {
  return {
    ...(identityMatches ? { identityMatches } : {}),
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

function strongMatch(leftId, rightId, confidence) {
  return {
    id: `identity-match:${leftId}|${rightId}`,
    identityIds: [leftId, rightId],
    status: 'candidate',
    confidence,
    method: 'deterministic-identity-v1',
    signals: [
      {
        kind: 'email-handle',
        label: 'The private email identifiers have the same non-generic account handle.',
        basis: 'observed',
        weight: 0.82,
      },
    ],
    conflicts: [],
  }
}

test('matches at or above the threshold merge without being asked about', () => {
  const dataset = datasetWith(
    [contributor('contributor:a', 'Eugene Cho'), contributor('contributor:b', 'E Cho')],
    [strongMatch('contributor:a', 'contributor:b', 0.92)],
  )

  const resolution = resolveIdentities(dataset)

  assert.equal(resolution.autoMergeThreshold, DEFAULT_AUTO_MERGE_THRESHOLD)
  assert.equal(resolution.autoMergedCount, 1)
  assert.equal(resolution.suggestedCount, 0)
  assert.equal(resolution.profiles.length, 1)
  assert.equal(resolution.matches[0].effectiveState, 'merged')
  assert.equal(resolution.matches[0].decisionSource, 'auto')
  // The underlying identities are a projection, never a rewrite.
  assert.equal(dataset.contributors.length, 2)
})

test('matches below the threshold are left alone for review', () => {
  const dataset = datasetWith(
    [contributor('contributor:a', 'Eugene Cho'), contributor('contributor:b', 'E Cho')],
    [strongMatch('contributor:a', 'contributor:b', 0.82)],
  )

  const resolution = resolveIdentities(dataset)

  assert.equal(resolution.autoMergedCount, 0)
  assert.equal(resolution.suggestedCount, 1)
  assert.equal(resolution.profiles.length, 2)
  assert.equal(resolution.matches[0].effectiveState, 'suggested')
})

test('lowering the threshold merges a pair that was previously left for review', () => {
  const dataset = datasetWith(
    [contributor('contributor:a', 'Eugene Cho'), contributor('contributor:b', 'E Cho')],
    [strongMatch('contributor:a', 'contributor:b', 0.82)],
  )
  const lowered = setAutoMergeThreshold(emptyIdentityDecisions(dataset.repository.name), 0.82)

  const resolution = resolveIdentities(dataset, lowered)

  assert.equal(resolution.autoMergedCount, 1)
  assert.equal(resolution.profiles.length, 1)
})

test('an explicit keep-separate outranks the threshold', () => {
  const dataset = datasetWith(
    [contributor('contributor:a', 'Eugene Cho'), contributor('contributor:b', 'E Cho')],
    [strongMatch('contributor:a', 'contributor:b', 0.96)],
  )
  const decisions = applyIdentityDecision(
    emptyIdentityDecisions(dataset.repository.name),
    'identity-match:contributor:a|contributor:b',
    'separate',
  )

  const resolution = resolveIdentities(dataset, decisions)

  assert.equal(resolution.profiles.length, 2)
  assert.equal(resolution.matches[0].effectiveState, 'separate')
  assert.equal(resolution.matches[0].decisionSource, 'user')
})

test('the threshold is clamped so that no setting can merge every proposed pair', () => {
  const document = setAutoMergeThreshold(emptyIdentityDecisions('repo'), 0)
  assert.equal(document.autoMergeThreshold, 0.7)
  assert.equal(setAutoMergeThreshold(document, 5).autoMergeThreshold, 1)
  assert.equal(setAutoMergeThreshold(document, Number.NaN).autoMergeThreshold, 0.92)
})

test('a decisions file written before the threshold existed still loads', () => {
  const legacy = {
    schemaVersion: '0.1.0',
    repository: 'repo',
    decisions: [{ matchId: 'identity-match:a|b', choice: 'merged' }],
  }

  const parsed = parseIdentityDecisions(legacy, 'repo')

  assert.equal(parsed.schemaVersion, '0.2.0')
  assert.equal(parsed.autoMergeThreshold, DEFAULT_AUTO_MERGE_THRESHOLD)
  assert.deepEqual(parsed.decisions, legacy.decisions)
})
