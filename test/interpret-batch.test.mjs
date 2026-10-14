import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { interpretAtlas, validateFeatures } from '../scripts/lib/interpret.mjs'
import { createBatchRunner } from '../scripts/lib/openrouter-batch.mjs'
import { createOfflineEnvironment } from '../scripts/verification/offline-environment.mjs'

const MODEL = 'openai/gpt-6-luna:batch'

function observedDataset() {
  return {
    schemaVersion: '0.1.0',
    analysis: { mode: 'observed-only' },
    repository: { name: 'synthetic-ranking' },
    episodes: ['a', 'b'].map((letter, index) => ({
      id: `episode:${letter.repeat(40)}`,
      commitSha: letter.repeat(40), shortSha: letter.repeat(8),
      subject: index ? 'Add ranking tests' : 'Introduce ranking',
      authoredAt: `2025-01-0${index + 1}T00:00:00Z`,
      committedAt: `2025-01-0${index + 1}T00:00:00Z`,
      parentShas: [], contributorIds: [], codeAreaIds: [],
      changes: [{ path: index ? 'test/rank.test.js' : 'src/rank.js', status: 'A' }],
      interpretationStatus: 'observed',
    })),
    contributors: [], codeAreas: [], featureCandidates: [], relationships: [],
  }
}

function fixture(t, { lifecycle = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-interpret-batch-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const dataset = observedDataset()
  const feature = { label: 'Ranking', rationale: 'Ranking implementation.', confidence: 0.8, commitShas: ['aaaaaaaa', 'unknown0'] }
  const featureId = validateFeatures([feature], dataset).featureCandidates[0].id
  const outputs = {
    features: { features: lifecycle ? [feature] : [] },
    lifecycle: { semanticEpisodes: [{ featureId, label: 'Ranking coverage', rationale: 'Tests support ranking.', confidence: 0.7, lifecycleStage: 'hardened', commitShas: ['bbbbbbbb'] }] },
  }
  const statePath = join(directory, 'output.json.batch-state.json')
  const input = { kind: 'interpret', dataset, maxFeatures: 1, maxLifecycleEpisodes: 1, reuseFeatures: false }
  const requests = []
  const polls = new Map()
  let time = 0
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options })
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key')
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      const stage = body.requests[0].custom_id
      assert.equal(body.endpoint, '/v1/messages')
      assert.equal(body.model, MODEL)
      assert.equal(body.requests.length, 1)
      assert.equal('model' in body.requests[0].body, false)
      assert.equal('stream' in body.requests[0].body, false)
      assert.equal('output_config' in body.requests[0].body, false)
      assert.ok(body.requests[0].body.system)
      if (stage === 'lifecycle') assert.match(JSON.stringify(body.requests[0].body.messages), new RegExp(featureId))
      return { ok: true, status: 202, json: async () => ({ id: `batch-${stage}`, status: 'validating' }) }
    }
    assert.ok(existsSync(statePath), 'batch ID must be on disk before polling')
    const stage = url.split('batch-').at(-1)
    assert.match(readFileSync(statePath, 'utf8'), new RegExp(`batch-${stage}`))
    const count = (polls.get(stage) ?? 0) + 1
    polls.set(stage, count)
    return { ok: true, status: 200, json: async () => ({
      id: `batch-${stage}`, status: count === 1 ? 'in_progress' : 'completed',
      results: count === 1 ? null : [{
        id: `request-${stage}`, custom_id: stage, error: null,
        response: { status_code: 200, request_id: `response-${stage}`, body: {
          stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(outputs[stage]) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        } },
      }],
    }) }
  }
  const runner = (overrides = {}) => createBatchRunner({
    statePath, input, model: MODEL, apiKey: 'synthetic-key', pollIntervalMs: 1,
    maxWaitMs: 100, now: () => time, sleep: async (ms) => { time += ms }, fetchImpl,
    ...overrides,
  })
  const interpret = (batchRunner) => interpretAtlas(dataset, {
    provider: 'openrouter', batchRunner, maxFeatures: 1, maxLifecycleEpisodes: 1,
    client: { messages: { stream: () => { throw new Error('Batch used synchronous transport') } } },
  })
  return { directory, dataset, statePath, input, requests, runner, interpret }
}

test('interpret batches feature discovery before dependent lifecycle and preserves validation and methods', async (t) => {
  const f = fixture(t)
  const result = await f.interpret(f.runner())
  assert.deepEqual(f.requests.filter((request) => request.method === 'POST').map((request) => JSON.parse(request.body).requests[0].custom_id), ['features', 'lifecycle'])
  assert.equal(result.dataset.featureCandidates.length, 1)
  assert.equal(result.dataset.featureCandidates[0].evidence.length, 1)
  assert.deepEqual(result.validated.unresolvedShas, [{ label: 'Ranking', sha: 'unknown0' }])
  assert.equal(result.dataset.semanticEpisodes[0].lifecycleStage, 'hardened')
  assert.equal(result.dataset.featureCandidates[0].method, `llm-induction:openrouter:${MODEL}`)
  assert.equal(result.dataset.semanticEpisodes[0].method, `llm-induction:openrouter:${MODEL}`)
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 10 })
  const replay = await f.interpret(f.runner({ replayOnly: true, apiKey: undefined, fetchImpl: () => { throw new Error('Replay attempted network') } }))
  assert.deepEqual(replay, result)
})

test('interpret timeout resumes the same batch without another submit', async (t) => {
  const f = fixture(t, { lifecycle: false })
  await assert.rejects(f.interpret(f.runner({ maxWaitMs: 1 })), /batch-features.*(?:status|in_progress|validating)/i)
  const result = await f.interpret(f.runner())
  assert.equal(result.dataset.featureCandidates.length, 0)
  assert.equal(f.requests.filter((request) => request.method === 'POST').length, 1)
})

test('interpret batches only lifecycle when validated features are reused with a batch override', async () => {
  const dataset = observedDataset()
  dataset.featureCandidates = validateFeatures([{ label: 'Ranking', commitShas: ['aaaaaaaa'] }], dataset).featureCandidates
  const stages = []
  const result = await interpretAtlas(dataset, {
    provider: 'openrouter', model: 'synthetic/explicit:batch', reuseFeatures: true,
    batchRunner: async ({ stage, endpoint }) => {
      stages.push(stage)
      assert.equal(endpoint, '/v1/messages')
      return new Map([[stage, { custom_id: stage, error: null, response: { status_code: 200, body: {
        stop_reason: 'end_turn', content: [{ type: 'text', text: '{"semanticEpisodes":[]}' }],
      } } }]])
    },
  })
  assert.deepEqual(stages, ['lifecycle'])
  assert.equal(result.dataset.featureCandidates[0].method, 'llm-induction:openrouter:synthetic/explicit:batch')
})

for (const status of ['failed', 'expired']) {
  test(`interpret surfaces a ${status} batch`, async (t) => {
    const f = fixture(t)
    const fetchImpl = async (_url, { method }) => ({ ok: true, status: method === 'POST' ? 202 : 200, json: async () => ({
      id: 'batch-failure', status: method === 'POST' ? 'validating' : status,
      error: method === 'POST' ? null : { message: 'Synthetic provider failure' }, results: null,
    }) })
    await assert.rejects(f.interpret(f.runner({ fetchImpl })), new RegExp(`batch-failure.*${status}`))
  })
}

test('interpret surfaces per-request errors instead of writing an empty interpretation', async (t) => {
  const f = fixture(t)
  const fetchImpl = async (_url, { method }) => ({ ok: true, status: method === 'POST' ? 202 : 200, json: async () => ({
    id: 'batch-error', status: method === 'POST' ? 'validating' : 'completed',
    results: method === 'POST' ? null : [{ id: 'request-error', custom_id: 'features', response: null, error: { message: 'Synthetic request rejection' } }],
  }) })
  await assert.rejects(f.interpret(f.runner({ fetchImpl })), /Synthetic request rejection/)
})

test('interpret CLI replays saved batch results offline into a new output on a minimal synthetic dataset', async (t) => {
  const f = fixture(t)
  const expected = await f.interpret(f.runner())
  const inputPath = join(f.directory, 'input.json')
  const outputPath = join(f.directory, 'replayed.json')
  writeFileSync(inputPath, JSON.stringify(f.dataset))
  const args = ['scripts/interpret.mjs', '--in', inputPath, '--out', outputPath, '--max-features', '1', '--max-lifecycle-episodes', '1', '--batch-replay', f.statePath]
  const env = createOfflineEnvironment({ home: f.directory })
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), expected.dataset)
  const second = spawnSync(process.execPath, args, { encoding: 'utf8', env })
  assert.equal(second.status, 1)
  assert.match(second.stderr, /Output already exists/)
  const mismatch = spawnSync(process.execPath, [...args.slice(0, 4), join(f.directory, 'changed.json'), ...args.slice(5), '--max-features', '2'], { encoding: 'utf8', env })
  assert.equal(mismatch.status, 1)
  assert.match(mismatch.stderr, /fingerprint/i)
})
