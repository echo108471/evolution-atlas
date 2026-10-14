import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBoundaryIntervals,
  buildEpochs,
  buildFocusSignals,
  buildPeriodLevels,
  clusterProposals,
  detectFocusPeaks,
  groupPeriods,
  levelName,
  planHierarchy,
} from '../scripts/lib/epochs.mjs'
import { labelPeriodLevels, requestLabel, sampleCommits } from '../scripts/lib/period-labels.mjs'
import {
  DEFAULT_MODEL,
  extractJson,
  parseWindowResponse,
  planWindows,
  proposePhaseBoundaries,
  renderWindow,
  requestWindow,
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

/** Size capping is exercised on its own; other tests opt out so cuts stay where placed. */
const UNCAPPED = { maxCommits: Number.POSITIVE_INFINITY, maxDays: Number.POSITIVE_INFINITY }

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
  const epochs = buildEpochs([{ id: 'epoch-boundary:x', startIndex: 180, endIndex: 200 }], episodes, UNCAPPED)

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
    { ...UNCAPPED, minCommits: 40 },
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

for (const { name, options, expectedModel } of [
  { name: 'synchronous', options: { model: 'openai/gpt-6-luna' }, expectedModel: 'openai/gpt-6-luna' },
  { name: 'explicit override', options: { model: 'x-ai/grok-4.6' }, expectedModel: 'x-ai/grok-4.6' },
]) {
  test(`phase requests send the ${name} model with OpenRouter chat completions`, async () => {
    const dataset = { repository: { name: 'fixture' }, episodes: splitHistory(80) }
    const [windowPlan] = planWindows(dataset.episodes)
    const requests = []
    const result = await requestWindow(dataset, windowPlan, {
      ...options,
      apiKey: 'sk-or-synthetic',
      fetchImpl: async (url, request) => {
        requests.push({ url, ...request, body: JSON.parse(request.body) })
        return {
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'stop', message: { content: '{"boundaries":[]}' } }],
            usage: { total_tokens: 10 },
          }),
        }
      },
    })

    assert.equal(requests.length, 1)
    const [request] = requests
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(request.method, 'POST')
    assert.deepEqual(request.headers, {
      authorization: 'Bearer sk-or-synthetic',
      'content-type': 'application/json',
    })
    assert.deepEqual(Object.keys(request.body).sort(), ['max_tokens', 'messages', 'model'])
    assert.equal(request.body.model, expectedModel)
    assert.equal(request.body.max_tokens, 4000)
    assert.deepEqual(request.body.messages.map((message) => message.role), ['system', 'user'])
    assert.ok(request.body.messages.every((message) => typeof message.content === 'string'))
    assert.match(request.body.messages[1].content, /c0000000 2025-01-01 render the landing page/)
    assert.deepEqual(result, { boundaries: [], usage: { total_tokens: 10 } })
  })

  test(`phase proposal windows retain the ${name} model and key`, async () => {
    const dataset = { repository: { name: 'fixture' }, episodes: splitHistory(300) }
    const requestOptions = []
    const result = await proposePhaseBoundaries(dataset, {
      ...options,
      apiKey: 'sk-or-synthetic',
      request: async (_dataset, _windowPlan, receivedOptions) => {
        requestOptions.push(receivedOptions)
        return { boundaries: [], usage: null }
      },
    })

    assert.ok(result.windowCount > 1)
    assert.equal(requestOptions.length, result.windowCount)
    for (const received of requestOptions) {
      assert.deepEqual(received, { model: expectedModel, apiKey: 'sk-or-synthetic' })
    }
    assert.deepEqual(result.failures, [])
  })

  test(`period labels preserve the ${name} epoch model in requests and candidate methods`, async () => {
    const dataset = { repository: { name: 'fixture' }, episodes: splitHistory(80) }
    const epochs = buildEpochs([], dataset.episodes, UNCAPPED)
    const requests = []
    const result = await labelPeriodLevels(dataset, [epochs], {
      model: options.model ?? DEFAULT_MODEL,
      apiKey: 'sk-or-synthetic',
      request: (prompt, systemPrompt, receivedOptions) => requestLabel(prompt, systemPrompt, {
        ...receivedOptions,
        fetchImpl: async (url, request) => {
          requests.push({ url, ...request, body: JSON.parse(request.body) })
          return {
            ok: true,
            json: async () => ({
              choices: [{
                finish_reason: 'stop',
                message: { content: '{"label":"Ranking","summary":"Ranking work","coherent":true,"confidence":0.8}' },
              }],
            }),
          }
        },
      }),
    })

    assert.equal(requests.length, 1)
    const [request] = requests
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(request.method, 'POST')
    assert.deepEqual(request.headers, {
      authorization: 'Bearer sk-or-synthetic',
      'content-type': 'application/json',
    })
    assert.deepEqual(Object.keys(request.body).sort(), ['max_tokens', 'messages', 'model'])
    assert.equal(request.body.model, expectedModel)
    assert.equal(request.body.max_tokens, 1500)
    assert.deepEqual(request.body.messages.map((message) => message.role), ['system', 'user'])
    assert.ok(request.body.messages.every((message) => typeof message.content === 'string'))
    assert.equal(result.method, `period-label:openrouter:${expectedModel}`)
    assert.equal(result.levels[0][0].labelMethod, result.method)
    assert.equal(result.levels[0][0].labelStatus, 'candidate')
    assert.deepEqual(result.failures, [])
  })
}

test('epochs keeps the configured batch default', () => {
  assert.equal(DEFAULT_MODEL, 'openai/gpt-6-luna:batch')
})

for (const options of [{}, { model: 'synthetic/explicit:batch' }]) {
  test(`direct synchronous epoch requests reject ${options.model ?? 'the batch default'} without a batch runner`, async () => {
    const dataset = { repository: { name: 'fixture' }, episodes: splitHistory(300) }
    const [windowPlan] = planWindows(dataset.episodes)
    const epochs = buildEpochs([], dataset.episodes, UNCAPPED)
    const model = options.model ?? DEFAULT_MODEL
    let calls = 0
    const dispatch = async () => { calls += 1; throw new Error('Unexpected dispatch') }
    const requests = [
      () => requestWindow(dataset, windowPlan, { ...options, fetchImpl: dispatch }),
      () => proposePhaseBoundaries(dataset, { ...options, request: dispatch }),
      () => requestLabel('prompt', 'system', { model, fetchImpl: dispatch }),
      () => labelPeriodLevels(dataset, [epochs], { model, request: dispatch }),
    ]
    for (const request of requests) {
      await assert.rejects(request, (error) => {
        assert.ok(error.message.includes(model))
        assert.match(error.message, /synchronous/i)
        assert.match(error.message, /Batch API/)
        return true
      })
    }
    assert.equal(calls, 0)
  })
}

test('the proposal pass resolves cited commits and drops the ones it cannot', async () => {
  const episodes = splitHistory(300)
  const dataset = { repository: { name: 'fixture' }, episodes }

  const result = await proposePhaseBoundaries(dataset, {
    model: 'openai/gpt-6-luna',
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
    model: 'openai/gpt-6-luna',
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

test('a history small enough to analyze whole is left unsegmented', () => {
  const plan = planHierarchy(300)

  assert.equal(plan.depth, 0)
  assert.deepEqual(plan.levels, [])
  assert.match(plan.rationale, /single analysis pass/)
})

test('a mid-sized history gets epochs and nothing above them', () => {
  const plan = planHierarchy(2693)

  assert.equal(plan.depth, 1)
  assert.ok(plan.levels[0] <= 30, 'one level only when its periods fit a single request')
})

test('a history with too many periods to describe together grows a level', () => {
  const plan = planHierarchy(200000)

  assert.ok(plan.depth >= 2, `expected grouping above epochs, got depth ${plan.depth}`)
  assert.ok(plan.levels[plan.levels.length - 1] < plan.levels[0], 'each level must be coarser')
})

test('depth is capped so an early commit is never read through many summaries', () => {
  const plan = planHierarchy(50_000_000, { maxDepth: 3 })

  assert.equal(plan.depth, 3)
  assert.match(plan.rationale, /capped/)
})

test('grouping cuts at the strongest boundaries rather than at even intervals', () => {
  const episodes = splitHistory(900)
  const boundaries = [
    { id: 'b:weak', corroborated: false, confidence: 0.6 },
    { id: 'b:strong', corroborated: true, confidence: 0.9 },
    { id: 'b:mid', corroborated: false, confidence: 0.7 },
  ]
  const epochs = buildEpochs(
    [
      { id: 'b:weak', startIndex: 200, endIndex: 210 },
      { id: 'b:strong', startIndex: 400, endIndex: 410 },
      { id: 'b:mid', startIndex: 600, endIndex: 610 },
    ],
    episodes,
    UNCAPPED,
  )

  const eras = groupPeriods(epochs, new Map(boundaries.map((b) => [b.id, b])), { maxPerGroup: 2, level: 1 })

  assert.equal(eras.length, 2)
  assert.equal(eras[0].closedBy, 'b:strong', 'the corroborated boundary is where the era ends')
  assert.equal(eras[0].childIds.length + eras[1].childIds.length, epochs.length)
})

test('a grouped era spans its children and carries their ids', () => {
  const episodes = splitHistory(600)
  const epochs = buildEpochs([{ id: 'b:x', startIndex: 300, endIndex: 310 }], episodes, UNCAPPED)
  const eras = groupPeriods(epochs, new Map([['b:x', { id: 'b:x', corroborated: true, confidence: 0.9 }]]), {
    maxPerGroup: 30,
    level: 1,
  })

  assert.equal(eras.length, 1)
  assert.equal(eras[0].level, 1)
  assert.equal(eras[0].startIndex, epochs[0].startIndex)
  assert.equal(eras[0].endIndex, epochs[epochs.length - 1].endIndex)
  assert.equal(eras[0].commitCount, epochs.reduce((sum, epoch) => sum + epoch.commitCount, 0))
  assert.deepEqual(eras[0].childIds, epochs.map((epoch) => epoch.id))
})

test('an epoch reports its true authored span even when commits are not in date order', () => {
  const episodes = splitHistory(200)
  // A merged branch carries an author date earlier than commits already recorded.
  episodes[150] = { ...episodes[150], authoredAt: '2024-01-01T00:00:00Z' }
  episodes[160] = { ...episodes[160], authoredAt: '2027-12-31T00:00:00Z' }

  const [epoch] = buildEpochs([], episodes, UNCAPPED)

  assert.equal(epoch.firstAuthoredAt, '2024-01-01T00:00:00Z')
  assert.equal(epoch.lastAuthoredAt, '2027-12-31T00:00:00Z')
  assert.ok(epoch.firstAuthoredAt < epoch.lastAuthoredAt, 'a period cannot end before it begins')
})

test('level names run epoch, era, age and then stay legible', () => {
  assert.equal(levelName(0), 'epoch')
  assert.equal(levelName(1), 'era')
  assert.equal(levelName(2), 'age')
  assert.equal(levelName(7), 'level-7')
})

test('a long period is sampled across its whole span, not just its opening', () => {
  const episodes = splitHistory(600)
  const sampled = sampleCommits(episodes, 0, 600, 20)

  assert.equal(sampled.length, 20)
  assert.equal(sampled[0].commitSha, episodes[0].commitSha)
  assert.ok(
    Number(sampled[sampled.length - 1].commitSha.slice(1, 8)) > 500,
    'the tail of the period must be represented',
  )
})

test('a short period is sampled whole', () => {
  const episodes = splitHistory(200)
  assert.equal(sampleCommits(episodes, 10, 40, 60).length, 30)
})

test('labels flow upward: an era is named from its epochs, not from raw commits', async () => {
  const episodes = splitHistory(600)
  const dataset = { repository: { name: 'fixture' }, episodes }
  const epochs = buildEpochs([{ id: 'b:x', startIndex: 300, endIndex: 310 }], episodes, UNCAPPED)
  const eras = groupPeriods(epochs, new Map([['b:x', { id: 'b:x', corroborated: true, confidence: 0.9 }]]), {
    maxPerGroup: 30,
    level: 1,
  })

  const prompts = []
  const result = await labelPeriodLevels(dataset, [epochs, eras], {
    model: 'test-model',
    apiKey: 'unused',
    request: async (prompt) => {
      prompts.push(prompt)
      return {
        label: { label: `named ${prompts.length}`, summary: 'summary', coherent: true, confidence: 0.8 },
        usage: null,
      }
    },
  })

  assert.equal(result.levels[1][0].label, `named ${prompts.length}`)
  assert.equal(result.levels[0][0].labelStatus, 'candidate')
  const eraPrompt = prompts[prompts.length - 1]
  assert.match(eraPrompt, /named 1/, 'the era prompt cites its epochs by their labels')
  assert.doesNotMatch(eraPrompt, /frontend\/src\/file0\.ts/, 'the era prompt carries no raw commit paths')
})

test('a failed label leaves the period unnamed instead of abandoning the run', async () => {
  const episodes = splitHistory(600)
  const dataset = { repository: { name: 'fixture' }, episodes }
  const epochs = buildEpochs([{ id: 'b:x', startIndex: 300, endIndex: 310 }], episodes, UNCAPPED)

  let call = 0
  const result = await labelPeriodLevels(dataset, [epochs], {
    model: 'test-model',
    apiKey: 'unused',
    request: async () => {
      call += 1
      if (call === 1) throw new Error('HTTP 500')
      return { label: { label: 'second', summary: 's', coherent: true, confidence: 0.7 }, usage: null }
    },
  })

  assert.equal(result.failures.length, 1)
  assert.equal(result.levels[0][0].label, null)
  assert.equal(result.levels[0][0].labelStatus, 'failed')
  assert.equal(result.levels[0][1].label, 'second')
})

test('a model that cannot find a common thread is recorded as incoherent, not forced', async () => {
  const episodes = splitHistory(200)
  const dataset = { repository: { name: 'fixture' }, episodes }
  const epochs = buildEpochs([], episodes)

  const result = await labelPeriodLevels(dataset, [epochs], {
    model: 'test-model',
    apiKey: 'unused',
    request: async () => ({
      label: { label: 'Mixed maintenance', summary: 'no common thread', coherent: false, confidence: 0.3 },
      usage: null,
    }),
  })

  assert.equal(result.levels[0][0].coherent, false)
  assert.equal(result.levels[0][0].labelConfidence, 0.3)
})

test('building levels stops early when a grouping would not actually coarsen', () => {
  const episodes = splitHistory(600)
  const epochs = buildEpochs([{ id: 'b:x', startIndex: 300, endIndex: 310 }], episodes, UNCAPPED)
  const levels = buildPeriodLevels(epochs, [{ id: 'b:x', corroborated: true, confidence: 0.9 }], { depth: 3 })

  assert.equal(levels[0], epochs)
  assert.ok(levels.length <= 3)
  for (let level = 1; level < levels.length; level += 1) {
    assert.ok(levels[level].length < levels[level - 1].length, 'each level must be strictly coarser')
  }
})

test('a period too long to be one phase is split, and says the split was imposed', () => {
  const episodes = splitHistory(800)
  const epochs = buildEpochs([], episodes, { maxCommits: 250, maxDays: Number.POSITIVE_INFINITY })

  assert.ok(epochs.length >= 4, `expected subdivision, got ${epochs.length}`)
  assert.ok(epochs.every((epoch) => epoch.commitCount <= 250))
  assert.equal(epochs[0].splitReason, 'size', 'an imposed cut is labeled, not passed off as evidence')
  assert.equal(epochs[0].closedBy, null, 'an imposed cut cites no boundary')
})

test('a period splits on duration even when its commit count is small', () => {
  // 204 commits across 277 days was a real pilot period the labeling model refused to name.
  const episodes = Array.from({ length: 200 }, (_, index) => {
    const base = episode(index)
    const day = new Date(Date.UTC(2025, 0, 1 + index * 3)).toISOString()
    return { ...base, authoredAt: day, committedAt: day }
  })

  const capped = buildEpochs([], episodes, { maxCommits: 500, maxDays: 120 })
  const uncapped = buildEpochs([], episodes, UNCAPPED)

  assert.equal(uncapped.length, 1)
  assert.ok(capped.length > 1, 'a period spanning 600 days is not one phase')
})

test('subdivision cuts at the most divergent interior position when one exists', () => {
  const episodes = splitHistory(600)
  const rows = buildFocusSignals(episodes, { window: 40 })
  const epochs = buildEpochs([], episodes, {
    maxCommits: 400,
    maxDays: Number.POSITIVE_INFINITY,
    focusRows: rows,
  })

  assert.equal(epochs.length, 2)
  assert.ok(
    Math.abs(epochs[0].endIndex - 300) <= 40,
    `expected the cut near the real shift at 300, got ${epochs[0].endIndex}`,
  )
})

test('subdivision refuses to cut a period it cannot halve without making a runt', () => {
  const episodes = splitHistory(70)
  const epochs = buildEpochs([], episodes, { minCommits: 40, maxCommits: 10, maxDays: 1 })

  assert.equal(epochs.length, 1, 'better one over-long period than two meaningless ones')
})
