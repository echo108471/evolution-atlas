#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, closeSync, fstatSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const ZOD_COMMIT = '43f729db4aa0cedff6d6b3261f33f8556b3c7102'
const ZOD_URL = 'https://github.com/colinhacks/zod'
const LICENSE_HASH = '3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const fail = () => { throw new Error('Invalid pinned observed atlas; no demo was prepared.') }
const array = value => { if (!Array.isArray(value)) fail(); return value }
const text = value => { if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) fail(); return value }
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) fail()
  return value
}
const path = value => {
  text(value)
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some(part => part === '..')
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) fail()
  return value
}

/** Build a new allowlisted view; raw identity hashes and free text never pass through. */
export function minimizeObservedAtlas(raw, commit = ZOD_COMMIT) {
  if (!sha(commit) || raw?.schemaVersion !== '0.3.0' || raw.analysis?.mode !== 'observed-only'
    || raw.repository?.headSha !== commit || raw.analysis?.mergeDiffStrategy !== 'diff-merges-first-parent') fail()
  const areas = array(raw.codeAreas).map(area => ({
    id: text(area.id), label: area.pathPrefix ? path(area.pathPrefix) : '(root)',
    pathPrefix: area.pathPrefix ? path(area.pathPrefix) : '', classification: 'top-level-path',
    firstSeenAt: date(area.firstSeenAt), lastSeenAt: date(area.lastSeenAt),
  }))
  const areaIds = new Set(areas.map(area => area.id))
  if (areaIds.size !== areas.length || areas.some(area => !/^area:[a-f0-9]{16}$/.test(area.id))) fail()
  const episodes = array(raw.episodes).map(episode => {
    if (!sha(episode.commitSha) || episode.id !== 'episode:' + episode.commitSha || episode.interpretationStatus !== 'observed'
      || typeof episode.firstParent !== 'boolean') fail()
    const parents = array(episode.parentShas).map(parent => { if (!sha(parent)) fail(); return parent })
    const ids = array(episode.codeAreaIds).map(id => { if (!areaIds.has(id)) fail(); return id })
    return {
      id: episode.id, commitSha: episode.commitSha, shortSha: episode.commitSha.slice(0, 8),
      subject: 'Observed commit ' + episode.commitSha.slice(0, 8),
      authoredAt: date(episode.authoredAt), committedAt: date(episode.committedAt), parentShas: parents,
      contributorIds: [], firstParent: episode.firstParent === true, codeAreaIds: ids,
      changes: array(episode.changes).map(change => {
        if (!/^[ACDMRTUXB]$/.test(change.status)) fail()
        const result = { path: path(change.path), status: change.status }
        if (change.previousPath !== undefined) result.previousPath = path(change.previousPath)
        if (change.similarity !== undefined) {
          if (typeof change.similarity !== 'string' || !/^\d{1,3}$/.test(change.similarity) || Number(change.similarity) > 100) fail()
          result.similarity = change.similarity
        }
        return result
      }), interpretationStatus: 'observed',
    }
  })
  const episodeIds = new Set(episodes.map(episode => episode.id))
  const commits = new Set(episodes.map(episode => episode.commitSha))
  if (episodes.length !== raw.repository.commitCount || episodeIds.size !== episodes.length || !commits.has(commit)
    || episodes.some(episode => episode.parentShas.some(parent => !commits.has(parent)))) fail()
  const relationships = []
  for (const episode of episodes) {
    for (const areaId of episode.codeAreaIds) {
      const prefix = areas.find(area => area.id === areaId).pathPrefix
      const paths = [...new Set(episode.changes.flatMap(change => [change.path, change.previousPath].filter(Boolean)))]
        .filter(file => (file.includes('/') ? file.split('/')[0] : '') === prefix).sort()
      if (!paths.length) fail()
      relationships.push({ id: 'touched:' + episode.commitSha + ':' + areaId,
        sourceId: episode.id, targetId: areaId, kind: 'touched', interpretationStatus: 'observed', confidence: 1,
        evidence: [{ commitSha: episode.commitSha, paths }] })
    }
  }
  return {
    schemaVersion: '0.3.0', analysis: { mode: 'observed-only', historyRange: commit, mergeDiffStrategy: 'diff-merges-first-parent' },
    repository: { name: 'zod', ref: commit, headSha: commit, commitCount: episodes.length },
    timeRange: { firstAuthoredAt: date(raw.timeRange?.firstAuthoredAt), lastAuthoredAt: date(raw.timeRange?.lastAuthoredAt) },
    contributors: [], identityMatches: [], structuralEpisodes: [], semanticEpisodes: [],
    episodes, codeAreas: areas, featureCandidates: [], relationships,
  }
}

function readRegular(file, limit = 64 * 1024 * 1024) {
  const absolute = resolve(file)
  if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile()) throw new Error('Input must be a regular file without symlinks.')
  const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size > limit) throw new Error('Input is not a bounded regular file.')
    return readFileSync(descriptor)
  } finally { closeSync(descriptor) }
}

function git(source, args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}

export function prepareZodDemo({ input, analysisProvenance, source, out, generatedAt }) {
  const destination = resolve(out)
  const scratch = join(ROOT, 'scratch')
  const rel = relative(scratch, destination)
  if (!rel || rel.startsWith('..') || existsSync(destination)) throw new Error('Choose a new ignored scratch output directory.')
  let parent = dirname(destination)
  while (!existsSync(parent)) parent = dirname(parent)
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw new Error('Output parents must be real directories.')
  const bytes = readRegular(input)
  let raw
  try { raw = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Input JSON is invalid.') }
  if (realpathSync(resolve(source)) !== resolve(source)) throw new Error('Source must not traverse symlinks.')
  const origin = git(source, ['remote', 'get-url', 'origin']).replace(/\.git$/, '')
  if (origin !== ZOD_URL || git(source, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Wrong source identity or incomplete history.')
  const tree = git(source, ['rev-parse', ZOD_COMMIT + '^{tree}'])
  let analysisRecord
  try { analysisRecord = JSON.parse(readRegular(analysisProvenance, 1024 * 1024).toString('utf8')) }
  catch { throw new Error('Analysis provenance must be bounded regular JSON.') }
  if (analysisRecord.source?.sourceUrl !== ZOD_URL || analysisRecord.source?.commit !== ZOD_COMMIT
    || analysisRecord.source?.tree !== tree || analysisRecord.result?.mode !== 'observed-only'
    || analysisRecord.command?.paidOptIn !== false || !sha(analysisRecord.analyzer?.revision)
    || !Array.isArray(analysisRecord.artifacts)
    || !analysisRecord.artifacts.some(artifact => artifact.sha256 === hash(bytes) && artifact.bytes === bytes.length)) {
    throw new Error('Analysis provenance does not bind this raw artifact and pinned source.')
  }
  const history = git(source, ['rev-list', '--parents', ZOD_COMMIT]).split('\n').map(row => row.split(' '))
  const dataset = minimizeObservedAtlas(raw)
  const parents = new Map(history.map(([commit, ...parentShas]) => [commit, parentShas]))
  if (history.length !== dataset.episodes.length || dataset.episodes.some(episode => JSON.stringify(parents.get(episode.commitSha)) !== JSON.stringify(episode.parentShas))) fail()
  const license = Buffer.from(git(source, ['show', ZOD_COMMIT + ':LICENSE']) + '\n')
  if (hash(license) !== LICENSE_HASH) throw new Error('Pinned license bytes differ from the reviewed notice.')
  const timestamp = generatedAt ? date(generatedAt) : new Date().toISOString()
  const datasetBytes = Buffer.from(JSON.stringify(dataset) + '\n')
  const manifest = { version: 1, generatedAt: timestamp, subjects: [{
    slug: 'zod', title: 'Zod', description: 'Observed Git history at a pinned source revision.',
    why: 'This demo omits contributor identities, original commit messages and candidate interpretations. Commit links and paths still allow reidentification through upstream Git. Counts describe exported records, not developer performance.',
    url: ZOD_URL, license: 'MIT', dataset: 'zod.json', headSha: ZOD_COMMIT,
    commitCount: dataset.episodes.length, contributorCount: 0, codeAreaCount: dataset.codeAreas.length,
    firstAuthoredAt: dataset.timeRange.firstAuthoredAt, lastAuthoredAt: dataset.timeRange.lastAuthoredAt,
    interpreted: false, interpretation: null,
  }] }
  const exporterFiles = ['scripts/prepare-zod-demo.mjs', 'scripts/lib/atlas.mjs', 'scripts/lib/identity.mjs', 'src/structure.mjs', 'scripts/gallery.mjs']
  if (git(ROOT, ['status', '--porcelain', '--untracked-files=all', '--', ...exporterFiles])) {
    throw new Error('Commit the exporter and its source dependencies before preparing final review bytes.')
  }
  const analyzerFiles = array(analysisRecord.analyzer.runtimeFiles).map(file => {
    if (typeof file.path !== 'string' || !/^(?:scripts|src|gallery)\/[A-Za-z0-9/._-]+$|^package(?:-lock)?\.json$/.test(file.path)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail()
    return { path: file.path, sha256: file.sha256, bytes: file.bytes }
  })
  const provenance = {
    version: 1, generatedAt: timestamp, source: { url: ZOD_URL, commit: ZOD_COMMIT, tree, historyCommits: history.length },
    analyzer: { revision: analysisRecord.analyzer.revision, files: analyzerFiles, mode: 'observed-only', paidOptIn: false },
    exporter: { revision: git(ROOT, ['rev-parse', 'HEAD']), files: exporterFiles.map(file => ({ path: file, sha256: hash(readRegular(join(ROOT, file))) })) },
    rawInputSha256: hash(bytes), snapshotSha256: hash(datasetBytes), license: { name: 'MIT', sourcePath: 'LICENSE', sha256: LICENSE_HASH },
    policy: { retained: ['commit and parent hashes', 'timestamps', 'file paths and change/rename status', 'top-level code areas', 'observed touched-path relationships'],
      omitted: ['all contributor identities, names, aliases, identity-derived IDs and authored relationships', 'original commit subjects and bodies', 'identity matches', 'structural, semantic and feature candidates', 'source excerpts and model outputs'],
      limits: ['Data minimization is not anonymization: public commit hashes and paths permit reidentification.', 'No model call was used; features and lifecycle interpretations are absent.', 'Dates, path changes and citations establish observations, not intent, completeness of meaning, ownership or developer performance.'] },
    publicationApproval: false,
  }
  const files = [
    ['gallery/zod.json', datasetBytes, 'application/json'],
    ['gallery/manifest.json', Buffer.from(JSON.stringify(manifest) + '\n'), 'application/json'],
    ['approved-snapshots/zod-LICENSE.txt', license, 'text/plain'],
    ['approved-snapshots/zod-PROVENANCE.json', Buffer.from(JSON.stringify(provenance, null, 2) + '\n'), 'application/json'],
  ]
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const inventory = files.map(([file, content, mediaType]) => {
    const target = join(destination, file)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    writeFileSync(target, content, { flag: 'wx', mode: 0o600 })
    return { path: file, bytes: content.length, sha256: hash(content), mediaType,
      proposedSource: 'publication/assets/zod/' + file.split('/').at(-1) }
  })
  writeFileSync(join(destination, 'inventory.json'), JSON.stringify({ version: 1, publicationApproval: false, files: inventory }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return { output: destination, sourceCommit: ZOD_COMMIT, files: inventory, publicationApproval: false }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--help')) {
      console.log('Usage: node scripts/prepare-zod-demo.mjs --input RAW_JSON --analysis-provenance RAW_PROVENANCE_JSON --source PINNED_LOCAL_ZOD --out NEW_SCRATCH_DIRECTORY [--generated-at ISO_TIMESTAMP]\nPrepares private review candidates only. Never fetches, requests a model, approves or publishes.')
    } else {
      const names = { '--input': 'input', '--analysis-provenance': 'analysisProvenance', '--source': 'source', '--out': 'out', '--generated-at': 'generatedAt' }
      const options = {}
      for (let index = 0; index < args.length; index += 2) {
        const key = names[args[index]], value = args[index + 1]
        if (!key || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error('Invalid or duplicate option.')
        options[key] = value
      }
      if (!options.input || !options.analysisProvenance || !options.source || !options.out) throw new Error('Supply --input, --analysis-provenance, --source and --out.')
      console.log(JSON.stringify(prepareZodDemo(options)))
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
