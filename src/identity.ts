import type {
  AtlasDataset,
  Contributor,
  IdentityMatchCandidate,
  IdentityMatchSignal,
} from './model'

export type IdentityDecisionChoice = 'merged' | 'separate'

export interface IdentityDecision {
  matchId: string
  choice: IdentityDecisionChoice
}

export interface IdentityDecisionsDocument {
  schemaVersion: '0.1.0'
  repository: string
  decisions: IdentityDecision[]
}

export interface ContributorProfile extends Contributor {
  identityIds: string[]
  resolutionStatus: 'observed' | 'resolved'
}

export type EffectiveIdentityMatchState = 'suggested' | 'merged' | 'separate' | 'blocked'

export interface ResolvedIdentityMatch extends IdentityMatchCandidate {
  identities: [Contributor, Contributor]
  effectiveState: EffectiveIdentityMatchState
  decisionSource: 'user' | 'repository' | 'linked' | null
}

export interface IdentityResolution {
  profiles: ContributorProfile[]
  profileByIdentityId: Map<string, ContributorProfile>
  matches: ResolvedIdentityMatch[]
  suggestedCount: number
  mergedIdentityCount: number
  reviewedCount: number
}

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function identityMatchId(leftId: string, rightId: string) {
  const [left, right] = [leftId, rightId].sort()
  return `identity-match:${left}|${right}`
}

function fallbackNameMatches(contributors: Contributor[]): IdentityMatchCandidate[] {
  const matches: IdentityMatchCandidate[] = []
  for (let leftIndex = 0; leftIndex < contributors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contributors.length; rightIndex += 1) {
      const left = contributors[leftIndex]
      const right = contributors[rightIndex]
      if (left.isBot !== right.isBot) continue
      const leftNames = new Set(left.aliases.map(normalizeName).filter((name) => name.length >= 3))
      const rightNames = new Set(right.aliases.map(normalizeName).filter((name) => name.length >= 3))
      if (![...leftNames].some((name) => rightNames.has(name))) continue
      const signal: IdentityMatchSignal = {
        kind: 'exact-name',
        label: 'A normalized author name is identical across the two Git identities.',
        basis: 'observed',
        weight: 0.72,
      }
      matches.push({
        id: identityMatchId(left.id, right.id),
        identityIds: [left.id, right.id].sort() as [string, string],
        status: 'candidate',
        confidence: 0.72,
        method: 'viewer-name-fallback-v1',
        signals: [signal],
        conflicts: [],
      })
    }
  }
  return matches
}

function availableMatches(dataset: AtlasDataset) {
  const byId = new Map<string, IdentityMatchCandidate>()
  for (const match of fallbackNameMatches(dataset.contributors)) byId.set(match.id, match)
  for (const match of dataset.identityMatches ?? []) byId.set(match.id, match)
  return [...byId.values()].sort(
    (left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id),
  )
}

class IdentityGroups {
  private parent = new Map<string, string>()

  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id)
  }

  find(id: string): string {
    const parent = this.parent.get(id) ?? id
    if (parent === id) return id
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }

  members(root: string) {
    return [...this.parent.keys()].filter((id) => this.find(id) === root)
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot)
  }
}

function pairKey(left: string, right: string) {
  return [left, right].sort().join('|')
}

function profileId(identityIds: string[]) {
  if (identityIds.length === 1) return identityIds[0]
  return `profile:${identityIds
    .map((id) => id.replace(/^contributor:/, ''))
    .sort()
    .join('+')}`
}

function buildProfile(
  identities: Contributor[],
  episodeCounts: Map<string, number>,
): ContributorProfile {
  const ordered = [...identities].sort(
    (left, right) =>
      (episodeCounts.get(right.id) ?? 0) - (episodeCounts.get(left.id) ?? 0) ||
      left.displayName.localeCompare(right.displayName),
  )
  const aliases = [...new Set(identities.flatMap((identity) => identity.aliases))].sort((left, right) =>
    left.localeCompare(right),
  )
  const identityIds = identities.map((identity) => identity.id).sort()
  return {
    id: profileId(identityIds),
    displayName: ordered[0].displayName,
    aliases,
    isBot: identities.every((identity) => identity.isBot),
    firstSeenAt: identities.reduce(
      (earliest, identity) => (identity.firstSeenAt < earliest ? identity.firstSeenAt : earliest),
      identities[0].firstSeenAt,
    ),
    lastSeenAt: identities.reduce(
      (latest, identity) => (identity.lastSeenAt > latest ? identity.lastSeenAt : latest),
      identities[0].lastSeenAt,
    ),
    identityIds,
    resolutionStatus: identityIds.length > 1 ? 'resolved' : 'observed',
  }
}

export function emptyIdentityDecisions(repository: string): IdentityDecisionsDocument {
  return { schemaVersion: '0.1.0', repository, decisions: [] }
}

export function applyIdentityDecision(
  document: IdentityDecisionsDocument,
  matchId: string,
  choice: IdentityDecisionChoice | null,
): IdentityDecisionsDocument {
  const decisions = document.decisions.filter((decision) => decision.matchId !== matchId)
  if (choice) decisions.push({ matchId, choice })
  return { ...document, decisions }
}

export function parseIdentityDecisions(
  value: unknown,
  repository: string,
): IdentityDecisionsDocument {
  if (!value || typeof value !== 'object') throw new Error('The identity decisions file is not an object.')
  const candidate = value as Partial<IdentityDecisionsDocument>
  if (candidate.schemaVersion !== '0.1.0' || candidate.repository !== repository) {
    throw new Error('The identity decisions file belongs to a different repository or schema.')
  }
  if (!Array.isArray(candidate.decisions)) throw new Error('The decisions list is missing.')
  const decisions = candidate.decisions.map((decision) => {
    if (
      !decision ||
      typeof decision.matchId !== 'string' ||
      (decision.choice !== 'merged' && decision.choice !== 'separate')
    ) {
      throw new Error('The identity decisions file contains an invalid decision.')
    }
    return { matchId: decision.matchId, choice: decision.choice }
  })
  return { schemaVersion: '0.1.0', repository, decisions }
}

export function resolveIdentities(
  dataset: AtlasDataset,
  document: IdentityDecisionsDocument = emptyIdentityDecisions(dataset.repository.name),
): IdentityResolution {
  const contributorById = new Map(dataset.contributors.map((contributor) => [contributor.id, contributor]))
  const matches = availableMatches(dataset).filter((match) =>
    match.identityIds.every((id) => contributorById.has(id)),
  )
  const decisions = new Map(document.decisions.map((decision) => [decision.matchId, decision.choice]))
  const groups = new IdentityGroups(dataset.contributors.map((contributor) => contributor.id))
  const forbidden = new Set(
    matches
      .filter((match) => decisions.get(match.id) === 'separate')
      .map((match) => pairKey(...match.identityIds)),
  )
  const blockedMatches = new Set<string>()

  const mergeMatches = matches.filter(
    (match) => decisions.get(match.id) === 'merged' || (match.status === 'confirmed' && !decisions.has(match.id)),
  )
  for (const match of mergeMatches) {
    const [left, right] = match.identityIds
    const leftMembers = groups.members(groups.find(left))
    const rightMembers = groups.members(groups.find(right))
    const blocked = leftMembers.some((leftMember) =>
      rightMembers.some((rightMember) => forbidden.has(pairKey(leftMember, rightMember))),
    )
    if (blocked) blockedMatches.add(match.id)
    else groups.union(left, right)
  }

  const episodeCounts = new Map<string, number>()
  for (const episode of dataset.episodes) {
    for (const identityId of episode.contributorIds) {
      episodeCounts.set(identityId, (episodeCounts.get(identityId) ?? 0) + 1)
    }
  }
  const identitiesByRoot = new Map<string, Contributor[]>()
  for (const contributor of dataset.contributors) {
    const root = groups.find(contributor.id)
    const identities = identitiesByRoot.get(root) ?? []
    identities.push(contributor)
    identitiesByRoot.set(root, identities)
  }
  const profiles = [...identitiesByRoot.values()]
    .map((identities) => buildProfile(identities, episodeCounts))
    .sort(
      (left, right) =>
        Number(left.isBot) - Number(right.isBot) || left.displayName.localeCompare(right.displayName),
    )
  const profileByIdentityId = new Map<string, ContributorProfile>()
  for (const profile of profiles) {
    for (const identityId of profile.identityIds) profileByIdentityId.set(identityId, profile)
  }

  const resolvedMatches: ResolvedIdentityMatch[] = matches.map((match) => {
    const userDecision = decisions.get(match.id)
    const isLinked = groups.find(match.identityIds[0]) === groups.find(match.identityIds[1])
    const effectiveState: EffectiveIdentityMatchState = blockedMatches.has(match.id)
      ? 'blocked'
      : userDecision === 'separate'
        ? 'separate'
        : userDecision === 'merged' || match.status === 'confirmed' || isLinked
          ? 'merged'
          : 'suggested'
    const decisionSource = userDecision
      ? 'user'
      : match.status === 'confirmed'
        ? 'repository'
        : isLinked
          ? 'linked'
          : null
    return {
      ...match,
      identities: [contributorById.get(match.identityIds[0])!, contributorById.get(match.identityIds[1])!],
      effectiveState,
      decisionSource,
    }
  })

  return {
    profiles,
    profileByIdentityId,
    matches: resolvedMatches,
    suggestedCount: resolvedMatches.filter((match) => match.effectiveState === 'suggested').length,
    mergedIdentityCount: profiles.reduce(
      (count, profile) => count + Math.max(0, profile.identityIds.length - 1),
      0,
    ),
    reviewedCount: resolvedMatches.filter(
      (match) => match.effectiveState === 'merged' || match.effectiveState === 'separate',
    ).length,
  }
}
