import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildEpochs, groupPeriods } from '../scripts/lib/epochs.mjs'
import { createBatchRunner } from '../scripts/lib/openrouter-batch.mjs'
import { proposePhaseBoundaries } from '../scripts/lib/phase-model.mjs'
import { labelPeriodLevels } from '../scripts/lib/period-labels.mjs'

const MODEL = 'openai/gpt-6-luna:batch'
const UNCAPPED = { maxCommits: Infinity, maxDays: Infinity }

function dataset(count = 240) {
  const episodes = Array.from({ length: count }, (_, index) => {
    const commitSha = index.toString(16).padStart(8, '0') + 'f'.repeat(32)
    return {
      id: `episode:${commitSha}`, commitSha, shortSha: commitSha.slice(0, 8),
      subject: index < count / 2 ? 'Introduce interface' : 'Expand data importer',
      authoredAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
      changes: [{ path: index < count / 2 ? 'ui/main.ts' : 'import/main.ts', status: 'M' }],
    }
  })
  return { repository: { name: 'synthetic-batch', headSha: episodes.at(-1).commitSha }, episodes }
}

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-epochs-batch-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function completion(value) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { total_tokens: 5 } }
}

function mockedApi(resultFor) {
  const batches = new Map()
  const submitted = []
  const fetched = []
  return {
    submitted, fetched,
    fetchImpl: async (url, options = {}) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        submitted.push(body)
        const id = `batch_${submitted.length}`
        batches.set(id, { body, polls: 0 })
        return { ok: true, status: 202, json: async () => ({ id, status: 'validating' }) }
      }
      fetched.push(url)
      const id = url.split('/').at(-1)
      const stored = batches.get(id)
      assert.ok(stored, `unexpected mocked batch ${id}`)
      stored.polls += 1
      return { ok: true, status: 200, json: async () => stored.polls === 1
        ? { id, status: 'in_progress' }
        : { id, status: 'completed', results: stored.body.requests.map((request, index) => ({
          id: `${id}_${index}`, custom_id: request.custom_id, ...resultFor(request, stored.body, index),
        })) } }
    },
  }
}

function successful(body) {
  return { response: { status_code: 200, request_id: 'synthetic', body }, error: null }
}

test('epoch proposals batch all windows, parse citations and replay saved raw results without requests', async (t) => {
  const root = temporary(t)
  const data = dataset()
  const api = mockedApi((request) => successful(completion({ boundaries: [
    { shortSha: data.episodes[120].shortSha, before: 'interface', after: 'importer', confidence: 0.8 },
    { shortSha: 'unresolved', confidence: 0.5 },
  ] })))
  let now = 0
  const config = { statePath: join(root, 'epochs.json.batch-state.json'), input: data, model: MODEL,
    apiKey: 'synthetic', fetchImpl: api.fetchImpl, pollIntervalMs: 1, maxWaitMs: 100,
    now: () => now, sleep: async (ms) => { now += ms } }
  const options = { model: MODEL, window: 120, stride: 60, batchRunner: createBatchRunner(config) }
  const result = await proposePhaseBoundaries(data, options)
  assert.equal(api.submitted.length, 1)
  assert.equal(api.fetched.length, 2)
  const [body] = api.submitted
  assert.equal(body.endpoint, '/v1/chat/completions')
  assert.equal(body.model, MODEL)
  assert.equal(body.requests.length, 3)
  assert.equal(new Set(body.requests.map((request) => request.custom_id)).size, 3)
  assert.ok(body.requests.every((request) => !('model' in request.body) && !('stream' in request.body)))
  assert.equal(result.proposals.length, 3)
  assert.ok(result.proposals.every((proposal) => proposal.index === 120))
  assert.equal(result.unresolved.length, 3)
  assert.equal(result.usage.total_tokens, 15)
  const replay = await proposePhaseBoundaries(data, { ...options, batchRunner: createBatchRunner({
    ...config, apiKey: undefined, replayOnly: true, fetchImpl: async () => assert.fail('Replay reached fetch'),
  }) })
  assert.deepEqual(replay, result)
})

test('labels batch each dependency level and preserve candidate methods and per-request failures', async (t) => {
  const root = temporary(t)
  const data = dataset()
  const epochs = buildEpochs([{ id: 'boundary', startIndex: 120, endIndex: 120 }], data.episodes, UNCAPPED)
  const eras = groupPeriods(epochs, new Map(), { maxPerGroup: 30, level: 1 })
  const api = mockedApi((request, body, index) => {
    if (body.requests.length === 2 && index === 1) return { response: null, error: { message: 'Synthetic request failure' } }
    return successful(completion({ label: body.requests.length === 2 ? 'Interface work' : 'Product era', summary: 'Candidate summary', coherent: true, confidence: 1.5 }))
  })
  const result = await labelPeriodLevels(data, [epochs, eras], {
    model: MODEL,
    batchRunner: createBatchRunner({ statePath: join(root, 'labels.batch-state.json'), input: data, model: MODEL,
      apiKey: 'synthetic', fetchImpl: api.fetchImpl, pollIntervalMs: 1, maxWaitMs: 100 }),
  })
  assert.equal(api.submitted.length, 2)
  assert.deepEqual(api.submitted.map((body) => body.requests.length), [2, 1])
  assert.match(api.submitted[1].requests[0].body.messages[1].content, /Interface work/)
  assert.match(api.submitted[1].requests[0].body.messages[1].content, /\(unnamed\)/)
  assert.doesNotMatch(api.submitted[1].requests[0].body.messages[1].content, /ui\/main\.ts/)
  assert.equal(result.method, `period-label:openrouter:${MODEL}`)
  assert.equal(result.levels[0][0].labelMethod, result.method)
  assert.equal(result.levels[0][0].labelStatus, 'candidate')
  assert.equal(result.levels[0][0].labelConfidence, 1)
  assert.equal(result.levels[0][1].labelStatus, 'failed')
  assert.equal(result.levels[1][0].label, 'Product era')
  assert.match(result.failures[0].message, /Synthetic request failure/)
})

for (const status of ['failed', 'expired']) {
  test(`a ${status} epoch batch aborts instead of yielding empty success`, async (t) => {
    const root = temporary(t)
    const data = dataset()
    const batchRunner = createBatchRunner({
      statePath: join(root, 'epochs.batch-state.json'), input: data, model: MODEL, apiKey: 'synthetic', pollIntervalMs: 1,
      fetchImpl: async (_url, options = {}) => ({ ok: true, status: options.method === 'POST' ? 202 : 200,
        json: async () => options.method === 'POST' ? { id: 'batch_failed', status: 'validating' }
          : { id: 'batch_failed', status, error: { message: 'Synthetic terminal error' }, results: null } }),
    })
    await assert.rejects(proposePhaseBoundaries(data, { batchRunner }), new RegExp(status))
  })
}

test('per-request epoch proposal errors retain successful windows and existing failure accounting', async (t) => {
  const root = temporary(t)
  const data = dataset()
  const api = mockedApi((_request, _body, index) => index === 0
    ? { response: null, error: { message: 'Synthetic window error' } }
    : successful(completion({ boundaries: [{ shortSha: data.episodes[120].shortSha }] })))
  const batchRunner = createBatchRunner({ statePath: join(root, 'epochs.batch-state.json'), input: data,
    model: MODEL, apiKey: 'synthetic', pollIntervalMs: 1, fetchImpl: api.fetchImpl })
  const result = await proposePhaseBoundaries(data, { batchRunner, window: 120, stride: 60 })
  assert.equal(result.proposals.length, 2)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].windowStart, 0)
  assert.match(result.failures[0].message, /Synthetic window error/)
})

test('epochs rejects batch routing, timing and replay flags with synchronous models before dispatch', (t) => {
  const root = temporary(t)
  const input = join(root, 'dataset.json')
  const calls = join(root, 'unexpected-fetch')
  const preload = join(root, 'mock-api.mjs')
  writeFileSync(input, JSON.stringify(dataset(80)))
  writeFileSync(preload, `
import { writeFileSync } from 'node:fs'
globalThis.fetch = async () => {
  writeFileSync(process.env.ATLAS_MOCK_CALLS, 'unexpected dispatch')
  throw new Error('Unexpected mock dispatch')
}
`)
  for (const [index, option] of [
    ['--batch-model', MODEL],
    ['--batch-poll-ms', '1'],
    ['--batch-max-wait-ms', '100'],
    ['--batch-replay', join(root, 'saved.batch-state.json')],
  ].entries()) {
    const output = join(root, `epochs-${index}.json`)
    const result = spawnSync(process.execPath, ['--import', preload, resolve('scripts/epochs.mjs'),
      '--in', input, '--out', output, '--model', 'openai/gpt-6-luna', '--allow-paid', ...option], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, OPENROUTER_API_KEY: 'synthetic', ATLAS_MOCK_CALLS: calls },
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Batch options require an OpenRouter model ending in :batch/)
    assert.equal(existsSync(calls), false)
    assert.equal(existsSync(output), false)
    assert.equal(existsSync(`${output}.batch-state.json`), false)
  }
})

test('epochs CLI resumes a label timeout without second submissions and replays without credentials', (t) => {
  const root = temporary(t)
  const input = join(root, 'dataset.json')
  const output = join(root, 'epochs.json')
  const savedProposals = join(root, 'proposals.json')
  const mockFile = join(root, 'mock-api.mjs')
  const callsFile = join(root, 'calls.json')
  writeFileSync(input, JSON.stringify(dataset(80)))
  writeFileSync(mockFile, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
let mockedNow = Date.now()
Date.now = () => mockedNow
const file = process.env.ATLAS_MOCK_CALLS
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { batches: [], calls: [] }
globalThis.fetch = async (url, options = {}) => {
  state.calls.push({ url, method: options.method ?? 'GET' })
  let payload
  if (options.method === 'POST') {
    const body = JSON.parse(options.body)
    const id = 'batch_' + (state.batches.length + 1)
    state.batches.push({ id, body })
    payload = { id, status: 'validating' }
  } else {
    const batch = state.batches.find((batch) => url.endsWith('/' + batch.id))
    if (!batch) throw new Error('Unexpected mock fetch')
    const sidecar = readFileSync(process.env.ATLAS_MOCK_SIDECAR, 'utf8')
    if (!sidecar.includes(batch.id)) throw new Error('Polled before batch ID was persisted')
    const label = batch.body.requests[0].body.max_tokens === 1500
    payload = label && process.env.ATLAS_MOCK_TIMEOUT === '1'
      ? { id: batch.id, status: 'in_progress' }
      : { id: batch.id, status: 'completed', results: batch.body.requests.map((request) => ({
        custom_id: request.custom_id, id: batch.id + '_' + request.custom_id, error: null,
        response: { status_code: 200, request_id: 'synthetic', body: {
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(label
            ? { label: 'Synthetic period', summary: 'Candidate', coherent: true, confidence: 0.8 }
            : { boundaries: [] }) } }], usage: { total_tokens: 1 },
        } },
      })) }
  }
  if (payload.status === 'in_progress') mockedNow += 1001
  writeFileSync(file, JSON.stringify(state))
  return { ok: true, status: options.method === 'POST' ? 202 : 200, json: async () => payload }
}
`)
  const sidecar = `${output}.batch-state.json`
  const base = ['--in', input, '--out', output, '--save-proposals', savedProposals]
  const env = { ...process.env, OPENROUTER_API_KEY: 'synthetic', ATLAS_MOCK_CALLS: callsFile, ATLAS_MOCK_SIDECAR: sidecar }
  const invoke = (args, childEnv = env) => spawnSync(process.execPath, ['--import', mockFile, resolve('scripts/epochs.mjs'), ...args], {
    encoding: 'utf8', env: childEnv, timeout: 10_000,
  })
  const first = invoke([...base, '--allow-paid', '--batch-poll-ms', '1', '--batch-max-wait-ms', '1000'], { ...env, ATLAS_MOCK_TIMEOUT: '1' })
  assert.equal(first.status, 1, first.stderr)
  assert.match(first.stderr, /batch_2/)
  assert.match(first.stderr, /in_progress/)
  assert.match(first.stderr, /resume/i)
  assert.equal(existsSync(output), false)
  assert.equal(existsSync(savedProposals), false)
  assert.equal(existsSync(sidecar), true)
  const resumed = invoke([...base, '--allow-paid', '--batch-poll-ms', '1', '--batch-max-wait-ms', '1000'])
  assert.equal(resumed.status, 0, resumed.stderr)
  const calls = JSON.parse(readFileSync(callsFile, 'utf8'))
  assert.equal(calls.batches.length, 2, 'both completed proposals and pending labels are reused')
  const document = JSON.parse(readFileSync(output, 'utf8'))
  assert.ok(document.method.endsWith(`:openrouter:${MODEL}`))
  assert.equal(document.levels[0][0].labelMethod, `period-label:openrouter:${MODEL}`)
  assert.equal(existsSync(savedProposals), true)
  const replayOutput = join(root, 'replayed.json')
  const { OPENROUTER_API_KEY: _unused, ...replayEnv } = env
  const replayed = invoke(['--in', input, '--out', replayOutput, '--batch-replay', sidecar], replayEnv)
  assert.equal(replayed.status, 0, replayed.stderr)
  assert.deepEqual(JSON.parse(readFileSync(replayOutput, 'utf8')), document)
  assert.deepEqual(JSON.parse(readFileSync(callsFile, 'utf8')), calls, 'offline replay never calls the mock API')
  const changed = invoke(['--in', input, '--out', join(root, 'changed.json'), '--batch-replay', sidecar, '--window', '80'], replayEnv)
  assert.equal(changed.status, 1, changed.stderr)
  assert.match(changed.stderr, /fingerprint/i)
})
