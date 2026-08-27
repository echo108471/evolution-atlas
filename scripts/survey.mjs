#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

// Mirrors the corpus bounds in scripts/lib/interpret.mjs so the token estimate
// reflects what interpretation would actually send.
const MAX_PATHS_PER_COMMIT = 12
const MAX_SUBJECT_LENGTH = 160

// Rough characters-per-token ratio. Paths and SHAs tokenize worse than prose,
// so treat the resulting estimate as a floor rather than a measurement.
const CHARS_PER_TOKEN = 3.6

const GIT_MAX_BUFFER = 512 * 1024 * 1024

const BOT_PATTERN =
  /\[bot\]|dependabot|renovate|greenkeeper|github-action|semantic-release|actions@github/i
const CONVENTIONAL_PATTERN =
  /^(feat|fix|chore|docs|refactor|test|tests|build|ci|perf|style|revert)(\([^)]*\))?!?:\s/i
const TERSE_SUBJECT_LENGTH = 15

function usage() {
  return `Usage: npm run survey -- [options] <repo> [repo...]

Reports the observable properties that determine whether a repository is a
useful analysis subject. Uses Git only; no model credential is required and
no dataset is written.

Options:
  --json          Emit JSON instead of a table
  --help          Show this help
`
}

function parseArguments(argv) {
  const options = { repositoryPaths: [], json: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--json') {
      options.json = true
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
    options.repositoryPaths.push(argument)
  }

  return options
}

function runGit(repositoryPath, args) {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function readCommits(repositoryPath) {
  // --diff-merges=first-parent matches how the analyzer represents merges.
  const raw = runGit(repositoryPath, [
    'log',
    '--no-color',
    '--name-status',
    '--diff-merges=first-parent',
    '--format=%x01%H%x00%aI%x00%aE%x00%aN%x00%P%x00%s',
  ])

  const commits = []
  for (const record of raw.split('\x01').slice(1)) {
    const breakIndex = record.indexOf('\n')
    const header = breakIndex === -1 ? record : record.slice(0, breakIndex)
    const body = breakIndex === -1 ? '' : record.slice(breakIndex + 1)
    const [sha, authoredAt, email, author, parents, subject] = header.split('\x00')

    const paths = []
    let renameCount = 0
    for (const line of body.split('\n')) {
      if (!line.trim()) continue
      const fields = line.split('\t')
      const status = fields[0]
      if (status.startsWith('R')) {
        renameCount += 1
        paths.push(fields[2] ?? fields[1])
      } else if (fields[1]) {
        paths.push(fields[1])
      }
    }

    commits.push({
      sha,
      authoredAt,
      email: (email ?? '').trim().toLocaleLowerCase('en-US'),
      author: (author ?? '').trim(),
      parentCount: (parents ?? '').trim() ? parents.trim().split(' ').length : 0,
      subject: subject ?? '',
      paths,
      renameCount,
    })
  }

  return commits
}

/**
 * Rebuilds the interpretation corpus exactly as scripts/lib/interpret.mjs does,
 * so the token estimate is comparable to a real interpretation run.
 */
function estimateCorpusTokens(commits) {
  const lines = []
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    const commit = commits[index]
    const subject = commit.subject.slice(0, MAX_SUBJECT_LENGTH)
    lines.push(`${commit.sha.slice(0, 8)} ${commit.authoredAt.slice(0, 10)} ${subject}`)
    if (commit.paths.length === 0) continue
    const shown = commit.paths.slice(0, MAX_PATHS_PER_COMMIT)
    const remaining = commit.paths.length - shown.length
    const suffix = remaining > 0 ? ` (+${remaining} more)` : ''
    lines.push(`    ${shown.join(' ')}${suffix}`)
  }
  return Math.round(lines.join('\n').length / CHARS_PER_TOKEN)
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function isBot(commit) {
  return BOT_PATTERN.test(commit.email) || BOT_PATTERN.test(commit.author)
}

function surveyRepository(repositoryPath) {
  const resolved = resolve(repositoryPath)
  const commits = readCommits(resolved)
  if (commits.length === 0) throw new Error(`No commits found in ${resolved}`)

  const emails = new Set(commits.map((commit) => commit.email))
  const botCommits = commits.filter(isBot)
  const botEmails = new Set(botCommits.map((commit) => commit.email))
  const dates = commits.map((commit) => commit.authoredAt).sort()
  const firstAuthoredAt = dates[0]
  const lastAuthoredAt = dates[dates.length - 1]
  const spanYears =
    (new Date(lastAuthoredAt) - new Date(firstAuthoredAt)) / (365.25 * 24 * 3600 * 1000)

  let topLevelDirectories = 0
  try {
    topLevelDirectories = runGit(resolved, ['ls-tree', '-d', '--name-only', 'HEAD'])
      .split('\n')
      .filter(Boolean).length
  } catch {
    topLevelDirectories = 0
  }

  const share = (count) => Number(((count / commits.length) * 100).toFixed(1))

  return {
    name: basename(resolved).replace(/\.git$/, ''),
    commitCount: commits.length,
    firstAuthoredAt,
    lastAuthoredAt,
    spanYears: Number(spanYears.toFixed(1)),
    authorIdentityCount: emails.size,
    humanIdentityCount: emails.size - botEmails.size,
    botCommitShare: share(botCommits.length),
    mergeCommitShare: share(commits.filter((commit) => commit.parentCount >= 2).length),
    conventionalSubjectShare: share(
      commits.filter((commit) => CONVENTIONAL_PATTERN.test(commit.subject)).length,
    ),
    terseSubjectShare: share(
      commits.filter((commit) => commit.subject.trim().length < TERSE_SUBJECT_LENGTH).length,
    ),
    medianSubjectLength: median(commits.map((commit) => commit.subject.length)),
    renameRecordCount: commits.reduce((total, commit) => total + commit.renameCount, 0),
    topLevelDirectories,
    estimatedCorpusTokens: estimateCorpusTokens(commits),
  }
}

const COLUMNS = [
  ['repo', 'name'],
  ['commits', 'commitCount'],
  ['span', 'spanYears'],
  ['ids', 'authorIdentityCount'],
  ['bot%', 'botCommitShare'],
  ['merge%', 'mergeCommitShare'],
  ['conv%', 'conventionalSubjectShare'],
  ['terse%', 'terseSubjectShare'],
  ['medSubj', 'medianSubjectLength'],
  ['renames', 'renameRecordCount'],
  ['dirs', 'topLevelDirectories'],
  ['corpusTok', 'estimatedCorpusTokens'],
]

function renderTable(rows) {
  const widths = COLUMNS.map(([heading, key]) =>
    Math.max(heading.length, ...rows.map((row) => String(row[key]).length)),
  )
  const lines = [
    COLUMNS.map(([heading], index) => heading.padStart(widths[index])).join('  '),
    widths.map((width) => '-'.repeat(width)).join('  '),
  ]
  for (const row of rows) {
    lines.push(COLUMNS.map(([, key], index) => String(row[key]).padStart(widths[index])).join('  '))
  }
  return lines.join('\n')
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help || options.repositoryPaths.length === 0) {
    process.stdout.write(usage())
    process.exit(options.help ? 0 : 1)
  }

  const rows = options.repositoryPaths
    .map(surveyRepository)
    .sort((left, right) => left.commitCount - right.commitCount)

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
  } else {
    process.stdout.write(`${renderTable(rows)}\n`)
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
