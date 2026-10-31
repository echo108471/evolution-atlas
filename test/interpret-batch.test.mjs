import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { interpretAtlas, validateFeatures } from '../scripts/lib/interpret.mjs'
import { createBatchRunner } from '../scripts/lib/openai-batch.mjs'
import { createOfflineEnvironment } from '../scripts/verification/offline-environment.mjs'
import { chatCompletion, createOpenAIBatchMock } from './helpers/openai-batch-mock.mjs'

const MODEL = 'gpt-6-luna:batch'

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
  let time = 0
  const mock = createOpenAIBatchMock({
    onRequest: (request) => assert.equal(request.headers.authorization, 'Bearer synthetic-key'),
    onSubmit: (submission) => {
      const [line] = submission.lines
      assert.equal(submission.endpoint, '/v1/chat/completions')
      assert.equal(submission.purpose, 'batch')
      assert.equal(submission.lines.length, 1)
      assert.equal(line.url, '/v1/chat/completions')
      assert.equal(line.body.model, 'gpt-6-luna')
      assert.equal('stream' in line.body, false)
      assert.equal('output_config' in line.body, false)
      assert.equal('system' in line.body, false)
      assert.equal(line.body.messages[0].role, 'system')
      assert.equal(typeof line.body.messages[1].content, 'string')
      assert.equal(line.body.max_completion_tokens, 32000)
      if (line.custom_id === 'lifecycle') assert.match(line.body.messages[1].content, new RegExp(featureId))
    },
    poll: (submission, count) => {
      assert.ok(existsSync(statePath), 'batch ID must be on disk before polling')
      assert.match(readFileSync(statePath, 'utf8'), new RegExp(submission.id))
      return count === 1 ? 'in_progress' : 'completed'
    },
    respond: (line) => chatCompletion(outputs[line.custom_id], { prompt_tokens: 10, completion_tokens: 5 }),
  })
  const requests = mock.requests
  const fetchImpl = mock.fetchImpl
  const runner = (overrides = {}) => createBatchRunner({
    statePath, input, model: MODEL, apiKey: 'synthetic-key', pollIntervalMs: 1,
    maxWaitMs: 100, now: () => time, sleep: async (ms) => { time += ms }, fetchImpl,
    ...overrides,
  })
  const interpret = (batchRunner) => interpretAtlas(dataset, {
    provider: 'openai', batchRunner, maxFeatures: 1, maxLifecycleEpisodes: 1,
    client: { messages: { stream: () => { throw new Error('Batch used synchronous transport') } } },
  })
  return { directory, dataset, statePath, input, requests, submissions: mock.submissions, runner, interpret }
}

test('interpret batches feature discovery before dependent lifecycle and preserves validation and methods', async (t) => {
  const f = fixture(t)
  const result = await f.interpret(f.runner())
  assert.deepEqual(f.submissions.map((submission) => submission.lines[0].custom_id), ['features', 'lifecycle'])
  assert.equal(result.dataset.featureCandidates.length, 1)
  assert.equal(result.dataset.featureCandidates[0].evidence.length, 1)
  assert.deepEqual(result.validated.unresolvedShas, [{ label: 'Ranking', sha: 'unknown0' }])
  assert.equal(result.dataset.semanticEpisodes[0].lifecycleStage, 'hardened')
  assert.equal(result.dataset.featureCandidates[0].method, `llm-induction:openai:${MODEL}`)
  assert.equal(result.dataset.semanticEpisodes[0].method, `llm-induction:openai:${MODEL}`)
  assert.deepEqual(result.usage, { input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 10 })
  const replay = await f.interpret(f.runner({ replayOnly: true, apiKey: undefined, fetchImpl: () => { throw new Error('Replay attempted network') } }))
  assert.deepEqual(replay, result)
})

test('interpret timeout resumes the same batch without another submit', async (t) => {
  const f = fixture(t, { lifecycle: false })
  await assert.rejects(f.interpret(f.runner({ maxWaitMs: 1 })), /batch-features.*(?:status|in_progress|validating)/i)
  const result = await f.interpret(f.runner())
  assert.equal(result.dataset.featureCandidates.length, 0)
  assert.equal(f.submissions.length, 1)
})

test('interpret batches only lifecycle when validated features are reused with a batch override', async () => {
  const dataset = observedDataset()
  dataset.featureCandidates = validateFeatures([{ label: 'Ranking', commitShas: ['aaaaaaaa'] }], dataset).featureCandidates
  const stages = []
  const result = await interpretAtlas(dataset, {
    provider: 'openai', model: 'synthetic/explicit:batch', reuseFeatures: true,
    batchRunner: async ({ stage, endpoint }) => {
      stages.push(stage)
      assert.equal(endpoint, '/v1/chat/completions')
      return new Map([[stage, { custom_id: stage, error: null, response: { status_code: 200, body: chatCompletion({ semanticEpisodes: [] }) } }]])
    },
  })
  assert.deepEqual(stages, ['lifecycle'])
  assert.equal(result.dataset.featureCandidates[0].method, 'llm-induction:openai:synthetic/explicit:batch')
})

for (const status of ['failed', 'expired']) {
  test(`interpret surfaces a ${status} batch`, async (t) => {
    const f = fixture(t)
    const { fetchImpl } = createOpenAIBatchMock({
      batchId: () => 'batch-failure',
      poll: () => ({ status, errors: { data: [{ message: 'Synthetic provider failure' }] } }),
    })
    await assert.rejects(f.interpret(f.runner({ fetchImpl })), new RegExp(`batch-failure.*${status}`))
  })
}

test('interpret surfaces per-request errors instead of writing an empty interpretation', async (t) => {
  const f = fixture(t)
  const { fetchImpl } = createOpenAIBatchMock({
    item: (line) => ({ id: 'request-error', custom_id: line.custom_id, response: null, error: { message: 'Synthetic request rejection' } }),
  })
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
