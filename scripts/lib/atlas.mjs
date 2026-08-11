import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

const GIT_MAX_BUFFER = 64 * 1024 * 1024

function runGit(repositoryPath, args) {
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
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

function readCommit(repositoryPath, sha) {
  const rawMetadata = runGit(repositoryPath, [
    'show',
    '-s',
    '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%s',
    sha,
  ])
  const fields = rawMetadata.split('\0')
  if (fields.length < 7) throw new Error(`Could not parse metadata for ${sha}`)

  const [commitSha, parents, authorName, authorEmail, authoredAt, committedAt] = fields
  const subject = fields.slice(6).join('\0').trimEnd()
  const rawChanges = runGit(repositoryPath, [
    'diff-tree',
    '--root',
    '--first-parent',
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
    changes: parseNameStatus(rawChanges),
  }
}

export function buildAtlas(inputPath = '.') {
  const requestedPath = resolve(inputPath)
  const topLevel = runGit(requestedPath, ['rev-parse', '--show-toplevel']).trim()
  const headSha = runGit(topLevel, ['rev-parse', '--verify', 'HEAD']).trim()
  const ref = tryGit(topLevel, ['symbolic-ref', '--short', '-q', 'HEAD'])?.trim() || 'HEAD'
  const commitShas = runGit(topLevel, [
    'log',
    '--reverse',
    '--topo-order',
    '--format=%H',
    'HEAD',
  ])
    .split('\n')
    .filter(Boolean)

  const contributors = new Map()
  const codeAreas = new Map()
  const episodes = []
  const relationships = []

  for (const sha of commitShas) {
    const commit = readCommit(topLevel, sha)
    const identityKey = contributorKey(commit.authorName, commit.authorEmail)
    const contributorId = stableId('contributor', identityKey)
    const existingContributor = contributors.get(contributorId)

    if (existingContributor) {
      existingContributor.firstSeenAt = minDate(existingContributor.firstSeenAt, commit.authoredAt)
      existingContributor.lastSeenAt = maxDate(existingContributor.lastSeenAt, commit.authoredAt)
      if (!existingContributor.aliases.includes(commit.authorName)) {
        existingContributor.aliases.push(commit.authorName)
      }
    } else {
      contributors.set(contributorId, {
        id: contributorId,
        displayName: commit.authorName,
        aliases: [commit.authorName],
        isBot: isBotIdentity(commit.authorName, commit.authorEmail),
        firstSeenAt: commit.authoredAt,
        lastSeenAt: commit.authoredAt,
      })
    }

    const episodeId = `episode:${commit.sha}`
    const areaEvidence = new Map()

    for (const change of commit.changes) {
      const area = codeAreaForPath(change.path)
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
      paths.push(change.path)
      areaEvidence.set(areaId, paths)
    }

    episodes.push({
      id: episodeId,
      commitSha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      subject: commit.subject,
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      parentShas: commit.parentShas,
      contributorIds: [contributorId],
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

  return {
    schemaVersion: '0.1.0',
    analysis: {
      mode: 'observed-only',
      historyRange: 'HEAD',
      mergeDiffStrategy: 'first-parent',
    },
    repository: {
      name: basename(topLevel),
      ref,
      headSha,
      commitCount: episodes.length,
    },
    timeRange: {
      firstAuthoredAt: episodes[0]?.authoredAt ?? null,
      lastAuthoredAt: episodes.at(-1)?.authoredAt ?? null,
    },
    contributors: orderedContributors,
    episodes,
    codeAreas: orderedAreas,
    featureCandidates: [],
    relationships,
  }
}
