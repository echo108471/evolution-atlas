import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { inventorySnapshot, safeRepositoryPath } from './repository-snapshot.mjs'

const MAX_LINES = 160, MAX_BYTES = 16_000, MAX_FILE_BYTES = 1_048_576
const SECRET_SHAPE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b|\bBearer\s+[A-Za-z0-9._~-]{24,}|\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][A-Za-z0-9_+/.=-]{16,}["']|https?:\/\/[^\s/:@]+:[^\s/@]{4,}@/i
const invalid = () => { throw new Error('Invalid immutable source inventory metadata') }

function blobBytes(repo, sha, path) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, 'cat-file', 'blob', sha], {
      env, timeout: 30_000, maxBuffer: MAX_FILE_BYTES, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`Cannot read local source blob: ${path}`)
  }
}

/** A read-only broker over one pinned snapshot. Inventory subsets are allowed
 * for expansion, but each included record must match that commit's real tree.
 * Receipts carry no owner: callers must separately check crossPartition against
 * the actor that owns a receipt. No content screening certifies absence of all
 * secrets; the checks below deliberately reject familiar secret-shaped text. */
export function sourceReader(repo, inventory) {
  if (!inventory || typeof inventory !== 'object' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(inventory.commitSha)
    || !Array.isArray(inventory.files) || inventory.eligibleFiles !== inventory.files.length
    || !Number.isSafeInteger(inventory.allTrackedEntries) || inventory.allTrackedEntries < inventory.files.length) invalid()
  const actual = inventorySnapshot({ repo, revision: inventory.commitSha, partitionCount: 6 })
  if (actual.inventory.commitSha !== inventory.commitSha || actual.inventory.allTrackedEntries !== inventory.allTrackedEntries) invalid()
  const realFiles = new Map(actual.inventory.files.map(file => [file.path, file])), files = new Map()
  for (const candidate of inventory.files) {
    if (!candidate || !safeRepositoryPath(candidate.path) || files.has(candidate.path)
      || !/^[A-F]$/.test(candidate.partition)) invalid()
    const actualFile = realFiles.get(candidate.path)
    if (!actualFile || ['path', 'mode', 'type', 'blobSha', 'size'].some(key => candidate[key] !== actualFile[key])) invalid()
    files.set(candidate.path, Object.freeze({ ...candidate }))
  }
  const ordered = [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const commitSha = actual.inventory.commitSha, cache = new Map()

  function decoded(file) {
    if (cache.has(file.blobSha)) return cache.get(file.blobSha)
    const bytes = blobBytes(actual.repo, file.blobSha, file.path)
    const digest = createHash(file.blobSha.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    if (bytes.length !== file.size || digest !== file.blobSha) throw new Error(`Source blob metadata mismatch: ${file.path}`)
    let text
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new Error(`Rejected source blob: ${file.path}`) }
    if (text.includes('\0') || SECRET_SHAPE.test(text)) throw new Error(`Rejected source blob: ${file.path}`)
    const value = Object.freeze({ text, lines: Object.freeze(text.split('\n')) })
    cache.set(file.blobSha, value)
    return value
  }

  function read(path, start = 1, count = 120, agent = 'R') {
    if (!safeRepositoryPath(path) || !files.has(path)) throw new Error('Source path is not eligible')
    if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(count) || count < 1 || count > MAX_LINES) throw new Error('Invalid source window')
    if (typeof agent !== 'string' || !/^[A-FR]$/.test(agent)) throw new Error('Invalid source reader agent')
    const file = files.get(path), { lines } = decoded(file)
    if (start > lines.length) throw new Error('Source window starts beyond file')
    const selected = [], end = Math.min(lines.length, start - 1 + count)
    let size = 0
    for (let i = start - 1; i < end; i++) {
      const nextSize = size + Buffer.byteLength(lines[i]) + (selected.length ? 1 : 0)
      if (nextSize > MAX_BYTES) break
      selected.push(lines[i]); size = nextSize
    }
    if (!selected.length) throw new Error(`Source line exceeds byte cap: ${path}`)
    const endLine = start + selected.length - 1
    return { kind: 'source', commitSha, blobSha: file.blobSha, path, startLine: start, endLine, totalLines: lines.length,
      partition: file.partition, crossPartition: agent !== 'R' && agent !== file.partition,
      text: selected.join('\n'), truncated: start > 1 || endLine < lines.length }
  }

  function search(prefix, literal) {
    if (typeof prefix !== 'string' || !prefix || !safeRepositoryPath(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
      || typeof literal !== 'string' || !literal || literal.length > 100 || /[\p{Cc}\p{Cs}]/u.test(literal)) throw new Error('Search requires a safe prefix and a short literal')
    const scoped = ordered.filter(file => file.path.startsWith(prefix)), matches = []
    let totalMatches = 0
    for (const file of scoped) {
      const { lines } = decoded(file)
      for (let line = 0; line < lines.length; line++) if (lines[line].includes(literal)) {
        totalMatches++
        if (matches.length < 50) matches.push({ path: file.path, line: line + 1 })
      }
    }
    return { kind: 'search', commitSha, prefix, literal, searchedFiles: scoped.length, totalMatches,
      matches, omittedMatches: Math.max(0, totalMatches - 50), note: 'locations only; not support until source window inspected' }
  }

  function verify(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Invalid source receipt')
    const { id: _id, ...payload } = receipt
    let expected
    if (payload.kind === 'source') {
      if (typeof payload.crossPartition !== 'boolean' || !Number.isSafeInteger(payload.endLine)) throw new Error('Invalid source receipt')
      // The original request may have been cropped by its byte budget. Replay
      // the actual saved range, never an inferred requested line count.
      const file = files.get(payload.path)
      const agent = payload.crossPartition ? (file?.partition === 'A' ? 'B' : 'A') : 'R'
      expected = read(payload.path, payload.startLine, payload.endLine - payload.startLine + 1, agent)
    } else if (payload.kind === 'search') expected = search(payload.prefix, payload.literal)
    else throw new Error('Invalid source receipt kind')
    if (!isDeepStrictEqual(payload, expected)) throw new Error('Source receipt differs from immutable evidence')
    return true
  }
  return Object.freeze({ read, search, verify })
}
