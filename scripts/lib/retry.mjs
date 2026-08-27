/**
 * Retry helpers for unattended batch generation. Providers fail transiently in ways a
 * long-running gallery build should absorb rather than report as a dead subject.
 */

// Infrastructure failures only. 402 is deliberately excluded: a payment error is usually
// a real balance problem rather than a transient one, and interpretation is a two-pass
// operation, so retrying it re-pays for the pass that already succeeded. Backing off on
// 402 spends money on every attempt and rarely clears.
export const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

/** Payment failures get a specific hint instead of a silent, costly retry loop. */
export const PAYMENT_STATUS = 402

export const DEFAULT_RETRIES = 4
export const MAX_BACKOFF_SECONDS = 120

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function errorStatus(error) {
  return error?.status ?? error?.response?.status ?? null
}

export function isRetryable(error) {
  return RETRYABLE_STATUS.has(errorStatus(error))
}

export function isPaymentError(error) {
  return errorStatus(error) === PAYMENT_STATUS
}

/**
 * Providers report a retry delay either on the response headers or, for gateways that
 * wrap an upstream error, inside the serialized body. Read both before falling back to
 * exponential backoff.
 */
export function retryAfterSeconds(error) {
  const raw = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after']
  const fromHeader = Number.parseInt(raw, 10)
  if (Number.isInteger(fromHeader) && fromHeader >= 0) return fromHeader

  const message = typeof error?.message === 'string' ? error.message : ''
  const match = message.match(/"retry-after"\s*:\s*"?(\d+)"?/i)
  if (match) {
    const parsed = Number.parseInt(match[1], 10)
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  return null
}

export function backoffSeconds(attempt) {
  return Math.min(MAX_BACKOFF_SECONDS, 5 * 2 ** (attempt - 1))
}

/**
 * Runs `task`, retrying retryable failures until `attempts` is exhausted. `onNotice`
 * receives a human-readable line per retry; `wait` is injectable so tests need no timers.
 */
export async function withRetry(task, { attempts = DEFAULT_RETRIES, onNotice = () => {}, wait = sleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      if (!isRetryable(error) || attempt >= attempts) throw error
      const delay = retryAfterSeconds(error) ?? backoffSeconds(attempt)
      onNotice(`${errorStatus(error)} on attempt ${attempt} of ${attempts}; retrying in ${delay}s`)
      await wait(delay * 1000)
    }
  }
}
