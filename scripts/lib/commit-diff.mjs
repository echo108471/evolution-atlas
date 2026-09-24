/**
 * Read a commit's diff from the repository, bounded.
 *
 * Diff volume is dominated by a handful of outliers: on zod, half of all commits change
 * 17 lines or fewer, while a 400-line cap removes 77% of the total volume. So most
 * commits can be sent whole and cost almost nothing, and the cap only ever engages on
 * rewrites, lockfiles, and generated output.
 *
 * When it does engage, the answer is not to truncate mid-patch. A p99 commit is usually
 * a migration or a rewrite - exactly what the lifecycle pass most wants to catch - so an
 * oversized commit is rendered as a per-file summary plus the full text of whichever
 * files fit. Small files are admitted first, because the large file in a rewrite is
 * typically generated output while the small one carries the intent.
 *
 * Diffs are never written into the atlas. They are read on demand during an analysis run
 * and discarded, because they are large and contain source that has no business in a
 * distributable dataset.
 */

import { execFileSync } from 'node:child_process'

const GIT_MAX_BUFFER = 256 * 1024 * 1024

// Read the object named by the receipt, independent of caller configuration,
// replacement refs, lazy fetches, and external diff or text conversion tools.
function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
}
const gitArguments = repositoryPath => ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repositoryPath]

export const DEFAULT_MAX_LINES = 400
export const DEFAULT_CONTEXT_LINES = 3

/**
 * A byte ceiling alongside the line ceiling, because a line count says nothing about
 * line length. A single-line minified dataset in the pilot reports one changed line and
 * emits 12.87 MB of patch - and being "one line" it was the first file the smallest-first
 * rule admitted, so the budget selected the worst possible file and sent 3.2 million
 * tokens to a 1.3 million token endpoint.
 */
export const DEFAULT_MAX_BYTES = 64 * 1024

function runGit(repositoryPath, args) {
  return execFileSync('git', [...gitArguments(repositoryPath), ...args], {
    env: gitEnvironment(),
    timeout: 30_000,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Per-file added/deleted counts. Read before any patch text so an oversized commit can
 * be recognized without loading it - the largest commit in the pilot corpus is 106,221
 * lines, which is not something to pull into memory to then discard.
 */
export function readNumstat(repositoryPath, sha) {
  const raw = runGit(repositoryPath, [
    'diff-tree', '--root', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv', '--no-commit-id', '--numstat', '-r', '-M', '-z', sha,
  ])

  const tokens = raw.split('\0')
  const files = []
  for (let index = 0; index < tokens.length; ) {
    const record = tokens[index++]
    if (!record) continue
    const match = record.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (!match) continue
    const [, addedRaw, deletedRaw, inlinePath] = match
    const binary = addedRaw === '-' || deletedRaw === '-'

    // A rename emits an empty path field and two NUL-separated paths after it.
    let path = inlinePath
    let previousPath = null
    if (inlinePath === '') {
      previousPath = tokens[index++] ?? null
      path = tokens[index++] ?? ''
    }

    files.push({
      path,
      previousPath,
      added: binary ? 0 : Number.parseInt(addedRaw, 10),
      deleted: binary ? 0 : Number.parseInt(deletedRaw, 10),
      binary,
    })
  }
  return files
}

/**
 * Byte sizes for the blobs on both sides of each change, read in two cheap calls. The sum
 * bounds how much patch text a file can produce, which numstat cannot tell us.
 */
export function readBlobSizes(repositoryPath, sha) {
  const raw = runGit(repositoryPath, [
    'diff-tree', '--root', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv', '--no-commit-id', '--raw', '-r', '-M', '-z', sha,
  ])

  const tokens = raw.split('\0')
  const entries = []
  const wanted = new Set()
  for (let index = 0; index < tokens.length; ) {
    const meta = tokens[index++]
    if (!meta || !meta.startsWith(':')) continue
    const fields = meta.slice(1).split(' ')
    if (fields.length < 5) continue
    const [, , oldBlob, newBlob, status] = fields
    const isRename = status.startsWith('R') || status.startsWith('C')
    if (isRename) index += 1
    const path = tokens[index++]
    if (!path) continue
    for (const blob of [oldBlob, newBlob]) {
      if (/^0+$/.test(blob)) continue
      wanted.add(blob)
    }
    entries.push({ path, oldBlob, newBlob })
  }

  const sizes = new Map()
  if (wanted.size > 0) {
    const output = execFileSync('git', [...gitArguments(repositoryPath), 'cat-file', '--batch-check=%(objectname) %(objectsize)'], {
      env: gitEnvironment(),
      timeout: 30_000,
      input: `${[...wanted].join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    for (const line of output.split('\n')) {
      const [name, size] = line.split(' ')
      if (name && size) sizes.set(name, Number.parseInt(size, 10) || 0)
    }
  }

  const byPath = new Map()
  for (const entry of entries) {
    byPath.set(entry.path, (sizes.get(entry.oldBlob) ?? 0) + (sizes.get(entry.newBlob) ?? 0))
  }
  return byPath
}

function readPatch(repositoryPath, sha, paths, contextLines) {
  const args = [
    'diff-tree', '--root', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv', '--no-commit-id', '-p', '-r', '-M',
    `--unified=${contextLines}`, '--no-color', sha,
  ]
  if (paths.length > 0) args.push('--', ...paths)
  return runGit(repositoryPath, args)
}

const summaryLine = (file) =>
  file.binary
    ? `  ${file.path}  (binary)`
    : `  ${file.path}  +${file.added} -${file.deleted}${file.previousPath ? `  (renamed from ${file.previousPath})` : ''}`

/**
 * Read one commit's diff under a line budget.
 *
 * Returns the patch text, whether the budget engaged, and - when it did - the summary
 * that stands in for the files that did not fit. `omitted` is reported rather than
 * hidden: a tier that saw a partial diff should be able to say so.
 */
export function readCommitDiff(repositoryPath, sha, { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES, contextLines = DEFAULT_CONTEXT_LINES, paths = null } = {}) {
  let files = readNumstat(repositoryPath, sha)
  if (Array.isArray(paths)) {
    const wanted = new Set(paths)
    files = files.filter((file) => wanted.has(file.path) || (file.previousPath && wanted.has(file.previousPath)))
  }
  const totalLines = files.reduce((sum, file) => sum + file.added + file.deleted, 0)

  if (files.length === 0) {
    return { text: '', files, totalLines: 0, totalBytes: 0, truncated: false, included: [], omitted: [], binaryCount: 0 }
  }

  const blobSizes = readBlobSizes(repositoryPath, sha)
  const sizeOf = (file) => blobSizes.get(file.path) ?? 0
  const totalBytes = files.reduce((sum, file) => sum + sizeOf(file), 0)

  const binaryCount = files.filter((file) => file.binary).length
  const textFiles = files.filter((file) => !file.binary)
  const patchPaths = Array.isArray(paths) ? files.map((file) => file.path) : []

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      text: readPatch(repositoryPath, sha, patchPaths, contextLines),
      files,
      totalLines,
      totalBytes,
      truncated: false,
      included: textFiles.map((file) => file.path),
      omitted: [],
      binaryCount,
    }
  }

  // Smallest first: in a rewrite the big file is usually generated and the small one
  // carries the authored intent. Ordered by bytes rather than lines, because the file
  // that broke this was one line long and 12.87 MB.
  const ordered = [...textFiles].sort((left, right) => sizeOf(left) - sizeOf(right))

  const included = []
  let lineBudget = maxLines
  let byteBudget = maxBytes
  for (const file of ordered) {
    const lines = file.added + file.deleted
    const bytes = sizeOf(file)
    if (lines > lineBudget || bytes > byteBudget) continue
    lineBudget -= lines
    byteBudget -= bytes
    included.push(file.path)
  }

  const omitted = files.filter((file) => !included.includes(file.path))
  const header = [
    `This commit changes ${totalLines} lines across ${files.length} files, over the ${maxLines}-line budget.`,
    'Every file it touches:',
    ...files.map(summaryLine),
    '',
    included.length > 0
      ? `Full text follows for ${included.length} of them; the rest are summarized above only.`
      : 'No single file fit the budget, so only the summary above is available.',
    '',
  ].join('\n')

  return {
    text: header + (included.length > 0 ? readPatch(repositoryPath, sha, included, contextLines) : ''),
    files,
    totalLines,
    totalBytes,
    truncated: true,
    included,
    omitted: omitted.map((file) => file.path),
    binaryCount,
  }
}
