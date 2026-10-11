/**
 * History-plane evidence over one pinned revision.
 *
 * Ops stay decision-scoped: only commits that are ancestors of (or equal to) the
 * run's pinned commit are readable, payloads are bounded, and omissions are
 * explicit. Contributor fields are observed Git metadata, never ranking input.
 *
 * Reuses bounded-diff selection from commit-diff.mjs. Prior-map lookup across
 * engine outputs and cached per-commit model readings are deliberately out of
 * scope here.
 */
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { readCommitDiff, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES, DEFAULT_CONTEXT_LINES } from './commit-diff.mjs'
import { safeRepositoryPath } from './repository-snapshot.mjs'

const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const DEFAULT_PATH_HISTORY_LIMIT = 12
const MAX_PATH_HISTORY_LIMIT = 40
const MAX_COMMIT_BODY_BYTES = 2000
const MAX_SUBJECT = 200
const HISTORY_DIFF_MAX_LINES = 400
const HISTORY_DIFF_MAX_BYTES = 64 * 1024

function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  })
  return env
}

function runGit(repo, args, { input, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, ...args], {
      env: gitEnv(),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer,
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = typeof error?.stderr === 'string' && error.stderr.trim() ? error.stderr.trim() : error.message
    throw new Error(`History git failed: ${detail}`)
  }
}

function assertPinned(pinnedCommitSha) {
  if (typeof pinnedCommitSha !== 'string' || !COMMIT_RE.test(pinnedCommitSha)) throw new Error('Pinned commit required for history ops')
}

function resolveCommit(repo, revision) {
  if (typeof revision !== 'string' || !revision.trim() || revision.includes('..') || /\s/.test(revision)) {
    throw new Error('Commit revision required')
  }
  let sha
  try {
    sha = runGit(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim()
  } catch {
    throw new Error('Commit revision not found')
  }
  if (!COMMIT_RE.test(sha)) throw new Error('Revision did not resolve to a real commit')
  return sha
}

function assertAncestorOfPinned(repo, pinnedCommitSha, commitSha) {
  try {
    runGit(repo, ['merge-base', '--is-ancestor', commitSha, pinnedCommitSha])
  } catch {
    throw new Error('History commit is not an ancestor of the pinned revision')
  }
}

function truncateBody(body) {
  if (!body) return { body: '', bodyTruncated: false }
  const bytes = Buffer.byteLength(body)
  if (bytes <= MAX_COMMIT_BODY_BYTES) return { body, bodyTruncated: false }
  let cut = body
  while (Buffer.byteLength(cut) > MAX_COMMIT_BODY_BYTES) cut = cut.slice(0, Math.floor(cut.length * 0.9))
  return { body: cut, bodyTruncated: true }
}

/** Observed commit metadata; author fields are not for ranking or judgment. */
export function readCommitMeta(repo, pinnedCommitSha, revision) {
  assertPinned(pinnedCommitSha)
  const commitSha = resolveCommit(repo, revision)
  assertAncestorOfPinned(repo, pinnedCommitSha, commitSha)
  const raw = runGit(repo, [
    'show', '-s', '--format=%H%n%P%n%an%n%ae%n%aI%n%cI%n%T%n%s%n%b', '--end-of-options', commitSha,
  ])
  const lines = raw.split('\n')
  const [full, parentsLine, authorName, authorEmail, authoredAt, committedAt, treeSha, subject, ...bodyLines] = lines
  if (full !== commitSha) throw new Error('Commit metadata identity mismatch')
  const { body, bodyTruncated } = truncateBody(bodyLines.join('\n').replace(/\n$/, ''))
  return {
    kind: 'commit-meta',
    pinnedCommitSha,
    commitSha,
    parents: parentsLine ? parentsLine.split(' ').filter(Boolean) : [],
    treeSha,
    subject: (subject || '').slice(0, MAX_SUBJECT),
    body,
    bodyTruncated,
    authoredAt,
    committedAt,
    authorName,
    authorEmail,
    isPinned: commitSha === pinnedCommitSha,
  }
}

export function readBoundedCommitDiff(repo, pinnedCommitSha, revision, {
  path = null,
  maxLines = HISTORY_DIFF_MAX_LINES,
  maxBytes = HISTORY_DIFF_MAX_BYTES,
  contextLines = DEFAULT_CONTEXT_LINES,
} = {}) {
  assertPinned(pinnedCommitSha)
  const commitSha = resolveCommit(repo, revision)
  assertAncestorOfPinned(repo, pinnedCommitSha, commitSha)
  if (!Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > HISTORY_DIFF_MAX_LINES) throw new Error('Invalid diff line budget')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HISTORY_DIFF_MAX_BYTES) throw new Error('Invalid diff byte budget')
  if (path != null) {
    if (typeof path !== 'string' || !path || !safeRepositoryPath(path)) throw new Error('Diff path is not eligible')
  }
  // A pathless diff must not ask Git to render restricted files. Name-only tree
  // comparison is metadata; the positive path list is applied before numstat,
  // blob-size lookup, or patch generation in readCommitDiff.
  const changedPaths = [...new Set(runGit(repo, [
    'diff-tree', '--root', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv',
    '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', commitSha,
  ]).split('\0').filter(Boolean))]
  // A sensitive file can be renamed to an ordinary-looking destination.
  // With --no-renames the destination would appear as a new safe file and
  // disclose the old content, even for an explicit destination-path request.
  // Withhold the entire commit's patch whenever any changed path is restricted.
  const hasRestrictedPath = changedPaths.some(changedPath => !safeRepositoryPath(changedPath))
  const paths = hasRestrictedPath ? [] : path ? [path] : changedPaths
  const withheldPathCount = hasRestrictedPath ? changedPaths.length : 0
  const diff = readCommitDiff(repo, commitSha, { maxLines, maxBytes, contextLines, paths })
  return {
    kind: 'diff',
    pinnedCommitSha,
    commitSha,
    path: path || null,
    maxLines,
    maxBytes,
    totalLines: diff.totalLines,
    totalBytes: diff.totalBytes,
    truncated: diff.truncated,
    partial: diff.truncated || withheldPathCount > 0,
    withheldPathCount,
    included: diff.included,
    omitted: diff.omitted,
    binaryCount: diff.binaryCount,
    files: diff.files,
    text: diff.text,
  }
}

/**
 * First-parent path history ending at the pinned revision. Rename following is
 * left to Git (`--follow`); results stay bounded by limit/skip.
 */
export function readPathHistory(repo, pinnedCommitSha, path, {
  limit = DEFAULT_PATH_HISTORY_LIMIT,
  skip = 0,
} = {}) {
  assertPinned(pinnedCommitSha)
  if (typeof path !== 'string' || !path || !safeRepositoryPath(path)) throw new Error('History path is not eligible')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PATH_HISTORY_LIMIT) throw new Error('Invalid path-history limit')
  if (!Number.isSafeInteger(skip) || skip < 0) throw new Error('Invalid path-history skip')

  const raw = runGit(repo, [
    'log', '--first-parent', '--follow', '--format=%H%x00%s%x00%aI%x00%P%x00',
    `--skip=${skip}`, `--max-count=${limit + 1}`,
    '--end-of-options', pinnedCommitSha, '--', path,
  ], { maxBuffer: 8 * 1024 * 1024 })

  const tokens = raw.split('\0').map((token) => token.replace(/^\n+|\n+$/g, ''))
  const records = []
  for (let index = 0; index < tokens.length; ) {
    while (index < tokens.length && tokens[index] === '') index += 1
    if (index >= tokens.length) break
    const commitSha = tokens[index++]
    const subject = tokens[index++] ?? ''
    const authoredAt = tokens[index++] ?? ''
    const parentsLine = tokens[index++] ?? ''
    if (!COMMIT_RE.test(commitSha)) continue
    records.push({
      commitSha,
      subject: (subject || '').slice(0, MAX_SUBJECT),
      authoredAt,
      parents: parentsLine ? parentsLine.split(' ').filter(Boolean) : [],
    })
  }

  const omitted = records.length > limit
  const commits = records.slice(0, limit)
  return {
    kind: 'path-history',
    pinnedCommitSha,
    path,
    limit,
    skip,
    returned: commits.length,
    omitted: omitted ? 1 : 0,
    note: omitted
      ? 'Additional matching commits exist beyond this page; raise skip or issue another bounded request.'
      : 'Page complete for this limit/skip under first-parent --follow from the pinned revision.',
    commits,
  }
}

export function historyReader(repo, pinnedCommitSha) {
  assertPinned(pinnedCommitSha)
  if (typeof repo !== 'string' || !repo) throw new Error('Repository path required for history ops')

  function commitMeta(revision) {
    return readCommitMeta(repo, pinnedCommitSha, revision)
  }
  function diff(revision, path, maxLines, maxBytes) {
    return readBoundedCommitDiff(repo, pinnedCommitSha, revision, {
      path: path == null || path === '' ? null : path,
      maxLines: maxLines == null ? HISTORY_DIFF_MAX_LINES : maxLines,
      maxBytes: maxBytes == null ? HISTORY_DIFF_MAX_BYTES : maxBytes,
    })
  }
  function pathHistory(path, limit, skip) {
    return readPathHistory(repo, pinnedCommitSha, path, {
      limit: limit == null ? DEFAULT_PATH_HISTORY_LIMIT : limit,
      skip: skip == null ? 0 : skip,
    })
  }
  function verify(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Invalid history receipt')
    const { id: _id, ...payload } = receipt
    let expected
    if (payload.kind === 'commit-meta') expected = commitMeta(payload.commitSha)
    else if (payload.kind === 'diff') {
      expected = diff(payload.commitSha, payload.path, payload.maxLines, payload.maxBytes)
    } else if (payload.kind === 'path-history') {
      expected = pathHistory(payload.path, payload.limit, payload.skip)
    } else throw new Error('Invalid history receipt kind')
    if (!isDeepStrictEqual(payload, expected)) throw new Error('History receipt differs from immutable repository state: ' + (receipt.id || payload.kind))
  }
  return { commitMeta, diff, pathHistory, verify }
}

export const HISTORY_BUDGET = Object.freeze({
  commitMeta: 12,
  diffs: 8,
  pathHistory: 6,
})

export {
  DEFAULT_MAX_LINES as HISTORY_DEFAULT_DIFF_LINES,
  DEFAULT_MAX_BYTES as HISTORY_DEFAULT_DIFF_BYTES,
  DEFAULT_PATH_HISTORY_LIMIT,
  MAX_PATH_HISTORY_LIMIT,
  HISTORY_DIFF_MAX_LINES,
  HISTORY_DIFF_MAX_BYTES,
}
