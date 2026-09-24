import { createHash } from 'node:crypto'
import { readRegularArtifact } from './prior-map-catalog.mjs'
import { assertEvolutionAncestor } from './repository-evolution.mjs'

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0

function readJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) }
  catch { throw new Error(`Invalid cached-reading JSON: ${label}`) }
}

function assertReading(value, commitSha, tier) {
  if (!record(value) || value.tier !== tier || (value.interpretationStatus !== undefined && value.interpretationStatus !== 'candidate')
    || !text(value.summary) || !text(value.capability)
    || !['introduce', 'extend', 'fix', 'refactor', 'remove', 'migrate', 'test', 'config', 'unclear'].includes(value.kind)
    || !Number.isFinite(value.significance) || value.significance < 0 || value.significance > 1
    || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error(`Invalid candidate commit reading at ${commitSha}, tier ${tier}`)
  }
  const clean = {
    tier,
    summary: value.summary,
    capability: value.capability,
    kind: value.kind,
    significance: value.significance,
    confidence: value.confidence,
    interpretationStatus: 'candidate',
  }
  if (typeof value.model === 'string') clean.model = value.model.slice(0, 200)
  if (Number.isSafeInteger(value.diffLines) && value.diffLines >= 0) clean.diffLines = value.diffLines
  if (typeof value.diffTruncated === 'boolean') clean.diffTruncated = value.diffTruncated
  if (tier === 1) {
    if (typeof value.needsDepth === 'boolean') clean.needsDepth = value.needsDepth
    if (['partial', 'consequential', 'unclear', 'none'].includes(value.depthCause)) clean.depthCause = value.depthCause
    if (typeof value.depthReason === 'string') clean.depthReason = value.depthReason.slice(0, 300)
  }
  return clean
}

export function loadCommitReadingArtifact(path, id, repo, currentCommitSha) {
  const bytes = readRegularArtifact(path, 16 * 1024 * 1024), document = readJson(bytes, path)
  return loadCommitReadingArtifactBytes(bytes, id, repo, currentCommitSha, path, document)
}

export function loadCommitReadingArtifactBytes(inputBytes, id, repo, currentCommitSha, label = id, parsedDocument = null) {
  const bytes = Buffer.from(inputBytes), document = parsedDocument ?? readJson(bytes, label)
  if (!record(document) || !text(document.repository) || !SHA.test(document.headSha ?? '') || !Array.isArray(document.readings)) {
    throw new Error('analyze-commits output needs repository, headSha, and readings')
  }
  assertEvolutionAncestor(repo, document.headSha, currentCommitSha, 'Cached-reading artifact head is foreign or later than the current revision')
  const byCommit = new Map()
  for (const entry of document.readings) {
    if (!record(entry) || !SHA.test(entry.commitSha ?? '') || byCommit.has(entry.commitSha)) throw new Error('Invalid or duplicate commit identity in cached-reading artifact')
    assertEvolutionAncestor(repo, entry.commitSha, currentCommitSha, 'Cached reading is from a foreign or future revision')
    assertEvolutionAncestor(repo, entry.commitSha, document.headSha, 'Cached reading is outside the artifact head history')
    const tiers = {}
    if (entry.tier1 != null) tiers[1] = assertReading(entry.tier1, entry.commitSha, 1)
    if (entry.tier2 != null) tiers[2] = assertReading(entry.tier2, entry.commitSha, 2)
    if (!Object.keys(tiers).length) throw new Error(`Cached reading has no usable tier: ${entry.commitSha}`)
    byCommit.set(entry.commitSha, { commitSha: entry.commitSha, subject: text(entry.subject) ? entry.subject.slice(0, 240) : '', tiers })
  }
  const provenance = {}
  if (typeof document.method === 'string') provenance.method = document.method.slice(0, 300)
  if (typeof document.unit === 'string') provenance.unit = document.unit.slice(0, 100)
  if (record(document.coverage)) {
    provenance.coverage = Object.fromEntries(['analyzed', 'unitCount', 'ofUnit', 'ofSubstantive', 'ofHistory']
      .filter(key => Number.isFinite(document.coverage[key])).map(key => [key, document.coverage[key]]))
  }
  return { id, path: label, artifactSha256: hash(bytes), headSha: document.headSha, repositoryName: document.repository, provenance, byCommit, bytes }
}

export function makeCommitReadingReceipt(artifact, commitSha, tier = 'all') {
  if (!artifact?.byCommit?.has(commitSha)) throw new Error('Cached reading not found for this commit')
  if (!['all', '1', '2'].includes(String(tier))) throw new Error('Cached-reading tier must be 1, 2, or all')
  const entry = artifact.byCommit.get(commitSha), tiers = String(tier) === 'all' ? Object.keys(entry.tiers).map(Number).sort() : [Number(tier)]
  if (tiers.some(number => !entry.tiers[number])) throw new Error('Requested cached-reading tier is unavailable')
  return {
    kind: 'commit-reading',
    artifactId: artifact.id,
    artifactSha256: artifact.artifactSha256,
    artifactHeadSha: artifact.headSha,
    repositoryName: artifact.repositoryName,
    artifactProvenance: structuredClone(artifact.provenance),
    commitSha,
    subject: entry.subject,
    readings: tiers.map(number => structuredClone(entry.tiers[number])),
    interpretationStatus: 'candidate',
    directSourceProof: false,
  }
}
