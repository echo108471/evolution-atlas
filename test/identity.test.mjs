import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIdentityMatches } from '../scripts/lib/identity.mjs'
import {
  applyIdentityDecision,
  clampThreshold,
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
  // A distinctive shared handle and a matching full name are two independent signals.
  assert.equal(matches[0].confidence, 0.94)
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
  // Held above the name-only tier so this exercises the manual path rather than auto-merge.
  const manual = emptyIdentityDecisions(dataset.repository.name, 0.92)
  const initial = resolveIdentities(dataset, manual)
  assert.equal(initial.suggestedCount, 1)
  assert.equal(initial.profiles.length, 2)

  const decisions = applyIdentityDecision(manual, initial.matches[0].id, 'merged')
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
  assert.equal(
    setAutoMergeThreshold(document, Number.NaN).autoMergeThreshold,
    DEFAULT_AUTO_MERGE_THRESHOLD,
  )
})

test('a threshold the reader never chose follows the current default', () => {
  // Stored as absent rather than as a copy, so improving the default reaches a reader who
  // never opened the control instead of being shadowed by browser storage.
  const untouched = emptyIdentityDecisions('repo')
  assert.equal(untouched.autoMergeThreshold, null)

  const dataset = datasetWith(
    [contributor('contributor:a', 'Colin McDonnell'), contributor('contributor:b', 'Colin McDonnell')],
    [strongMatch('contributor:a', 'contributor:b', DEFAULT_AUTO_MERGE_THRESHOLD)],
  )
  const resolution = resolveIdentities(dataset, untouched)

  assert.equal(resolution.autoMergeThreshold, DEFAULT_AUTO_MERGE_THRESHOLD)
  assert.equal(resolution.autoMergedCount, 1)
})

test('an identical full name merges on its own but a lone given name does not', () => {
  const full = datasetWith([
    contributor('contributor:a', 'Colin McDonnell'),
    contributor('contributor:b', 'Colin McDonnell'),
  ])
  assert.equal(resolveIdentities(full).autoMergedCount, 1)

  const given = datasetWith([
    contributor('contributor:a', 'Ernest'),
    contributor('contributor:b', 'Ernest'),
  ])
  // Below the analyzer's emission floor, so it is never even proposed.
  assert.equal(given.identityMatches, undefined)
  assert.equal(resolveIdentities(given).matches.length, 0)
  assert.equal(resolveIdentities(given).profiles.length, 2)
})

test('a decisions file written before the threshold existed still loads', () => {
  const legacy = {
    schemaVersion: '0.1.0',
    repository: 'repo',
    decisions: [{ matchId: 'identity-match:a|b', choice: 'merged' }],
  }

  const parsed = parseIdentityDecisions(legacy, 'repo')

  assert.equal(parsed.schemaVersion, '0.2.0')
  // Absent rather than back-filled, so the file follows whatever default is current.
  assert.equal(parsed.autoMergeThreshold, null)
  assert.equal(clampThreshold(parsed.autoMergeThreshold), DEFAULT_AUTO_MERGE_THRESHOLD)
  assert.deepEqual(parsed.decisions, legacy.decisions)
})

test('a shared given-name handle across two domains does not join two people', () => {
  // Observed in zod: andreas@deininger.net and andreas@amsenius.se are different people,
  // and the old scoring merged them at 0.82 on the handle alone.
  const matches = buildIdentityMatches([
    record('contributor:a', ['Andreas Deininger'], 'andreas@deininger.test'),
    record('contributor:b', ['Andreas Amsenius'], 'andreas@amsenius.test'),
  ])

  assert.deepEqual(matches, [])
})

test('a shared given-name handle at one domain is still evidence', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['Scott Trinh'], 'scott@scotttrinh.test'),
    record('contributor:b', ['Scott Trinh'], 'scott@scotttrinh.test'),
  ])

  assert.equal(matches.length, 1)
  assert.ok(matches[0].confidence >= 0.94)
})

test('a role handle shared across domains is never identity evidence', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['Barnaby Keene'], 'accounts@southcla.test'),
    record('contributor:b', ['Alexandre Gaubil'], 'accounts@gaubil.test'),
  ])

  assert.deepEqual(matches, [])
})

test('one address used under two names is the strongest observed signal', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['Sid'], 'sid@example.test'),
    record('contributor:b', ['Sidharth Rathi'], 'sid@example.test'),
  ])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].confidence, 0.97)
  assert.ok(matches[0].signals.some((signal) => signal.kind === 'same-address'))
})

test('a repeated single-token given name is too weak to propose', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['Ernest'], 'ernest@one.test'),
    record('contributor:b', ['Ernest'], 'ernest2@two.test'),
  ])

  assert.deepEqual(matches, [])
})

test('a long single-token name is treated as a full name', () => {
  const matches = buildIdentityMatches([
    record('contributor:a', ['EthanBehrends'], 'ethan@lindy.test'),
    record('contributor:b', ['EthanBehrends'], 'epbehrends@gmail.test'),
  ])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].confidence, 0.86)
})

test('disagreeing full names are recorded as evidence against the match', () => {
  // Reached directly so that the conflict is observable; scoring drops it below the floor.
  const matches = buildIdentityMatches([
    record('contributor:a', ['Ivan Greene'], 'ivan@ivan.test', { mailmapKeys: ['email:shared'] }),
    record('contributor:b', ['Ivan Kleshnin'], 'ivan@paqmind.test', { mailmapKeys: ['email:shared'] }),
  ])

  assert.equal(matches.length, 1)
  assert.equal(matches[0].status, 'confirmed')
  // The repository's own mapping outranks the heuristic, so the score stands.
  assert.equal(matches[0].confidence, 1)
  assert.deepEqual(
    matches[0].conflicts.map((signal) => signal.kind),
    ['conflicting-name'],
  )
})
