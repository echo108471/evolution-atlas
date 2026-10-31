import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { batchResultBody, BATCH_ENDPOINT, createBatchRunner, FILES_ENDPOINT } from '../scripts/lib/openai-batch.mjs'

const model = 'gpt-6-luna:batch'
const endpoint = '/v1/chat/completions'
const request = { stage: 'features', endpoint, requests: [
  { custom_id: 'a', body: { model, stream: true, max_completion_tokens: 10, messages: [{ role: 'user', content: 'Synthetic input' }] } },
  { custom_id: 'b', body: { max_completion_tokens: 10, messages: [{ role: 'user', content: 'Second input' }] } },
] }
const item = (id, body = { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) => ({ id: `req_${id}`, custom_id: id, response: { status_code: 200, request_id: id, body }, error: null })
const jsonl = (lines) => lines.map(line => JSON.stringify(line)).join('\n') + '\n'
const completedResults = [item('b'), item('a')]
const completed = { id: 'batch_test', status: 'completed', output_file_id: 'file_out', error_file_id: null }
const response = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => typeof data === 'string' ? data : JSON.stringify(data) })

/**
 * A synthetic OpenAI Files + Batches endpoint. `poll` supplies each GET of the batch;
 * output and error file contents are served from `files`.
 */
function mockOpenAI({ poll = () => completed, files = { file_out: jsonl(completedResults) }, onUpload, onCreate, onPoll } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method })
    if (options.method === 'POST' && url === FILES_ENDPOINT) {
      const uploaded = await onUpload?.(options)
      return response(uploaded ?? { id: 'file_in', purpose: 'batch' })
    }
    if (options.method === 'POST' && url === BATCH_ENDPOINT) {
      await onCreate?.(options)
      return response({ id: 'batch_test', status: 'validating' })
    }
    if (options.method === 'GET' && url === `${BATCH_ENDPOINT}/batch_test`) {
      await onPoll?.(options)
      return response(poll())
    }
    const content = url.match(new RegExp(`^${FILES_ENDPOINT}/([^/]+)/content$`))
    if (options.method === 'GET' && content && Object.hasOwn(files, content[1])) return response(files[content[1]])
    throw new Error(`Unexpected ${options.method} ${url}`)
  }
  return { fetchImpl, calls }
}

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-batch-'))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  let time = 0
  const waits = []
  return { root, waits, options: {
    statePath: join(root, 'output.json.batch-state.json'), input: { synthetic: true }, model,
    apiKey: 'mock-key', pollIntervalMs: 10, maxWaitMs: 1000,
    now: () => time, sleep: async ms => { waits.push(ms); time += ms },
  } }
}

test('batch upload, inherited wire model, backoff, durable IDs, unordered results and offline replay', async t => {
  const f = setup(t)
  const statuses = ['in_progress', 'finalizing', 'completed']
  const saved = () => JSON.parse(readFileSync(f.options.statePath, 'utf8')).stages.features
  const mock = mockOpenAI({
    onUpload: async (options) => {
      assert.equal(options.headers.authorization, 'Bearer mock-key')
      assert.equal(saved().status, 'submitting')
      assert.equal(options.body.get('purpose'), 'batch')
      const lines = (await options.body.get('file').text()).trim().split('\n').map(line => JSON.parse(line))
      assert.deepEqual(lines.map(line => line.custom_id), ['a', 'b'])
      for (const line of lines) {
        assert.deepEqual(Object.keys(line), ['custom_id', 'method', 'url', 'body'])
        assert.equal(line.method, 'POST')
        assert.equal(line.url, endpoint)
        assert.equal(line.body.model, 'gpt-6-luna')
        assert.equal('stream' in line.body, false)
      }
    },
    onCreate: async (options) => {
      assert.equal(saved().inputFileId, 'file_in')
      assert.equal(saved().batchId, null)
      assert.deepEqual(JSON.parse(options.body), { input_file_id: 'file_in', endpoint, completion_window: '24h' })
    },
    onPoll: async () => {
      assert.equal(saved().batchId, 'batch_test')
      assert.equal(typeof saved().fingerprint, 'string')
    },
    poll: () => {
      const status = statuses.shift()
      return status === 'completed' ? completed : { id: 'batch_test', status }
    },
  })
  const options = { ...f.options, batchModel: 'gpt-6-luna:batch', fetchImpl: mock.fetchImpl }
  const results = await createBatchRunner(options)(request)
  assert.deepEqual(mock.calls.map(call => call.method), ['POST', 'POST', 'GET', 'GET', 'GET', 'GET'])
  assert.equal(mock.calls.at(-1).url, `${FILES_ENDPOINT}/file_out/content`)
  assert.deepEqual(f.waits, [10, 20, 40])
  assert.deepEqual(batchResultBody(results.get('a')), completedResults[1].response.body)
  assert.deepEqual(saved().results, completedResults)
  const before = readFileSync(f.options.statePath)
  const replay = await createBatchRunner({ ...options, apiKey: undefined, replayOnly: true,
    fetchImpl: () => assert.fail('replay dispatched network'),
  })(request)
  assert.deepEqual([...replay], [...results])
  assert.deepEqual(readFileSync(f.options.statePath), before)
})

test('per-request failures from the error file are retained and surfaced', async t => {
  const f = setup(t)
  const failed = { id: 'req_b', custom_id: 'b', response: { status_code: 400, body: { error: { message: 'bad request' } } }, error: null }
  const mock = mockOpenAI({
    poll: () => ({ ...completed, error_file_id: 'file_err' }),
    files: { file_out: jsonl([item('a')]), file_err: jsonl([failed]) },
  })
  const results = await createBatchRunner({ ...f.options, fetchImpl: mock.fetchImpl })(request)
  assert.ok(batchResultBody(results.get('a')))
  assert.throws(() => batchResultBody(results.get('b')), /HTTP 400/)
})

test('timeout names batch and status, then resume polls without a second submit', async t => {
  const f = setup(t)
  let submissions = 0
  const first = createBatchRunner({ ...f.options, maxWaitMs: 15, fetchImpl: mockOpenAI({
    onCreate: () => { submissions++ },
    poll: () => ({ id: 'batch_test', status: 'in_progress' }),
  }).fetchImpl })
  await assert.rejects(first(request), /batch_test timed out; last status: in_progress.*Rerun the same command/)
  const resume = mockOpenAI({ onUpload: () => assert.fail('resume uploaded'), onCreate: () => assert.fail('resume resubmitted') })
  assert.equal((await createBatchRunner({ ...f.options, fetchImpl: resume.fetchImpl })(request)).size, 2)
  assert.ok(resume.calls.every(call => call.method === 'GET'))
  assert.equal(submissions, 1)
})

test('changed run input or stage request refuses resume before dispatch', async t => {
  const f = setup(t)
  await createBatchRunner({ ...f.options, fetchImpl: mockOpenAI().fetchImpl })(request)
  assert.throws(() => createBatchRunner({ ...f.options, input: { synthetic: false } }), /fingerprint differs/)
  assert.throws(() => createBatchRunner({ ...f.options, batchModel: 'other' }), /fingerprint differs/)
  const resume = createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('changed request dispatched') })
  await assert.rejects(resume({ ...request, requests: request.requests.slice(0, 1) }), /request fingerprint differs/)
})

for (const status of ['failed', 'expired', 'cancelled']) {
  test(`terminal ${status} retains raw error and never resubmits`, async t => {
    const f = setup(t)
    const raw = { id: 'batch_test', status, output_file_id: null, errors: { object: 'list', data: [{ code: 'synthetic', message: 'Provider explanation' }] } }
    const run = createBatchRunner({ ...f.options, fetchImpl: mockOpenAI({ poll: () => raw }).fetchImpl })
    await assert.rejects(run(request), new RegExp(`batch_test ${status}: Provider explanation`))
    assert.deepEqual(JSON.parse(readFileSync(f.options.statePath)).stages.features.raw, raw)
    await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('terminal resubmitted') })(request), /Provider explanation/)
  })
}

test('cancelling is polled until cancelled', async t => {
  const f = setup(t)
  let calls = 0
  await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: mockOpenAI({ poll: () => ({ id: 'batch_test', status: calls++ ? 'cancelled' : 'cancelling' }) }).fetchImpl })(request), /batch_test cancelled/)
  assert.equal(calls, 2)
})

test('request errors, HTTP errors and malformed results remain explicit', () => {
  assert.throws(() => batchResultBody({ custom_id: 'bad', error: { message: 'quota' }, response: null }), /bad failed: quota/)
  assert.throws(() => batchResultBody({ ...item('bad'), error: { message: 'both populated' } }), /exactly one/)
  assert.throws(() => batchResultBody({ custom_id: 'bad', response: { status_code: 429, body: { error: 'quota' } } }), /HTTP 429/)
  assert.throws(() => batchResultBody({ custom_id: 'bad', response: { status_code: 200 } }), /no response body/)
})

for (const results of [[item('a')], [item('a'), item('a')], [item('a'), item('foreign')], null]) {
  test(`missing, duplicate or foreign result IDs are rejected: ${JSON.stringify(results?.map(x => x.custom_id))}`, async t => {
    const f = setup(t)
    const mock = results ? mockOpenAI({ files: { file_out: jsonl(results) } }) : mockOpenAI({ poll: () => ({ ...completed, output_file_id: null }) })
    await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: mock.fetchImpl })(request), /missing|duplicate|no output or error file/)
  })
}

test('an upload whose batch creation fails is reserved and cannot be paid for twice', async t => {
  const f = setup(t)
  const run = createBatchRunner({ ...f.options, fetchImpl: mockOpenAI({ onCreate: () => { throw new Error('connection lost after create') } }).fetchImpl })
  await assert.rejects(run(request), /connection lost after create/)
  const saved = JSON.parse(readFileSync(f.options.statePath)).stages.features
  assert.equal(saved.inputFileId, 'file_in')
  assert.equal(saved.batchId, null)
  await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('duplicate POST') })(request), /uncertain outcome.*file_in.*No second submission/)
})

test('uncertain submission is reserved and cannot be paid for twice', async t => {
  const f = setup(t)
  const run = createBatchRunner({ ...f.options, fetchImpl: async () => { throw new Error('connection lost after POST') } })
  await assert.rejects(run(request), /connection lost/)
  const saved = JSON.parse(readFileSync(f.options.statePath))
  assert.equal(saved.stages.features.batchId, null)
  await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('duplicate POST') })(request), /uncertain outcome.*No second submission/)
})

test('incomplete replay cannot dispatch and concurrent users cannot share a state', async t => {
  const f = setup(t)
  const first = createBatchRunner({ ...f.options, maxWaitMs: 5, fetchImpl: mockOpenAI({ poll: () => ({ id: 'batch_test', status: 'validating' }) }).fetchImpl })
  await assert.rejects(first(request), /timed out/)
  await assert.rejects(createBatchRunner({ ...f.options, replayOnly: true, fetchImpl: () => assert.fail('replay dispatch') })(request), /needs completed stage/)
  writeFileSync(`${f.options.statePath}.lock`, String(process.pid))
  await assert.rejects(createBatchRunner(f.options)(request), /in use by process/)
})

test('duplicate custom IDs fail locally and do not create a paid reservation', async t => {
  const f = setup(t)
  await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('duplicate ID dispatched') })({ ...request, requests: [request.requests[0], request.requests[0]] }), /must be non-empty and unique/)
})

test('a dead process lock is recovered by one runner without retaining the recovery guard', async t => {
  const f = setup(t)
  const deadPid = 2147483647
  assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' })
  writeFileSync(`${f.options.statePath}.lock`, String(deadPid))
  let submissions = 0
  await createBatchRunner({ ...f.options, fetchImpl: mockOpenAI({ onCreate: () => { submissions++ } }).fetchImpl })(request)
  assert.equal(submissions, 1)
  assert.equal(existsSync(`${f.options.statePath}.lock`), false)
  assert.equal(existsSync(`${f.options.statePath}.lock.recovery`), false)
})

test('concurrent stale-lock recovery cannot unlink another runner lock and submit twice', async t => {
  const f = setup(t)
  const childPath = join(f.root, 'stale-lock-child.cjs')
  const releasePath = join(f.root, 'release')
  const postsPath = join(f.root, 'posts')
  const helperUrl = new URL('../scripts/lib/openai-batch.mjs', import.meta.url).href
  writeFileSync(`${f.options.statePath}.lock`, '2147483647')
  // Pause the stale-PID probe so a second process enters the exact recovery
  // window that previously allowed it to remove a newly acquired lock.
  writeFileSync(childPath, `
const fs = require('node:fs')
const [statePath, releasePath, postsPath, helperUrl, requestJson] = process.argv.slice(2)
const originalKill = process.kill
process.kill = function (pid, signal) {
  if (pid === 2147483647) {
    process.send({ event: 'stale-probe' })
    while (!fs.existsSync(releasePath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    throw Object.assign(new Error('Synthetic dead process'), { code: 'ESRCH' })
  }
  return originalKill.call(process, pid, signal)
}
;(async () => {
  const { createBatchRunner } = await import(helperUrl)
  const request = JSON.parse(requestJson)
  await createBatchRunner({ statePath, input: { synthetic: true }, model: '${model}', apiKey: 'mock-key',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/batches')) fs.appendFileSync(postsPath, options.method + '\\n')
      if (url.endsWith('/files')) return { ok: true, status: 200, json: async () => ({ id: 'file_in' }) }
      if (url.endsWith('/content')) return { ok: true, status: 200, text: async () => request.requests.map(entry => JSON.stringify({ custom_id: entry.custom_id, response: { status_code: 200, body: {} }, error: null })).join('\\n') }
      return { ok: true, status: 200, json: async () => ({ id: 'batch_test', status: 'completed', output_file_id: 'file_out' }) }
    },
  })(request)
})().then(() => { process.send({ event: 'done' }); process.disconnect() }, error => {
  process.send({ event: 'error', message: error.message }); process.disconnect()
})
`)
  const start = () => {
    const events = []
    const child = fork(childPath, [f.options.statePath, releasePath, postsPath, helperUrl, JSON.stringify(request)], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    child.on('message', event => events.push(event))
    t.after(() => child.kill())
    return events
  }
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (predicate()) return
      await delay(10)
    }
    assert.fail('Timed out waiting for synthetic lock contender')
  }
  const first = start()
  await waitFor(() => first.length > 0)
  assert.equal(first[0].event, 'stale-probe')
  const second = start()
  await waitFor(() => second.length > 0)
  assert.equal(second[0].event, 'error', 'the second process must not enter stale-lock recovery')
  assert.match(second[0].message, /recovery is in progress/)
  writeFileSync(releasePath, '')
  await waitFor(() => first.some(event => event.event === 'done'))
  assert.equal(readFileSync(postsPath, 'utf8'), 'POST\n')
})
