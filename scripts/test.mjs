#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOfflineEnvironment } from './verification/offline-environment.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Discover only project tests under the supplied test root; never scan scratch or the whole repo. */
export function discoverTestFiles(testRoot) {
  const root = resolve(testRoot)
  const matches = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.test\.(?:mjs|ts)$/.test(entry.name)) matches.push(path)
    }
  }
  visit(root)
  return matches
}

/** Preserve explicit test-file selection, while default/option-only runs stay scoped to test/. */
export function buildRunnerArgs(testRoot, args = [], cwd = process.cwd()) {
  const hasExplicitTestFile = args.some((argument) => {
    if (typeof argument !== 'string' || argument.startsWith('-')) return false
    if (!/\.test\.(?:mjs|ts)$/.test(argument)) return false
    return existsSync(resolve(cwd, argument))
  })
  const selected = hasExplicitTestFile ? args : [...args, ...discoverTestFiles(testRoot)]
  if (!selected.length) throw new Error(`No *.test.mjs or *.test.ts files found under ${resolve(testRoot)}.`)
  return ['--import', 'tsx', '--test', ...selected]
}

export function runTests(args = process.argv.slice(2), { cwd = REPOSITORY_ROOT } = {}) {
  const testRoot = join(cwd, 'test')
  const home = mkdtempSync(join(tmpdir(), 'atlas-test-home-'))
  try {
    const runner = spawnSync(process.execPath, buildRunnerArgs(testRoot, args, cwd), {
      cwd, env: createOfflineEnvironment({ home }), stdio: 'inherit', timeout: 240_000,
    })
    if (runner.error) throw runner.error
    return runner.status ?? 1
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = runTests()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
