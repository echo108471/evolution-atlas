#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NPM_VERSION = '11.9.0'

export function createFreshCheckoutEvidenceDirectory(repository, runId) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('Unsafe fresh-checkout evidence identifier.')
  const root = resolve(repository)
  if (realpathSync(root) !== root) throw new Error('Fresh-checkout source and evidence must not traverse a symlink.')
  const evidenceRoot = join(root, 'scratch', 'fresh-checkout-evidence')
  let ancestor = evidenceRoot
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  if (realpathSync(ancestor) !== ancestor || !lstatSync(ancestor).isDirectory()) {
    throw new Error('Fresh-checkout evidence must not traverse a symlink or non-directory.')
  }
  mkdirSync(evidenceRoot, { recursive: true })
  const runRoot = join(evidenceRoot, runId)
  mkdirSync(runRoot, { recursive: false })
  return runRoot
}

export function parseFreshCheckoutArguments(argv) {
  const options = {
    repository: REPOSITORY_ROOT,
    revision: null,
    cache: join(REPOSITORY_ROOT, 'scratch', 'npm-cache'),
    installMode: 'offline',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { help: true }
    const names = { '--repo': 'repository', '--revision': 'revision', '--cache': 'cache', '--install-mode': 'installMode' }
    const key = names[argument]
    const value = argv[++index]
    if (!key || !value || value.startsWith('--')) throw new Error(`Unknown or incomplete option: ${argument}`)
    options[key] = value
  }
  if (!['offline', 'registry'].includes(options.installMode)) throw new Error('--install-mode must be offline or registry.')
  if (options.revision !== null && !/^[a-f0-9]{40}$/.test(options.revision)) throw new Error('--revision must be a full 40-character local commit SHA.')
  options.repository = resolve(options.repository)
  options.cache = resolve(options.cache)
  return options
}

/** Clone only the named local commit; retain owned checkout and logs as ignored evidence. */
export async function runFreshCheckout(options) {
  const { createOfflineEnvironment } = await import('./verification/offline-environment.mjs')
  const expectedNode = readFileSync(join(options.repository, '.node-version'), 'utf8').trim()
  if (process.versions.node !== expectedNode) throw new Error(`Use pinned Node ${expectedNode}; found ${process.versions.node}.`)
  const runRoot = createFreshCheckoutEvidenceDirectory(options.repository, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
  const environment = createOfflineEnvironment({ home: join(runRoot, 'empty-home') })
  mkdirSync(environment.HOME, { recursive: true })
  const checkout = join(runRoot, 'checkout')
  const stages = []
  const report = {
    ok: false,
    sourceRepository: options.repository,
    revision: null,
    node: process.versions.node,
    npm: null,
    git: null,
    installMode: options.installMode,
    cache: options.cache,
    checkout,
    evidenceDirectory: runRoot,
    stages,
    limitations: [
      'The repository clone is local, at a resolved exact commit, and makes no third-party experiment fetch.',
      'Offline installation proves availability in the supplied cache; it does not prove an empty-cache installation.',
      'Registry installation is an explicit dependency-download stage; validation afterward uses the credential-free offline environment.',
      'The Node guard rejects external network calls and Git allows only file transport; this is not an operating-system network sandbox.',
      'Tests and generated fixtures establish synthetic mechanics, not real model or repository acceptance, semantic accuracy, or history privacy clearance.',
      'Browser journeys and Chromium installation are separate prerequisites and are not run by this command.',
    ],
  }
  const run = (name, command, args, { cwd = options.repository, env = environment, timeout = 300_000 } = {}) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 })
    const logPath = join(runRoot, `${String(stages.length + 1).padStart(2, '0')}-${name}.log`)
    writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}\n` : ''}`)
    stages.push({ name, command: [command, ...args], status: result.status, signal: result.signal, log: logPath, ok: result.status === 0 && !result.error })
    if (result.status !== 0 || result.error) throw new Error(`Fresh-checkout stage ${name} failed; inspect ${logPath}.`)
    return (result.stdout ?? '').trim()
  }
  try {
    report.npm = run('npm-version', 'npm', ['--version'])
    if (report.npm !== NPM_VERSION) throw new Error(`Use pinned npm ${NPM_VERSION}; found ${report.npm}.`)
    report.git = run('git-version', 'git', ['--version'])
    // Untracked user files and ignored generated artifacts are neither copied nor removed.
    if (run('source-status', 'git', ['status', '--porcelain', '--untracked-files=no'])) {
      throw new Error('Commit tracked source changes before validating a fresh checkout of an exact revision.')
    }
    const revision = run('resolve-revision', 'git', ['rev-parse', '--verify', `${options.revision ?? 'HEAD'}^{commit}`])
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Source did not resolve to a full commit SHA.')
    report.revision = revision
    run('local-clone', 'git', ['clone', '--no-local', '--no-checkout', options.repository, checkout])
    run('checkout-revision', 'git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', revision], { cwd: checkout })
    if (run('verify-checkout-revision', 'git', ['rev-parse', 'HEAD'], { cwd: checkout }) !== revision) throw new Error('Checkout revision mismatch.')
    const pinnedNode = readFileSync(join(checkout, '.node-version'), 'utf8').trim()
    const packageJson = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
    if (pinnedNode !== expectedNode || packageJson.packageManager !== `npm@${NPM_VERSION}`) {
      throw new Error('Checked revision lacks the matching Node and npm pins.')
    }
    // The exact checked source owns the guard used by its install and validation.
    environment.NODE_OPTIONS = `--require=${JSON.stringify(join(checkout, 'scripts', 'verification', 'offline-preload.cjs'))}`
    const installEnvironment = { ...environment }
    if (options.installMode === 'registry') {
      delete installEnvironment.NODE_OPTIONS
      delete installEnvironment.NPM_CONFIG_OFFLINE
    }
    const installArgs = ['ci', '--cache', options.cache, '--no-audit', '--no-fund', '--update-notifier=false', '--registry', 'https://registry.npmjs.org']
    if (options.installMode === 'offline') installArgs.push('--offline')
    run('install-dependencies', 'npm', installArgs, { cwd: checkout, env: installEnvironment })
    run('generate-fixtures', process.execPath, ['scripts/synthetic-fixtures.mjs', 'generate'], { cwd: checkout })
    run('validate-fixtures', process.execPath, ['scripts/synthetic-fixtures.mjs', 'validate'], { cwd: checkout })
    run('offline-checks', 'npm', ['run', 'check'], { cwd: checkout })
    run('diff-check', 'git', ['diff', '--check'], { cwd: checkout })
    const checkoutStatus = run('checkout-status', 'git', ['status', '--porcelain', '--untracked-files=all'], { cwd: checkout })
    if (checkoutStatus) throw new Error('Fresh-checkout validation left tracked changes or unignored files; inspect checkout-status log.')
    if (!existsSync(join(checkout, 'dist', 'index.html'))) throw new Error('Build did not produce dist/index.html.')
    if (run('source-status-after', 'git', ['status', '--porcelain', '--untracked-files=no'])) {
      throw new Error('The source repository changed during fresh-checkout validation.')
    }
    report.ok = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }
  writeFileSync(join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseFreshCheckoutArguments(process.argv.slice(2))
    const result = options.help ? {
      usage: 'node scripts/fresh-checkout.mjs [--revision FULL_LOCAL_SHA] [--cache PATH] [--install-mode offline|registry] [--repo LOCAL_PATH]\nDefault: exact current HEAD, offline installation from scratch/npm-cache. Explicit registry mode permits dependency downloads only. Evidence is retained under scratch/fresh-checkout-evidence/.',
    } : await runFreshCheckout(options)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.ok === false) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
    process.exitCode = 1
  }
}
