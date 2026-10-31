import assert from 'node:assert/strict'
import test from 'node:test'

import {
  backoffSeconds,
  isPaymentError,
  isRetryable,
  retryAfterSeconds,
  withRetry,
} from '../scripts/lib/retry.mjs'

/** A gateway-wrapped 402 body, as returned when a second interpretation ran before the first settled. */
const IN_FLIGHT_BUDGET_MESSAGE =
  '402 {"type":"error","error":{"type":"billing_error","message":"This request would exceed ' +
  'your available credits given your current in-flight requests."},"metadata":{"reason":' +
  '"in_flight_budget_exhausted","headers":{"Retry-After":"120"}}}'

function apiError(status, message = '') {
  return Object.assign(new Error(message), { status })
}

test('transient provider failures are retryable and client mistakes are not', () => {
  for (const status of [408, 409, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryable(apiError(status)), true, `${status} should retry`)
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryable(apiError(status)), false, `${status} should not retry`)
  }
})

test('a payment failure is never retried, because each attempt costs money', async () => {
  // Interpretation is two passes; retrying the pair re-pays for the pass that succeeded.
  assert.equal(isRetryable(apiError(402, IN_FLIGHT_BUDGET_MESSAGE)), false)
  assert.equal(isPaymentError(apiError(402)), true)
  assert.equal(isPaymentError(apiError(429)), false)

  let calls = 0
  await assert.rejects(
    withRetry(
      () => {
        calls += 1
        throw apiError(402, IN_FLIGHT_BUDGET_MESSAGE)
      },
      { attempts: 4, wait: () => {} },
    ),
    /in_flight_budget_exhausted/,
  )
  assert.equal(calls, 1)
})

test('a retry delay is read from a plain headers object or a Headers instance', () => {
  assert.equal(retryAfterSeconds({ headers: { 'retry-after': '30' } }), 30)
  assert.equal(retryAfterSeconds({ headers: new Headers({ 'retry-after': '45' }) }), 45)
})

test('a gateway that wraps the upstream error still yields its retry delay', () => {
  assert.equal(retryAfterSeconds(apiError(402, IN_FLIGHT_BUDGET_MESSAGE)), 120)
})

test('an absent or unusable retry delay falls back to backoff', () => {
  assert.equal(retryAfterSeconds(apiError(429)), null)
  assert.equal(retryAfterSeconds({ headers: { 'retry-after': 'soon' } }), null)
  assert.equal(backoffSeconds(1), 5)
  assert.equal(backoffSeconds(3), 20)
  assert.equal(backoffSeconds(99), 120)
})

test('a retryable failure is retried and its eventual success returned', async () => {
  const waits = []
  let calls = 0
  const result = await withRetry(
    () => {
      calls += 1
      if (calls < 3) throw apiError(429)
      return 'done'
    },
    { attempts: 4, wait: (ms) => waits.push(ms) },
  )
  assert.equal(result, 'done')
  assert.equal(calls, 3)
  assert.deepEqual(waits, [5000, 10000])
})

test('a provider-supplied delay wins over exponential backoff', async () => {
  const waits = []
  let calls = 0
  await withRetry(
    () => {
      calls += 1
      if (calls === 1) throw apiError(429, '429 {"metadata":{"headers":{"Retry-After":"120"}}}')
      return 'ok'
    },
    { attempts: 3, wait: (ms) => waits.push(ms) },
  )
  assert.deepEqual(waits, [120000])
})

test('a non-retryable failure is raised without consuming attempts', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      () => {
        calls += 1
        throw apiError(400, 'bad request')
      },
      { attempts: 5, wait: () => {} },
    ),
    /bad request/,
  )
  assert.equal(calls, 1)
})

test('exhausting the attempt budget raises the last failure', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(
      () => {
        calls += 1
        throw apiError(503, 'upstream down')
      },
      { attempts: 3, wait: () => {} },
    ),
    /upstream down/,
  )
  assert.equal(calls, 3)
})
