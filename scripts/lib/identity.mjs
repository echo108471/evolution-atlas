export const IDENTITY_MATCH_METHOD = 'deterministic-identity-v2'

/**
 * Role addresses rather than personal ones. Two people can both route `contact@` or
 * `accounts@` at their own domain, so a shared handle from this set says nothing about
 * identity. Observed in the surveyed repositories: `github@` joined eight unrelated
 * people and `mail@` joined four.
 */
const GENERIC_HANDLES = new Set([
  'accounts',
  'admin',
  'code',
  'contact',
  'dev',
  'developer',
  'email',
  'git',
  'github',
  'hello',
  'hi',
  'info',
  'mail',
  'me',
  'my',
  'noreply',
  'oss',
  'personal',
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

function emailDomain(email) {
  return email.trim().toLocaleLowerCase('en-US').split('@')[1] ?? ''
}

/** Display-name tokens, e.g. "Colin McDonnell" becomes ["colin", "mcdonnell"]. */
function nameTokens(record) {
  return record.names.flatMap((name) =>
    name
      .split(/[\s,]+/)
      .map(compact)
      .filter((token) => token.length >= 2),
  )
}

/** The last token of a multi-token name, used only to detect a disagreement. */
function surnames(record) {
  return new Set(
    record.names
      .map((name) => name.split(/[\s,]+/).map(compact).filter((token) => token.length >= 2))
      .filter((tokens) => tokens.length >= 2)
      .map((tokens) => tokens[tokens.length - 1]),
  )
}

/**
 * A handle equal to somebody's given name identifies a person far less than one derived
 * from their full name. `andreas@deininger.net` and `andreas@amsenius.se` are two people;
 * `colinmcd@mit.edu` and `colinmcd@alum.mit.edu` are one. The difference is that
 * "andreas" is a single token of a longer display name while "colinmcd" is not a token of
 * anything — it was built from the whole name. Measured on zod, this distinction accounts
 * for every cross-domain handle collision that joined two unrelated contributors.
 */
function isGivenNameHandle(handle, left, right) {
  for (const record of [left, right]) {
    for (const name of record.names) {
      const tokens = name.split(/[\s,]+/).map(compact).filter((token) => token.length >= 2)
      if (tokens.length >= 2 && tokens.includes(handle)) return true
      if (tokens.length === 1 && tokens[0] === handle) return true
    }
  }
  return false
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

  // One address used under two display names is one Git account that was renamed, which is
  // stronger evidence than anything derived from the parts of an address.
  const sameAddress =
    left.email.trim().toLocaleLowerCase('en-US') === right.email.trim().toLocaleLowerCase('en-US')
  if (sameAddress) {
    signals.push({
      kind: 'same-address',
      label: 'Both identities author from the same email address under different names.',
      basis: 'observed',
      weight: 0.97,
    })
  }

  const sharedHandle =
    leftHandle && rightHandle && leftHandle === rightHandle ? leftHandle : null
  const usableHandle = Boolean(
    sharedHandle && sharedHandle.length >= 4 && !GENERIC_HANDLES.has(sharedHandle),
  )
  const givenNameHandle = usableHandle && isGivenNameHandle(sharedHandle, left, right)
  const sameDomain = emailDomain(left.email) === emailDomain(right.email)

  // A handle built from a whole name identifies an account. A handle that is merely
  // somebody's given name does not, unless the addresses also share a domain.
  const sameHandle = usableHandle && (!givenNameHandle || sameDomain)
  if (sameHandle && !sameGithubAccount && !sameAddress) {
    signals.push({
      kind: 'email-handle',
      label: givenNameHandle
        ? 'Both addresses share an account handle at the same domain.'
        : 'The private email identifiers have the same non-generic account handle.',
      basis: 'observed',
      weight: 0.86,
    })
  }

  const sameName = hasIntersection(leftNames, rightNames)
  // A full name collides far less often than a single given name. "Colin McDonnell"
  // appearing twice is good evidence; "Ernest" appearing twice is close to none. A long
  // single token is a full name with the space removed — "EthanBehrends" identifies a
  // person the way "Ernest" does not — so length stands in for a token count of one.
  const FULL_NAME_LENGTH = 10
  const multiTokenName =
    sameName &&
    [...leftNames].some(
      (name) =>
        rightNames.has(name) &&
        (name.length >= FULL_NAME_LENGTH ||
          [left, right].some((record) =>
            record.names.some(
              (raw) =>
                compact(raw) === name &&
                raw.split(/[\s,]+/).filter((token) => compact(token).length >= 2).length >= 2,
            ),
          )),
    )
  if (sameName) {
    signals.push({
      kind: 'exact-name',
      label: multiTokenName
        ? 'A normalized full author name is identical across the two Git identities.'
        : 'A single-token author name is identical across the two Git identities.',
      basis: 'observed',
      weight: multiTokenName ? 0.86 : 0.6,
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

  // Evidence against, recorded rather than silently folded into a score. Two full names
  // that disagree on the surname are the clearest signal that a shared handle is a
  // coincidence, and the viewer shows this beside the reasons the pair was proposed.
  const conflicts = []
  const leftSurnames = surnames(left)
  const rightSurnames = surnames(right)
  const conflictingSurname =
    !sameName &&
    leftSurnames.size > 0 &&
    rightSurnames.size > 0 &&
    !hasIntersection(leftSurnames, rightSurnames) &&
    !nameMatchesHandle
  if (conflictingSurname) {
    conflicts.push({
      kind: 'conflicting-name',
      label: 'The two identities give different full names, so a shared handle is likely coincidence.',
      basis: 'observed',
      weight: 0.5,
    })
  }

  if (signals.length === 0) return null

  const explicit = explicitlyMapped
  let confidence = Math.max(...signals.map((signal) => signal.weight))
  // Two independent agreeing signals beat either one alone.
  if (multiTokenName && sameHandle) confidence = Math.max(confidence, 0.94)
  if (multiTokenName && (nameMatchesHandle || sameGithubAccount)) {
    confidence = Math.max(confidence, 0.92)
  }
  // A recorded conflict caps the pair below the emission floor, which drops it. A repository
  // that mapped the two identities together is authoritative over the heuristic, so its
  // confidence stands and the conflict is carried through as context for the reviewer.
  if (conflictingSurname && !explicit) confidence = Math.min(confidence, 0.5)
  if (!explicit && confidence < 0.7) return null

  return {
    id: identityMatchId(left.id, right.id),
    identityIds: [left.id, right.id].sort(),
    status: explicit ? 'confirmed' : 'candidate',
    confidence: Number(confidence.toFixed(2)),
    method: IDENTITY_MATCH_METHOD,
    signals,
    conflicts,
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
