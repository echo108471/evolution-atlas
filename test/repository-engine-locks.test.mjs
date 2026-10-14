import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareEngine, recordEngineLaunch, recordEngineTerminal, readEngineWorkerStatus } from '../scripts/repository-engine.mjs'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const moduleUrl = pathToFileURL(resolve('scripts/repository-engine.mjs')).href

function fixture(t, operation) {
  const root = mkdtempSync(join(tmpdir(), 'repository-engine-lock-test-'))
  const repo = join(root, 'source'), out = join(root, 'run'), children = []
  t.after(async () => {
    for (const { child, closed } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await closed
    }
    rmSync(root, { recursive: true, force: true })
  })
  const git = args => execFileSync('git', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', repo])
  writeFileSync(join(repo, 'main.js'), 'export const synthetic = true\n')
  git(['-C', repo, 'add', '.'])
  git(['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Synthetic source'])
  prepareEngine(out, { mode: 'discovery', repo, displayName: 'Synthetic lock fixture', partitionCount: 1 })
  if (operation === 'terminal') recordEngineLaunch(out, 'A', 'worker-A')
  mkdirSync(join(out, 'locks'), { recursive: true })
  const lockPath = join(out, 'locks', 'assignment-A.lock')
  const invoke = () => operation === 'launch'
    ? recordEngineLaunch(out, 'A', 'worker-A')
    : recordEngineTerminal(out, 'A', 'worker-A', 'completed')
  return { root, out, children, lockPath, invoke }
}

function hold(f, pid) {
  const bytes = JSON.stringify({ pid, note: 'Synthetic test owner; explicit release only' }) + '\n'
  writeFileSync(f.lockPath, bytes, { flag: 'wx' })
  // Age must never grant authority to discard a live or dead owner's lock.
  utimesSync(f.lockPath, new Date(0), new Date(0))
  return bytes
}

function waitSetting(t, value) {
  const previous = process.env.ATLAS_HOST_LOCK_WAIT_MS
  process.env.ATLAS_HOST_LOCK_WAIT_MS = value
  t.after(() => {
    if (previous === undefined) delete process.env.ATLAS_HOST_LOCK_WAIT_MS
    else process.env.ATLAS_HOST_LOCK_WAIT_MS = previous
  })
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for lifecycle test process')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

for (const operation of ['launch', 'terminal']) {
  test(`v3 ${operation} waits for a live assignment holder to release before recording state`, async t => {
    const f = fixture(t, operation), bytes = hold(f, process.pid), startedPath = join(f.root, 'started')
    // A broker or host writer may still be writing JSON while it owns the
    // lock. Lifecycle inspection must wait too, not parse these partial bytes.
    const pendingWrite = operation === 'launch'
      ? join(f.out, 'receipts', 'A', 'A-001.json')
      : join(f.out, 'attempts', 'A', '001.binding.json')
    const original = operation === 'terminal' ? readFileSync(pendingWrite) : null
    if (operation === 'launch') mkdirSync(join(f.out, 'receipts', 'A'), { recursive: true })
    writeFileSync(pendingWrite, '{')
    const source = `
      import { writeFileSync } from 'node:fs'
      import { recordEngineLaunch, recordEngineTerminal } from ${JSON.stringify(moduleUrl)}
      const [out, operation, startedPath] = process.argv.slice(1)
      writeFileSync(startedPath, 'started')
      const result = operation === 'launch'
        ? recordEngineLaunch(out, 'A', 'worker-A')
        : recordEngineTerminal(out, 'A', 'worker-A', 'completed')
      process.stdout.write(JSON.stringify(result))
    `
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, f.out, operation, startedPath], {
      env: { ...env, ATLAS_HOST_LOCK_WAIT_MS: '5000' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', done = false
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const closed = once(child, 'close').then(result => { done = true; return result })
    f.children.push({ child, closed })
    await waitUntil(() => existsSync(startedPath) || done)
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(done, false, `lifecycle call must keep waiting beyond the old brief retries: ${stderr}`)
    assert.equal(readFileSync(f.lockPath, 'utf8'), bytes)
    const pendingArtifact = join(f.out, 'attempts', 'A', operation === 'launch' ? '001.reservation.json' : '001.terminal.json')
    assert.equal(existsSync(pendingArtifact), false)

    if (original) writeFileSync(pendingWrite, original)
    else unlinkSync(pendingWrite)
    unlinkSync(f.lockPath) // Only the synthetic owner releases this lock.
    const [code] = await closed
    assert.equal(code, 0, stderr)
    assert.equal(JSON.parse(stdout).handle, 'worker-A')
    assert.equal(existsSync(f.lockPath), false, 'successful caller releases its own lock')
    assert.equal(existsSync(pendingArtifact), true)
    assert.equal(readEngineWorkerStatus(f.out, 'A').state, operation === 'launch' ? 'runtime-check-required' : 'terminal')
  })

  test(`v3 ${operation} fails closed on a dead holder and preserves the old lock`, t => {
    const f = fixture(t, operation), deadPid = 2_147_483_647
    assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' })
    const bytes = hold(f, deadPid)
    assert.throws(f.invoke, error => {
      assert.equal(error.code, 'EEXIST')
      assert.ok(error.message.includes(f.lockPath))
      assert.ok(error.message.includes(String(deadPid)))
      assert.match(error.message, /manual recovery/)
      return true
    })
    assert.equal(readFileSync(f.lockPath, 'utf8'), bytes)
  })

  test(`v3 ${operation} times out with the live holder PID and lock path without deleting it`, t => {
    const f = fixture(t, operation), bytes = hold(f, process.pid)
    waitSetting(t, '100')
    const started = performance.now()
    assert.throws(f.invoke, error => {
      assert.equal(error.code, 'ETIMEDOUT')
      assert.equal(error.path, f.lockPath)
      assert.equal(error.pid, process.pid)
      assert.ok(error.message.includes(f.lockPath))
      assert.ok(error.message.includes(String(process.pid)))
      assert.match(error.message, /Timed out after 100 ms/)
      return true
    })
    assert.ok(performance.now() - started >= 100)
    assert.equal(readFileSync(f.lockPath, 'utf8'), bytes)
  })
}
