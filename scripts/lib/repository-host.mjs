/** Host dispatch lifecycle and assignment-scoped evidence barrier for repository engine v3. */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

const TERMINAL = new Set(['completed', 'interrupted', 'failed'])
const DISPATCHABLE = new Set([
  'ready-to-dispatch',
  'partial-evidence-needs-explicit-resume',
  'retry-needs-explicit-dispatch',
])
const LOCK_DELAYS_MS = [8, 16, 32, 48]
const json = value => JSON.stringify(value, null, 2) + '\n'
const assignmentName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)

function assertAssignment(assignment) {
  if (!assignmentName(assignment)) throw new Error('Invalid host assignment identifier')
}

function assertDirectory(path, label) {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Regular ${label} directory required: ${path}`)
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function pidIsLive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readLock(path) {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return { malformed: true }
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && Number.isSafeInteger(value.pid) ? { value } : { malformed: true }
  } catch {
    return { malformed: true }
  }
}

function acquireLock(directory, scope) {
  const lockDirectory = resolve(directory, 'locks')
  assertDirectory(lockDirectory, 'host lock')
  mkdirSync(lockDirectory, { recursive: true })
  const path = resolve(lockDirectory, scope + '.lock')
  const nonce = randomUUID()
  const bytes = Buffer.from(json({ pid: process.pid, nonce, note: 'Explicit stale-lock recovery only; locks never expire by age.' }))

  for (let attempt = 0; ; attempt++) {
    let descriptor
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, bytes)
      closeSync(descriptor)
      descriptor = undefined
      break
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor) } catch { /* Preserve the acquisition error. */ }
      }
      if (error?.code !== 'EEXIST') throw error

      const lock = readLock(path)
      if (attempt < LOCK_DELAYS_MS.length) {
        // The owner may still be writing its freshly created lock file. Retry a
        // fixed number of times; this is not an age based expiry policy.
        if (lock.malformed || pidIsLive(lock.value.pid)) {
          sleepSync(LOCK_DELAYS_MS[attempt])
          continue
        }
      }
      if (lock.malformed || !pidIsLive(lock.value.pid)) {
        throw new Error(`Stale or unreadable host lock requires manual recovery: ${path}. Confirm the recorded process is gone, then remove the lock explicitly.`)
      }
      throw new Error(`Host lock is held by live pid ${lock.value.pid}: ${path}`)
    }
  }

  return () => {
    let current
    try { current = readFileSync(path) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (!current.equals(bytes)) throw new Error(`Host lock identity changed; leaving it for manual recovery: ${path}`)
    unlinkSync(path)
  }
}

function withLocks(directory, scopes, action) {
  if (typeof action !== 'function') throw new Error('Synchronous host lock callback required')
  const out = resolve(directory)
  const releases = []
  try {
    for (const scope of [...new Set(scopes)].sort()) releases.push(acquireLock(out, scope))
    const result = action()
    if (result && typeof result.then === 'function') throw new Error('Host lock callbacks must complete synchronously')
    return result
  } finally {
    for (const release of releases.reverse()) release()
  }
}

const assignmentScope = assignment => 'assignment-' + assignment
const recordsDirectory = (directory, assignment) => resolve(directory, 'attempts', assignment)

function checkedRead(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Regular host artifact required: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function createOnly(path, value) {
  const bytes = Buffer.from(json(value))
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(path).equals(bytes)) throw new Error(`Refusing changed host artifact: ${path}`)
    return
  }
  try {
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code !== 'EEXIST' || !existsSync(path)) throw error
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(path).equals(bytes)) throw error
  }
}

function hostPaths(directory, assignment, sequence) {
  const base = resolve(recordsDirectory(directory, assignment), sequence)
  return {
    legacy: base + '.json',
    reservation: base + '.reservation.json',
    binding: base + '.binding.json',
    terminal: base + '.terminal.json',
  }
}

function validHandle(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
}

function listAssignmentHistory(directory, assignment) {
  const dir = recordsDirectory(directory, assignment)
  assertDirectory(resolve(directory, 'attempts'), 'host attempts')
  assertDirectory(dir, 'assignment attempts')
  if (!existsSync(dir)) return []
  const names = readdirSync(dir).sort()
  const sequences = new Set()
  for (const name of names) {
    const match = /^(\d{3,})\.(?:json|reservation\.json|binding\.json|terminal\.json)$/.exec(name)
    if (!match) throw new Error(`Unknown host attempt artifact: ${resolve(dir, name)}`)
    sequences.add(match[1])
  }

  const ordered = [...sequences].sort((a, b) => Number(a) - Number(b))
  const history = []
  for (const [index, sequence] of ordered.entries()) {
    const expected = String(index + 1).padStart(3, '0')
    if (sequence !== expected) throw new Error(`Host attempt sequence gap or reordering in ${dir}`)
    const paths = hostPaths(directory, assignment, sequence)
    const hasLegacy = existsSync(paths.legacy)
    const hasReservation = existsSync(paths.reservation)
    if (hasLegacy === hasReservation) throw new Error(`Host attempt must have exactly one launch or reservation identity: ${dir}/${sequence}`)
    if (hasLegacy && existsSync(paths.binding)) throw new Error(`Legacy host launch cannot also have a reservation binding: ${paths.binding}`)

    let record
    if (hasLegacy) {
      const saved = checkedRead(paths.legacy)
      if (saved?.sequence !== sequence || !validHandle(saved.handle)) throw new Error(`Invalid legacy host attempt: ${paths.legacy}`)
      record = { assignment, sequence, reservationId: `legacy:${sequence}`, kind: 'legacy', source: 'legacy', handle: saved.handle }
    } else {
      const saved = checkedRead(paths.reservation)
      if (saved?.version !== 1 || saved.assignment !== assignment || saved.sequence !== sequence
        || typeof saved.reservationId !== 'string' || !/^[0-9a-f-]{36}$/.test(saved.reservationId)) throw new Error(`Invalid host dispatch reservation: ${paths.reservation}`)
      record = { assignment, sequence, reservationId: saved.reservationId, kind: 'reserved', source: 'reservation', handle: null }
      if (existsSync(paths.binding)) {
        const binding = checkedRead(paths.binding)
        if (binding?.version !== 1 || binding.assignment !== assignment || binding.sequence !== sequence
          || binding.reservationId !== saved.reservationId || !validHandle(binding.handle)) throw new Error(`Invalid host dispatch binding: ${paths.binding}`)
        record.kind = 'bound'
        record.handle = binding.handle
      }
    }

    if (existsSync(paths.terminal)) {
      const terminal = checkedRead(paths.terminal)
      const identityMatches = terminal?.handle === record.handle
        && (record.source === 'legacy'
          ? terminal?.reservationId === undefined
          : terminal?.reservationId === record.reservationId && terminal?.assignment === assignment && terminal?.sequence === sequence)
      if (!identityMatches || !TERMINAL.has(terminal.observation)) throw new Error(`Invalid terminal host observation: ${paths.terminal}`)
      if (!record.handle) throw new Error(`A dispatch reservation cannot terminate before a host handle is bound: ${paths.terminal}`)
      record.kind = 'terminal'
      record.observation = terminal.observation
    }

    if (index < ordered.length - 1 && record.kind !== 'terminal') throw new Error(`New host dispatch lacks explicit prior terminal observation: ${dir}/${sequence}`)
    history.push(record)
  }
  return history
}

function readStatusUnlocked(directory, assignment) {
  assertAssignment(assignment)
  const attempts = listAssignmentHistory(directory, assignment)
  const latest = attempts.at(-1)
  const state = !latest ? 'unassigned'
    : latest.kind === 'reserved' ? 'dispatch-reserved'
      : ['bound', 'legacy'].includes(latest.kind) ? 'runtime-check-required'
        : 'terminal'
  return {
    assignment,
    state,
    sequence: latest?.sequence ?? null,
    reservationId: latest?.reservationId ?? null,
    handle: latest?.handle ?? null,
    observation: latest?.observation ?? null,
    canReadEvidence: state === 'runtime-check-required',
  }
}

function validateAuthorization(value, history) {
  if (!value || typeof value !== 'object' || !DISPATCHABLE.has(value.state)
    || !Number.isSafeInteger(value.receiptCount) || value.receiptCount < 0
    || typeof value.outputExists !== 'boolean' || typeof value.checkpointExists !== 'boolean') {
    throw new Error('Fresh read-only dispatch authorization is required')
  }
  if (value.outputExists || value.checkpointExists) throw new Error('Saved output or checkpoint makes this assignment unsafe to dispatch')
  const latest = history.at(-1)
  if (latest && latest.kind !== 'terminal') throw new Error('An active or unbound host dispatch blocks duplicate dispatch')
  if (value.receiptCount > 0 && (!latest || latest.kind !== 'terminal')) {
    throw new Error('Existing evidence can resume only after explicit terminal host observation')
  }
  if (value.state === 'ready-to-dispatch') {
    if (history.length || value.receiptCount) throw new Error('Ready state conflicts with prior host attempts or evidence')
  } else {
    if (!latest || latest.kind !== 'terminal') throw new Error('Resume requires an explicit terminal host observation')
    if (value.state === 'partial-evidence-needs-explicit-resume' && value.receiptCount === 0) {
      throw new Error('Partial-evidence resume requires retained evidence')
    }
    if (value.state === 'retry-needs-explicit-dispatch' && value.receiptCount !== 0) {
      throw new Error('Evidence-bearing assignments must use explicit partial-evidence resume')
    }
  }
}

function allRecordedHandles(directory) {
  const attemptsRoot = resolve(directory, 'attempts')
  assertDirectory(attemptsRoot, 'host attempts')
  if (!existsSync(attemptsRoot)) return []
  return readdirSync(attemptsRoot).filter(assignmentName)
    .flatMap(assignment => listAssignmentHistory(directory, assignment)
      .filter(record => record.handle)
      .map(record => ({ assignment, sequence: record.sequence, handle: record.handle })))
}

/** Run a synchronous callback under the shared lock used by reservations and broker writes. */
export function withHostAssignmentLock(directory, assignment, action) {
  assertAssignment(assignment)
  return withLocks(directory, [assignmentScope(assignment)], action)
}

/**
 * Reserve an authorized dispatch before starting its worker. The callback must
 * freshly inspect the assignment while this assignment lock is held and return
 * {state, receiptCount, outputExists, checkpointExists}.
 */
export function reserveHostDispatch(directory, assignment, authorize) {
  assertAssignment(assignment)
  if (typeof authorize !== 'function') throw new Error('Read-only dispatch authorization callback required')
  return withLocks(directory, ['host-identities', assignmentScope(assignment)], () => {
    const history = listAssignmentHistory(directory, assignment)
    const authorization = authorize()
    if (authorization && typeof authorization.then === 'function') throw new Error('Dispatch authorization must complete synchronously')
    validateAuthorization(authorization, history)
    const sequence = String(history.length + 1).padStart(3, '0')
    const reservationId = randomUUID()
    createOnly(hostPaths(directory, assignment, sequence).reservation, { version: 1, assignment, sequence, reservationId })
    return { assignment, sequence, reservationId, state: 'dispatch-reserved' }
  })
}

/** Bind the spawned host handle to exactly one reserved assignment. */
export function bindHostDispatch(directory, assignment, reservationId, handle) {
  assertAssignment(assignment)
  if (typeof reservationId !== 'string' || !reservationId.trim()) throw new Error('Dispatch reservation identity required')
  if (!validHandle(handle)) throw new Error('Valid host handle required')
  return withLocks(directory, ['host-identities', assignmentScope(assignment)], () => {
    const history = listAssignmentHistory(directory, assignment), latest = history.at(-1)
    if (!latest || latest.reservationId !== reservationId || !['reserved', 'bound'].includes(latest.kind)) {
      throw new Error('Latest unbound reservation identity must match')
    }
    if (latest.kind === 'bound' && latest.handle !== handle) throw new Error('Reservation is already bound to a different host handle')
    if (latest.kind === 'reserved') {
      const duplicate = allRecordedHandles(directory).find(item => item.handle === handle
        && !(item.assignment === assignment && item.sequence === latest.sequence))
      if (duplicate) throw new Error('Host handle is already pinned to another assignment or attempt')
      const path = hostPaths(directory, assignment, latest.sequence).binding
      createOnly(path, { version: 1, assignment, sequence: latest.sequence, reservationId, handle })
    }
    return { assignment, sequence: latest.sequence, reservationId, handle, state: 'runtime-check-required' }
  })
}

/** Record an explicit host terminal observation for the current reservation or legacy launch. */
export function recordHostTerminal(directory, assignment, reservationId, handle, observation) {
  assertAssignment(assignment)
  if (typeof reservationId !== 'string' || !reservationId.trim()) throw new Error('Dispatch identity required')
  if (!validHandle(handle)) throw new Error('Valid host handle required')
  if (!TERMINAL.has(observation)) throw new Error('Explicit terminal host observation required')
  return withLocks(directory, ['host-identities', assignmentScope(assignment)], () => {
    const history = listAssignmentHistory(directory, assignment), latest = history.at(-1)
    if (!latest || latest.reservationId !== reservationId || latest.handle !== handle
      || !['bound', 'legacy', 'terminal'].includes(latest.kind)) throw new Error('Latest bound host identity must match')
    const terminalPath = hostPaths(directory, assignment, latest.sequence).terminal
    const record = latest.source === 'legacy'
      ? { handle, observation }
      : { version: 1, assignment, sequence: latest.sequence, reservationId, handle, observation }
    createOnly(terminalPath, record)
    return { assignment, sequence: latest.sequence, reservationId, handle, observation, state: 'terminal' }
  })
}

/** Read only this assignment's host state; no worker output, labels, or summaries are returned. */
export function readHostStatus(directory, assignment) {
  assertAssignment(assignment)
  return withHostAssignmentLock(directory, assignment, () => readStatusUnlocked(directory, assignment))
}

/**
 * Read-only, non-locking snapshot for inspectEngine and other code already
 * running under a host assignment lock. This is informational only: callers
 * must use withHostEvidenceAccess for authority to read or write evidence.
 */
export function inspectHostAssignment(directory, assignment) {
  assertAssignment(assignment)
  return readStatusUnlocked(resolve(directory), assignment)
}

/** Run broker evidence work only after a host handle has been bound and before terminal observation. */
export function withHostEvidenceAccess(directory, assignment, action, options = {}) {
  assertAssignment(assignment)
  if (typeof action !== 'function') throw new Error('Synchronous evidence callback required')
  const waitForBindingMs = options.waitForBindingMs ?? 1000
  if (!Number.isSafeInteger(waitForBindingMs) || waitForBindingMs < 0 || waitForBindingMs > 1000) {
    throw new Error('Host binding wait must be an integer from 0 to 1000 milliseconds')
  }
  const waiting = Symbol('waiting-for-host-binding')
  let waited = 0, poll = 0
  while (true) {
    const result = withHostAssignmentLock(directory, assignment, () => {
      const status = readStatusUnlocked(directory, assignment)
      if (status.canReadEvidence) {
        const value = action({ assignment: status.assignment, sequence: status.sequence, reservationId: status.reservationId, handle: status.handle })
        if (value && typeof value.then === 'function') throw new Error('Evidence callbacks must complete synchronously')
        return value
      }
      if (status.state === 'dispatch-reserved' && waited < waitForBindingMs) return waiting
      throw new Error(`Evidence access blocked until ${assignment} has a bound active host dispatch`)
    })
    if (result !== waiting) return result
    const pause = Math.min(Math.min(200, 8 * (2 ** poll++)), waitForBindingMs - waited)
    sleepSync(pause)
    waited += pause
  }
}
