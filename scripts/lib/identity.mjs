export const IDENTITY_MATCH_METHOD = 'deterministic-identity-v1'

const GENERIC_HANDLES = new Set([
  'admin',
  'contact',
  'dev',
  'developer',
  'git',
  'github',
  'hello',
  'info',
  'mail',
  'noreply',
  'root',
  'support',
  'team',
])

function compact(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function normalizedNames(record) {
  return new Set(record.names.map(compact).filter((name) => name.length >= 3))
}

function emailHandle(email) {
  const [local = '', domain = ''] = email.trim().toLocaleLowerCase('en-US').split('@')
  if (!local) return null
  if (domain === 'users.noreply.github.com') {
    const plusIndex = local.lastIndexOf('+')
    return compact(plusIndex === -1 ? local : local.slice(plusIndex + 1))
  }
  const withoutTag = local.split('+')[0]
  return compact(withoutTag)
}

function githubHandle(email) {
  const [local = '', domain = ''] = email.trim().toLocaleLowerCase('en-US').split('@')
  if (domain !== 'users.noreply.github.com') return null
  const plusIndex = local.lastIndexOf('+')
  return compact(plusIndex === -1 ? local : local.slice(plusIndex + 1))
}

function hasIntersection(left, right) {
  return [...left].some((value) => right.has(value))
}

export function identityMatchId(leftId, rightId) {
  const [left, right] = [leftId, rightId].sort()
  return `identity-match:${left}|${right}`
}

function proposedMatch(left, right) {
  if (left.id === right.id || left.isBot !== right.isBot) return null

  const leftNames = normalizedNames(left)
  const rightNames = normalizedNames(right)
  const leftHandle = emailHandle(left.email)
  const rightHandle = emailHandle(right.email)
  const leftGithub = githubHandle(left.email)
  const rightGithub = githubHandle(right.email)
  const signals = []

  const sameMailmapIdentity = hasIntersection(left.mailmapKeys, right.mailmapKeys)
  const explicitlyMapped =
    sameMailmapIdentity &&
    ([...left.mailmapKeys].some((key) => key !== left.rawKey) ||
      [...right.mailmapKeys].some((key) => key !== right.rawKey))
  if (explicitlyMapped) {
    signals.push({
      kind: 'mailmap',
      label: 'Repository .mailmap resolves both identities to one canonical contact.',
      basis: 'repository-config',
      weight: 1,
    })
  }

  const sameGithubAccount = Boolean(leftGithub && rightGithub && leftGithub === rightGithub)
  if (sameGithubAccount) {
    signals.push({
      kind: 'github-account',
      label: 'GitHub noreply metadata points to the same account handle.',
      basis: 'observed',
      weight: 0.96,
    })
  }

  const sameHandle = Boolean(
    leftHandle &&
      rightHandle &&
      leftHandle === rightHandle &&
      leftHandle.length >= 4 &&
      !GENERIC_HANDLES.has(leftHandle),
  )
  if (sameHandle && !sameGithubAccount) {
    signals.push({
      kind: 'email-handle',
      label: 'The private email identifiers have the same non-generic account handle.',
      basis: 'observed',
      weight: 0.82,
    })
  }

  const sameName = hasIntersection(leftNames, rightNames)
  if (sameName) {
    signals.push({
      kind: 'exact-name',
      label: 'A normalized author name is identical across the two Git identities.',
      basis: 'observed',
      weight: 0.72,
    })
  }

  const handles = new Set([leftHandle, rightHandle].filter(Boolean))
  const nameMatchesHandle = [...leftNames, ...rightNames].some((name) => handles.has(name))
  if (nameMatchesHandle && (sameName || sameHandle || sameGithubAccount)) {
    signals.push({
      kind: 'name-handle-alignment',
      label: 'An observed author name also aligns with an account handle.',
      basis: 'heuristic',
      weight: 0.12,
    })
  }

  if (signals.length === 0) return null

  const explicit = signals.some((signal) => signal.kind === 'mailmap')
  let confidence = Math.max(...signals.map((signal) => signal.weight))
  if (sameName && sameHandle) confidence = Math.max(confidence, 0.92)
  if (sameName && nameMatchesHandle) confidence = Math.max(confidence, 0.82)
  if (!explicit && confidence < 0.7) return null

  return {
    id: identityMatchId(left.id, right.id),
    identityIds: [left.id, right.id].sort(),
    status: explicit ? 'confirmed' : 'candidate',
    confidence: Number(confidence.toFixed(2)),
    method: IDENTITY_MATCH_METHOD,
    signals,
    conflicts: [],
  }
}

export function buildIdentityMatches(records) {
  const matches = []
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const match = proposedMatch(records[leftIndex], records[rightIndex])
      if (match) matches.push(match)
    }
  }
  return matches.sort(
    (left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id),
  )
}
