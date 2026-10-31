import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { authHeaders, CHAT_COMPLETIONS_PATH, isBatchModel, OPENAI_API_BASE, wireModel } from './openai-provider.mjs'

export { isBatchModel }
export const BATCH_ENDPOINT = `${OPENAI_API_BASE}/batches`
export const FILES_ENDPOINT = `${OPENAI_API_BASE}/files`
export const DEFAULT_BATCH_POLL_MS = 30_000
export const DEFAULT_BATCH_MAX_WAIT_MS = 86_400_000
const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled'])
const STATUSES = new Set(['validating', 'in_progress', 'finalizing', 'cancelling', ...TERMINAL])

// Keep batch routing in one place. The selected ID keeps its local `:batch` marker for
// provenance and fingerprints; the wire model drops it.
export function resolveBatchModel(model, override) {
  const selected = override ?? model
  if (typeof selected !== 'string' || !selected.trim()) throw new Error('Batch model must be a non-empty model ID')
  return selected
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function saveState(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

// A second local process must not race the first paid submission. A killed
// process leaves a reclaimable lock; a submitting reservation remains protected.
function acquireLock(path) {
  const lockPath = `${path}.lock`
  const claim = () => writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 })
  try {
    claim()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // Serialize stale-lock recovery and re-read its owner inside that guard.
    // Otherwise two reruns can both observe a dead PID and one can unlink the
    // other's newly acquired lock, allowing duplicate paid submissions.
    const recoveryPath = `${lockPath}.recovery`
    try {
      mkdirSync(recoveryPath, { mode: 0o700 })
    } catch (recoveryError) {
      if (recoveryError.code !== 'EEXIST') throw recoveryError
      throw new Error(`Batch lock recovery is in progress: ${recoveryPath}. If interrupted, verify no runner is active before removing this recovery directory.`)
    }
    try {
      if (existsSync(lockPath)) {
        const pid = Number(readFileSync(lockPath, 'utf8'))
        if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Cannot read batch state lock ${lockPath}; inspect it before retrying`)
        let active = true
        try {
          process.kill(pid, 0)
        } catch (probe) {
          if (probe.code !== 'ESRCH') throw probe
          active = false
        }
        if (active) throw new Error(`Batch state is in use by process ${pid}: ${path}`)
        unlinkSync(lockPath)
      }
      claim()
    } finally {
      rmdirSync(recoveryPath)
    }
  }
  return () => unlinkSync(lockPath)
}

export function batchResultBody(item) {
  if (!item || Boolean(item.response) === Boolean(item.error)) {
    throw new Error(`Invalid batch result ${item?.custom_id ?? '(missing)'}: expected exactly one response or error`)
  }
  if (item.error) throw new Error(`Batch request ${item.custom_id} failed: ${item.error.message ?? JSON.stringify(item.error)}`)
  if (!Number.isInteger(item.response.status_code) || item.response.status_code < 200 || item.response.status_code >= 300) {
    throw new Error(`Batch request ${item.custom_id}: HTTP ${item.response.status_code}: ${JSON.stringify(item.response.body).slice(0, 300)}`)
  }
  if (!item.response.body || typeof item.response.body !== 'object') throw new Error(`Batch request ${item.custom_id} has no response body`)
  return item.response.body
}

export function parseJsonl(text, label) {
  return String(text ?? '').split('\n').filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`${label} line ${index + 1} is not valid JSON`)
    }
  })
}

function resultMap(entry, requests) {
  if (!Array.isArray(entry.results)) throw new Error(`Completed batch ${entry.batchId} has no downloaded results`)
  const expected = new Set(requests.map(request => request.custom_id))
  const results = new Map()
  for (const item of entry.results) {
    if (!expected.has(item?.custom_id) || results.has(item.custom_id)) throw new Error(`Batch ${entry.batchId} has an unknown or duplicate result: ${item?.custom_id}`)
    results.set(item.custom_id, item)
  }
  if (results.size !== expected.size) throw new Error(`Batch ${entry.batchId} is missing request results`)
  return results
}

function batchErrorMessage(raw) {
  return raw?.errors?.data?.map(error => error?.message).filter(Boolean).join('; ') ||
    raw?.error?.message || 'no results available'
}

/**
 * Persist paid work separately from immutable derived outputs. Stages group
 * independent requests; callers retain ownership of parsing and evidence checks.
 * Submission uploads a JSONL input file, then creates an OpenAI batch for it; the
 * output and error files are downloaded into the sidecar once the batch completes,
 * so replay reads terminal raw responses without credentials or network access.
 */
export function createBatchRunner({
  statePath, input, model, batchModel, apiKey,
  pollIntervalMs = DEFAULT_BATCH_POLL_MS, maxWaitMs = DEFAULT_BATCH_MAX_WAIT_MS,
  replayOnly = false, fetchImpl = globalThis.fetch, onProgress,
  now = Date.now, sleep = delay,
} = {}) {
  if (!statePath) throw new Error('Batch execution requires a sidecar state path')
  for (const [name, value] of [['--batch-poll-ms', pollIntervalMs], ['--batch-max-wait-ms', maxWaitMs]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} requires a positive integer`)
  }
  const path = resolve(statePath)
  const selectedModel = resolveBatchModel(model, batchModel)
  const runFingerprint = fingerprint({ input, model, batchModel: selectedModel })
  const readState = () => {
    if (!existsSync(path)) {
      if (replayOnly) throw new Error(`Batch replay state does not exist: ${path}`)
      return { version: 2, fingerprint: runFingerprint, model, batchModel: selectedModel, stages: {} }
    }
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    if (saved.version !== 2 || !saved.stages || saved.fingerprint !== runFingerprint) {
      throw new Error(`Batch state fingerprint differs from these inputs/options: ${path}. Use the original inputs to resume, or a new output path for new work.`)
    }
    return saved
  }
  // Fail before any caller can dispatch dependent work for changed inputs.
  readState()

  return async ({ stage, endpoint, requests }) => {
    if (!stage || endpoint !== CHAT_COMPLETIONS_PATH) throw new Error('Invalid batch stage or endpoint')
    if (!Array.isArray(requests) || !requests.length) throw new Error('A batch requires at least one request')
    const ids = requests.map(request => request.custom_id)
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Batch custom_id values must be non-empty and unique')
    // Each JSONL line names its own method, URL and model. Inner bodies inherit the
    // batch model (without the local :batch marker) and must never stream.
    const payload = {
      endpoint,
      completion_window: '24h',
      requests: requests.map(({ custom_id, body }) => {
        const { model: _model, stream: _stream, ...inner } = body
        return { custom_id, method: 'POST', url: endpoint, body: { model: wireModel(selectedModel), ...inner } }
      }),
    }
    const requestFingerprint = fingerprint(payload)
    if (!replayOnly) mkdirSync(dirname(path), { recursive: true })
    const unlock = replayOnly ? () => {} : acquireLock(path)
    try {
      const state = readState()
      let entry = Object.hasOwn(state.stages, stage) ? state.stages[stage] : undefined
      if (entry && entry.fingerprint !== requestFingerprint) throw new Error(`Batch request fingerprint differs for stage ${stage}: ${path}. Refusing to resume or resubmit.`)
      if (entry && !entry.batchId) {
        const file = entry.inputFileId ? ` (uploaded input file ${entry.inputFileId})` : ''
        throw new Error(`Batch submission for stage ${stage} has an uncertain outcome in ${path}${file}. No second submission will be made. Inspect your OpenAI batches and reconcile the batch ID before resuming.`)
      }
      const resumeHint = () => `Rerun the same command with the same inputs and output to resume using ${path}; --batch-max-wait-ms may be increased.`
      const timeout = () => new Error(`Batch ${entry?.batchId ?? '(submission pending)'} timed out; last status: ${entry?.status ?? 'submitting'}. ${resumeHint()}`)
      const deadline = now() + maxWaitMs
      const exchange = async (url, { method, json, form, text = false }) => {
        const remaining = deadline - now()
        if (remaining <= 0) throw timeout()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.min(remaining, 60_000))
        try {
          const response = await fetchImpl(url, {
            method,
            headers: { ...authHeaders(apiKey), ...(json ? { 'content-type': 'application/json' } : {}) },
            ...(json ? { body: JSON.stringify(json) } : form ? { body: form } : {}),
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
          return text ? await response.text() : await response.json()
        } catch (error) {
          if (controller.signal.aborted || now() >= deadline) throw timeout()
          throw new Error(`Batch ${entry?.batchId ?? 'submission'} request failed: ${error.message}. ${resumeHint()}`)
        } finally {
          clearTimeout(timer)
        }
      }
      if (!entry) {
        if (replayOnly) throw new Error(`Batch replay is missing stage ${stage}: ${path}`)
        if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
        entry = { fingerprint: requestFingerprint, request: payload, inputFileId: null, batchId: null, status: 'submitting', raw: null, results: null }
        Object.defineProperty(state.stages, stage, { value: entry, enumerable: true, writable: true, configurable: true })
        saveState(path, state)
        const form = new FormData()
        form.append('purpose', 'batch')
        form.append('file', new Blob([payload.requests.map(line => JSON.stringify(line)).join('\n') + '\n'], { type: 'application/jsonl' }), `${stage}.jsonl`)
        const file = await exchange(FILES_ENDPOINT, { method: 'POST', form })
        if (typeof file.id !== 'string' || !file.id) throw new Error(`Batch input upload returned no file ID; inspect ${path} and your OpenAI files before resuming`)
        entry.inputFileId = file.id
        saveState(path, state)
        const raw = await exchange(BATCH_ENDPOINT, { method: 'POST', json: { input_file_id: file.id, endpoint, completion_window: payload.completion_window } })
        if (typeof raw.id !== 'string' || !raw.id) throw new Error(`Batch submission returned no ID; inspect ${path} and your OpenAI batches before resuming`)
        entry.batchId = raw.id
        entry.status = raw.status
        entry.raw = raw
        saveState(path, state) // The ID is durable before the first poll.
        onProgress?.(`Submitted batch ${raw.id} (${stage}); state: ${path}`)
      }
      let interval = pollIntervalMs
      while (true) {
        if (!STATUSES.has(entry.status)) throw new Error(`Batch ${entry.batchId} has unknown status: ${entry.status}`)
        if (TERMINAL.has(entry.status)) {
          if (entry.status !== 'completed') throw new Error(`Batch ${entry.batchId} ${entry.status}: ${batchErrorMessage(entry.raw)}. State retained at ${path}`)
          if (!Array.isArray(entry.results)) {
            if (replayOnly) throw new Error(`Batch replay needs downloaded results for stage ${stage}; resume the original command to retrieve them first.`)
            if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
            const files = [entry.raw?.output_file_id, entry.raw?.error_file_id].filter(id => typeof id === 'string' && id)
            if (!files.length) throw new Error(`Completed batch ${entry.batchId} has no output or error file. State retained at ${path}`)
            const results = []
            for (const id of files) {
              results.push(...parseJsonl(await exchange(`${FILES_ENDPOINT}/${encodeURIComponent(id)}/content`, { method: 'GET', text: true }), `Batch file ${id}`))
            }
            entry.results = results
            saveState(path, state)
          }
          return resultMap(entry, payload.requests)
        }
        if (replayOnly) throw new Error(`Batch replay needs completed stage ${stage}; batch ${entry.batchId} is ${entry.status}. Resume the original command to retrieve results first.`)
        if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
        const remaining = deadline - now()
        if (remaining <= 0) throw timeout()
        await sleep(Math.min(interval, remaining))
        if (now() >= deadline) throw timeout()
        const raw = await exchange(`${BATCH_ENDPOINT}/${encodeURIComponent(entry.batchId)}`, { method: 'GET' })
        if (raw.id !== entry.batchId) throw new Error(`Batch poll returned a different ID for ${entry.batchId}`)
        entry.status = raw.status
        entry.raw = raw
        saveState(path, state)
        onProgress?.(`Batch ${entry.batchId}: ${entry.status}`)
        interval = Math.min(interval * 2, Math.max(pollIntervalMs, 300_000))
      }
    } finally {
      unlock()
    }
  }
}
