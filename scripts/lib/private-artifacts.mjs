import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// Only these reviewed roots are eligible for this preservation operation.
export const PRIVATE_ARTIFACT_ROOTS = Object.freeze([
  'public/graph-reviews/consolidated-engine/larger-demonstration',
  'public/graph-reviews/experiment-summary',
])

const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`)

function assertNoSymlinks(path) {
  let current = resolve(path)
  while (true) {
    let stat
    try { stat = lstatSync(current) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (stat?.isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function readRegularFile(path) {
  assertNoSymlinks(path)
  if (!lstatSync(path).isFile()) throw new Error(`Refusing non-regular file: ${path}`)
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) throw new Error(`Refusing non-regular file: ${path}`)
    return { bytes: readFileSync(descriptor), mode: stat.mode & 0o777 }
  } finally {
    closeSync(descriptor)
  }
}

function listFiles(root, directory) {
  assertNoSymlinks(directory)
  if (!existsSync(directory)) return []
  const stat = lstatSync(directory)
  if (!stat.isDirectory()) throw new Error(`Artifact root must be a directory: ${directory}`)
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`)
    if (entry.isDirectory()) files.push(...listFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
    else throw new Error(`Refusing non-regular artifact: ${path}`)
  }
  return files
}

function validateArtifactPath(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..') || !PRIVATE_ARTIFACT_ROOTS.some((root) => path.startsWith(`${root}/`))) {
    throw new Error('Manifest contains a path outside the reviewed artifact roots.')
  }
}

export function inventoryPrivateArtifacts(repositoryRoot) {
  const root = resolve(repositoryRoot)
  assertNoSymlinks(root)
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, env: gitEnvironment, encoding: 'utf8' }).trim()
  if (resolve(gitRoot) !== root) throw new Error('Preservation must run at the Git repository root.')
  const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, env: gitEnvironment, encoding: 'utf8' }).trim()
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', ...PRIVATE_ARTIFACT_ROOTS], { cwd: root, env: gitEnvironment, encoding: 'utf8' }).split('\0').filter(Boolean))
  const paths = PRIVATE_ARTIFACT_ROOTS.flatMap((directory) => listFiles(root, join(root, directory))).sort()
  const present = new Set(paths)
  if ([...tracked].some((path) => !present.has(path))) throw new Error('A tracked artifact is missing from the working tree; preserve or resolve it before untracking.')
  const files = paths.map((path) => {
    validateArtifactPath(path)
    const { bytes, mode } = readRegularFile(join(root, path))
    return { path, bytes: bytes.length, sha256: hash(bytes), sourceMode: mode, tracked: tracked.has(path) }
  })
  return { version: 1, revision, roots: [...PRIVATE_ARTIFACT_ROOTS], files }
}

function validateManifest(manifest) {
  if (manifest.version !== 1 || !/^[a-f0-9]{40,64}$/.test(manifest.revision) || JSON.stringify(manifest.roots) !== JSON.stringify(PRIVATE_ARTIFACT_ROOTS) || !Array.isArray(manifest.files)) throw new Error('Invalid preservation manifest.')
  const seen = new Set()
  for (const file of manifest.files) {
    validateArtifactPath(file.path)
    if (seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.sourceMode) || file.sourceMode < 0 || file.sourceMode > 0o777 || typeof file.tracked !== 'boolean') throw new Error('Invalid preservation file metadata.')
    seen.add(file.path)
  }
}

export function verifyPrivateArtifactBackup(destination) {
  const backupRoot = resolve(destination)
  assertNoSymlinks(backupRoot)
  const { bytes: manifestBytes } = readRegularFile(join(backupRoot, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  validateManifest(manifest)
  const filesRoot = join(backupRoot, 'files')
  const actual = listFiles(filesRoot, filesRoot).sort()
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files.map((file) => file.path).sort())) throw new Error('Backup file inventory differs from its manifest.')
  for (const file of manifest.files) {
    const { bytes } = readRegularFile(join(filesRoot, file.path))
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`Backup hash mismatch: ${file.path}`)
  }
  return {
    backupRoot,
    manifestPath: join(backupRoot, 'manifest.json'),
    manifestSha256: hash(manifestBytes),
    revision: manifest.revision,
    roots: manifest.roots,
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
    trackedFiles: manifest.files.filter((file) => file.tracked).length,
    untrackedFiles: manifest.files.filter((file) => !file.tracked).length,
  }
}

export function preservePrivateArtifacts({ repositoryRoot, destination }) {
  const root = resolve(repositoryRoot)
  const backupRoot = resolve(destination)
  assertNoSymlinks(root)
  assertNoSymlinks(backupRoot)
  if (inside(root, backupRoot) || inside(backupRoot, root)) throw new Error('Backup destination must be outside and separate from the repository.')
  if (existsSync(backupRoot)) throw new Error('Backup destination already exists; verify it or choose a new destination.')
  const manifest = inventoryPrivateArtifacts(root)
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
  mkdirSync(join(backupRoot, 'files'), { mode: 0o700 })
  for (const file of manifest.files) {
    const { bytes, mode } = readRegularFile(join(root, file.path))
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256 || mode !== file.sourceMode) throw new Error(`Source changed during preservation: ${file.path}`)
    const copy = join(backupRoot, 'files', file.path)
    mkdirSync(dirname(copy), { recursive: true, mode: 0o700 })
    writeFileSync(copy, bytes, { flag: 'wx', mode: mode & 0o100 ? 0o700 : 0o600 })
  }
  writeFileSync(join(backupRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  const result = verifyPrivateArtifactBackup(backupRoot)
  // Fail closed if files were edited/added/removed while the backup was made.
  if (JSON.stringify(inventoryPrivateArtifacts(root)) !== JSON.stringify(manifest)) throw new Error('Source inventory changed during preservation; do not untrack it.')
  return result
}
