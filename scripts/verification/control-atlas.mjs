import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  appendFileSync,
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { FEATURE_REGISTRY, FEATURE_IDS, getFeature } from './features.mjs'
import { loadPreviewBuild, runPreviewJourney, startPreviewServer } from './preview.mjs'
import {
  syntheticAtlas,
  syntheticCandidateMap,
  syntheticHistoryCandidateMap,
  syntheticGallery,
  syntheticPeriods,
} from './fixtures.mjs'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const SCRATCH_ROOT = join(REPOSITORY_ROOT, 'scratch')
const RUNTIME_ROOT = join(SCRATCH_ROOT, 'control-atlas-runtime')
const EVIDENCE_ROOT = join(SCRATCH_ROOT, 'control-atlas-evidence')
const BROWSER_ROOT = join(SCRATCH_ROOT, 'verification-browsers')
const OWNER_FILE = '.control-atlas-owner.json'
const EVIDENCE_MARKER = '.control-atlas-evidence.json'
const EXPECTED_FETCH_CANCEL_PATHS = new Set([
  '/gallery/manifest.json',
  '/gallery/synthetic-atlas.json',
  '/atlas.json',
  '/epochs.json',
  '/maps/output.json',
])
const HARNESS_SOURCE_FILES = [
  'package-lock.json',
  'scripts/control-atlas.mjs',
  'scripts/test.mjs',
  'scripts/verification/control-atlas.mjs',
  'scripts/verification/features.mjs',
  'scripts/verification/fixtures.mjs',
  'scripts/verification/preview.mjs',
  'test/control-atlas.test.mjs',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
]

const BASE_LIMITATIONS = [
  'The verifier uses deterministic synthetic fixtures. It does not read local atlas datasets, gallery artifacts, experiment runs, environment files, or the user browser profile.',
  'A passing browser journey establishes only the rendered route and interactions recorded in its assertions.',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[^0-9TZ]/g, '').toLowerCase()
  return `${timestamp}-${randomBytes(5).toString('hex')}`
}

function isPathWithin(parent, child) {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

function safeRunId(runId) {
  return typeof runId === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(runId)
}

function validateOwnedRuntime(runtimeRoot, runId) {
  if (!safeRunId(runId)) throw new Error('Invalid run id; expected a simple verifier run id.')
  const base = resolve(runtimeRoot)
  try {
    if (lstatSync(base).isSymbolicLink()) throw new Error('Runtime root must not be a symbolic link.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const target = resolve(base, runId)
  if (!isPathWithin(base, target) || target === base) throw new Error('Runtime path escaped its owned root.')
  let targetStat
  try { targetStat = lstatSync(target) } catch (error) {
    if (error?.code === 'ENOENT') return { base, target, marker: null }
    throw error
  }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error('Verifier runtime must be a regular directory.')
  const markerPath = join(target, OWNER_FILE)
  let markerStat
  try { markerStat = lstatSync(markerPath) } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Refusing cleanup: verifier ownership marker is missing or unsafe.')
    throw error
  }
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error('Refusing cleanup: verifier ownership marker is missing or unsafe.')
  }
  const marker = readJsonFile(markerPath)
  if (marker.kind !== 'control-atlas-runtime' || marker.runId !== runId) {
    throw new Error('Refusing cleanup: verifier ownership marker does not match this run id.')
  }
  return { base, target, marker }
}

/** Inspect or remove exactly one run directory after its ownership marker is verified. */
function ownerProcessIsLive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function cleanupRun({ runtimeRoot = RUNTIME_ROOT, runId, apply = false, allowCurrentProcess = false }) {
  const { target, marker } = validateOwnedRuntime(runtimeRoot, runId)
  if (!marker) return { ok: true, status: 'nothing-to-clean', runId }
  if (ownerProcessIsLive(marker.pid) && !(allowCurrentProcess && marker.pid === process.pid)) {
    if (!apply) return { ok: true, status: 'active', runId, ownerPid: marker.pid, wouldRemove: target }
    throw new Error(`Refusing cleanup: verifier process ${marker.pid} may still own this runtime.`)
  }
  if (!apply) return { ok: true, status: 'dry-run', runId, wouldRemove: target, createdAt: marker.createdAt }
  rmSync(target, { recursive: true, force: false })
  return { ok: true, status: 'cleaned', runId, removed: target }
}

function gitHead(repositoryRoot) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function gitStatus(repositoryRoot, files) {
  try {
    const args = ['-C', repositoryRoot, 'status', '--porcelain', '--untracked-files=all', '--', ...files]
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean)
  } catch {
    return null
  }
}

function sourceTreeFiles(repositoryRoot, directory) {
  const absoluteRoot = resolve(repositoryRoot, directory)
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(relative(resolve(repositoryRoot), absolute))
    }
  }
  visit(absoluteRoot)
  return files
}

export function sourceManifest({ repositoryRoot = REPOSITORY_ROOT, features = FEATURE_REGISTRY } = {}) {
  const paths = [...new Set([
    ...HARNESS_SOURCE_FILES,
    ...sourceTreeFiles(repositoryRoot, 'src'),
    ...features.flatMap((feature) => [...feature.sourceFiles, ...feature.testFiles]),
  ])].sort()
  const files = paths.map((path) => {
    const absolute = resolve(repositoryRoot, path)
    if (!isPathWithin(resolve(repositoryRoot), absolute)) throw new Error(`Source path escaped repository root: ${path}`)
    const bytes = readFileSync(absolute)
    return { path, sha256: sha256(bytes) }
  })
  const digestInput = files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join('')
  return {
    headSha: gitHead(repositoryRoot),
    workingTreePaths: gitStatus(repositoryRoot, paths),
    sourceFingerprint: sha256(digestInput),
    files,
  }
}

export function selectedBrowserExecutable(value = process.env.ATLAS_BROWSER_EXECUTABLE) {
  if (!value) return undefined
  if (!isAbsolute(value)) throw new Error('ATLAS_BROWSER_EXECUTABLE must be an absolute executable path.')
  const path = realpathSync(value)
  if (!lstatSync(path).isFile()) throw new Error('ATLAS_BROWSER_EXECUTABLE must resolve to a regular file.')
  accessSync(path, constants.X_OK)
  return path
}

async function withBrowserPath(browserRoot, callback) {
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot
  try {
    return await callback()
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previous
  }
}

function nodeAtLeast(minimum) {
  const current = process.versions.node.split('.').map(Number)
  const required = minimum.split('.').map(Number)
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const left = current[index] ?? 0
    const right = required[index] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return true
}

export async function doctor({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const root = resolve(repositoryRoot)
  const browserRoot = join(root, 'scratch', 'verification-browsers')
  const packageJson = readJsonFile(join(root, 'package.json'))
  const checks = [
    {
      id: 'node-version',
      ok: nodeAtLeast(packageJson.engines?.node?.replace(/^>=/, '') ?? '22.12.0'),
      detail: `Node ${process.versions.node}; required ${packageJson.engines?.node ?? '>=22.12.0'}.`,
    },
    {
      id: 'repository-root',
      ok: existsSync(join(root, 'src', 'App.tsx')) && existsSync(join(root, 'package.json')),
      detail: root,
    },
    {
      id: 'vite-dependency',
      ok: existsSync(join(root, 'node_modules', 'vite', 'package.json')),
      detail: 'Install project dependencies with npm install if missing.',
    },
    {
      id: 'playwright-dependency',
      ok: existsSync(join(root, 'node_modules', 'playwright', 'package.json')),
      detail: 'The verifier uses the repository-local Playwright devDependency.',
    },
  ]

  let browserPath = null
  let browserOk = false
  let browserError = null
  try {
    await withBrowserPath(browserRoot, async () => {
      const { chromium } = await import('playwright')
      browserPath = selectedBrowserExecutable() ?? chromium.executablePath()
      browserOk = existsSync(browserPath)
    })
  } catch (error) {
    browserError = error instanceof Error ? error.message : String(error)
  }
  checks.push({
      id: 'playwright-chromium',
    ok: browserOk,
    detail: browserOk
      ? `${process.env.ATLAS_BROWSER_EXECUTABLE ? 'Explicit system Chromium' : 'Bundled Chromium'} is installed at ${browserPath}.`
      : `Install bundled Chromium with: PLAYWRIGHT_BROWSERS_PATH=scratch/verification-browsers npx playwright install chromium${browserError ? ` (${browserError})` : ''}`,
  })

  let fingerprint
  try {
    fingerprint = sourceManifest({ repositoryRoot: root })
    checks.push({ id: 'source-fingerprint', ok: true, detail: fingerprint.sourceFingerprint })
  } catch (error) {
    checks.push({
      id: 'source-fingerprint',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  return {
    ok: checks.every((check) => check.ok),
    command: 'doctor',
    repositoryRoot: root,
    browserCache: browserRoot,
    sourceFingerprint: fingerprint?.sourceFingerprint ?? null,
    headSha: fingerprint?.headSha ?? null,
    checks,
    limitations: BASE_LIMITATIONS,
  }
}

export function listFeatures() {
  return {
    ok: true,
    command: 'list',
    features: FEATURE_REGISTRY.map((feature) => ({
      id: feature.id,
      title: feature.title,
      route: feature.route,
      journey: feature.journey,
      assertions: feature.assertions,
      sourceFiles: feature.sourceFiles,
      testFiles: feature.testFiles,
      limits: feature.limits,
    })),
  }
}

/** Validate output ancestors before any runtime, profile, manifest or screenshot is written. */
export function prepareControlRoots({ repositoryRoot = REPOSITORY_ROOT } = {}) {
  const root = resolve(repositoryRoot)
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('Verifier repository root must have real directory ancestors.')
  const scratch = join(root, 'scratch')
  const paths = [scratch, join(scratch, 'control-atlas-evidence'), join(scratch, 'control-atlas-runtime')]
  // Check all existing ancestors before creating any missing directories.
  for (const path of paths) {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Verifier scratch, evidence and runtime roots must be real directories.')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const path of paths) if (!existsSync(path)) mkdirSync(path, { recursive: false })
  return { scratch, evidenceRoot: paths[1], runtimeRoot: paths[2] }
}

function createRuntime(runId) {
  prepareControlRoots()
  const runtimeDir = join(RUNTIME_ROOT, runId)
  mkdirSync(runtimeDir, { recursive: false })
  writeJsonFile(join(runtimeDir, OWNER_FILE), {
    kind: 'control-atlas-runtime',
    runId,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  })
  const publicDir = join(runtimeDir, 'public')
  mkdirSync(publicDir, { recursive: true })
  return { runtimeDir, publicDir }
}

function populateRuntime(runtime) {
  const { runtimeDir, publicDir } = runtime
  mkdirSync(join(publicDir, 'gallery'), { recursive: true })
  mkdirSync(join(publicDir, 'maps'), { recursive: true })
  const dataset = syntheticAtlas()
  writeJsonFile(join(publicDir, 'atlas.json'), dataset)
  writeJsonFile(join(publicDir, 'epochs.json'), syntheticPeriods(dataset))
  writeJsonFile(join(publicDir, 'gallery', 'manifest.json'), syntheticGallery(dataset))
  writeJsonFile(join(publicDir, 'gallery', 'synthetic-atlas.json'), dataset)
  writeJsonFile(join(publicDir, 'maps', 'output.json'), syntheticCandidateMap())
  writeJsonFile(join(publicDir, 'maps', 'history-output.json'), syntheticHistoryCandidateMap())
  return { ...runtime, dataset }
}

function appendAction(actionPath, record) {
  appendFileSync(actionPath, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`)
}

function safeExternalRequest(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

async function startIsolatedVite({ publicDir, runtimeDir }) {
  const { createServer } = await import('vite')
  // Do not load project Vite configuration or env files: the verification server serves
  // only the synthetic publicDir and uses the same React transform plugin.
  const server = await createServer({
    root: REPOSITORY_ROOT,
    configFile: false,
    envFile: false,
    envDir: false,
    envPrefix: ['CONTROL_ATLAS_FIXTURE_'],
    mode: 'development',
    plugins: [react()],
    publicDir,
    cacheDir: join(runtimeDir, 'vite-cache'),
    logLevel: 'error',
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      open: false,
      cors: false,
      hmr: { host: '127.0.0.1' },
    },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') {
    await server.close()
    throw new Error('Vite did not expose an ephemeral loopback port.')
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, port: address.port }
}

function recordStep({ actionPath, actions, name, assertion, result = 'passed', details = null }) {
  const entry = { name, assertion, result, details }
  actions.push(entry)
  appendAction(actionPath, entry)
}

function browserHealthProblems(events) {
  return {
    consoleErrors: events.consoleErrors,
    pageErrors: events.pageErrors,
    failedRequests: events.failedRequests,
    blockedExternalRequests: events.blockedExternalRequests,
    httpErrors: events.httpErrors,
    ...(events.blockedUnexpectedRequests ? { blockedUnexpectedRequests: events.blockedUnexpectedRequests } : {}),
  }
}

function hasBrowserHealthProblems(events) {
  return Object.values(browserHealthProblems(events)).some((items) => items.length > 0)
}

async function waitForVisible(page, actionPath, actions, locator, label) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 8_000 })
    recordStep({ actionPath, actions, name: 'assert-visible', assertion: label })
  } catch (error) {
    recordStep({ actionPath, actions, name: 'assert-visible', assertion: label, result: 'failed', details: String(error) })
    throw error
  }
}

async function clickAndRecord(page, actionPath, actions, locator, label) {
  try {
    await locator.click({ timeout: 8_000 })
    recordStep({ actionPath, actions, name: 'click', assertion: label })
  } catch (error) {
    recordStep({ actionPath, actions, name: 'click', assertion: label, result: 'failed', details: String(error) })
    throw error
  }
}

async function navigateAndRecord(page, actionPath, actions, url, label) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    recordStep({ actionPath, actions, name: 'navigate', assertion: label, details: new URL(url).pathname + new URL(url).search })
  } catch (error) {
    recordStep({ actionPath, actions, name: 'navigate', assertion: label, result: 'failed', details: String(error) })
    throw error
  }
}

async function assertText(page, actionPath, actions, pattern, label) {
  try {
    const text = await page.locator('body').innerText()
    assert.match(text, pattern)
    recordStep({ actionPath, actions, name: 'assert-text', assertion: label })
  } catch (error) {
    recordStep({ actionPath, actions, name: 'assert-text', assertion: label, result: 'failed', details: String(error) })
    throw error
  }
}

async function assertCandidateMapEvidenceLayout(page, actionPath, actions, phase) {
  const label = `Receipt S1 and its citation labels remain visible without overlap ${phase}.`
  let layout = null
  try {
    layout = await page.evaluate(() => {
      const measure = (selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
        const hit = document.elementFromPoint(left + width / 2, top + height / 2)
        return { left, right, top, bottom, width, height,
          inViewport: width > 0 && height > 0 && left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight,
          unobscured: hit !== null && element.contains(hit),
        }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight }, scrollY,
        receipt: measure('.map-evidence-inspector'),
        source: measure('.map-source-text'),
        citations: measure('.map-inspector-sources'),
        heading: measure('.map-inspector-sources h2'),
        citationId: measure('.map-inspector-sources button span'),
        citationPath: measure('.map-inspector-sources button small'),
      }
    })
    assert.deepEqual(layout.viewport, { width: 1440, height: 1000 })
    for (const [name, box] of Object.entries(layout).filter(([name]) => !['viewport', 'scrollY'].includes(name))) {
      assert.ok(box?.inViewport, `${name} must fit inside the viewport ${phase}`)
      assert.ok(box.unobscured, `${name} must not be obscured ${phase}`)
    }
    assert.ok(layout.receipt.bottom <= layout.citations.top + 0.5, `Receipt inspector must end before its citation section ${phase}`)
    recordStep({ actionPath, actions, name: 'assert-evidence-layout', assertion: label, details: layout })
  } catch (error) {
    recordStep({ actionPath, actions, name: 'assert-evidence-layout', assertion: label, result: 'failed', details: { layout, error: String(error) } })
    throw error
  }
}

async function runJourney({ feature, page, baseUrl, actionPath, actions, runtimeDir, events }) {
  const heading = (name) => page.getByRole('heading', { name, exact: true })
  if (feature.id === 'candidate-map') {
    await navigateAndRecord(page, actionPath, actions, `${baseUrl}/?view=map`, 'Open the candidate map import route.')
    await waitForVisible(page, actionPath, actions, heading('Open a candidate map'), 'Candidate map empty state is rendered.')
    await page.waitForLoadState('networkidle', { timeout: 5_000 })
    recordStep({ actionPath, actions, name: 'assert-network-idle', assertion: 'Initial synthetic route requests have settled before file import.' })
    const requestCountBeforeImport = events.requests.length
    const input = page.locator('input[type="file"][aria-label="Choose output.json or reviewed-output.json"]')
    try {
      await input.setInputFiles(join(runtimeDir, 'public', 'maps', 'output.json'))
      recordStep({ actionPath, actions, name: 'file-import', assertion: 'Select the synthetic output.json file in the local browser session.', details: 'output.json' })
    } catch (error) {
      recordStep({ actionPath, actions, name: 'file-import', assertion: 'Select the synthetic output.json file in the local browser session.', result: 'failed', details: String(error) })
      throw error
    }
    const mapHeading = heading('Synthetic Candidate Map')
    await waitForVisible(page, actionPath, actions, mapHeading, 'Synthetic output.json was imported in the local browser session.')
    await page.waitForLoadState('networkidle', { timeout: 5_000 })
    const requestsAfterImport = events.requests.slice(requestCountBeforeImport)
    if (requestsAfterImport.length) {
      recordStep({ actionPath, actions, name: 'assert-local-import-side-effect', assertion: 'File import produces no network requests.', result: 'failed', details: requestsAfterImport })
      throw new Error('Candidate-map file import triggered a network request.')
    }
    recordStep({ actionPath, actions, name: 'assert-local-import-side-effect', assertion: 'File import produces no network requests.', details: { baselineRequestCount: requestCountBeforeImport, subsequentRequests: requestsAfterImport } })
    await assertText(page, actionPath, actions, /File imports are never uploaded\./, 'The UI states that file imports are never uploaded.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'S1', exact: true }).first(), 'Select cited source receipt S1.')
    await waitForVisible(page, actionPath, actions, page.locator('.map-source-text').filter({ hasText: 'export function lookup(key)' }), 'Evidence inspector displays the cited source text.')
    await assertCandidateMapEvidenceLayout(page, actionPath, actions, 'after opening the receipt')
    const scroll = await page.locator('.map-explorer').evaluate(element => {
      const before = window.scrollY
      const requested = element.getBoundingClientRect().top + before + 200
      window.scrollTo(0, requested)
      return { before, requested }
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const afterScroll = await page.evaluate(() => window.scrollY)
    assert.notEqual(afterScroll, scroll.before, 'The receipt layout check must exercise a changed page scroll position.')
    recordStep({ actionPath, actions, name: 'scroll', assertion: 'Scroll the page through the candidate detail while retaining the receipt sidebar.', details: { ...scroll, after: afterScroll } })
    await assertCandidateMapEvidenceLayout(page, actionPath, actions, 'after scrolling the page')
    await assertText(page, actionPath, actions, /Independent verification: not performed/, 'Candidate map keeps independent verification marked not performed.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'History', exact: true }), 'Navigate to history without inferring evolution from a snapshot.')
    await waitForVisible(page, actionPath, actions, heading('No cross-revision history included'), 'Snapshot-only artifact exposes the missing history boundary.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'Evidence store', exact: true }), 'Open the included evidence catalog.')
    await clickAndRecord(page, actionPath, actions, page.locator('.map-receipt-catalog button').first(), 'Open a stored receipt from outside the selected capability.')
    await waitForVisible(page, actionPath, actions, page.locator('.map-source-text').filter({ hasText: 'export function lookup(key)' }), 'Evidence catalog returns to the focused receipt inspector.')
    await page.locator('#map-capability-search').fill('no matching capability')
    await input.setInputFiles(join(runtimeDir, 'public', 'maps', 'output.json'))
    await waitForVisible(page, actionPath, actions, page.getByRole('button', { name: 'Synthetic catalog lookup', exact: false }).first(), 'Repeated import clears the previous map search.')
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') })
    await waitForVisible(page, actionPath, actions, page.getByRole('alert'), 'Invalid replacement reports an error without discarding the current map.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'Dismiss', exact: true }), 'Dismiss the invalid import error.')
    await waitForVisible(page, actionPath, actions, mapHeading, 'Dismissal retains the valid candidate map.')

    let releaseRoute
    const delayedRoute = new Promise(resolve => { releaseRoute = resolve })
    await page.route('**/maps/output.json', async route => { await delayedRoute; await route.continue().catch(() => undefined) }, { times: 1 })
    await page.locator('#map-local-route').fill('/maps/output.json')
    const requestStarted = page.waitForRequest('**/maps/output.json')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'Open map', exact: true }), 'Begin a delayed same-origin map request.')
    await requestStarted
    await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') })
    await waitForVisible(page, actionPath, actions, page.getByRole('alert'), 'Invalid file interrupts the pending route with a visible error.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'Dismiss', exact: true }), 'Dismiss the interrupted import error.')
    releaseRoute()
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'Open map', exact: true }), 'Retry the unchanged map route after interruption.')
    await waitForVisible(page, actionPath, actions, mapHeading, 'An unchanged route can be retried after a failed replacement.')
    await input.setInputFiles(join(runtimeDir, 'public', 'maps', 'history-output.json'))
    await waitForVisible(page, actionPath, actions, heading('Synthetic History Map'), 'A descendant map replaces the snapshot.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'History', exact: true }), 'Open the cross-revision history projection.')
    await waitForVisible(page, actionPath, actions, heading('What changed between revisions'), 'Observed revision changes remain separate from candidate lineage.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: 'H1', exact: true }), 'Follow a history claim to its diff receipt.')
    await waitForVisible(page, actionPath, actions, page.getByText('Observed Git diff', { exact: true }).first(), 'History selection opens an observed diff in the focused inspector.')
    await clickAndRecord(page, actionPath, actions, page.locator('.map-receipt-catalog button').filter({ hasText: 'R1' }), 'Inspect a cached interpretation from the evidence catalog.')
    await waitForVisible(page, actionPath, actions, page.locator('.map-evidence-inspector').getByText('Cached candidate reading', { exact: true }), 'Cached model readings are not labeled observed Git.')
    await clickAndRecord(page, actionPath, actions, page.getByText('Full saved receipt', { exact: true }), 'Inspect the structured reading without hiding its interpretation status.')
    await waitForVisible(page, actionPath, actions, page.getByText('A fictional cached reading of catalog lookup.', { exact: false }), 'Structured receipt content remains inspectable.')
    await waitForVisible(page, actionPath, actions, heading('Earlier interpretations consulted'), 'Prior maps and cached readings consulted are listed as candidate context.')
    await waitForVisible(page, actionPath, actions, page.getByText('1 of 4 candidate capabilities looked up', { exact: false }), 'Prior-map usage reports looked-up and unopened capabilities.')
    await waitForVisible(page, actionPath, actions, heading('Graph comparisons and decisions'), 'Integration comparisons and decisions are shown with the history.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: /^Baseline map/ }), 'Switch to the baseline candidate map.')
    await waitForVisible(page, actionPath, actions, heading('Baseline catalog lookup'), 'The baseline graph replaces the current map in the capability view.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: /^Current map/ }), 'Return to the current candidate map.')
    await waitForVisible(page, actionPath, actions, page.locator('#map-capability-title'), 'The current map is restored.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'Provenance', exact: true }), 'Open the provenance pins.')
    await waitForVisible(page, actionPath, actions, page.getByText('Integration packet sha256', { exact: true }), 'Replay pins are shown without validating the interpretation.')
    await clickAndRecord(page, actionPath, actions, page.locator('.map-receipt-catalog button').filter({ hasText: 'Q1' }), 'Inspect source-search navigation provenance.')
    await waitForVisible(page, actionPath, actions, page.locator('.map-evidence-inspector').getByText('Observed source search (navigation only)', { exact: true }), 'Source search is observed navigation.')
    await waitForVisible(page, actionPath, actions, page.getByText('Search results are navigation only; they cannot support behavior claims without inspected source evidence.', { exact: true }), 'Search hits do not establish behavioral claims.')
    await page.setViewportSize({ width: 390, height: 844 })
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'Evidence store', exact: true }), 'Open evidence navigation on a narrow viewport.')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'The mobile map must not overflow horizontally.')
    recordStep({ actionPath, actions, name: 'assert-mobile-width', assertion: 'Candidate map fits a 390px viewport without horizontal overflow.' })
    return
  }

  if (feature.id === 'gallery') {
    await navigateAndRecord(page, actionPath, actions, `${baseUrl}/`, 'Open the synthetic gallery index.')
    await waitForVisible(page, actionPath, actions, heading('Understand a codebase through evidence.'), 'Gallery index renders from the synthetic manifest.')
    await page.screenshot({ path: join(dirname(actionPath), 'entry.png'), fullPage: true, animations: 'disabled' })
    await clickAndRecord(page, actionPath, actions, page.getByRole('link', { name: 'Open a candidate capability map', exact: true }), 'Open the current engine workspace from the primary entry.')
    await waitForVisible(page, actionPath, actions, heading('Open a candidate map'), 'Current engine entry opens without an atlas dataset.')
    await page.goBack()
    await waitForVisible(page, actionPath, actions, heading('Understand a codebase through evidence.'), 'Browser Back restores the front door.')
    await clickAndRecord(page, actionPath, actions, page.getByRole('button', { name: /Synthetic Gallery Project/ }), 'Open the synthetic gallery subject.')
    await waitForVisible(page, actionPath, actions, heading('Read the codebase as a history of capabilities.'), 'Gallery subject opens its matching synthetic dataset.')
    try {
      assert.match(page.url(), /repo=synthetic/)
      recordStep({ actionPath, actions, name: 'assert-route', assertion: 'Gallery subject selection is reflected in the URL.' })
    } catch (error) {
      recordStep({ actionPath, actions, name: 'assert-route', assertion: 'Gallery subject selection is reflected in the URL.', result: 'failed', details: String(error) })
      throw error
    }
    return
  }

  await navigateAndRecord(page, actionPath, actions, `${baseUrl}/?repo=synthetic&view=overview`, 'Open the synthetic repository overview.')
  await waitForVisible(page, actionPath, actions, heading('Read the codebase as a history of capabilities.'), 'Synthetic atlas overview renders.')

  if (feature.id === 'overview') {
    await assertText(page, actionPath, actions, /1\s*candidate features/, 'Overview shows the synthetic candidate feature count.')
    return
  }

  const navNames = {
    repository: 'Repository',
    periods: 'Periods',
    features: 'Features',
    people: 'People',
    identity: 'Manage identities',
  }
  const navigationControl = feature.id === 'identity'
    ? page.getByRole('button', { name: /^Manage identities\b/ })
    : page.getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('button', { name: navNames[feature.id], exact: true })
  await clickAndRecord(page, actionPath, actions, navigationControl, `Open ${feature.title}.`)

  if (feature.id === 'repository') {
    await waitForVisible(page, actionPath, actions, heading('See how the codebase changed shape.'), 'Repository time machine heading renders.')
    const previous = page.getByRole('button', { name: '← Previous', exact: true })
    await waitForVisible(page, actionPath, actions, previous, 'Checkpoint navigation is available.')
    await clickAndRecord(page, actionPath, actions, previous, 'Move from the latest checkpoint to the previous checkpoint.')
    await assertText(page, actionPath, actions, /1\s*\/\s*2/, 'The checkpoint position updates after navigation.')
    return
  }

  if (feature.id === 'periods') {
    await waitForVisible(page, actionPath, actions, heading('Periods'), 'Periods view renders the head-matched synthetic document.')
    const period = page.getByRole('button', { name: /Synthetic epoch/ })
    await clickAndRecord(page, actionPath, actions, period, 'Open the synthetic period detail.')
    await waitForVisible(page, actionPath, actions, heading('Synthetic epoch'), 'Selected period details render.')
    return
  }

  if (feature.id === 'features') {
    await waitForVisible(page, actionPath, actions, page.getByText('Feature stories', { exact: true }), 'Feature story view renders.')
    const candidate = page.getByRole('button', { name: /Synthetic catalog feature/ }).first()
    await clickAndRecord(page, actionPath, actions, candidate, 'Select the synthetic candidate feature.')
    await waitForVisible(page, actionPath, actions, page.getByText('Synthetic catalog feature', { exact: true }).first(), 'Selected candidate feature appears in the story view.')
    return
  }

  if (feature.id === 'people') {
    await waitForVisible(page, actionPath, actions, heading('Trace authored evidence without turning it into a score.'), 'People view renders.')
    const contributorSelector = page.getByRole('combobox', { name: /^Contributor\b/ })
    await waitForVisible(page, actionPath, actions, contributorSelector, 'Synthetic contributor selector is available.')
    try {
      await contributorSelector.selectOption('contributor:ada-alt')
      recordStep({ actionPath, actions, name: 'select', assertion: 'Select the second synthetic contributor identity.', details: 'contributor:ada-alt' })
    } catch (error) {
      recordStep({ actionPath, actions, name: 'select', assertion: 'Select the second synthetic contributor identity.', result: 'failed', details: String(error) })
      throw error
    }
    await waitForVisible(page, actionPath, actions, page.getByRole('button', { name: 'Authored commit bbbbbbb: Add synthetic catalog check', exact: true }), 'Selected contributor shows the commit attributed to its synthetic identity.')
    await assertText(page, actionPath, actions, /Ada Example/, 'The people view shows synthetic Git authorship context.')
    return
  }

  if (feature.id === 'identity') {
    await waitForVisible(page, actionPath, actions, heading('Confirm which Git identities belong together.'), 'Identity review page renders.')
    await waitForVisible(page, actionPath, actions, heading('Review likely Git identity matches'), 'Synthetic identity match is available for review.')
    await assertText(page, actionPath, actions, /Ada Example/, 'The isolated identity review shows only synthetic candidate names.')
    return
  }

  throw new Error(`No journey is implemented for ${feature.id}.`)
}

async function captureFeatureEvidence({ featureDir, page, events, actions, traceActive, context }) {
  const result = { screenshot: null, viewportScreenshot: null, domText: null, domHtml: null, trace: null }
  try {
    const viewportScreenshot = join(featureDir, 'viewport.png')
    await page.screenshot({ path: viewportScreenshot, fullPage: false, animations: 'disabled' })
    result.viewportScreenshot = viewportScreenshot
  } catch (error) {
    events.captureErrors.push({ artifact: 'viewport-screenshot', error: String(error) })
  }
  try {
    const screenshot = join(featureDir, 'rendered.png')
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' })
    result.screenshot = screenshot
  } catch (error) {
    events.captureErrors.push({ artifact: 'screenshot', error: String(error) })
  }
  try {
    const body = await page.locator('body').innerText({ timeout: 3_000 })
    result.domText = join(featureDir, 'dom.txt')
    writeFileSync(result.domText, `${body}\n`, { flag: 'w' })
    result.domHtml = join(featureDir, 'page.html')
    writeFileSync(result.domHtml, await page.content(), { flag: 'w' })
  } catch (error) {
    events.captureErrors.push({ artifact: 'dom', error: String(error) })
  }
  if (traceActive) {
    try {
      result.trace = join(featureDir, 'trace.zip')
      await context.tracing.stop({ path: result.trace })
    } catch (error) {
      result.trace = null
      events.captureErrors.push({ artifact: 'trace', error: String(error) })
    }
  }
  return result
}

async function runOneFeature({ feature, baseUrl, browser, runtimeDir, evidenceDir, trace, journey = runJourney, permittedPaths = null, allowMissingEpochs = false }) {
  const featureDir = join(evidenceDir, 'features', feature.id)
  mkdirSync(featureDir, { recursive: true })
  const actionPath = join(featureDir, 'actions.jsonl')
  const actions = []
  const events = { requests: [], consoleErrors: [], pageErrors: [], cancelledRequests: [], failedRequests: [], blockedExternalRequests: [], httpErrors: [], captureErrors: [] }
  if (permittedPaths) events.blockedUnexpectedRequests = []
  if (allowMissingEpochs) events.allowedOptionalEpochs = []
  let context = null
  let page = null
  let traceActive = false
  let failure = null
  let captured = { screenshot: null, viewportScreenshot: null, domText: null, domHtml: null, trace: null }
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', ...(permittedPaths ? { serviceWorkers: 'block' } : {}) })
    if (permittedPaths) {
      context.setDefaultTimeout(8_000)
      context.setDefaultNavigationTimeout(15_000)
    }
    if (permittedPaths) await context.routeWebSocket('**/*', socket => {
      events.blockedUnexpectedRequests.push(safeExternalRequest(socket.url()))
      socket.close()
    })
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url()
      let requestOrigin = null
      try { requestOrigin = new URL(requestUrl).origin } catch { /* route will be blocked */ }
      if (requestOrigin !== baseUrl) {
        events.blockedExternalRequests.push(safeExternalRequest(requestUrl))
        await route.abort()
      } else {
        const parsed = new URL(requestUrl)
        if (permittedPaths && (!permittedPaths.has(parsed.pathname) || (parsed.search && parsed.pathname !== '/') || !['GET', 'HEAD'].includes(route.request().method()))) {
          events.blockedUnexpectedRequests.push(safeExternalRequest(requestUrl))
          await route.abort()
        } else await route.continue()
      }
    })
    page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const optionalEpochError = allowMissingEpochs && message.location().url === `${baseUrl}/epochs.json` && /404/.test(message.text())
        if (optionalEpochError) events.allowedOptionalEpochs.push({ kind: 'console', path: '/epochs.json', message: message.text() })
        else events.consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => events.pageErrors.push(error.message))
    page.on('requestfailed', (request) => {
      const failed = {
        method: request.method(),
        resourceType: request.resourceType(),
        url: safeExternalRequest(request.url()),
        error: request.failure()?.errorText ?? null,
      }
      let pathname = null
      try { pathname = new URL(request.url()).pathname } catch { /* retained as a genuine failed request */ }
      if (failed.error === 'net::ERR_ABORTED' && failed.method === 'GET' && failed.resourceType === 'fetch' && EXPECTED_FETCH_CANCEL_PATHS.has(pathname)) {
        events.cancelledRequests.push(failed)
      } else {
        events.failedRequests.push(failed)
      }
    })
    page.on('request', (request) => events.requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: safeExternalRequest(request.url()),
      hasQuery: new URL(request.url()).search.length > 0,
      queryKeys: [...new Set(new URL(request.url()).searchParams.keys())].sort(),
    }))
    page.on('response', (response) => {
      if (response.status() >= 400) {
        if (allowMissingEpochs && response.status() === 404 && response.url() === `${baseUrl}/epochs.json` && response.request().method() === 'GET') {
          events.allowedOptionalEpochs.push({ kind: 'response', path: '/epochs.json', status: 404 })
        } else events.httpErrors.push({ url: safeExternalRequest(response.url()), status: response.status() })
      }
    })
    if (trace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      traceActive = true
    }
    await journey({ feature, page, baseUrl, actionPath, actions, runtimeDir, events, featureDir })
    if (hasBrowserHealthProblems(events)) {
      throw new Error('Browser emitted a page/console error, failed request, blocked external request, or HTTP error; inspect browser-events.json.')
    }
    recordStep({ actionPath, actions, name: 'assert-browser-health', assertion: allowMissingEpochs
      ? 'No browser errors or unexpected requests; only absent optional /epochs.json GET 404 responses are allowed and recorded.'
      : 'No uncaught page errors, console errors, failed or external requests, or HTTP responses >= 400.', details: allowMissingEpochs ? events.allowedOptionalEpochs : null })
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
    if (!actions.some((action) => action.result === 'failed')) {
      recordStep({ actionPath, actions, name: 'journey', assertion: 'Journey completes without an uncaught error.', result: 'failed', details: failure.message })
    }
  } finally {
    if (page) {
      captured = await captureFeatureEvidence({ featureDir, page, events, actions, traceActive, context })
      if (hasBrowserHealthProblems(events) && !failure) {
        failure = new Error('Browser health changed while capturing rendered evidence; inspect browser-events.json.')
        recordStep({ actionPath, actions, name: 'assert-browser-health-after-capture', assertion: 'Evidence capture does not add browser errors or failed requests.', result: 'failed', details: browserHealthProblems(events) })
      }
      await page.close().catch((error) => events.captureErrors.push({ artifact: 'page-close', error: String(error) }))
    }
    if (context) await context.close().catch((error) => events.captureErrors.push({ artifact: 'context-close', error: String(error) }))
    if (hasBrowserHealthProblems(events) && !failure) {
      failure = new Error('Browser health changed during isolated context teardown; inspect browser-events.json.')
      recordStep({ actionPath, actions, name: 'assert-browser-health-after-teardown', assertion: 'Browser teardown leaves no unexpected errors or failed requests.', result: 'failed', details: browserHealthProblems(events) })
    }
    if (!failure && events.captureErrors.length) {
      failure = new Error('Could not capture all required browser evidence; inspect browser-events.json.')
    }
    writeJsonFile(join(featureDir, 'actions.json'), actions)
    writeJsonFile(join(featureDir, 'browser-events.json'), events)
  }
  return {
    id: feature.id,
    title: feature.title,
    status: failure ? 'failed' : 'passed',
    route: feature.route,
    actions,
    assertions: actions.filter((entry) => entry.name.startsWith('assert-')).map((entry) => ({ name: entry.name, result: entry.result, assertion: entry.assertion })),
    artifacts: {
      screenshot: captured.screenshot,
      viewportScreenshot: captured.viewportScreenshot,
      domText: captured.domText,
      domHtml: captured.domHtml,
      actionLog: actionPath,
      actionSummary: join(featureDir, 'actions.json'),
      browserEvents: join(featureDir, 'browser-events.json'),
      trace: captured.trace,
    },
    error: failure ? { name: failure.name, message: failure.message, stack: failure.stack } : null,
    limitations: feature.limits,
  }
}

export async function verifyFeatures({ featureIds, all = false, trace = false } = {}) {
  const selectedIds = all ? FEATURE_IDS : featureIds
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) throw new Error('Choose one or more features with --feature NAME or --all.')
  const unknown = selectedIds.filter((id) => !FEATURE_IDS.includes(id))
  if (unknown.length) throw new Error(`Unknown feature id(s): ${unknown.join(', ')}. Run list to see supported features.`)
  const selectedFeatures = selectedIds.map((id) => getFeature(id))
  const source = sourceManifest({ features: selectedFeatures })
  const runId = createRunId()
  prepareControlRoots()
  const evidenceDir = join(EVIDENCE_ROOT, runId)
  mkdirSync(evidenceDir, { recursive: false })
  writeJsonFile(join(evidenceDir, EVIDENCE_MARKER), { kind: 'control-atlas-evidence', runId, createdAt: new Date().toISOString() })
  writeJsonFile(join(evidenceDir, 'source-manifest.json'), source)

  const report = {
    ok: false,
    command: 'verify',
    runId,
    startedAt: new Date().toISOString(),
    repositoryRoot: REPOSITORY_ROOT,
    sourceFingerprint: source.sourceFingerprint,
    headSha: source.headSha,
    testedFeatures: selectedIds,
    evidenceDir,
    browser: { name: 'Playwright Chromium', isolatedProfile: true, host: '127.0.0.1' },
    results: [],
    runtimeTeardown: null,
    limitations: [...BASE_LIMITATIONS],
  }
  let runtime = null
  let browser = null
  let vite = null
  let browserTemp = null
  try {
    runtime = createRuntime(runId)
    runtime = populateRuntime(runtime)
    const { baseUrl, server } = await startIsolatedVite(runtime)
    vite = server
    report.baseUrl = baseUrl
    // Chromium's Unix socket path must fit even when the checkout is deeply nested.
    browserTemp = mkdtempSync(join(tmpdir(), 'atlas-ui-'))
    const env = {
      PATH: process.env.PATH ?? '',
      TMPDIR: browserTemp,
      TEMP: browserTemp,
      TMP: browserTemp,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    }
    browser = await withBrowserPath(BROWSER_ROOT, async () => {
      const { chromium } = await import('playwright')
      return chromium.launch({ headless: true, env, executablePath: selectedBrowserExecutable() })
    })
    report.browser = { ...report.browser, executablePath: selectedBrowserExecutable() ?? 'bundled Chromium', version: browser.version() }
    for (const feature of selectedFeatures) {
      const result = await runOneFeature({ feature, baseUrl, browser, runtimeDir: runtime.runtimeDir, evidenceDir, trace })
      report.results.push(result)
    }
  } catch (error) {
    report.setupError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }
  } finally {
    if (browser) await browser.close().catch((error) => { report.browserTeardownError = String(error) })
    if (browserTemp) rmSync(browserTemp, { recursive: true, force: true })
    if (vite) await vite.close().catch((error) => { report.viteTeardownError = String(error) })
    if (runtime) {
      try {
        report.runtimeTeardown = cleanupRun({ runId, apply: true, allowCurrentProcess: true })
      } catch (error) {
        report.runtimeTeardown = { ok: false, status: 'failed', runId, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  try {
    const finalSource = sourceManifest({ features: selectedFeatures })
    report.finalSourceFingerprint = finalSource.sourceFingerprint
    report.sourceChanged = finalSource.sourceFingerprint !== source.sourceFingerprint
    if (report.sourceChanged) {
      const initialHashes = new Map(source.files.map((entry) => [entry.path, entry.sha256]))
      report.sourceDifferences = finalSource.files
        .filter((entry) => initialHashes.get(entry.path) !== entry.sha256)
        .map(({ path }) => path)
    }
  } catch (error) {
    report.sourceRecheckError = error instanceof Error ? error.message : String(error)
  }
  report.finishedAt = new Date().toISOString()
  report.ok = !report.setupError
    && !report.browserTeardownError
    && !report.viteTeardownError
    && !report.sourceChanged
    && !report.sourceRecheckError
    && report.results.length === selectedFeatures.length
    && report.results.every((result) => result.status === 'passed')
    && report.runtimeTeardown?.status === 'cleaned'
  const summaryPath = join(evidenceDir, 'report.json')
  writeJsonFile(summaryPath, report)
  report.report = summaryPath
  return report
}

/** Explicit private inspection of a prepared production build; this never approves publication. */
export async function verifyPreview(options) {
  const preview = loadPreviewBuild(options)
  const readiness = await doctor()
  if (!readiness.ok) return { ok: false, command: 'verify-preview', doctor: readiness, publicationApproval: false }
  const features = [getFeature('gallery'), getFeature('overview'), getFeature('repository')]
  const source = sourceManifest({ features })
  prepareControlRoots()
  const runId = createRunId(), evidenceDir = join(EVIDENCE_ROOT, runId)
  mkdirSync(evidenceDir, { recursive: false })
  writeJsonFile(join(evidenceDir, EVIDENCE_MARKER), { kind: 'control-atlas-evidence', runId, createdAt: new Date().toISOString() })
  writeJsonFile(join(evidenceDir, 'source-manifest.json'), source)
  writeJsonFile(join(evidenceDir, 'build-manifest.json'), preview.build)
  const limitations = [
    'This is a private inspection of explicitly inventoried prepared production bytes; it does not approve publication or attest plugin emission.',
    'The inventory code revision is caller-declared provenance. Served-byte hashes do not establish which source commit produced the bundle.',
    'The sole gallery card, overview, an available previous checkpoint and selected observed commit evidence are exercised at 1440 × 1000. This does not establish semantic accuracy, licensing approval or exhaustive history coverage.',
    'The browser has a fresh profile and sterile environment; external requests and requests outside the inventory are blocked.',
  ]
  const report = { ok: false, command: 'verify-preview', dataMode: 'prepared-private-preview', publicationApproval: false,
    runId, startedAt: new Date().toISOString(), repositoryRoot: REPOSITORY_ROOT, headSha: source.headSha,
    sourceFingerprint: source.sourceFingerprint, build: preview.build, expected: preview.expected,
    directory: preview.directory, inventory: preview.inventory, evidenceDir, testedFeatures: ['gallery', 'overview', 'repository'],
    browser: { name: 'Playwright Chromium', isolatedProfile: true, host: '127.0.0.1' }, results: [], limitations,
  }
  let runtime, browser, hosted, browserTemp
  try {
    runtime = createRuntime(runId)
    hosted = await startPreviewServer(preview)
    report.baseUrl = hosted.baseUrl
    browserTemp = mkdtempSync(join(tmpdir(), 'atlas-ui-'))
    const env = { PATH: process.env.PATH ?? '', TMPDIR: browserTemp, TEMP: browserTemp, TMP: browserTemp, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
    browser = await withBrowserPath(BROWSER_ROOT, async () => (await import('playwright')).chromium.launch({ headless: true, env, executablePath: selectedBrowserExecutable() }))
    report.browser = { ...report.browser, executablePath: selectedBrowserExecutable() ?? 'bundled Chromium', version: browser.version() }
    const feature = { ...features[0], title: 'Private production gallery preview', limits: limitations }
    const result = await runOneFeature({ feature, baseUrl: hosted.baseUrl, browser, runtimeDir: runtime.runtimeDir, evidenceDir,
      permittedPaths: new Set(['/', ...[...preview.files.keys()].map(path => `/${path}`), ...(preview.allowedMissingEpochs ? ['/epochs.json'] : [])]),
      allowMissingEpochs: preview.allowedMissingEpochs,
      journey: args => runPreviewJourney({ ...args, expected: preview.expected, commits: preview.commits,
        record: entry => recordStep({ actionPath: args.actionPath, actions: args.actions, ...entry }),
        navigate: (url, label) => navigateAndRecord(args.page, args.actionPath, args.actions, url, label),
        visible: (locator, label) => waitForVisible(args.page, args.actionPath, args.actions, locator, label),
        click: (locator, label) => clickAndRecord(args.page, args.actionPath, args.actions, locator, label),
      }),
    })
    result.artifacts.galleryViewport = join(evidenceDir, 'features', 'gallery', 'gallery-viewport.png')
    result.artifacts.galleryScreenshot = join(evidenceDir, 'features', 'gallery', 'gallery-rendered.png')
    for (const surface of ['overview', 'repository']) {
      result.artifacts[`${surface}Viewport`] = join(evidenceDir, 'features', 'gallery', `${surface}-viewport.png`)
      result.artifacts[`${surface}Screenshot`] = join(evidenceDir, 'features', 'gallery', `${surface}-rendered.png`)
    }
    report.results.push(result)
  } catch (error) {
    report.setupError = { name: error.name, message: error.message }
  } finally {
    if (browser) await browser.close().catch(error => { report.browserTeardownError = String(error) })
    if (browserTemp) rmSync(browserTemp, { recursive: true, force: true })
    if (hosted) {
      await new Promise(resolve => hosted.server.close(error => { if (error) report.serverTeardownError = String(error); resolve() }))
      writeJsonFile(join(evidenceDir, 'server-requests.json'), hosted.requests)
    }
    if (runtime) {
      try { report.runtimeTeardown = cleanupRun({ runId, apply: true, allowCurrentProcess: true }) }
      catch (error) { report.runtimeTeardown = { ok: false, status: 'failed', error: String(error) } }
    }
  }
  try {
    const finalSource = sourceManifest({ features })
    report.finalSourceFingerprint = finalSource.sourceFingerprint
    report.sourceChanged = finalSource.sourceFingerprint !== source.sourceFingerprint
    const finalBuild = loadPreviewBuild(options)
    report.buildChanged = finalBuild.build.fingerprint !== preview.build.fingerprint || finalBuild.build.inventorySha256 !== preview.build.inventorySha256
  } catch (error) { report.recheckError = String(error) }
  report.finishedAt = new Date().toISOString()
  report.ok = !report.setupError && !report.browserTeardownError && !report.serverTeardownError && !report.sourceChanged
    && !report.buildChanged && !report.recheckError && report.results.length === 1 && report.results[0].status === 'passed' && report.runtimeTeardown?.status === 'cleaned'
  const reportPath = join(evidenceDir, 'report.json')
  writeJsonFile(reportPath, report)
  report.report = reportPath
  return report
}

export function getControlPaths() {
  return {
    repositoryRoot: REPOSITORY_ROOT,
    scratchRoot: SCRATCH_ROOT,
    runtimeRoot: RUNTIME_ROOT,
    evidenceRoot: EVIDENCE_ROOT,
    browserRoot: BROWSER_ROOT,
  }
}


