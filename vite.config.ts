import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const PUBLIC_DIR = 'public'
const OUT_DIR = 'dist'
const GALLERY_MANIFEST = join(PUBLIC_DIR, 'gallery', 'manifest.json')
const GRAPH_REVIEW_OUT_DIR = join(OUT_DIR, 'graph-reviews')
const PUBLISHED_GRAPH_REVIEW_PATHS = [
  'consolidated-engine/larger-demonstration',
  'experiment-summary',
]

/**
 * `public/` holds two unrelated things: the gallery a hosted site publishes, and whatever
 * local `atlas*.json` or `epochs*.json` a maintainer generated from their own repository.
 * An epoch document quotes commit subjects and dates, so it leaks the same history the
 * dataset does and is excluded on the same terms. Vite copies both
 * into the build, so deploying a gallery from a working tree that has been used locally
 * would also publish private histories — contributor names and emails included. Those
 * files are gitignored, which keeps them out of the repository but not out of `dist/`.
 *
 * A build is a gallery build when a gallery manifest exists, and a personal build when it
 * does not. Only the former drops the loose datasets, so a maintainer deploying their own
 * atlas still gets the `/atlas.json` the viewer falls back to.
 */
function excludeLocalDatasetsFromGalleryBuilds(): Plugin {
  return {
    name: 'evolution-atlas:exclude-local-datasets',
    apply: 'build',
    closeBundle() {
      if (!existsSync(GALLERY_MANIFEST)) return

      let graphReviewAllowlist: GraphReviewAllowlist | undefined
      let graphReviewAllowlistError: Error | undefined
      try {
        graphReviewAllowlist = readTrackedGraphReviewAllowlist()
      } catch (error) {
        graphReviewAllowlistError = error instanceof Error
          ? error
          : new Error('gallery build could not determine tracked graph-review assets', { cause: error })
      }

      const removed = readdirSync(OUT_DIR)
        .filter((entry) => /^(atlas|epochs|readings|capabilities).*\.json$/.test(entry))
        .map((entry) => {
          rmSync(join(OUT_DIR, entry))
          return entry
        })

      if (removed.length > 0) {
        this.info(`gallery build: excluded ${removed.length} local dataset(s)`)
      }

      let removedGraphReviewPaths = 0
      if (existsSync(GRAPH_REVIEW_OUT_DIR)) {
        if (graphReviewAllowlist && lstatSync(GRAPH_REVIEW_OUT_DIR).isDirectory()) {
          removedGraphReviewPaths = removeUnapprovedGraphReviewPaths(
            GRAPH_REVIEW_OUT_DIR,
            graphReviewAllowlist,
          )
        } else {
          rmSync(GRAPH_REVIEW_OUT_DIR, { recursive: true, force: true })
          removedGraphReviewPaths = 1
        }
      }
      if (removedGraphReviewPaths > 0) {
        this.info(`gallery build: excluded ${removedGraphReviewPaths} unapproved graph-review path(s)`)
      }

      if (graphReviewAllowlistError) throw graphReviewAllowlistError
      if (!graphReviewAllowlist) {
        throw new Error('gallery build is missing its tracked graph-review allowlist')
      }

      const missingPublishedPaths = PUBLISHED_GRAPH_REVIEW_PATHS.filter((relativePath) => {
        const path = join(GRAPH_REVIEW_OUT_DIR, ...relativePath.split('/'))
        return !isRegularDirectory(path)
      })
      if (missingPublishedPaths.length > 0) {
        throw new Error(
          `gallery build is missing approved graph-review assets: ${missingPublishedPaths.join(', ')}`,
        )
      }

      const missingTrackedFiles = [...graphReviewAllowlist.files].filter((relativePath) =>
        !isRegularFile(join(GRAPH_REVIEW_OUT_DIR, ...relativePath.split('/'))),
      )
      if (missingTrackedFiles.length > 0) {
        throw new Error(
          `gallery build is missing ${missingTrackedFiles.length} tracked graph-review file(s): ${missingTrackedFiles.slice(0, 10).join(', ')}`,
        )
      }
    },
  }
}

/** Keep only the explicitly published review roots in the gallery output. */
function removeUnapprovedGraphReviewPaths(
  directory: string,
  trackedAllowlist: GraphReviewAllowlist,
): number {
  let removedCount = 0

  function prune(currentDirectory: string, currentRelativePath = ''): void {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const relativePath = currentRelativePath
        ? `${currentRelativePath}/${entry.name}`
        : entry.name
      const absolutePath = join(currentDirectory, entry.name)
      const isAllowed = entry.isDirectory()
        ? trackedAllowlist.directories.has(relativePath)
        : entry.isFile() && trackedAllowlist.files.has(relativePath)

      if (!isAllowed) {
        rmSync(absolutePath, { recursive: true, force: true })
        removedCount += 1
        continue
      }

      if (entry.isDirectory()) prune(absolutePath, relativePath)
    }
  }

  prune(directory)
  return removedCount
}

type GraphReviewAllowlist = { files: Set<string>; directories: Set<string> }

/** Gallery builds require Git so only tracked files from the approved roots are published. */
function readTrackedGraphReviewAllowlist(): GraphReviewAllowlist {
  try {
    const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const trackedFiles = execFileSync('git', [
      'ls-files',
      '--full-name',
      '-z',
      '--',
      ...PUBLISHED_GRAPH_REVIEW_PATHS.map((path) => `${PUBLIC_DIR}/graph-reviews/${path}`),
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0').filter(Boolean)

    const prefix = `${PUBLIC_DIR}/graph-reviews/`
    const files = new Set(trackedFiles.map((path) => {
      if (!path.startsWith(prefix)) {
        throw new Error(`Git returned an unexpected graph-review path: ${path}`)
      }
      return path.slice(prefix.length)
    }))
    for (const path of files) {
      if (!isRegularFile(join(repositoryRoot, PUBLIC_DIR, 'graph-reviews', ...path.split('/')))) {
        throw new Error(`tracked graph-review asset is not a regular file: ${path}`)
      }
    }
    const directories = new Set<string>()
    for (const path of files) {
      let parent = dirname(path)
      while (parent !== '.') {
        directories.add(parent)
        parent = dirname(parent)
      }
    }
    return { files, directories }
  } catch (error) {
    throw new Error('gallery build could not determine tracked graph-review assets', { cause: error })
  }
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isRegularDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT',
  )
}

export default defineConfig({
  plugins: [react(), excludeLocalDatasetsFromGalleryBuilds()],
})
