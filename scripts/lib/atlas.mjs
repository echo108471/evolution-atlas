import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

import { buildIdentityMatches } from './identity.mjs'
import { buildStructuralEpisodes } from '../../src/structure.mjs'

const GIT_MAX_BUFFER = 64 * 1024 * 1024

function runGit(repositoryPath, args) {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
  })
}

function tryGit(repositoryPath, args) {
  try {
    return runGit(repositoryPath, args)
  } catch {
    return null
  }
}

function stableId(namespace, value) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `${namespace}:${digest}`
}

function contributorKey(name, email) {
  const normalizedEmail = email.trim().toLocaleLowerCase('en-US')
  if (normalizedEmail) return `email:${normalizedEmail}`
  return `name:${name.trim().toLocaleLowerCase('en-US')}`
}

function isBotIdentity(name, email) {
  return (
    /\[bot\]$/i.test(name.trim()) ||
    /(?:^|[+._-])bot(?:@|[+._-])/i.test(email) ||
    /\bbot\b/i.test(name)
  )
}

function mailmapIdentityKey(repositoryPath, name, email, fallbackKey, pinnedRef = null) {
  // A pinned analysis must not borrow mappings from a later working-tree .mailmap.
  const options = pinnedRef
    ? ['-c', 'core.bare=true', '-c', 'mailmap.file=/dev/null', '-c', `mailmap.blob=${pinnedRef}:.mailmap`]
    : []
  const resolved = tryGit(repositoryPath, [...options, 'check-mailmap', `${name} <${email}>`])?.trim()
  if (!resolved) return fallbackKey
  const match = resolved.match(/^(.*)\s+<([^<>]+)>$/)
  if (!match) return fallbackKey
  return contributorKey(match[1], match[2])
}

function codeAreaForPath(path) {
  const separator = path.indexOf('/')
  if (separator === -1) {
    return { label: '(root)', pathPrefix: '' }
  }
  const pathPrefix = path.slice(0, separator)
  return { label: pathPrefix, pathPrefix }
}

function minDate(left, right) {
  return left <= right ? left : right
}

function maxDate(left, right) {
  return left >= right ? left : right
}

export function parseNameStatus(output) {
  const tokens = output.split('\0')
  const changes = []

  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index++]
    if (!rawStatus) continue

    const status = rawStatus.charAt(0)
    if (status === 'R' || status === 'C') {
      const previousPath = tokens[index++]
      const path = tokens[index++]
      if (!previousPath || !path) {
        throw new Error(`Incomplete ${rawStatus} record from git diff-tree`)
      }
      changes.push({ path, previousPath, status, similarity: rawStatus.slice(1) })
      continue
    }

    const path = tokens[index++]
    if (!path) throw new Error(`Incomplete ${rawStatus} record from git diff-tree`)
    changes.push({ path, status })
  }

  return changes
}

/** Long enough for a pull request title and a squashed commit list; short of a changelog. */
const MAX_BODY_CHARACTERS = 2000

function readCommit(repositoryPath, sha) {
  const rawMetadata = runGit(repositoryPath, [
    'show',
    '-s',
    '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00%b',
    sha,
  ])
  const fields = rawMetadata.split('\0')
  if (fields.length < 8) throw new Error(`Could not parse metadata for ${sha}`)

  const [commitSha, parents, authorName, authorEmail, authoredAt, committedAt, rawSubject] = fields
  const subject = rawSubject.trimEnd()
  // 72.4% of the pilot's first-parent commits carry a body, and 445 of those 535 are
  // merges whose body holds the pull request title - `Merge pull request #772 from
  // AggieWorks/feat/professor-subpage` has the body `feat: professor subpage`. The subject
  // channel was measurably the weakest evidence anywhere in the pipeline while the text
  // that would fix it was being thrown away at the first step.
  const body = fields.slice(7).join('\0').trim().slice(0, MAX_BODY_CHARACTERS)
  // `--diff-merges=first-parent`, not `--first-parent`. The latter silently emits nothing
  // at all for a merge commit, so every merge recorded zero changes and no code area -
  // 25.7% of the pilot history - while `analysis.mergeDiffStrategy` claimed otherwise.
  // Adding `-m` is not the fix either: it emits one section per parent, and with
  // `--no-commit-id` suppressing the separators the second parent's diff is
  // indistinguishable from the first's.
  const rawChanges = runGit(repositoryPath, [
    'diff-tree',
    '--root',
    '--diff-merges=first-parent',
    '--no-commit-id',
    '--name-status',
    '-r',
    '-z',
    '-M',
    sha,
  ])

  return {
    sha: commitSha,
    parentShas: parents ? parents.split(' ') : [],
    authorName,
    authorEmail,
    authoredAt,
    committedAt,
    subject,
    body,
    changes: parseNameStatus(rawChanges),
  }
}

export function buildAtlas(inputPath = '.', { ref = 'HEAD' } = {}) {
  const requestedPath = resolve(inputPath)
  const topLevel = runGit(requestedPath, ['rev-parse', '--show-toplevel']).trim()
  const headSha = runGit(topLevel, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  const repositoryRef = ref === 'HEAD'
    ? tryGit(topLevel, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() || 'HEAD'
    : ref
  const commitShas = runGit(topLevel, [
    'log',
    '--reverse',
    '--topo-order',
    '--format=%H',
    headSha,
  ])
    .split('\n')
    .filter(Boolean)

  // The first-parent chain is the history of the branch itself: what main looked like
  // over time. Commits off it are states main never had, and in a merge-PR workflow they
  // outnumber it three to one. Recorded per episode so an analysis pass can choose that
  // unit without the observed layer losing anything.
  const firstParentChain = new Set(
    runGit(topLevel, ['log', '--first-parent', '--format=%H', headSha]).split('\n').filter(Boolean),
  )

  const contributors = new Map()
  const identityRecords = new Map()
  const mailmapCache = new Map()
  const codeAreas = new Map()
  const episodes = []
  const relationships = []

  for (const sha of commitShas) {
    const commit = readCommit(topLevel, sha)
    const identityKey = contributorKey(commit.authorName, commit.authorEmail)
    const contributorId = stableId('contributor', identityKey)
    const existingContributor = contributors.get(contributorId)
    const mailmapCacheKey = `${commit.authorName}\0${commit.authorEmail}`
    let resolvedMailmapKey = mailmapCache.get(mailmapCacheKey)
    if (!resolvedMailmapKey) {
      resolvedMailmapKey = mailmapIdentityKey(
        topLevel,
        commit.authorName,
        commit.authorEmail,
        identityKey,
        ref === 'HEAD' ? null : headSha,
      )
      mailmapCache.set(mailmapCacheKey, resolvedMailmapKey)
    }

    if (existingContributor) {
      existingContributor.firstSeenAt = minDate(existingContributor.firstSeenAt, commit.authoredAt)
      existingContributor.lastSeenAt = maxDate(existingContributor.lastSeenAt, commit.authoredAt)
      if (!existingContributor.aliases.includes(commit.authorName)) {
        existingContributor.aliases.push(commit.authorName)
      }
      const identityRecord = identityRecords.get(contributorId)
      if (!identityRecord.names.includes(commit.authorName)) {
        identityRecord.names.push(commit.authorName)
      }
      identityRecord.mailmapKeys.add(resolvedMailmapKey)
    } else {
      contributors.set(contributorId, {
        id: contributorId,
        displayName: commit.authorName,
        aliases: [commit.authorName],
        isBot: isBotIdentity(commit.authorName, commit.authorEmail),
        firstSeenAt: commit.authoredAt,
        lastSeenAt: commit.authoredAt,
      })
      identityRecords.set(contributorId, {
        id: contributorId,
        names: [commit.authorName],
        email: commit.authorEmail,
        rawKey: identityKey,
        mailmapKeys: new Set([resolvedMailmapKey]),
        isBot: isBotIdentity(commit.authorName, commit.authorEmail),
      })
    }

    const episodeId = `episode:${commit.sha}`
    const areaEvidence = new Map()

    const recordAreaEvidence = (path) => {
      const area = codeAreaForPath(path)
      const areaId = stableId('area', area.pathPrefix)
      const existingArea = codeAreas.get(areaId)

      if (existingArea) {
        existingArea.firstSeenAt = minDate(existingArea.firstSeenAt, commit.authoredAt)
        existingArea.lastSeenAt = maxDate(existingArea.lastSeenAt, commit.authoredAt)
      } else {
        codeAreas.set(areaId, {
          id: areaId,
          label: area.label,
          pathPrefix: area.pathPrefix,
          classification: 'top-level-path',
          firstSeenAt: commit.authoredAt,
          lastSeenAt: commit.authoredAt,
        })
      }

      const paths = areaEvidence.get(areaId) ?? []
      if (!paths.includes(path)) paths.push(path)
      areaEvidence.set(areaId, paths)
    }

    for (const change of commit.changes) {
      recordAreaEvidence(change.path)
      if (change.previousPath) recordAreaEvidence(change.previousPath)
    }

    episodes.push({
      id: episodeId,
      commitSha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      subject: commit.subject,
      ...(commit.body ? { body: commit.body } : {}),
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      parentShas: commit.parentShas,
      contributorIds: [contributorId],
      firstParent: firstParentChain.has(commit.sha),
      codeAreaIds: [...areaEvidence.keys()].sort(),
      changes: commit.changes,
      interpretationStatus: 'observed',
    })

    relationships.push({
      id: `authored:${contributorId}:${commit.sha}`,
      sourceId: contributorId,
      targetId: episodeId,
      kind: 'authored',
      interpretationStatus: 'observed',
      confidence: 1,
      evidence: [{ commitSha: commit.sha }],
    })

    for (const [areaId, paths] of [...areaEvidence.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      relationships.push({
        id: `touched:${commit.sha}:${areaId}`,
        sourceId: episodeId,
        targetId: areaId,
        kind: 'touched',
        interpretationStatus: 'observed',
        confidence: 1,
        evidence: [{ commitSha: commit.sha, paths: [...paths].sort() }],
      })
    }
  }

  const orderedContributors = [...contributors.values()]
    .map((contributor) => ({
      ...contributor,
      aliases: [...contributor.aliases].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const orderedAreas = [...codeAreas.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  )
  const identityMatches = buildIdentityMatches([...identityRecords.values()])
  const structuralEpisodes = buildStructuralEpisodes(episodes)

  return {
    schemaVersion: '0.3.0',
    analysis: {
      mode: 'observed-only',
      historyRange: ref,
      mergeDiffStrategy: 'diff-merges-first-parent',
    },
    repository: {
      name: basename(topLevel),
      ref: repositoryRef,
      headSha,
      commitCount: episodes.length,
    },
    timeRange: {
      firstAuthoredAt: episodes[0]?.authoredAt ?? null,
      lastAuthoredAt: episodes.at(-1)?.authoredAt ?? null,
    },
    contributors: orderedContributors,
    identityMatches,
    structuralEpisodes,
    episodes,
    codeAreas: orderedAreas,
    featureCandidates: [],
    semanticEpisodes: [],
    relationships,
  }
}
