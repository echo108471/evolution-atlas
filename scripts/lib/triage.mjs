/**
 * Tier 0: decide what deserves a model request, using only what the analyzer already
 * observed. No network, no key, no cost.
 *
 * This exists because 38.1% of zod's subjects and a comparable share of the pilot's are
 * structurally incapable of being a capability - merges, releases, docs, lockfile bumps.
 * Feature discovery currently reads all of it. Removing that share before the expensive
 * tiers is the cheapest improvement available to the pipeline.
 *
 * Every classification records a `basis`:
 *
 *   structural - provable from the change list. "Changed only .md files" is a fact.
 *   pattern    - guessed from subject text. "Subject starts with 'chore:'" is a
 *                convention the author may not follow, and a wrong guess here silently
 *                removes a commit from the entire atlas.
 *
 * The distinction is not decoration. Structural findings can be trusted to skip a
 * commit; pattern findings are held to a higher bar (see `classify`) precisely because
 * a commit dropped at tier 0 is never seen again.
 */

/** Paths that document rather than implement. */
const DOC_PATH = /(^|\/)(readme|license|licence|changelog|contributing|code_of_conduct|authors|notice)(\.[\w-]+)?$/i
const DOC_EXTENSION = /\.(md|mdx|markdown|rst|txt|adoc)$/i
const DOC_DIRECTORY = /(^|\/)(docs?|documentation|website|\.github\/issue_template)(\/|$)/i

/** Dependency manifests and lockfiles: churn with no authored intent. */
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|gemfile\.lock|poetry\.lock|cargo\.lock|go\.sum|requirements\.txt|uv\.lock)$/i

/** Build output and vendored code: present in the tree, not written by hand. */
const GENERATED = /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage|__snapshots__)(\/|$)|\.(min\.js|min\.css|map|snap)$/i

/** Formatting, linting, and pipeline configuration. */
const CHORE_PATH = /(^|\/)(\.github\/workflows|\.circleci|\.husky|\.vscode|\.idea)(\/|$)|(^|\/)(\.eslintrc|\.prettierrc|\.editorconfig|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.dockerignore)/i

const RELEASE_SUBJECT = /^\s*(v?\d+\.\d+\.\d+|release|bump version|publish|chore\(release\)|\d+\.\d+\.\d+)/i
const VERSION_BUMP_SUBJECT = /\b(bump|update|upgrade)\b.*\bversion\b|\bversion\b.*\bbump\b/i
const DEPENDENCY_SUBJECT = /^\s*(chore\(deps[^)]*\)|build\(deps[^)]*\)|bump\s+\S+\s+from\s+\S+\s+to\s+)/i
const CHORE_SUBJECT = /^\s*(chore|style|ci|build|format|lint)(\([^)]*\))?[:!]/i
const DOCS_SUBJECT = /^\s*docs?(\([^)]*\))?[:!]/i
const REVERT_SUBJECT = /^\s*revert\b/i
const MERGE_SUBJECT = /^\s*merge\s+(branch|pull request|remote-tracking)\b/i

const every = (changes, predicate) => changes.length > 0 && changes.every(predicate)

const pathsOf = (change) => (change.previousPath ? [change.path, change.previousPath] : [change.path])

const matchesEvery = (changes, expression) =>
  every(changes, (change) => pathsOf(change).every((path) => expression.test(path)))

const isDocPath = (path) => DOC_PATH.test(path) || DOC_EXTENSION.test(path) || DOC_DIRECTORY.test(path)

/**
 * Classify one episode. Returns the class, whether it is worth a model request, and the
 * signals that decided it - the signals are kept so a maintainer can see why a commit
 * was dropped rather than having to trust the outcome.
 */
export function classify(episode) {
  const changes = episode.changes ?? []
  const subject = episode.subject ?? ''
  const isMerge = (episode.parentShas ?? []).length > 1
  const signals = []
  const add = (basis, label) => signals.push({ basis, label })

  // A merge with no first-parent diff introduced no change of its own. This is provable,
  // not inferred: the analyzer recorded zero file changes for it.
  if (changes.length === 0) {
    add('structural', isMerge ? 'merge with no first-parent diff' : 'no file changes recorded')
    return { class: isMerge ? 'merge' : 'empty', substantive: false, signals }
  }

  if (matchesEvery(changes, GENERATED)) {
    add('structural', 'every path is build output or vendored')
    return { class: 'generated', substantive: false, signals }
  }

  if (every(changes, (change) => pathsOf(change).every(isDocPath))) {
    add('structural', 'every path is documentation')
    return { class: 'docs', substantive: false, signals }
  }

  if (matchesEvery(changes, LOCKFILE)) {
    add('structural', 'every path is a dependency manifest or lockfile')
    return { class: 'dependencies', substantive: false, signals }
  }

  if (matchesEvery(changes, CHORE_PATH)) {
    add('structural', 'every path is tooling or pipeline configuration')
    return { class: 'chore', substantive: false, signals }
  }

  // Subject-only evidence from here down. A commit whose paths touch real source is
  // kept whatever its subject says, because the subject is a convention and the diff is
  // a fact; a mislabeled `chore:` that edits the parser is exactly the commit this
  // pipeline exists to find.
  if (REVERT_SUBJECT.test(subject)) {
    add('pattern', 'subject announces a revert')
    // Reverts stay substantive on purpose. Undoing work is a lifecycle event, and the
    // lifecycle pass reports `removed` and `migrated` stages it currently rarely fills.
    return { class: 'revert', substantive: true, signals }
  }

  if (MERGE_SUBJECT.test(subject) && isMerge) {
    add('pattern', 'subject is a merge announcement')
    add('structural', 'commit has multiple parents')
    // A merge that carries a first-parent diff resolved conflicts by hand. That is
    // authored work, so it survives; the class is kept for reporting.
    return { class: 'merge', substantive: true, signals }
  }

  if (DEPENDENCY_SUBJECT.test(subject)) {
    add('pattern', 'subject follows the dependency-bump convention')
    return { class: 'dependencies', substantive: false, signals }
  }

  if (RELEASE_SUBJECT.test(subject) || VERSION_BUMP_SUBJECT.test(subject)) {
    add('pattern', 'subject is a release or version bump')
    return { class: 'release', substantive: false, signals }
  }

  if (DOCS_SUBJECT.test(subject)) {
    add('pattern', 'subject follows the docs convention')
    // Paths already proved this touches non-doc files, so the subject is describing
    // itself badly. Keep it.
    return { class: 'code', substantive: true, signals }
  }

  if (CHORE_SUBJECT.test(subject)) {
    add('pattern', 'subject follows the chore convention')
    return { class: 'code', substantive: true, signals }
  }

  add('structural', 'changes source files with no exclusion matched')
  return { class: 'code', substantive: true, signals }
}

/**
 * Classify a whole dataset. The counts are the point: a run should report what it
 * removed before it reports what it found.
 */
export function triage(episodes) {
  const results = episodes.map((episode) => ({
    id: episode.id,
    commitSha: episode.commitSha,
    ...classify(episode),
  }))

  const counts = {}
  for (const result of results) {
    counts[result.class] = (counts[result.class] ?? 0) + 1
  }

  const substantive = results.filter((result) => result.substantive)
  return {
    results,
    counts,
    substantiveCount: substantive.length,
    filteredCount: results.length - substantive.length,
    filteredShare: results.length === 0 ? 0 : (results.length - substantive.length) / results.length,
  }
}

/** The indices a later tier should spend requests on, oldest first. */
export function substantiveIndices(episodes) {
  const indices = []
  episodes.forEach((episode, index) => {
    if (classify(episode).substantive) indices.push(index)
  })
  return indices
}
