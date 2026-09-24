import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bindHostDispatch,
  inspectHostAssignment,
  readHostStatus,
  recordHostTerminal,
  reserveHostDispatch,
  withHostAssignmentLock,
  withHostEvidenceAccess,
} from '../scripts/lib/repository-host.mjs'

const json = value => JSON.stringify(value, null, 2) + '\n'
const ready = () => ({ state: 'ready-to-dispatch', receiptCount: 0, outputExists: false, checkpointExists: false })
function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'repository-host-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
function reserve(directory, assignment = 'A', authorization = ready) {
  return reserveHostDispatch(directory, assignment, authorization)
}
async function waitUntil(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for concurrent host reservation fixture')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('two processes racing to reserve one assignment produce one create-only reservation', async t => {
  const directory = fixture(t), barrier = resolve(directory, 'barrier')
  mkdirSync(barrier)
  writeFileSync(resolve(barrier, 'go'), 'wait')
  const moduleUrl = pathToFileURL(resolve('scripts/lib/repository-host.mjs')).href
  const source = `
    import { existsSync, writeFileSync } from 'node:fs'
    import { resolve } from 'node:path'
    import { reserveHostDispatch } from ${JSON.stringify(moduleUrl)}
    const [directory, barrier, name] = process.argv.slice(1)
    writeFileSync(resolve(barrier, name + '.ready'), 'ready')
    const cell = new Int32Array(new SharedArrayBuffer(4))
    while (existsSync(resolve(barrier, 'go'))) Atomics.wait(cell, 0, 0, 5)
    try {
      const reservation = reserveHostDispatch(directory, 'A', () => ({ state: 'ready-to-dispatch', receiptCount: 0, outputExists: false, checkpointExists: false }))
      process.stdout.write(JSON.stringify({ ok: true, reservation }))
    } catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error.message })) }
  `
  const children = ['one', 'two'].map(name => spawn(process.execPath, ['--input-type=module', '-e', source, directory, barrier, name], { stdio: ['ignore', 'pipe', 'pipe'] }))
  await waitUntil(() => children.every((_, i) => existsSync(resolve(barrier, ['one', 'two'][i] + '.ready'))))
  rmSync(resolve(barrier, 'go'))
  const outcomes = await Promise.all(children.map(async child => {
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, stderr)
    return JSON.parse(stdout)
  }))
  assert.equal(outcomes.filter(item => item.ok).length, 1)
  assert.equal(outcomes.filter(item => !item.ok && /active|unbound|unsafe|ready state conflicts/i.test(item.error)).length, 1)
  const reservations = resolve(directory, 'attempts', 'A')
  assert.deepEqual((await import('node:fs')).readdirSync(reservations), ['001.reservation.json'])
})

test('reservation blocks evidence until matching handle binding and terminal pins are explicit', t => {
  const directory = fixture(t)
  const reservation = reserve(directory, 'A', () => {
    assert.equal(inspectHostAssignment(directory, 'A').state, 'unassigned', 'non-locking inspection composes inside reservation authorization')
    return ready()
  })
  assert.equal(readHostStatus(directory, 'A').state, 'dispatch-reserved')
  assert.throws(() => withHostEvidenceAccess(directory, 'A', () => 'should not run', { waitForBindingMs: 0 }), /blocked until A has a bound active host dispatch/)
  assert.throws(() => bindHostDispatch(directory, 'A', 'wrong-reservation', 'worker-A'), /identity must match/)
  assert.equal(existsSync(resolve(directory, 'attempts', 'A', '001.binding.json')), false)

  assert.deepEqual(bindHostDispatch(directory, 'A', reservation.reservationId, 'worker-A'), {
    assignment: 'A', sequence: '001', reservationId: reservation.reservationId, handle: 'worker-A', state: 'runtime-check-required',
  })
  assert.equal(readHostStatus(directory, 'A').handle, 'worker-A')
  assert.deepEqual(withHostEvidenceAccess(directory, 'A', identity => {
    assert.equal(inspectHostAssignment(directory, 'A').state, 'runtime-check-required', 'non-locking inspection composes inside the evidence lock')
    return identity
  }), {
    assignment: 'A', sequence: '001', reservationId: reservation.reservationId, handle: 'worker-A',
  })
  assert.throws(() => bindHostDispatch(directory, 'A', reservation.reservationId, 'worker-other'), /different host handle/)
  assert.throws(() => recordHostTerminal(directory, 'A', reservation.reservationId, 'wrong-handle', 'failed'), /identity must match/)
  assert.equal(existsSync(resolve(directory, 'attempts', 'A', '001.terminal.json')), false)

  recordHostTerminal(directory, 'A', reservation.reservationId, 'worker-A', 'interrupted')
  const status = readHostStatus(directory, 'A')
  assert.equal(status.state, 'terminal')
  assert.equal(status.observation, 'interrupted')
  assert.equal(status.canReadEvidence, false)
  assert.throws(() => withHostEvidenceAccess(directory, 'A', () => 'should not run', { waitForBindingMs: 0 }), /blocked until A has a bound active host dispatch/)
})

test('evidence barrier releases the lock while waiting for post-spawn handle binding', async t => {
  const directory = fixture(t), reservation = reserve(directory)
  const moduleUrl = pathToFileURL(resolve('scripts/lib/repository-host.mjs')).href
  const source = `
    import { bindHostDispatch } from ${JSON.stringify(moduleUrl)}
    const [directory, reservationId] = process.argv.slice(1)
    await new Promise(resolve => setTimeout(resolve, 40))
    bindHostDispatch(directory, 'A', reservationId, 'host-after-spawn')
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, directory, reservation.reservationId], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const result = withHostEvidenceAccess(directory, 'A', identity => {
    assert.equal(identity.handle, 'host-after-spawn')
    assert.equal(inspectHostAssignment(directory, 'A').canReadEvidence, true)
    return 'evidence opened only after bind'
  })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, stderr)
  assert.equal(result, 'evidence opened only after bind')
})

test('existing evidence resumes only after terminal observation and only with the explicit resume state', t => {
  const directory = fixture(t)
  assert.throws(() => reserve(directory, 'A', () => ({
    state: 'partial-evidence-needs-explicit-resume', receiptCount: 1, outputExists: false, checkpointExists: false,
  })), /only after explicit terminal host observation/)
  assert.equal(existsSync(resolve(directory, 'attempts')), false, 'unauthorized dispatch must leave no attempt records')

  const first = reserve(directory)
  bindHostDispatch(directory, 'A', first.reservationId, 'worker-1')
  assert.throws(() => reserve(directory), /active or unbound host dispatch/)
  recordHostTerminal(directory, 'A', first.reservationId, 'worker-1', 'failed')
  assert.throws(() => reserve(directory, 'A', () => ({
    state: 'retry-needs-explicit-dispatch', receiptCount: 1, outputExists: false, checkpointExists: false,
  })), /Evidence-bearing assignments must use explicit partial-evidence resume/)

  const resumed = reserve(directory, 'A', () => ({
    state: 'partial-evidence-needs-explicit-resume', receiptCount: 1, outputExists: false, checkpointExists: false,
  }))
  assert.equal(resumed.sequence, '002')
  assert.equal(readHostStatus(directory, 'A').state, 'dispatch-reserved')
  assert.throws(() => reserve(directory, 'A', () => ({
    state: 'partial-evidence-needs-explicit-resume', receiptCount: 1, outputExists: false, checkpointExists: false,
  })), /active or unbound host dispatch/)
})

test('live and dead lock collisions are bounded and never auto-delete the lock', t => {
  const directory = fixture(t)
  mkdirSync(resolve(directory, 'locks'))
  const stalePath = resolve(directory, 'locks', 'assignment-A.lock')
  const deadPid = process.pid + 10_000_000
  writeFileSync(stalePath, json({ pid: deadPid, ancient: true }))
  const staleBytes = readFileSync(stalePath)
  assert.throws(() => withHostAssignmentLock(directory, 'A', () => 'unused'), /manual recovery/)
  assert.deepEqual(readFileSync(stalePath), staleBytes)

  rmSync(stalePath)
  const livePath = resolve(directory, 'locks', 'assignment-B.lock')
  writeFileSync(livePath, json({ pid: process.pid, owner: 'test-live-process' }))
  const liveBytes = readFileSync(livePath), started = Date.now()
  assert.throws(() => withHostAssignmentLock(directory, 'B', () => 'unused'), /held by live pid/)
  assert.ok(Date.now() - started >= 80, 'live lock collision should retry a bounded number of times')
  assert.deepEqual(readFileSync(livePath), liveBytes)
})

test('status contains only the requested assignment state and handle', t => {
  const directory = fixture(t)
  const a = reserve(directory, 'A')
  bindHostDispatch(directory, 'A', a.reservationId, 'private-handle-A')
  const b = reserve(directory, 'B')
  bindHostDispatch(directory, 'B', b.reservationId, 'private-handle-B')
  const status = readHostStatus(directory, 'A')
  assert.deepEqual(Object.keys(status).sort(), ['assignment', 'canReadEvidence', 'handle', 'observation', 'reservationId', 'sequence', 'state'].sort())
  assert.equal(status.assignment, 'A')
  assert.equal(status.handle, 'private-handle-A')
  assert.equal(JSON.stringify(status).includes('private-handle-B'), false)
  assert.equal(JSON.stringify(status).includes('proposal'), false)
})

test('legacy launch records remain readable and can receive explicit terminal observations', t => {
  const directory = fixture(t), attempts = resolve(directory, 'attempts', 'A')
  mkdirSync(attempts, { recursive: true })
  writeFileSync(resolve(attempts, '001.json'), json({ sequence: '001', handle: 'legacy-worker' }))
  assert.equal(readHostStatus(directory, 'A').state, 'runtime-check-required')
  recordHostTerminal(directory, 'A', 'legacy:001', 'legacy-worker', 'completed')
  assert.equal(readHostStatus(directory, 'A').state, 'terminal')
  assert.equal(JSON.parse(readFileSync(resolve(attempts, '001.terminal.json'))).observation, 'completed')
})
