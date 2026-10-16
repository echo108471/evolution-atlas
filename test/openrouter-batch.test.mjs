import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { batchResultBody, BATCH_ENDPOINT, createBatchRunner } from '../scripts/lib/openrouter-batch.mjs'

const model = 'openai/gpt-6-luna:batch'
const request = { stage: 'features', endpoint: '/v1/messages', requests: [
  { custom_id: 'a', body: { model, stream: true, max_tokens: 10, messages: [{ role: 'user', content: 'Synthetic input' }] } },
  { custom_id: 'b', body: { max_tokens: 10, messages: [{ role: 'user', content: 'Second input' }] } },
] }
const item = (id, body = { content: [{ type: 'text', text: '{}' }] }) => ({ custom_id: id, response: { status_code: 200, body }, error: null })
const completed = { id: 'batch_test', status: 'completed', results: [item('b'), item('a')] }
const response = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) })

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

test('batch wire order, inherited model, backoff, durable ID, unordered results and offline replay', async t => {
  const f = setup(t)
  const statuses = ['in_progress', 'finalizing', 'completed']
  let calls = 0
  const fetchImpl = async (url, options) => {
    calls++
    assert.equal(options.headers.Authorization, 'Bearer mock-key')
    const saved = JSON.parse(readFileSync(f.options.statePath, 'utf8'))
    if (options.method === 'POST') {
      assert.equal(url, BATCH_ENDPOINT)
      assert.equal(saved.stages.features.status, 'submitting')
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body), ['endpoint', 'model', 'completion_window', 'requests'])
      assert.equal(body.model, 'openai/gpt-6-luna')
      assert.equal(body.completion_window, '24h')
      for (const entry of body.requests) {
        assert.equal('model' in entry.body, false)
        assert.equal('stream' in entry.body, false)
      }
      return response({ id: 'batch_test', status: 'validating' }, 202)
    }
    assert.equal(url, `${BATCH_ENDPOINT}/batch_test`)
    assert.equal(saved.stages.features.batchId, 'batch_test')
    assert.equal(typeof saved.stages.features.fingerprint, 'string')
    const status = statuses.shift()
    return response(status === 'completed' ? completed : { id: 'batch_test', status })
  }
  const options = { ...f.options, batchModel: 'openai/gpt-6-luna', fetchImpl }
  const results = await createBatchRunner(options)(request)
  assert.equal(calls, 4)
  assert.deepEqual(f.waits, [10, 20, 40])
  assert.deepEqual(batchResultBody(results.get('a')), completed.results[1].response.body)
  const before = readFileSync(f.options.statePath)
  const replay = await createBatchRunner({ ...options, apiKey: undefined, replayOnly: true,
    fetchImpl: () => assert.fail('replay dispatched network'),
  })(request)
  assert.deepEqual([...replay], [...results])
  assert.deepEqual(readFileSync(f.options.statePath), before)
})

test('timeout names batch and status, then resume polls without a second submit', async t => {
  const f = setup(t)
  let submissions = 0
  const first = createBatchRunner({ ...f.options, maxWaitMs: 15, fetchImpl: async (_url, options) => {
    if (options.method === 'POST') submissions++
    return response({ id: 'batch_test', status: options.method === 'POST' ? 'validating' : 'in_progress' })
  } })
  await assert.rejects(first(request), /batch_test timed out; last status: in_progress.*Rerun the same command/)
  const resume = createBatchRunner({ ...f.options, fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET')
    return response(completed)
  } })
  assert.equal((await resume(request)).size, 2)
  assert.equal(submissions, 1)
})

test('changed run input or stage request refuses resume before dispatch', async t => {
  const f = setup(t)
  await createBatchRunner({ ...f.options, fetchImpl: async () => response(completed) })(request)
  assert.throws(() => createBatchRunner({ ...f.options, input: { synthetic: false } }), /fingerprint differs/)
  assert.throws(() => createBatchRunner({ ...f.options, batchModel: 'other' }), /fingerprint differs/)
  const resume = createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('changed request dispatched') })
  await assert.rejects(resume({ ...request, requests: request.requests.slice(0, 1) }), /request fingerprint differs/)
})

for (const status of ['failed', 'expired', 'cancelled']) {
  test(`terminal ${status} retains raw error and never resubmits`, async t => {
    const f = setup(t)
    const raw = { id: 'batch_test', status, results: null, error: { message: 'Provider explanation' } }
    const run = createBatchRunner({ ...f.options, fetchImpl: async () => response(raw) })
    await assert.rejects(run(request), new RegExp(`batch_test ${status}: Provider explanation`))
    assert.deepEqual(JSON.parse(readFileSync(f.options.statePath)).stages.features.raw, raw)
    await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: () => assert.fail('terminal resubmitted') })(request), /Provider explanation/)
  })
}

test('cancelling is polled until cancelled', async t => {
  const f = setup(t)
  let calls = 0
  await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: async () => response({ id: 'batch_test', status: calls++ ? 'cancelled' : 'cancelling' }) })(request), /batch_test cancelled/)
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
    await assert.rejects(createBatchRunner({ ...f.options, fetchImpl: async () => response({ ...completed, results }) })(request), /missing|duplicate|no inline/)
  })
}

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
  const first = createBatchRunner({ ...f.options, maxWaitMs: 5, fetchImpl: async () => response({ id: 'batch_test', status: 'validating' }) })
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
  await createBatchRunner({ ...f.options, fetchImpl: async () => { submissions++; return response(completed) } })(request)
  assert.equal(submissions, 1)
  assert.equal(existsSync(`${f.options.statePath}.lock`), false)
  assert.equal(existsSync(`${f.options.statePath}.lock.recovery`), false)
})

test('concurrent stale-lock recovery cannot unlink another runner lock and submit twice', async t => {
  const f = setup(t)
  const childPath = join(f.root, 'stale-lock-child.cjs')
  const releasePath = join(f.root, 'release')
  const postsPath = join(f.root, 'posts')
  const helperUrl = new URL('../scripts/lib/openrouter-batch.mjs', import.meta.url).href
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
    fetchImpl: async (_url, options) => {
      fs.appendFileSync(postsPath, options.method + '\\n')
      return { ok: true, status: 202, json: async () => ({ id: 'batch_test', status: 'completed',
        results: request.requests.map(entry => ({ custom_id: entry.custom_id, response: { status_code: 200, body: {} }, error: null })) }) }
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
