import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createOfflineEnvironment, OFFLINE_PRELOAD } from '../scripts/verification/offline-environment.mjs'

test('offline environment removes credentials, inherited preload hooks, and remote Git protocols', () => {
  const env = createOfflineEnvironment({ home: '/tmp/synthetic-home', environment: {
    PATH: '/synthetic/bin', OPENROUTER_API_KEY: 'synthetic', GH_TOKEN: 'synthetic',
    HTTPS_PROXY: 'https://example.test', GIT_DIR: '/unexpected', NODE_OPTIONS: '--require=unexpected',
  } })
  assert.equal(env.PATH, '/synthetic/bin')
  for (const key of ['OPENROUTER_API_KEY', 'GH_TOKEN', 'HTTPS_PROXY', 'GIT_DIR']) assert.equal(env[key], undefined)
  assert.equal(env.HOME, '/tmp/synthetic-home')
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'file')
  assert.equal(env.NPM_CONFIG_USERCONFIG, '/tmp/synthetic-home/.npmrc')
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, '/tmp/synthetic-home/global-npmrc')
  assert.ok(env.NODE_OPTIONS.includes(OFFLINE_PRELOAD))
  assert.equal(env.NODE_OPTIONS.includes('unexpected'), false)
})

test('offline subprocess rejects external HTTP, fetch and socket calls but permits loopback', t => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-network-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const source = `
    const assert = require('node:assert/strict');
    const http = require('node:http'); const net = require('node:net');
    const denied = /Offline validation forbids external network access/;
    assert.throws(() => http.get('https://example.test/'), denied);
    assert.throws(() => fetch('https://example.test/'), denied);
    assert.throws(() => fetch('https://openrouter.ai/api/v1/batches', { method: 'POST', body: '{}' }), denied);
    assert.throws(() => fetch('https://openrouter.ai/api/v1/batches/batch_synthetic'), denied);
    assert.throws(() => net.connect({ host: 'example.test', port: 443 }), denied);
    const server = http.createServer((req, res) => res.end('synthetic'));
    server.listen(0, '127.0.0.1', async () => {
      try { assert.equal(await (await fetch('http://127.0.0.1:'+server.address().port)).text(), 'synthetic'); }
      catch (error) { console.error(error.message); process.exitCode = 1; }
      finally { server.close(); }
    });
  `
  const result = spawnSync(process.execPath, ['-e', source], {
    env: createOfflineEnvironment({ home }), encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr)
})
