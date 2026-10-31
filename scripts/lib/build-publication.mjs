import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, rmSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

const MANIFEST_PATH = 'publication/manifest.json'
const SOURCE_PREFIX = 'publication/assets/'
// maps/ holds owner-approved candidate capability maps (engine output.json / reviewed-output.json).
const OUTPUT_PREFIXES = ['gallery/', 'approved-snapshots/', 'maps/']
const MEDIA_EXTENSIONS = new Map([
  ['application/json', ['.json']],
  ['text/html', ['.html']],
  ['text/css', ['.css']],
  ['text/plain', ['.txt']],
  ['image/svg+xml', ['.svg']],
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/webp', ['.webp']],
  ['image/gif', ['.gif']],
  ['image/x-icon', ['.ico']],
])

function fail(message) {
  throw new Error(`Publication manifest: ${message}`)
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
}

function safeRelativePath(value, field) {
  if (typeof value !== 'string' || !value.split('/').every(segment =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) && segment !== '.' && segment !== '..')) {
    fail(`${field} must be a safe relative file path`)
  }
  return value
}

function assertRepositoryDirectories(root) {
  const ancestors = []
  for (let path = root; ; path = dirname(path)) {
    ancestors.unshift(path)
    if (dirname(path) === path) break
  }
  for (const path of ancestors) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('repository root and its ancestors must be real directories')
  }
}

/** A failed build must not leave a prior deployable output behind. Never clear a caller-selected directory. */
function clearOwnedOutput(root) {
  assertRepositoryDirectories(root)
  const output = join(root, 'dist')
  let stat
  try { stat = lstatSync(output) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('owned dist output must be a real directory')
  rmSync(output, { recursive: true, force: true })
}

function assertOwnedBuildOutput(build, root) {
  if (build.copyPublicDir !== false) fail('production builds must disable public directory copying')
  if (build.emptyOutDir !== true) fail('production builds must clear stale output')
  const ownedOutput = join(root, 'dist')
  if (resolve(root, build.outDir) !== ownedOutput) fail('production builds must use the owned dist output directory')
  // The bundler's per-output directory overrides Vite's outDir, including arrays.
  for (const output of [build.rolldownOptions?.output, build.rollupOptions?.output].flat().filter(Boolean)) {
    if (output.file != null || (output.dir != null && (typeof output.dir !== 'string' || resolve(root, output.dir) !== ownedOutput))) {
      fail('bundler outputs must use the owned dist output directory')
    }
  }
}

/** Refuse symlinks in files and every directory below the selected repository root. */
function readRegularFile(root, relativePath) {
  let path = root
  const parts = relativePath.split('/')
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) fail(`symlinks are forbidden: ${relativePath}`)
    if (index < parts.length - 1 && !stat.isDirectory()) fail(`expected directory: ${relativePath}`)
    if (index === parts.length - 1 && !stat.isFile()) fail(`expected regular file: ${relativePath}`)
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    if (!fstatSync(descriptor).isFile()) fail(`expected regular file: ${relativePath}`)
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function validateMediaType(bytes, mediaType, source) {
  if (mediaType === 'application/json') {
    try { JSON.parse(bytes.toString('utf8')) } catch { fail(`invalid JSON asset: ${source}`) }
  } else if (mediaType === 'text/html') {
    if (!/^\s*(?:<!doctype\s+html\b[^>]*>\s*)?<html\b/i.test(bytes.toString('utf8'))) {
      fail(`expected an HTML document: ${source}`)
    }
  } else if (mediaType === 'image/svg+xml') {
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(bytes.toString('utf8'))) {
      fail(`expected an SVG document: ${source}`)
    }
  } else if (mediaType === 'image/png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail(`invalid PNG asset: ${source}`)
  } else if (mediaType === 'image/jpeg') {
    if (!bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) fail(`invalid JPEG asset: ${source}`)
  } else if (mediaType === 'image/webp') {
    if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') fail(`invalid WebP asset: ${source}`)
  } else if (mediaType === 'image/gif') {
    if (!['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) fail(`invalid GIF asset: ${source}`)
  } else if (mediaType === 'image/x-icon') {
    if (!bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) fail(`invalid icon asset: ${source}`)
  }
}

/**
 * Approval references record an owner's decision; the build does not grant approval.
 * Dedicated snapshot sources, exact hashes and output paths prevent local output discovery.
 */
export function loadPublicationAssets(repositoryRoot) {
  const root = resolve(repositoryRoot)
  assertRepositoryDirectories(root)
  let manifest
  const manifestBytes = readRegularFile(root, MANIFEST_PATH)
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) } catch { fail('manifest must contain valid JSON') }
  if (!hasExactKeys(manifest, ['version', 'assets']) || manifest.version !== 1 || !Array.isArray(manifest.assets)) {
    fail('expected version 1 and an explicit assets array')
  }

  const outputPaths = new Set()
  return manifest.assets.map((asset, index) => {
    if (!hasExactKeys(asset, ['source', 'path', 'sha256', 'mediaType', 'approval'])) fail(`invalid asset entry ${index}`)
    const source = safeRelativePath(asset.source, `asset ${index} source`)
    const path = safeRelativePath(asset.path, `asset ${index} output`)
    if (!source.startsWith(SOURCE_PREFIX)) fail(`asset ${index} source must be under ${SOURCE_PREFIX}`)
    if (!OUTPUT_PREFIXES.some(prefix => path.startsWith(prefix))) fail(`asset ${index} output must be under gallery/, approved-snapshots/ or maps/`)
    const normalizedPath = path.toLowerCase()
    if ([...outputPaths].some(existing => existing === normalizedPath
      || existing.startsWith(`${normalizedPath}/`) || normalizedPath.startsWith(`${existing}/`))) {
      fail(`duplicate or conflicting output path: ${path}`)
    }
    outputPaths.add(normalizedPath)
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) fail(`invalid SHA-256 for asset ${index}`)
    const extensions = MEDIA_EXTENSIONS.get(asset.mediaType)
    if (!extensions || !extensions.includes(extname(source).toLowerCase()) || !extensions.includes(extname(path).toLowerCase())) {
      fail(`asset ${index} media type must match source and output extensions`)
    }
    if (typeof asset.approval !== 'string' || !asset.approval.trim()) fail(`asset ${index} requires an owner approval reference`)
    const bytes = readRegularFile(root, source)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) fail(`SHA-256 mismatch: ${source}`)
    validateMediaType(bytes, asset.mediaType, source)
    return { ...asset, bytes }
  })
}

/** Emit only validated bytes through the bundler; never scan or copy public/. */
export function publicationAssetsPlugin() {
  let root
  let build
  let assets
  return {
    name: 'evolution-atlas:approved-publication-assets',
    apply: 'build',
    config(config) {
      // Vite canonicalizes root after this hook, so validate the caller's path here.
      assertRepositoryDirectories(resolve(config.root ?? process.cwd()))
    },
    configResolved(config) {
      // Vite normalizes a disabled publicDir to the empty string.
      if (config.publicDir) {
        fail('production builds must disable public directory copying')
      }
      root = resolve(config.root)
      build = config.build
      assertOwnedBuildOutput(build, root)
    },
    buildStart() {
      assertOwnedBuildOutput(this.environment?.config.build ?? build, root)
      clearOwnedOutput(root)
      assets = loadPublicationAssets(root)
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({ type: 'asset', fileName: asset.path, source: asset.bytes })
      }
    },
  }
}
