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

export const DEFAULT_MAX_LINES = 400
export const DEFAULT_CONTEXT_LINES = 3

function runGit(repositoryPath, args) {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
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
    'diff-tree', '--root', '--first-parent', '--no-commit-id', '--numstat', '-r', '-M', '-z', sha,
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

function readPatch(repositoryPath, sha, paths, contextLines) {
  const args = [
    'diff-tree', '--root', '--first-parent', '--no-commit-id', '-p', '-r', '-M',
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
export function readCommitDiff(repositoryPath, sha, { maxLines = DEFAULT_MAX_LINES, contextLines = DEFAULT_CONTEXT_LINES } = {}) {
  const files = readNumstat(repositoryPath, sha)
  const totalLines = files.reduce((sum, file) => sum + file.added + file.deleted, 0)

  if (files.length === 0) {
    return { text: '', files, totalLines: 0, truncated: false, included: [], omitted: [], binaryCount: 0 }
  }

  const binaryCount = files.filter((file) => file.binary).length
  const textFiles = files.filter((file) => !file.binary)

  if (totalLines <= maxLines) {
    return {
      text: readPatch(repositoryPath, sha, [], contextLines),
      files,
      totalLines,
      truncated: false,
      included: textFiles.map((file) => file.path),
      omitted: [],
      binaryCount,
    }
  }

  // Smallest first: in a rewrite the big file is usually generated and the small one
  // carries the authored intent.
  const ordered = [...textFiles].sort(
    (left, right) => left.added + left.deleted - (right.added + right.deleted),
  )

  const included = []
  let budget = maxLines
  for (const file of ordered) {
    const size = file.added + file.deleted
    if (size > budget) break
    budget -= size
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
    truncated: true,
    included,
    omitted: omitted.map((file) => file.path),
    binaryCount,
  }
}
