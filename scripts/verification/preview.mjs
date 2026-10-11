import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' }
const gitEnv = { PATH: process.env.PATH ?? '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function reject(message) { throw new Error(`Private preview: ${message}`) }
function safePath(value) {
  return typeof value === 'string' && value.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && !['.', '..'].includes(part))
}
function realPath(path, directory) {
  if (!isAbsolute(path) || resolve(path) !== path) reject('paths must be absolute and normalized')
  for (let current = path; ; current = dirname(current)) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) reject('symlinks are not accepted')
    if (current === path ? (directory ? !stat.isDirectory() : !stat.isFile()) : !stat.isDirectory()) reject('expected a regular file or directory')
    if (dirname(current) === current) break
  }
}
function ignoredPath(path, directory) {
  realPath(path, directory)
  let root
  try {
    root = execFileSync('git', ['-C', directory ? path : dirname(path), 'rev-parse', '--show-toplevel'], { env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', relative(root, path)], { env: gitEnv, stdio: 'ignore' })
  } catch { reject('preview directory and inventory must be ignored local paths inside a Git checkout') }
  return root
}
function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { reject(`${label} must be valid JSON`) }
}
function exactKeys(object, keys) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key))
}
function scan(directory, prefix = '') {
  const paths = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!safePath(path) || entry.isSymbolicLink()) reject('build contains an unsafe path or symlink')
    if (entry.isDirectory()) paths.push(...scan(join(directory, entry.name), path))
    else if (entry.isFile()) paths.push(path)
    else reject('build contains a non-regular file')
    if (paths.length > 1000) reject('preview inventory is too large')
  }
  return paths.sort()
}

/** Only the explicitly inventoried, ignored prepared build is read; no source cache or raw run is opened. */
export function loadPreviewBuild({ directory, inventory }) {
  if (typeof directory !== 'string' || typeof inventory !== 'string') reject('directory and inventory are required')
  const root = ignoredPath(directory, true)
  if (ignoredPath(inventory, false) !== root || inventory.startsWith(`${directory}/`)) reject('inventory must be outside the build and in the same Git checkout')
  if (lstatSync(inventory).size > 1024 * 1024) reject('inventory is too large')
  const inventoryBytes = readFileSync(inventory)
  const manifest = parseJson(inventoryBytes, 'inventory')
  if (!exactKeys(manifest, ['version', 'sourceRevision', 'files']) || manifest.version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)
    || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1000) reject('expected version 1, full sourceRevision and explicit files')
  const files = new Map()
  let totalBytes = 0
  for (const entry of manifest.files) {
    if (!exactKeys(entry, ['path', 'sha256', 'bytes']) || !safePath(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 64 * 1024 * 1024) reject('invalid inventory entry')
    if (files.has(entry.path) || !TYPES[extname(entry.path)] || !(entry.path === 'index.html' || entry.path === 'epochs.json'
      || ['assets/', 'gallery/', 'approved-snapshots/'].some(prefix => entry.path.startsWith(prefix)))) reject('unexpected or duplicate build path')
    const path = join(directory, entry.path)
    realPath(path, false)
    if (lstatSync(path).size !== entry.bytes) reject(`size mismatch: ${entry.path}`)
    totalBytes += entry.bytes
    if (totalBytes > 128 * 1024 * 1024) reject('preview build is too large')
    const bytes = readFileSync(path)
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) reject(`hash mismatch: ${entry.path}`)
    files.set(entry.path, { ...entry, content: bytes, type: TYPES[extname(entry.path)] })
  }
  assert.deepEqual(scan(directory), [...files.keys()].sort(), 'Private preview: actual build files must exactly match the inventory')
  if (!files.has('index.html') || !files.has('gallery/manifest.json')) reject('build must contain its app and gallery manifest')
  const gallery = parseJson(files.get('gallery/manifest.json').content, 'gallery manifest')
  if (!Array.isArray(gallery.subjects) || gallery.subjects.length !== 1) reject('preview requires exactly one gallery subject')
  const subject = gallery.subjects[0]
  if (!safePath(subject.slug) || subject.slug.includes('/') || typeof subject.title !== 'string' || !subject.title.trim()
    || !safePath(subject.dataset) || !subject.dataset.endsWith('.json')) reject('invalid gallery subject')
  const datasetPath = `gallery/${subject.dataset}`
  if (!files.has(datasetPath)) reject('subject dataset is not inventoried')
  const dataset = parseJson(files.get(datasetPath).content, 'subject dataset')
  for (const key of ['episodes', 'contributors', 'codeAreas', 'featureCandidates']) if (!Array.isArray(dataset[key])) reject(`dataset ${key} must be an array`)
  for (const key of ['semanticEpisodes', 'structuralEpisodes']) if (dataset[key] !== undefined && !Array.isArray(dataset[key])) reject(`dataset ${key} must be an array`)
  if (!/^[a-f0-9]{40}$/.test(subject.headSha) || dataset.repository?.headSha !== subject.headSha) reject('manifest and dataset must agree on the full repository revision')
  if (typeof dataset.repository.name !== 'string' || !dataset.repository.name.trim()) reject('dataset repository name is required')
  const counts = { commits: dataset.episodes.length, contributors: dataset.contributors.length, codeAreas: dataset.codeAreas.length,
    features: dataset.featureCandidates.length, lifecycle: dataset.semanticEpisodes?.length ?? 0, reorganizations: dataset.structuralEpisodes?.length ?? 0 }
  if (subject.commitCount !== counts.commits || subject.contributorCount !== counts.contributors || subject.codeAreaCount !== counts.codeAreas
    || dataset.repository.commitCount !== counts.commits) reject('manifest and dataset counts disagree')
  const metadata = []
  for (const [field, label] of [['notice', 'License notice'], ['provenance', 'Snapshot provenance']]) {
    if (subject[field] === undefined) continue
    const path = subject[field]
    if (typeof path !== 'string' || !path.startsWith('/') || !safePath(path.slice(1)) || !files.has(path.slice(1))
      || !['gallery/', 'approved-snapshots/'].some(prefix => path.slice(1).startsWith(prefix))) reject(`subject ${field} must reference an inventoried same-origin metadata file`)
    metadata.push({ field, label, path, sha256: files.get(path.slice(1)).sha256 })
  }
  const normalizedInventory = [...files.values()].map(({ path, sha256, bytes }) => ({ path, sha256, bytes })).sort((a, b) => a.path.localeCompare(b.path))
  // Retain only fields needed for one selected commit; never serialize the corpus in the report.
  const commits = new Map(dataset.episodes.map(episode => [episode.shortSha, {
    commitSha: episode.commitSha, shortSha: episode.shortSha, subject: episode.subject,
    paths: episode.changes.map(change => change.previousPath ? `${change.previousPath} → ${change.path}` : change.path),
  }]))
  return { directory, inventory, files, commits,
    expected: { slug: subject.slug, title: subject.title, repositoryName: dataset.repository.name, headSha: subject.headSha, datasetPath, datasetSha256: files.get(datasetPath).sha256, counts, metadata },
    build: { declaredSourceRevision: manifest.sourceRevision, inventorySha256: hash(inventoryBytes), fingerprint: hash(JSON.stringify(normalizedInventory)), files: normalizedInventory },
    allowedMissingEpochs: !files.has('epochs.json'),
  }
}

/** Serve immutable validated bytes on an owned loopback port, without filesystem fallback. */
export async function startPreviewServer(preview) {
  const requests = []
  const server = createServer((request, response) => {
    let url
    try { url = new URL(request.url, 'http://127.0.0.1') } catch { response.writeHead(400).end(); return }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = preview.files.get(path)
    const status = !['GET', 'HEAD'].includes(request.method) || (url.search && url.pathname !== '/') ? 400 : file ? 200 : 404
    requests.push({ method: request.method, path: url.pathname, status })
    response.writeHead(status, { 'Content-Type': file?.type ?? 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(status === 200 && request.method !== 'HEAD' ? file.content : undefined)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  return { server, baseUrl, requests }
}

export async function runPreviewJourney({ page, baseUrl, expected, commits, featureDir, record, navigate, visible, click }) {
  const step = async (name, assertion, work) => {
    try { const details = await work(); record({ name, assertion, details }); return details }
    catch (error) { record({ name, assertion, result: 'failed', details: String(error) }); throw error }
  }
  await navigate(`${baseUrl}/`, 'Open the inventoried private production gallery.')
  await visible(page.getByRole('heading', { name: 'How a codebase grew, read from its commits.', exact: true }), 'Prepared production gallery renders.')
  const card = page.locator('.gallery-card')
  await step('assert-preview-card', 'The sole gallery card agrees with the prepared dataset counts and pinned revision.', async () => {
    assert.equal(await card.count(), 1)
    assert.equal(await card.getByRole('heading', { level: 2 }).innerText(), expected.title)
    const counts = await card.locator('.gallery-shape > div').evaluateAll(divs => Object.fromEntries(divs.map(div => [div.querySelector('dt').textContent, div.querySelector('dd').textContent.replace(/,/g, '')])))
    assert.equal(Number(counts.Commits), expected.counts.commits)
    assert.equal(Number(counts.Contributors), expected.counts.contributors)
    assert.equal(Number(counts['Code areas']), expected.counts.codeAreas)
    assert.equal((await card.locator('.gallery-provenance code').innerText()).toLowerCase(), expected.headSha.slice(0, 8))
    return { title: expected.title, headSha: expected.headSha, counts: expected.counts }
  })
  for (const metadata of expected.metadata) {
    await step('assert-preview-metadata', `${metadata.label} points to the inventoried same-origin file and returns exact bytes.`, async () => {
      assert.equal(await card.getByRole('link', { name: metadata.label, exact: true }).getAttribute('href', { timeout: 8_000 }), metadata.path)
      const [response, result] = await Promise.all([
        page.waitForResponse(response => response.url() === `${baseUrl}${metadata.path}`, { timeout: 8_000 }),
        page.evaluate(async path => {
          const response = await fetch(path, { signal: AbortSignal.timeout(8_000) })
          const bytes = await response.arrayBuffer()
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          return { status: response.status, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') }
        }, metadata.path),
      ])
      assert.equal(result.status, 200)
      assert.equal(response.status(), 200)
      assert.equal(result.sha256, metadata.sha256)
      return metadata
    })
  }
  await page.screenshot({ path: join(featureDir, 'gallery-viewport.png'), animations: 'disabled' })
  await page.screenshot({ path: join(featureDir, 'gallery-rendered.png'), fullPage: true, animations: 'disabled' })
  const [datasetResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/${expected.datasetPath}` && response.status() === 200, { timeout: 10_000 }),
    click(card.getByRole('button'), 'Open the sole prepared atlas from its gallery card.'),
  ])
  await step('assert-preview-dataset', 'The browser receives the inventoried dataset bytes and exact full repository revision.', async () => {
    const bytes = await datasetResponse.body()
    assert.equal(hash(bytes), expected.datasetSha256)
    assert.equal(parseJson(bytes, 'browser dataset').repository.headSha, expected.headSha)
    return { dataset: expected.datasetPath, sha256: expected.datasetSha256, headSha: expected.headSha }
  })
  await visible(page.getByRole('heading', { name: 'Read the codebase as a history of capabilities.', exact: true }), 'Prepared atlas repository overview renders.')
  await page.waitForLoadState('networkidle', { timeout: 10_000 })
  await step('assert-preview-overview', 'Repository overview renders the expected counts and revision without a fatal dataset state.', async () => {
    assert.equal(new URL(page.url()).searchParams.get('repo'), expected.slug)
    assert.equal(await page.locator('.product-brand strong').innerText(), expected.repositoryName)
    assert.equal((await page.locator('.repository-meta code').innerText()).toLowerCase(), expected.headSha.slice(0, 8))
    const counts = await page.locator('.overview-metrics > div').evaluateAll(divs => Object.fromEntries(divs.map(div => [div.querySelector('span').textContent, Number(div.querySelector('strong').textContent.replace(/,/g, ''))])))
    assert.equal(counts['observed commits'], expected.counts.commits)
    assert.equal(counts['candidate features'], expected.counts.features)
    assert.equal(counts['lifecycle episodes'], expected.counts.lifecycle)
    assert.equal(counts['repository reorganizations'], expected.counts.reorganizations)
    assert.equal(await page.locator('.fatal-error, .load-error, .map-error').count(), 0)
    return { headSha: expected.headSha, counts, slug: expected.slug }
  })
  await page.screenshot({ path: join(featureDir, 'overview-viewport.png'), animations: 'disabled' })
  await page.screenshot({ path: join(featureDir, 'overview-rendered.png'), fullPage: true, animations: 'disabled' })
  await click(page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('button', { name: 'Repository', exact: true }), 'Open observed repository history.')
  await visible(page.getByRole('heading', { name: 'See how the codebase changed shape.', exact: true }), 'Prepared repository history renders.')
  if (!commits.size) {
    record({ name: 'assert-preview-history', assertion: 'An empty prepared history has no checkpoint or commit evidence to navigate.', details: { checkpointNavigation: 'not available', reason: 'Dataset contains no observed commits.' } })
    await page.screenshot({ path: join(featureDir, 'repository-viewport.png'), animations: 'disabled' })
    await page.screenshot({ path: join(featureDir, 'repository-rendered.png'), fullPage: true, animations: 'disabled' })
    return
  }
  const checkpoint = page.locator('.checkpoint-commit')
  const beforeSha = (await checkpoint.locator('code').innerText()).toLowerCase()
  assert.ok(commits.has(beforeSha), 'Initial checkpoint must resolve to the prepared dataset.')
  const previous = page.getByRole('button', { name: '← Previous', exact: true })
  if (await previous.isEnabled()) {
    const beforeAt = new URL(page.url()).searchParams.get('at')
    await click(previous, 'Move to the previous observed checkpoint.')
    await page.waitForFunction(old => new URL(location.href).searchParams.get('at') !== old, beforeAt)
    await step('assert-preview-checkpoint', 'Previous checkpoint changes the URL and selects a known prepared commit.', async () => {
      const sha = (await checkpoint.locator('code').innerText()).toLowerCase()
      assert.notEqual(sha, beforeSha)
      assert.equal(new URL(page.url()).searchParams.get('at'), sha)
      assert.ok(commits.has(sha), 'Selected checkpoint must resolve to the prepared dataset.')
      return { beforeSha, shortSha: sha, commitSha: commits.get(sha).commitSha }
    })
  } else {
    record({ name: 'assert-preview-checkpoint', assertion: 'The initial checkpoint remains inspectable when Previous is unavailable.', details: { shortSha: beforeSha, checkpointNavigation: 'not available', reason: 'No earlier checkpoint is available.' } })
  }
  const selectedSha = (await checkpoint.locator('code').innerText()).toLowerCase()
  const selected = commits.get(selectedSha)
  await page.screenshot({ path: join(featureDir, 'repository-viewport.png'), animations: 'disabled' })
  await page.screenshot({ path: join(featureDir, 'repository-rendered.png'), fullPage: true, animations: 'disabled' })
  await click(checkpoint, 'Inspect the selected checkpoint commit evidence.')
  const evidence = page.locator('.checkpoint-panel__evidence')
  await visible(evidence.getByText('Observed commit evidence', { exact: true }), 'Observed commit evidence opens for the selected checkpoint.')
  await step('assert-preview-commit-evidence', 'The inspected commit label, revision and touched paths match the selected prepared commit.', async () => {
    assert.equal(await evidence.locator('.inspector-heading h2').innerText(), selected.subject)
    assert.equal((await evidence.locator('.status-line code').innerText()).toLowerCase(), selectedSha)
    const paths = await evidence.locator('.path-list code').allTextContents()
    assert.deepEqual(paths, selected.paths)
    return { shortSha: selectedSha, commitSha: selected.commitSha, touchedPathCount: paths.length, touchedPathsSha256: hash(JSON.stringify(paths)) }
  })
}
