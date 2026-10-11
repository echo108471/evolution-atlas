// Routine checks may use local servers, but must never contact remote providers.
const net = require('node:net')
const tls = require('node:tls')
const { syncBuiltinESMExports } = require('node:module')

const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase())
const denied = () => { throw new Error('Offline validation forbids external network access') }

function checkConnection(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'string') return // Local Unix socket or named pipe.
  if (first?.path) return
  const host = typeof first === 'object'
    ? first.host ?? first.hostname ?? 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost'
  if (!local(host)) denied()
}

for (const [owner, key] of [[net.Socket.prototype, 'connect'], [tls, 'connect']]) {
  const original = owner[key]
  owner[key] = function (...args) { checkConnection(args); return original.apply(this, args) }
}

function checkRequest(input) {
  if (typeof input === 'string' || input instanceof URL) {
    if (!local(new URL(input).hostname)) denied()
  } else if (!input?.socketPath && !local(input?.hostname ?? input?.host ?? 'localhost')) denied()
}

for (const name of ['node:http', 'node:https']) {
  const owner = require(name)
  for (const key of ['request', 'get']) {
    const original = owner[key]
    owner[key] = function (...args) { checkRequest(args[0]); return original.apply(this, args) }
  }
}
const originalFetch = globalThis.fetch
globalThis.fetch = function (input, ...args) {
  checkRequest(typeof input === 'object' && !(input instanceof URL) ? input.url : input)
  return originalFetch.call(this, input, ...args)
}
syncBuiltinESMExports()
