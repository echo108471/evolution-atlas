#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const privateRoots = new Set(['public', 'scratch', 'data', 'datasets', 'runs', 'responses',
  'raw-runs', 'raw-responses', 'model-responses', 'results', 'reports', 'clones', 'repos',
  'repositories', 'cache', 'caches', '.cache', '.gallery-cache', 'private-artifacts'])

export function prohibitedTrackedPaths(paths) {
  return paths.filter(path => privateRoots.has(path.split('/')[0])
    || path.split('/').some(part => /^\.env(?:\.|$)/.test(part)
      || ['.aws', '.codex', '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519'].includes(part))
    || /\.(?:pem|key|p12|pfx)$/.test(path))
}

export function checkTrackedArtifacts(repositoryRoot = root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
  const rejected = prohibitedTrackedPaths(files)
  if (rejected.length) throw new Error(`Private output or credential paths remain tracked (${rejected.length}): ${rejected.join(', ')}`)
  return { trackedFiles: files.length, prohibitedPaths: 0,
    limitations: 'Path policy only; source content, reachable history and approved snapshots require separate review.' }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.stdout.write(`${JSON.stringify(checkTrackedArtifacts())}\n`) }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
