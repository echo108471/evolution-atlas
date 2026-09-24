import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { inventorySnapshot } from './repository-snapshot.mjs'
import { sourceReader } from './repository-source.mjs'

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const MAX_ENTRIES = 10_000
const MAX_OMISSION_SAMPLES = 40
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0

function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
  return env
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, ...args], {
      env: gitEnv(), encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const detail = typeof error?.stderr === 'string' && error.stderr.trim() ? error.stderr.trim() : error.message
    throw new Error(`Evolution Git check failed: ${detail}`)
  }
}

export function resolveEvolutionCommit(repo, revision) {
  if (typeof revision !== 'string' || !revision.trim() || revision.includes('..') || /\s/.test(revision)) throw new Error('Invalid evolution revision')
  const sha = git(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
  if (!SHA.test(sha)) throw new Error('Evolution revision did not resolve to a commit')
  return sha
}

export function assertEvolutionAncestor(repo, ancestor, descendant, message = 'Revision must be an ancestor of the pinned revision') {
  if (!SHA.test(ancestor ?? '') || !SHA.test(descendant ?? '')) throw new Error('Full commit identities required for revision binding')
  try { execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant], { env: gitEnv(), timeout: 30_000, stdio: 'ignore' }) }
  catch { throw new Error(message) }
  return true
}

const sum = value => createHash('sha256').update(value).digest('hex')

function summarizeOmissions(side, omitted, sampleLimit = MAX_OMISSION_SAMPLES) {
  const counts = new Map()
  for (const entry of omitted) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1)
  return [...counts].sort(([a], [b]) => cmp(a, b)).map(([reason, count]) => ({
    side, reason, count,
    samplePaths: omitted.filter(entry => entry.reason === reason).slice(0, sampleLimit).map(entry => entry.path),
    omittedSamplePaths: Math.max(0, count - Math.min(count, sampleLimit)),
  }))
}

function boundedRows(rows, field, omissions) {
  if (rows.length <= MAX_ENTRIES) return rows
  omissions.push(`${field}: ${rows.length - MAX_ENTRIES} additional eligible path observations omitted by the ${MAX_ENTRIES}-entry transition limit`)
  return rows.slice(0, MAX_ENTRIES)
}

/** Compare only the repository snapshot's eligible source inventory. */
export function observeRevisionTransition({ repo, fromCommitSha, toCommitSha, currentInventory, maxFileBytes = 1_048_576, baselineMaxFileBytes = maxFileBytes }) {
  assertEvolutionAncestor(repo, fromCommitSha, toCommitSha, 'Baseline revision is not an ancestor of the current revision')
  if (!currentInventory || currentInventory.commitSha !== toCommitSha || !Array.isArray(currentInventory.files)) throw new Error('Current pinned source inventory required')
  const previous = inventorySnapshot({ repo, revision: fromCommitSha, partitionCount: 6, maxFileBytes: baselineMaxFileBytes }).inventory
  const priorFiles = new Map(previous.files.map(file => [file.path, file]))
  const currentFiles = new Map(currentInventory.files.map(file => [file.path, file]))
  const priorEntries = new Set([...previous.files.map(file => file.path), ...previous.omitted.map(entry => entry.path)])
  const currentEntries = new Set([...currentInventory.files.map(file => file.path), ...(currentInventory.omitted ?? []).map(entry => entry.path)])
  const added = [], changed = [], unchanged = [], deleted = [], omissions = [], notComparable = []

  for (const [path, current] of currentFiles) {
    const prior = priorFiles.get(path)
    if (!prior) {
      if (priorEntries.has(path)) {
        const reason = previous.omitted.find(entry => entry.path === path)?.reason ?? 'not-eligible-under-baseline-filter'
        notComparable.push({ side: 'baseline', path, reason: `not-comparable-to-baseline:${reason}` })
      } else added.push({ path, blobSha: current.blobSha })
    } else if (prior.blobSha === current.blobSha) unchanged.push({ path, blobSha: current.blobSha })
    else changed.push({ path, fromBlobSha: prior.blobSha, toBlobSha: current.blobSha })
  }
  for (const [path, prior] of priorFiles) {
    if (currentFiles.has(path)) continue
    if (!currentEntries.has(path)) deleted.push({ path, blobSha: prior.blobSha })
    else omissions.push({ side: 'current', path, reason: currentInventory.omitted?.find(entry => entry.path === path)?.reason ?? 'not-eligible-under-current-filter' })
  }
  for (const entry of previous.omitted) omissions.push({ side: 'baseline', path: entry.path, reason: entry.reason })
  for (const entry of currentInventory.omitted ?? []) omissions.push({ side: 'current', path: entry.path, reason: entry.reason })

  for (const rows of [added, changed, unchanged, deleted]) rows.sort((a, b) => cmp(a.path, b.path))
  const summary = []
  const result = {
    version: 'repository-transition/1',
    fromCommitSha,
    toCommitSha,
    relation: fromCommitSha === toCommitSha ? 'same' : 'ancestor',
    added: boundedRows(added, 'added', summary),
    changed: boundedRows(changed, 'changed', summary),
    unchanged: boundedRows(unchanged, 'unchanged', summary),
    deleted: boundedRows(deleted, 'deleted', summary),
    omissions: [
      ...summarizeOmissions('baseline', previous.omitted),
      ...summarizeOmissions('current', currentInventory.omitted ?? []),
      ...summarizeOmissions('transition', notComparable),
      ...omissions.filter(entry => entry.reason === 'not-eligible-under-baseline-filter' || entry.reason === 'not-eligible-under-current-filter')
        .sort((a, b) => cmp(`${a.side}:${a.path}`, `${b.side}:${b.path}`)).slice(0, MAX_OMISSION_SAMPLES),
      ...summary,
    ],
  }
  result.fingerprint = sum(JSON.stringify(result))
  return result
}

function inventoryForReceiptCommit(repo, commitSha, maxFileBytes = 1_048_576) {
  return inventorySnapshot({ repo, revision: commitSha, partitionCount: 6, maxFileBytes }).inventory
}

export function verifySourceReceiptsAtOriginalCommits(repo, receipts, currentCommitSha) {
  if (!Array.isArray(receipts)) throw new Error('Baseline receipt array required')
  const inventoryByCommit = new Map(), readers = new Map(), verified = []
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || typeof receipt.id !== 'string') throw new Error('Invalid original receipt')
    if (receipt.kind !== 'source') continue
    const sourceCommit = receipt.commitSha
    if (!SHA.test(sourceCommit ?? '')) throw new Error(`Original receipt lacks full source commit identity: ${receipt.id}`)
    assertEvolutionAncestor(repo, sourceCommit, currentCommitSha, `Original receipt is from a foreign or future revision: ${receipt.id}`)
    if (!inventoryByCommit.has(sourceCommit)) inventoryByCommit.set(sourceCommit, inventoryForReceiptCommit(repo, sourceCommit))
    const inventory = inventoryByCommit.get(sourceCommit)
    if (receipt.kind === 'source') {
      // A source receipt records the original assignment partition. Preserve that partition
      // while still checking path/blob/size against the immutable Git tree at its commit.
      const file = inventory.files.find(item => item.path === receipt.path)
      if (!file || !/^[A-F]$/.test(receipt.partition ?? '')) throw new Error(`Original source path is no longer eligible at its recorded commit: ${receipt.id}`)
      const key = `${sourceCommit}:${receipt.partition}:${receipt.path}`
      if (!readers.has(key)) {
        const tailored = { ...inventory, files: inventory.files.map(item => ({ ...item, partition: item.path === receipt.path ? receipt.partition : item.partition })), eligibleFiles: inventory.files.length }
        readers.set(key, sourceReader(repo, tailored))
      }
      const reader = readers.get(key)
      // sourceReader's verifier checks the original text, line bounds, blob SHA and the
      // exact cross-partition bit. It can be replayed with the recorded partition.
      reader.verify(receipt)
    }
    verified.push(receipt)
  }
  return verified
}
