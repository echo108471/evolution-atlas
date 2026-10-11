import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** CLI gates keep local replay separate from acquisition and paid execution. */
export function requirePaidPermission(allowPaid, action) {
  if (!allowPaid) {
    throw new Error(`${action} requires --allow-paid; use saved output or local validation to avoid model calls`)
  }
}

export function requirePinnedCommit(commit, context) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${context} requires a full 40-character commit SHA`)
  }
  return commit
}

function canonicalPath(path) {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(canonicalPath(parent), absolute.slice(parent.length))
}

/** A saved paid artifact must remain reusable, including through symlinks/hardlinks. */
export function requireSeparateOutput(outputPath, inputPaths) {
  if (!outputPath) return
  const canonicalOutput = canonicalPath(outputPath)
  for (const inputPath of inputPaths.filter(Boolean)) {
    const samePath = canonicalOutput === canonicalPath(inputPath)
    let sameInode = false
    if (existsSync(outputPath) && existsSync(inputPath)) {
      const output = statSync(outputPath)
      const input = statSync(inputPath)
      sameInode = output.dev === input.dev && output.ino === input.ino
    }
    if (samePath || sameInode) {
      throw new Error('Output must be separate from catalog, dataset and saved input artifacts; choose a new output path')
    }
  }
}

export function requireNewOutput(outputPath) {
  if (!outputPath) return
  try { lstatSync(outputPath) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Output already exists; choose a new output path to preserve saved artifacts')
}
