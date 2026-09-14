import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runOwnership, writeImmutable } from '../scripts/run-behavior-ownership.mjs'
import { hash } from '../scripts/lib/capability-graph.mjs'
import { ownershipRequest } from '../scripts/lib/behavior-ownership.mjs'

function fixture(t) {
  mkdirSync('public/graph-reviews', { recursive: true })
  const root = mkdtempSync(resolve('public/graph-reviews/ownership-test-'))
  t.after(() => {
    try { rmSync(root, { recursive: true, force: true }) }
    catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; t.diagnostic(`Temporary fixture cleanup denied; retained ${root}`) }
  })
  const baseline = { headSha: 'a'.repeat(40) }, packet = { evidence: [], searches: [] }, prior = { nodes: [], pairs: [], reviews: [] }
  const o = { prepared: `${root}/prepared`, prior: `${root}/prior`, in: `${root}/baseline.json`, out: `${root}/live` }
  const requests = ['forward', 'reverse'].map((order) => {
    const r = ownershipRequest([], [], packet, baseline.headSha, 'synthetic', order === 'reverse'), file = `planned-${order}.json`
    writeImmutable(`${o.prepared}/${file}`, r)
    return { order, file, requestSha256: hash(r) }
  })
  writeImmutable(o.in, baseline); writeImmutable(`${o.prior}/output.json`, prior); writeImmutable(`${o.prepared}/packet.json`, packet)
  writeImmutable(`${o.prepared}/plan.json`, { status: 'prepared-not-run', baselineSha256: hash(baseline), priorSha256: hash(prior), packetSha256: hash(packet), requests })
  const value = { behaviors: [], roles: [], decisions: [], implementations: [], history: [], consistencyNotes: [], coverageLimits: ['Synthetic fixture, not repository data'] }
  return { o, root, payload: { model: 'synthetic', usage: { cost: 0.1 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] } }
}
test('ownership run preserves raw responses and exact replay makes no provider calls', async (t) => {
  const { o, root, payload } = fixture(t); let calls = 0
  const a = await runOwnership(o, { apiKey: 'synthetic', requestProvider: async () => { calls++; return payload } })
  assert.equal(calls, 2); assert.equal(a.status, 'completed'); assert.equal(a.cost, 0.2)
  const b = await runOwnership({ ...o, out: `${root}/replay`, 'replay-from': o.out }, { requestProvider: async () => { throw new Error('must not call') } })
  assert.deepEqual(a, b)
  assert.equal(readFileSync(`${o.out}/output.json`, 'utf8'), readFileSync(`${root}/replay/output.json`, 'utf8'))
})
test('provider failure is sanitized, persisted and stops the second call', async (t) => {
  const { o } = fixture(t); let calls = 0
  const a = await runOwnership(o, { apiKey: 'synthetic', requestProvider: async () => { calls++; throw new Error('HTTP 403: private provider metadata') } })
  assert.equal(calls, 1); assert.equal(a.status, 'incomplete'); assert.equal(a.costComplete, false)
  assert.equal(a.reviews[0].httpStatus, 403)
  assert.doesNotMatch(readFileSync(`${o.out}/ownership-forward.failure.json`, 'utf8'), /private provider/)
  await runOwnership(o, { requestProvider: async () => { throw new Error('must not call') } })
})
test('invalid semantic output is retained without repair and does not gate independent repeat', async (t) => {
  const { o, payload } = fixture(t); payload.choices[0].message.content = '{}'; let calls = 0
  const r = await runOwnership(o, { apiKey: 'synthetic', requestProvider: async () => { calls++; return payload } })
  assert.equal(calls, 2); assert.equal(r.reviews[0].status, 'invalid'); assert.equal(r.agreement, null)
  assert.deepEqual(JSON.parse(readFileSync(`${o.out}/ownership-forward.response.json`, 'utf8')), payload)
})
test('unreturned usage or reached cost guard prevents another paid request', async (t) => {
  for (const usage of [{}, { cost: 1.25 }]) {
    const { o, payload } = fixture(t); payload.usage = usage; let calls = 0
    const r = await runOwnership(o, { apiKey: 'synthetic', requestProvider: async () => { calls++; return payload } })
    assert.equal(calls, 1); assert.equal(r.status, 'incomplete')
  }
})
test('orphaned request and absent replay cannot silently retry', async (t) => {
  const { o, root } = fixture(t)
  const request = JSON.parse(readFileSync(`${o.prepared}/planned-forward.json`, 'utf8'))
  writeImmutable(`${o.out}/ownership-forward.request.json`, request)
  const forbidden = { apiKey: 'synthetic', requestProvider: async () => assert.fail('no provider calls permitted') }
  await assert.rejects(runOwnership(o, forbidden), /reconcile/)
  await assert.rejects(runOwnership({ ...o, out: `${root}/replay`, 'replay-from': `${root}/absent` }, forbidden), /fallback forbidden/)
})
