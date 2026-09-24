import { execFileSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const SOURCE_EXTENSIONS = new Set([
  '.c', '.h', '.cc', '.hh', '.cpp', '.hpp', '.cxx', '.hxx', '.m', '.mm',
  '.cs', '.fs', '.fsx', '.vb', '.go', '.java', '.kt', '.kts', '.scala', '.swift',
  '.rs', '.py', '.pyi', '.pyx', '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.jl',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.sql', '.graphql', '.gql',
  '.proto', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.ex', '.exs', '.erl', '.hrl',
  '.clj', '.cljs', '.cljc', '.edn', '.hs', '.lhs', '.elm', '.dart', '.zig', '.nim',
])
const EXCLUDED_PARTS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'third_party', 'third-party',
  'dist', 'build', 'out', 'target', 'coverage', 'generated', '__generated__',
  '__pycache__', '.cache', '.next', '.nuxt', '.output', '.turbo', '.parcel-cache',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.gradle', '.idea', '.vscode', '.vs', 'bower_components', 'pods', '.bundle',
  '.ssh', '.aws', '.azure', '.gcloud', '.gnupg', '.kube', '.docker', '.config', '.codex', '.claude',
  '.cursor', '.windsurf', '.agents', '.github', '.gitlab', '.circleci',
  'secrets', 'secret', '.secrets', 'credentials', 'credential', '.credentials', 'private-keys', 'private_keys',
])
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

function validCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error('partitionCount must be an integer from 1 to 6')
}

function pathOmission(path) {
  if (typeof path !== 'string' || !path || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(path)
    || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) return 'unsafe-path'
  const parts = path.toLowerCase().split('/'), name = parts.at(-1)
  if (parts.some(part => EXCLUDED_PARTS.has(part))) return 'excluded-directory-or-sensitive-path'
  if (parts.some(part => part === '.env' || part.startsWith('.env.'))
    || /(?:^|[._-])(?:secret|secrets|credential|credentials|password|passwords|token|tokens)(?:[._-]|$)/.test(name)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/.test(name)
    || /\.(?:key|pem|p12|pfx|p8|jks|keystore|kdbx)(?:\.|$)/.test(name)
    || /^(?:agents|claude|gemini|terax|copilot-instructions)(?:\.|$)/.test(name)
    || /^(?:\.npmrc|\.pypirc|\.netrc|\.gitconfig|\.gitmodules|\.cursorrules|\.windsurfrules)$/.test(name)
    || /(?:^|[._-])(?:instructions|system-prompt)(?:[._-]|$)/.test(name)) return 'sensitive-or-instruction-path'
  return null
}

// A metadata-only path gate; true does not certify a file's contents as safe.
export function safeRepositoryPath(path) {
  return pathOmission(path) === null
}

/** Keep directory subtrees together up to the average partition weight, then
 * split large trees at directory boundaries. Oversized sibling file groups are
 * indivisible. Greedy byte balancing is deterministic, not an optimal packing. */
export function assignRepositoryPartitions(files, count) {
  validCount(count)
  if (!Array.isArray(files)) throw new Error('files must be an array')
  const ordered = [...files].sort((a, b) => compare(a?.path, b?.path)), seen = new Set()
  for (const file of ordered) {
    if (!file || !safeRepositoryPath(file.path) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid partition file metadata')
    if (seen.has(file.path)) throw new Error('Duplicate partition file path')
    seen.add(file.path)
  }
  const weight = list => list.reduce((sum, file) => sum + Math.max(1, file.size), 0)
  const target = Math.ceil(weight(ordered) / count), groups = []
  function group(list, depth, prefix) {
    if (prefix && weight(list) <= target) { groups.push({ files: list, weight: weight(list), key: prefix }); return }
    const dirs = new Map(), direct = []
    for (const file of list) {
      const parts = file.path.split('/')
      if (parts.length === depth + 1) direct.push(file)
      else {
        const key = parts[depth]
        if (!dirs.has(key)) dirs.set(key, [])
        dirs.get(key).push(file)
      }
    }
    // Root files have no meaningful directory locality; siblings below root do.
    if (prefix && direct.length) groups.push({ files: direct, weight: weight(direct), key: prefix + '/' })
    else for (const file of direct) groups.push({ files: [file], weight: weight([file]), key: file.path })
    for (const [dir, children] of dirs) group(children, depth + 1, prefix ? prefix + '/' + dir : dir)
  }
  group(ordered, 0, '')
  groups.sort((a, b) => b.weight - a.weight || compare(a.key, b.key))
  const loads = Array(count).fill(0), assignments = new Map()
  for (const group of groups) {
    let slot = 0
    for (let i = 1; i < count; i++) if (loads[i] < loads[slot]) slot = i
    loads[slot] += group.weight
    for (const file of group.files) assignments.set(file.path, String.fromCharCode(65 + slot))
  }
  return ordered.map(file => ({ ...file, partition: assignments.get(file.path) }))
}

function validateRevision(revision) {
  // Permit named refs, hashes, and ordinary ancestry suffixes; never arbitrary
  // rev-parse options, reflogs, path expressions, or revision ranges.
  if (typeof revision !== 'string' || revision.length > 1024
    || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*(?:[~^][0-9]*)*$/.test(revision)
    || revision.includes('..') || revision.includes('//')
    || revision.split(/[~^]/)[0].split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) {
    throw new Error('Invalid revision: use a commit hash, named ref, or ancestry suffix')
  }
}

function gitMetadata(repo, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
  try {
    const bytes = execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, ...args], {
      env, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    // JSON inventory paths must round-trip to the exact Git path bytes. Never
    // silently substitute replacement characters for non-UTF-8 filenames.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Cannot read local Git metadata; verify the repository, revision, and locally available objects')
  }
}

export function inventorySnapshot({ repo, revision = 'HEAD', partitionCount = 3, maxFileBytes = 1_048_576 } = {}) {
  validCount(partitionCount)
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 1_048_576) throw new Error('maxFileBytes must be an integer from 1 to 1048576')
  validateRevision(revision)
  if (typeof repo !== 'string' || !repo || /[\u0000-\u001f\u007f]/.test(repo)) throw new Error('repo must be a local directory path')
  const local = realpathSync(resolve(repo))
  if (!statSync(local).isDirectory()) throw new Error('repo must be a local directory path')
  const gitDir = realpathSync(gitMetadata(local, ['rev-parse', '--absolute-git-dir']).trim())
  const commitSha = gitMetadata(gitDir, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim()
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha)) throw new Error('Revision did not resolve to a real commit')
  const tree = gitMetadata(gitDir, ['ls-tree', '-r', '-l', '-z', '--full-tree', commitSha])
  const records = tree ? tree.split('\0').slice(0, -1) : [], files = [], omitted = []
  for (const record of records) {
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40}|[a-f0-9]{64}) +(-|\d+)\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error('Unrecognized Git tree metadata')
    const [, mode, type, blobSha, bytes, path] = match, size = bytes === '-' ? null : Number(bytes)
    let reason = pathOmission(path)
    if (!reason && (type !== 'blob' || !['100644', '100755'].includes(mode))) reason = mode === '120000' ? 'symlink' : 'non-regular-entry'
    if (!reason && (!Number.isSafeInteger(size) || size < 0)) reason = 'unavailable-size'
    if (!reason && size > maxFileBytes) reason = 'oversize'
    if (!reason && (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) || /(?:\.min\.(?:js|css)|\.generated\.[^.]+|\.g\.(?:cs|go)|\.pb\.(?:go|cc|h)|_pb2\.py)$/i.test(path))) reason = 'unsupported-or-generated-file'
    if (reason) omitted.push({ path, reason })
    else files.push({ path, mode, type, blobSha, size })
  }
  omitted.sort((a, b) => compare(a.path, b.path))
  return { repo: gitDir, inventory: { commitSha, allTrackedEntries: records.length, eligibleFiles: files.length, omitted, files: assignRepositoryPartitions(files, partitionCount) } }
}
