import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { prepareEngine, inspectEngine, engineBroker, checkpointEngine, freezeIntegration, publishEngine } from '../scripts/versions/repository-engine-v2/history/repository-engine-v2.mjs'
import { historyReader } from '../scripts/lib/repository-history.mjs'

const json = x => JSON.stringify(x, null, 2) + '\n'
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, json(value), { flag: 'wx' }) }

function multiCommitFixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repository-history-test-')))
  const repo = root + '/source', out = root + '/run'
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  execFileSync('git', ['init', '-q', repo], { env })
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'test@example.invalid'])

  writeFileSync(repo + '/main.go', 'package main\nfunc main() {}\n')
  git(['add', '--all']); git(['commit', '-qm', 'introduce main']); const c1 = git(['rev-parse', 'HEAD'])

  writeFileSync(repo + '/main.go', 'package main\nfunc main() { run() }\n')
  writeFileSync(repo + '/other.go', 'package main\nfunc other() {}\n')
  git(['add', '--all']); git(['commit', '-qm', 'wire main and add other']); const c2 = git(['rev-parse', 'HEAD'])

  writeFileSync(repo + '/other.go', 'package main\nfunc other() { return }\n')
  git(['add', '--all']); git(['commit', '-qm', 'extend other']); const c3 = git(['rev-parse', 'HEAD'])

  const config = { mode: 'discovery', repo, displayName: 'History fixture', partitionCount: 1 }
  return { root, repo, out, config, git, commits: { c1, c2, c3 } }
}

const node = (id, evidence) => ({
  id, name: 'Synthetic ' + id, summary: 'Synthetic responsibility', actor: 'Synthetic caller',
  inputs: [], outcomes: ['Synthetic result'], conditions: [], exclusions: [], implementations: [],
  uncertainty: [], evidenceIds: [evidence], assessment: 'partial',
  claims: [{ text: 'Synthetic claim', evidenceIds: [evidence], assessment: 'partial' }],
})

test('history helpers expose commit meta, bounded path diff, and path history for multi-commit repos', t => {
  const f = multiCommitFixture(t)
  const history = historyReader(f.repo, f.commits.c3)
  const meta = history.commitMeta(f.commits.c1)
  assert.equal(meta.kind, 'commit-meta')
  assert.equal(meta.commitSha, f.commits.c1)
  assert.equal(meta.subject, 'introduce main')
  assert.equal(meta.isPinned, false)
  assert.deepEqual(meta.parents, [])

  const diff = history.diff(f.commits.c2, 'main.go')
  assert.equal(diff.kind, 'diff')
  assert.equal(diff.path, 'main.go')
  assert.ok(diff.files.some(file => file.path === 'main.go'))
  assert.ok(!diff.files.some(file => file.path === 'other.go'))
  assert.match(diff.text, /run\(\)/)

  const pathHistory = history.pathHistory('main.go', 10, 0)
  assert.equal(pathHistory.kind, 'path-history')
  assert.equal(pathHistory.returned, 2)
  assert.deepEqual(pathHistory.commits.map(c => c.commitSha), [f.commits.c2, f.commits.c1])
  assert.throws(() => history.commitMeta('0'.repeat(40)), /not found|not an ancestor/)
})

test('current history diffs ignore replacement refs and caller Git environment', t => {
  const f = multiCommitFixture(t)
  const history = historyReader(f.repo, f.commits.c3)
  const original = history.diff(f.commits.c2, 'main.go')
  f.git(['replace', f.commits.c2, f.commits.c1])
  assert.deepEqual(history.diff(f.commits.c2, 'main.go'), original)
  const previous = process.env.GIT_EXTERNAL_DIFF
  try {
    process.env.GIT_EXTERNAL_DIFF = '/nonexistent/forbidden-diff-tool'
    assert.deepEqual(history.diff(f.commits.c2, 'main.go'), original)
    history.verify({ ...original, id: 'proof' })
  } finally {
    if (previous === undefined) delete process.env.GIT_EXTERNAL_DIFF
    else process.env.GIT_EXTERNAL_DIFF = previous
  }
})

test('pathless history diff withholds restricted paths before rendering a patch', t => {
  const f = multiCommitFixture(t)
  writeFileSync(f.repo + '/.env', 'SYNTHETIC_PRIVATE_ENV_SENTINEL=do-not-read\n')
  writeFileSync(f.repo + '/main.go', 'package main\nfunc main() { run(); more() }\n')
  f.git(['add', '--all'])
  f.git(['commit', '-qm', 'update source and environment'])
  const current = f.git(['rev-parse', 'HEAD'])
  const history = historyReader(f.repo, current)
  const diff = history.diff(current)
  assert.equal(diff.path, null)
  assert.equal(diff.withheldPathCount, 2)
  assert.equal(diff.partial, true)
  assert.deepEqual(diff.files, [])
  assert.equal(diff.text, '')
  assert.doesNotMatch(diff.text, /SYNTHETIC_PRIVATE_ENV_SENTINEL|\.env/)
  assert.throws(() => history.diff(current, '.env'), /not eligible/)
  const explicit = history.diff(current, 'main.go')
  assert.equal(explicit.partial, true)
  assert.deepEqual(explicit.files, [])
  assert.equal(explicit.text, '')
  history.verify({ ...diff, id: 'pathless-safe-diff' })
})

test('history diff withholds a safe-looking rename destination of a restricted file', t => {
  const f = multiCommitFixture(t)
  writeFileSync(f.repo + '/.env', 'SYNTHETIC_PRIVATE_ENV_SENTINEL=do-not-read\n')
  f.git(['add', '--all'])
  f.git(['commit', '-qm', 'add synthetic environment file'])
  f.git(['mv', '.env', 'config.txt'])
  f.git(['commit', '-qm', 'rename environment file'])
  const current = f.git(['rev-parse', 'HEAD'])
  const history = historyReader(f.repo, current)
  for (const requestedPath of [undefined, 'config.txt']) {
    const diff = history.diff(current, requestedPath)
    assert.equal(diff.partial, true)
    assert.equal(diff.withheldPathCount, 2)
    assert.deepEqual(diff.files, [])
    assert.equal(diff.text, '')
  }
})

test('v2 broker history ops persist verifiable receipts and stay within ancestor scope', t => {
  const f = multiCommitFixture(t)
  prepareEngine(f.out, f.config)
  assert.deepEqual(inspectEngine(f.out).manifest.budgets.history, { commitMeta: 12, diffs: 8, pathHistory: 6 })

  const meta = engineBroker(f.out, 'A', 'commit-meta', [f.commits.c1])
  assert.equal(meta.id, 'A-001')
  assert.equal(meta.kind, 'commit-meta')
  assert.equal(meta.subject, 'introduce main')

  const diff = engineBroker(f.out, 'A', 'diff', [f.commits.c2, 'other.go'])
  assert.equal(diff.id, 'A-002')
  assert.equal(diff.kind, 'diff')
  assert.ok(diff.text.includes('func other'))

  const pathHistory = engineBroker(f.out, 'A', 'path-history', ['other.go', '5', '0'])
  assert.equal(pathHistory.id, 'A-003')
  assert.equal(pathHistory.kind, 'path-history')
  assert.ok(pathHistory.commits.length >= 2)
  assert.equal(pathHistory.commits[0].commitSha, f.commits.c3)

  assert.throws(() => engineBroker(f.out, 'A', 'commit-meta', ['0'.repeat(40)]), /not found|not an ancestor/)
  assert.equal(inspectEngine(f.out).jobs[0].state, 'partial-evidence-needs-explicit-resume')
  assert.deepEqual(JSON.parse(readFileSync(f.out + '/receipts/A/A-001.json')).commitSha, f.commits.c1)
})

test('history receipts enter the decision-scoped catalog with bodies omitted and remain fetchable', t => {
  const f = multiCommitFixture(t)
  prepareEngine(f.out, f.config)
  const source = engineBroker(f.out, 'A', 'read', ['main.go'])
  const historyDiff = engineBroker(f.out, 'A', 'diff', [f.commits.c2])
  const proposal = {
    agent: 'A',
    scopeSummary: 'Synthetic history-backed fixture',
    coverage: { inspected: [source.path], omissions: ['Unread regions'] },
    crossPartitionLeads: [],
    nodes: [node('A1', source.id)],
    edges: [],
    limitations: ['Synthetic fixture; history used for lineage context via ' + historyDiff.id],
  }
  save(f.out + '/proposals/A.json', proposal)
  checkpointEngine(f.out, 'A')
  freezeIntegration(f.out)

  const packet = JSON.parse(readFileSync(f.out + '/integration-input.json'))
  assert.equal(packet.packaging, 'decision-scoped')
  const catalogDiff = packet.receiptCatalog.find(e => e.id === historyDiff.id)
  assert.equal(catalogDiff.kind, 'diff')
  assert.ok(catalogDiff.omitted.includes('text'))
  assert.equal(Object.hasOwn(catalogDiff, 'text'), false)
  assert.ok(packet.omissions.some(o => /History-plane bodies/i.test(o)))

  const fetched = engineBroker(f.out, 'R', 'receipt', [historyDiff.id])
  assert.equal(fetched.kind, 'diff')
  assert.equal(fetched.text, historyDiff.text)

  const meta = engineBroker(f.out, 'R', 'commit-meta', [f.commits.c1])
  assert.equal(meta.kind, 'commit-meta')
  assert.equal(meta.pinnedCommitSha, f.commits.c3)

  const graph = {
    nodes: proposal.nodes, edges: [],
    lineage: proposal.nodes.map(n => ({ originalId: n.id, successorIds: [n.id], decision: 'retain', reason: 'Synthetic exact retain' })),
    edgeLineage: [], decisions: [], limitations: ['Synthetic fixture'], comparisons: [],
  }
  save(f.out + '/reconciled.json', graph)
  checkpointEngine(f.out, 'R')
  const published = publishEngine(f.out)
  assert.equal(published.status, 'candidate-map-produced')
  const output = JSON.parse(readFileSync(f.out + '/output.json'))
  assert.ok(output.limitations.some(l => /History-plane broker ops are partially available/i.test(l)))
  assert.ok(!output.limitations.some(l => /unimplemented in this runner version \(no history-plane broker ops\)/i.test(l)))
  assert.ok(output.receipts.some(r => r.kind === 'diff' && r.id === historyDiff.id))
  assert.ok(output.receipts.some(r => r.kind === 'commit-meta' && r.id === meta.id))
})

test('protocol documents available history ops and remaining gaps', t => {
  const f = multiCommitFixture(t)
  prepareEngine(f.out, f.config)
  const protocol = readFileSync(f.out + '/protocol.md', 'utf8')
  assert.match(protocol, /commit-meta/)
  assert.match(protocol, /path-history/)
  assert.match(protocol, /prior-map lookup/)
  assert.match(protocol, /not yet available/i)
  assert.doesNotMatch(protocol, /does not yet expose history-plane broker ops/)
})
