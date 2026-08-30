import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBoundaryIntervals,
  buildEpochs,
  buildFocusSignals,
  clusterProposals,
  detectFocusPeaks,
} from '../scripts/lib/epochs.mjs'
import {
  extractJson,
  parseWindowResponse,
  planWindows,
  proposePhaseBoundaries,
  renderWindow,
} from '../scripts/lib/phase-model.mjs'

function episode(index, { prefix = 'frontend', subject = `work on ${prefix}` } = {}) {
  // Distinct within the first eight characters, so short SHAs stay unique the way
  // real ones do. An earlier fixture collided here and silently resolved every
  // citation to the last commit.
  const sha = `c${String(index).padStart(7, '0')}${'f'.repeat(31)}`
  const day = String((index % 27) + 1).padStart(2, '0')
  const month = String((Math.floor(index / 27) % 12) + 1).padStart(2, '0')
  return {
    id: `episode:${sha}`,
    commitSha: sha,
    shortSha: sha.slice(0, 8),
    subject,
    authoredAt: `2025-${month}-${day}T00:00:00Z`,
    committedAt: `2025-${month}-${day}T00:00:00Z`,
    parentShas: [],
    contributorIds: [],
    codeAreaIds: [],
    changes: [{ path: `${prefix}/src/file${index % 5}.ts`, status: 'M' }],
    interpretationStatus: 'observed',
  }
}

/** Two halves that touch disjoint paths and use disjoint vocabulary. */
function splitHistory(size = 200) {
  return Array.from({ length: size }, (_, index) =>
    index < size / 2
      ? episode(index, { prefix: 'frontend', subject: 'render the landing page' })
      : episode(index, { prefix: 'etl', subject: 'load warehouse extraction rows' }),
  )
}

test('focus signals peak where the touched paths and subject vocabulary both change', () => {
  const episodes = splitHistory(200)
  const rows = buildFocusSignals(episodes, { window: 40 })
  const strongest = rows.reduce((best, row) => (row.path > best.path ? row : best))

  assert.equal(strongest.index, 100)
  assert.ok(strongest.path > 0.9, `expected near-total path divergence, got ${strongest.path}`)
  assert.ok(strongest.language > 0.9, `expected near-total language divergence, got ${strongest.language}`)
})

test('focus signals stay flat when the work never changes character', () => {
  const episodes = Array.from({ length: 160 }, (_, index) => episode(index))
  const rows = buildFocusSignals(episodes, { window: 40 })

  assert.ok(rows.every((row) => row.path < 0.05), 'a uniform history should not diverge')
  assert.ok(rows.every((row) => row.language < 0.05), 'a uniform history should not diverge')
})

test('peak detection suppresses neighbours so one shift is reported once', () => {
  const episodes = splitHistory(200)
  const rows = buildFocusSignals(episodes, { window: 40 })
  const peaks = detectFocusPeaks(rows, 'path', { count: 5, separation: 50 })

  assert.ok(peaks.length >= 1)
  assert.equal(peaks[0].kind, 'path')
  for (let index = 1; index < peaks.length; index += 1) {
    assert.ok(peaks[index].index - peaks[index - 1].index >= 50, 'peaks must respect separation')
  }
})

test('proposals from overlapping windows fold into one boundary and keep the vote count', () => {
  const clusters = clusterProposals([
    { index: 100, confidence: 0.7, windowStart: 0, before: 'a', after: 'b', reason: 'first look' },
    { index: 108, confidence: 0.82, windowStart: 100, before: 'a2', after: 'b2', reason: 'second look' },
    { index: 400, confidence: 0.6, windowStart: 300, before: 'c', after: 'd', reason: 'later' },
  ])

  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].votes, 2)
  assert.equal(clusters[0].confidence, 0.82)
  assert.equal(clusters[0].reason, 'second look', 'the most confident member supplies the description')
  assert.equal(clusters[1].votes, 1)
})

test('a proposal citing a commit outside the dataset is dropped rather than clustered', () => {
  const clusters = clusterProposals([
    { index: null, confidence: 0.9, windowStart: 0 },
    { index: 50, confidence: 0.7, windowStart: 0 },
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].index, 50)
})

test('a boundary spans both readings without assuming which one comes first', () => {
  const episodes = splitHistory(300)
  const { boundaries } = buildBoundaryIntervals(
    [{ index: 150, votes: 2, confidence: 0.8, before: 'ui', after: 'etl', reason: 'pivot' }],
    [{ index: 120, kind: 'path', score: 2.4 }],
    episodes,
  )

  assert.equal(boundaries.length, 1)
  const [boundary] = boundaries
  assert.equal(boundary.status, 'candidate')
  assert.equal(boundary.corroborated, true)
  assert.equal(boundary.proposedIndex, 150)
  assert.equal(boundary.settledIndex, 120)
  assert.equal(boundary.startIndex, 120, 'the interval starts at the earlier reading')
  assert.equal(boundary.endIndex, 150, 'the interval ends at the later reading')
  assert.equal(boundary.spanCommits, 30)
})

test('a boundary no detector corroborates is still recorded, marked uncorroborated', () => {
  const episodes = splitHistory(300)
  const { boundaries } = buildBoundaryIntervals(
    [{ index: 150, votes: 1, confidence: 0.7, before: 'a', after: 'b', reason: 'quiet shift' }],
    [{ index: 10, kind: 'path', score: 2.0 }],
    episodes,
    { reach: 40 },
  )

  const [boundary] = boundaries
  assert.equal(boundary.corroborated, false)
  assert.equal(boundary.settledIndex, null)
  assert.equal(boundary.startIndex, boundary.endIndex, 'an uncorroborated boundary is a point')
  assert.equal(boundary.signals.length, 1)
  assert.equal(boundary.signals[0].basis, 'candidate')
})

test('observed focus shifts and candidate proposals stay distinguishable in the signals', () => {
  const episodes = splitHistory(300)
  const { boundaries } = buildBoundaryIntervals(
    [{ index: 150, votes: 2, confidence: 0.8, before: 'a', after: 'b', reason: 'pivot' }],
    [{ index: 140, kind: 'path', score: 2.4 }],
    episodes,
  )

  const bases = boundaries[0].signals.map((signal) => signal.basis)
  assert.deepEqual(bases, ['candidate', 'observed'])
  assert.equal(boundaries[0].signals[1].kind, 'path-focus-shift')
})

test('one focus shift cannot corroborate two separate boundaries', () => {
  const episodes = splitHistory(400)
  const { boundaries, unpairedFocusPeaks } = buildBoundaryIntervals(
    [
      { index: 150, votes: 2, confidence: 0.8, before: 'a', after: 'b', reason: 'first' },
      { index: 200, votes: 1, confidence: 0.7, before: 'b', after: 'c', reason: 'second' },
    ],
    [{ index: 155, kind: 'path', score: 2.4 }],
    episodes,
  )

  assert.equal(boundaries.filter((boundary) => boundary.corroborated).length, 1)
  assert.equal(boundaries[0].settledIndex, 155, 'the nearer boundary claims the peak')
  assert.equal(boundaries[1].settledIndex, null)
  assert.equal(unpairedFocusPeaks.length, 0, 'a claimed peak is not also reported as unpaired')
})

test('focus peaks that no proposal reaches are reported rather than discarded', () => {
  const episodes = splitHistory(400)
  const { unpairedFocusPeaks } = buildBoundaryIntervals(
    [{ index: 50, votes: 1, confidence: 0.7, before: 'a', after: 'b', reason: 'r' }],
    [{ index: 60, kind: 'path', score: 2.0 }, { index: 300, kind: 'path', score: 2.6 }],
    episodes,
  )

  assert.equal(unpairedFocusPeaks.length, 1)
  assert.equal(unpairedFocusPeaks[0].index, 300)
  assert.equal(unpairedFocusPeaks[0].commitSha, episodes[300].commitSha)
})

test('epochs run between boundary intervals, leaving the ambiguous commits in neither', () => {
  const episodes = splitHistory(400)
  const epochs = buildEpochs(
    [{ id: 'epoch-boundary:x', startIndex: 180, endIndex: 200 }],
    episodes,
  )

  assert.equal(epochs.length, 2)
  assert.deepEqual([epochs[0].startIndex, epochs[0].endIndex], [0, 180])
  assert.deepEqual([epochs[1].startIndex, epochs[1].endIndex], [200, 400])
  assert.equal(epochs[0].closedBy, 'epoch-boundary:x')
  assert.equal(epochs[1].closedBy, null)
  assert.equal(epochs[0].commitCount + epochs[1].commitCount, 380, 'the 20 transition commits belong to neither epoch')
})

test('a boundary too close to the previous cut does not create a runt epoch', () => {
  const episodes = splitHistory(400)
  const epochs = buildEpochs(
    [
      { id: 'epoch-boundary:a', startIndex: 10, endIndex: 20 },
      { id: 'epoch-boundary:b', startIndex: 200, endIndex: 210 },
    ],
    episodes,
    { minCommits: 40 },
  )

  assert.equal(epochs.length, 2)
  assert.equal(epochs[0].startIndex, 0)
  assert.equal(epochs[0].endIndex, 200, 'the runt cut at 10 is skipped')
})

test('windows overlap so most commits are read by two separate requests', () => {
  const episodes = splitHistory(500)
  const windows = planWindows(episodes, { window: 200, stride: 100 })

  assert.ok(windows.length >= 4)
  assert.deepEqual([windows[0].start, windows[0].end], [0, 200])
  assert.deepEqual([windows[1].start, windows[1].end], [100, 300])
  assert.equal(windows[windows.length - 1].end, 500)
})

test('a rendered window carries commits and nothing that hints at a boundary', () => {
  const rendered = renderWindow(splitHistory(4))

  assert.match(rendered, /c0000000 2025-01-01 render the landing page/)
  assert.match(rendered, /frontend\/src\/file0\.ts/)
  assert.doesNotMatch(rendered, /divergence|z-score|boundary|peak/i)
})

test('model output survives a markdown fence', () => {
  const parsed = extractJson('```json\n{"boundaries": [{"shortSha": "abc"}]}\n```')
  assert.equal(parsed.boundaries[0].shortSha, 'abc')
})

test('a truncated window fails loudly instead of yielding partial boundaries', () => {
  assert.throws(
    () => parseWindowResponse({ choices: [{ finish_reason: 'length', message: { content: '{"bound' } }] }),
    /truncated/,
  )
})

test('the proposal pass resolves cited commits and drops the ones it cannot', async () => {
  const episodes = splitHistory(300)
  const dataset = { repository: { name: 'fixture' }, episodes }

  const result = await proposePhaseBoundaries(dataset, {
    window: 200,
    stride: 100,
    request: async (_dataset, windowPlan) => ({
      boundaries:
        windowPlan.start === 0
          ? [
              { shortSha: episodes[150].shortSha, confidence: 0.8, before: 'a', after: 'b', reason: 'r' },
              { shortSha: 'notacommit', confidence: 0.9, before: 'x', after: 'y', reason: 'r' },
            ]
          : [],
      usage: { total_tokens: 10 },
    }),
  })

  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].index, 150)
  assert.equal(result.unresolved.length, 1)
  assert.equal(result.unresolved[0].shortSha, 'notacommit')
  assert.equal(result.failures.length, 0)
  assert.equal(result.usage.total_tokens, 10 * result.windowCount)
})

test('one failing window does not abandon the rest of the history', async () => {
  const episodes = splitHistory(300)
  const dataset = { repository: { name: 'fixture' }, episodes }

  const result = await proposePhaseBoundaries(dataset, {
    window: 200,
    stride: 100,
    request: async (_dataset, windowPlan) => {
      if (windowPlan.start === 0) throw new Error('HTTP 503')
      return { boundaries: [{ shortSha: episodes[250].shortSha, confidence: 0.7 }], usage: null }
    },
  })

  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].message, 'HTTP 503')
  assert.ok(result.proposals.length >= 1, 'later windows still contribute')
})
