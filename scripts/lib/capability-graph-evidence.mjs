/** Bounded retrieval from cached readings and immutable Git blobs, including historical paths. */
import { execFileSync } from 'node:child_process'
import { hash } from './capability-graph.mjs'

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
})

export function safeEvidencePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !path.split('/').some((part) => ['..', '.', '.git'].includes(part)) &&
    !/[\x00-\x1f\\]/.test(path) &&
    !/(^|\/)(\.env(?:\..*)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)$|\.(key|pem)$/i.test(path)
}

export function sourceReader(repo, headSha, readings, { allowParents = false } = {}) {
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('head must be a full commit SHA')
  if (git(repo, ['rev-parse', '--verify', `${headSha}^{commit}`]).trim() !== headSha) throw new Error('head mismatch')
  const revisions = new Set([headSha, ...readings.map((r) => r.commitSha)])
  const resolveRevision = (revision) => {
    if (allowParents && typeof revision === 'string' && revision.endsWith('^')) {
      const requestedBase = revision.slice(0, -1)
      const base = requestedBase === 'head' ? headSha : readings.find((r) => r.id === requestedBase)?.commitSha
      if (!base) throw new Error('parent must name head or a registered reading ID')
      const parent = git(repo, ['rev-parse', '--verify', `${base}^1`]).trim()
      revisions.add(parent)
      return parent
    }
    const sha = revision === 'head' ? headSha : readings.find((r) => r.id === revision)?.commitSha ?? revision
    if (!revisions.has(sha)) throw new Error('revision outside evidence registry')
    return sha
  }
  const trees = new Map()
  const tree = (sha) => {
    if (!revisions.has(sha) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('revision outside evidence registry')
    if (!trees.has(sha)) {
      const entries = git(repo, ['ls-tree', '-rz', sha]).split('\0').filter(Boolean).map((line) => {
        const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/)
        return match ? { mode: match[1], type: match[2], blobSha: match[3], path: match[4] } : null
      }).filter((entry) => entry && entry.type === 'blob' && entry.mode !== '120000' && safeEvidencePath(entry.path))
      trees.set(sha, new Map(entries.map((entry) => [entry.path, entry])))
    }
    return trees.get(sha)
  }
  const paths = [...tree(headSha).keys()]
  return { paths,
    catalog(revision) {
      const sha = resolveRevision(revision)
      return { revision, commitSha: sha, paths: [...tree(sha).keys()] }
    },
    changedPaths(revision) {
      const sha = resolveRevision(revision)
      return git(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', sha])
        .split('\0').filter((path) => path && safeEvidencePath(path))
    },
    read(request, byteLimit = 5000) {
    const sha = resolveRevision(request.revision)
    if (!safeEvidencePath(request.path)) throw new Error('source path denied')
    const entry = tree(sha).get(request.path)
    if (!entry) throw new Error('source path missing or not a regular blob')
    const size = Number(git(repo, ['cat-file', '-s', entry.blobSha]).trim())
    if (size > 1024 * 1024) throw new Error('blob exceeds 1 MiB retrieval limit')
    const content = git(repo, ['cat-file', 'blob', entry.blobSha])
    if (content.includes('\0')) throw new Error('binary source omitted')
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/.test(content)) {
      throw new Error(`sensitive-looking content: local remediation required for ${request.path}`)
    }
    const startLine = request.startLine ?? 1
    if (!Number.isInteger(startLine) || startLine < 1) throw new Error('invalid startLine')
    const lines = content.split('\n'), selected = []
    let bytes = 0
    for (const line of lines.slice(startLine - 1, startLine + 78)) {
      const nextBytes = Buffer.byteLength(line + '\n')
      if (bytes + nextBytes > byteLimit) break
      selected.push(line); bytes += nextBytes
    }
    if (!selected.length) throw new Error('empty source window or first line exceeds byte budget')
    const span = { commitSha: sha, path: request.path, blobSha: entry.blobSha,
      startLine, endLine: startLine + selected.length - 1 }
    return { id: `S${hash(span).slice(0, 16)}`, kind: 'source', ...span,
      text: selected.join('\n'), totalLines: lines.length,
      truncated: startLine > 1 || startLine + selected.length - 1 < lines.length,
      interpretationStatus: 'observed' }
  } }
}

export function retrieveGraphEvidence(plan, readings, source, {
  maxReadings = 12, maxSources = 6, maxBytes = 24000,
} = {}) {
  for (const key of ['readingIds', 'sources', 'searches']) {
    if (!Array.isArray(plan[key])) throw new Error(`plan ${key} must be an array`)
  }
  const registry = new Map(readings.map((r) => [r.id, r]))
  const requests = [...plan.readingIds], searchResults = []
  for (const query of plan.searches.slice(0, 6)) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('invalid search')
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
    const score = (value) => terms.filter((term) => value.toLowerCase().includes(term)).length
    const hits = readings.map((r) => ({ id: r.id, score: score(`${r.subject} ${r.text}`) }))
      .filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3)
    requests.push(...hits.map((r) => r.id))
    searchResults.push({ query, readingIds: hits.map((r) => r.id),
      paths: source.paths.map((path) => ({ path, score: score(path) })).filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 10).map((p) => p.path) })
  }
  const evidence = [], omitted = []
  let bytes = 0, readingCount = 0, sourceCount = 0
  // Reserve half for code so reading requests cannot starve source retrieval.
  for (const id of [...new Set(requests)]) {
    const entry = registry.get(id)
    if (!entry) { omitted.push({ id, reason: 'unknown reading' }); continue }
    const size = Buffer.byteLength(JSON.stringify(entry))
    if (readingCount >= maxReadings || bytes + size > maxBytes / 2) {
      omitted.push({ id, reason: 'reading budget' }); continue
    }
    evidence.push(entry); bytes += size; readingCount++
  }
  for (const request of plan.sources) {
    if (sourceCount >= maxSources || maxBytes - bytes < 1000) {
      omitted.push({ request, reason: 'source budget' }); continue
    }
    try {
      const entry = source.read(request, Math.min(5000, maxBytes - bytes - 800))
      if (evidence.some((previous) => previous.id === entry.id)) continue
      const size = Buffer.byteLength(JSON.stringify(entry))
      if (bytes + size > maxBytes) { omitted.push({ request, reason: 'byte budget' }); continue }
      evidence.push(entry); bytes += size; sourceCount++
    } catch (error) {
      if (error.message.startsWith('sensitive-looking')) throw error
      omitted.push({ request, reason: error.message })
    }
  }
  return { evidence, searchResults, omitted, bytes, readingCount, sourceCount,
    truncatedSearches: Math.max(0, plan.searches.length - 6) }
}
