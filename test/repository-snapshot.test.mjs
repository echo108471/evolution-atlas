import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { inventorySnapshot, assignRepositoryPartitions, safeRepositoryPath } from '../scripts/lib/repository-snapshot.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repository-snapshot-test-'))), repo = resolve(root, 'source')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = (args, input) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8', env, input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  mkdirSync(repo)
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Synthetic Test'])
  git(['config', 'user.email', 'synthetic@example.invalid'])
  const save = (path, content = 'synthetic source\n') => { const p = resolve(repo, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content) }
  const commit = () => { git(['add', '--all']); git(['commit', '-qm', 'Synthetic snapshot']); return git(['rev-parse', 'HEAD']) }
  return { root, repo, git, save, commit }
}

test('worktree and bare refs inventory immutable committed source metadata across languages', t => {
  const f = fixture(t)
  const paths = ['src/main.go', 'src/java/Main.java', 'lib/main.c', 'lib/util.hpp', 'engine/lib.rs', 'tools/main.py', 'web/main.ts', 'ui/View.vue']
  paths.forEach(path => f.save(path))
  const first = f.commit()
  f.git(['tag', '-a', 'v1', '-m', 'Synthetic tag'])
  const snapshot = inventorySnapshot({ repo: f.repo, revision: 'v1' })
  assert.equal(snapshot.repo, resolve(f.repo, '.git'))
  assert.equal(snapshot.inventory.commitSha, first)
  assert.equal(snapshot.inventory.allTrackedEntries, paths.length)
  assert.deepEqual(snapshot.inventory.files.map(file => file.path), [...paths].sort())
  for (const file of snapshot.inventory.files) {
    assert.equal(file.type, 'blob'); assert.equal(file.mode, '100644')
    assert.equal(file.size, 17); assert.match(file.blobSha, /^[a-f0-9]{40}$/); assert.match(file.partition, /^[A-C]$/)
  }
  f.save('src/main.go', 'uncommitted modification')
  f.save('untracked.ts')
  assert.deepEqual(inventorySnapshot({ repo: f.repo, revision: 'main' }), snapshot)
  f.commit()
  assert.deepEqual(inventorySnapshot({ repo: f.repo, revision: first }), snapshot)
  assert.equal(inventorySnapshot({ repo: f.repo, revision: 'HEAD~1' }).inventory.commitSha, first)
  assert.notEqual(inventorySnapshot({ repo: f.repo }).inventory.commitSha, first)
  const bare = resolve(f.root, 'source.git')
  execFileSync('git', ['clone', '--bare', '-q', f.repo, bare], { stdio: 'pipe' })
  assert.deepEqual(inventorySnapshot({ repo: bare, revision: 'refs/tags/v1' }), { repo: bare, inventory: snapshot.inventory })
})

test('linked worktrees resolve their own Git directory and pinned branch', t => {
  const f = fixture(t); f.save('main.go'); const commit = f.commit(), linked = resolve(f.root, 'linked')
  f.git(['worktree', 'add', '-q', '-b', 'linked', linked])
  const result = inventorySnapshot({ repo: linked })
  assert.equal(result.repo, resolve(f.repo, '.git/worktrees/linked'))
  assert.equal(result.inventory.commitSha, commit)
})

test('metadata exclusions reject sensitive paths, generated files, links and size limits', t => {
  const f = fixture(t)
  const excluded = ['.env', '.env.example', 'src/.env.ts', 'secrets/index.py', 'src/credentials.go', '.codex/prompt.ts', '.claude/task.py', '.agents/task.js', 'AGENTS.md', 'CLAUDE.ts', '.github/flows.sh', '.config/cli.py', 'private.pem', 'private.key.ts', 'id_ed25519.py', 'node_modules/x.js', 'vendor/main.go', 'target/lib.rs', 'build/main.c', '__pycache__/cache.py', 'src/foo.generated.ts', 'src/code.pb.go', 'src/bundle.min.js', 'README.md', 'large.py', 'odd\nname.py']
  excluded.forEach(path => f.save(path, path === 'large.py' ? 'x'.repeat(101) : 'synthetic'))
  f.save('src/main.py', 'x'.repeat(100)); f.save('src/empty.go', '')
  symlinkSync('src/main.py', resolve(f.repo, 'alias.py'))
  const first = f.commit()
  f.git(['update-index', '--add', '--cacheinfo', `160000,${first},submodule.go`])
  f.git(['commit', '-qm', 'Synthetic gitlink'])
  const result = inventorySnapshot({ repo: f.repo, maxFileBytes: 100 }).inventory
  assert.deepEqual(result.files.map(file => file.path), ['src/empty.go', 'src/main.py'])
  assert.equal(result.allTrackedEntries, excluded.length + 4)
  assert.equal(result.eligibleFiles, 2)
  assert.equal(result.omitted.length, excluded.length + 2)
  const reasons = Object.fromEntries(result.omitted.map(file => [file.path, file.reason]))
  assert.equal(reasons['large.py'], 'oversize'); assert.equal(reasons['alias.py'], 'symlink')
  assert.equal(reasons['submodule.go'], 'non-regular-entry'); assert.equal(reasons['odd\nname.py'], 'unsafe-path')
})

test('path gate rejects traversal, controls, credentials and instruction locations without opening files', () => {
  for (const path of ['', '/src/a.ts', '../a.ts', 'src/../a.ts', 'src/./a.ts', 'src//a.ts', 'C:/a.ts', 'C:\\a.ts', 'src\\a.ts', 'a\0.ts', 'a\t.ts', 'a\u202e.ts', '.aws/main.py', '.env.local', 'foo/.env.test.py', 'foo/api-token.ts', '.cursor/policy.ts', 'copilot-instructions.md', null, 1]) assert.equal(safeRepositoryPath(path), false, String(path))
  for (const path of ['src/go/main.go', 'source with spaces/Main.java', 'café/日本語.py', 'README.md', 'src/config.ts']) assert.equal(safeRepositoryPath(path), true, path)
})

test('assignments are exact, stable across order, nonmutating and preserve directory locality', () => {
  const files = [
    { path: 'a/one.go', size: 10 }, { path: 'a/two.go', size: 20 },
    { path: 'b/one.java', size: 30 }, { path: 'c/one.rs', size: 30 },
    { path: 'deep/alpha/one.py', size: 30 }, { path: 'deep/beta/one.ts', size: 30 },
    { path: 'root.c', size: 30 },
  ]
  const before = structuredClone(files), result = assignRepositoryPartitions(files, 3)
  assert.deepEqual(files, before)
  assert.deepEqual(result, assignRepositoryPartitions([...files].reverse(), 3))
  assert.deepEqual(result, assignRepositoryPartitions([...files.slice(3), ...files.slice(0, 3)], 3))
  assert.equal(new Set(result.map(file => file.path)).size, files.length)
  assert.equal(result.find(file => file.path === 'a/one.go').partition, result.find(file => file.path === 'a/two.go').partition)
  assert.deepEqual([...new Set(result.map(file => file.partition))].sort(), ['A', 'B', 'C'])
  assert.ok(assignRepositoryPartitions(files, 1).every(file => file.partition === 'A'))
  assert.deepEqual(assignRepositoryPartitions([], 6), [])
  assert.deepEqual(assignRepositoryPartitions(Array.from({ length: 6 }, (_, i) => ({ path: `${i}.go`, size: 0 })), 6).map(file => file.partition), ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.throws(() => assignRepositoryPartitions([{ path: 'a.go', size: 1 }, { path: 'a.go', size: 2 }], 2), /Duplicate/)
  assert.throws(() => assignRepositoryPartitions([{ path: '../a.go', size: 1 }], 2), /Invalid/)
  assert.throws(() => assignRepositoryPartitions([{ path: 'a.go', size: -1 }], 2), /Invalid/)
})

test('invalid revisions and configuration fail before repository access', () => {
  for (const partitionCount of [0, 7, 1.5, NaN, '3', null]) assert.throws(() => inventorySnapshot({ partitionCount }), /partitionCount/)
  for (const maxFileBytes of [0, 1_048_577, 1.5, NaN, '100', null]) assert.throws(() => inventorySnapshot({ maxFileBytes }), /maxFileBytes/)
  for (const revision of ['', '-h', '--help', 'HEAD:source.ts', 'HEAD..main', 'HEAD@{1}', 'main\n', 'main;echo', 'a//b', 'refs/heads/.hidden', 'foo.lock', 'refs/heads/', null]) assert.throws(() => inventorySnapshot({ revision }), /Invalid revision/)
  for (const count of [0, 7, 1.5, '2']) assert.throws(() => assignRepositoryPartitions([], count), /partitionCount/)
})

test('unborn repositories fail and real commits with empty eligible sets are represented', t => {
  const f = fixture(t)
  assert.throws(() => inventorySnapshot({ repo: f.repo }), /Cannot read local Git metadata/)
  f.git(['commit', '--allow-empty', '-qm', 'Empty synthetic commit'])
  const empty = inventorySnapshot({ repo: f.repo }).inventory
  assert.equal(empty.allTrackedEntries, 0); assert.equal(empty.eligibleFiles, 0); assert.deepEqual(empty.files, []); assert.deepEqual(empty.omitted, [])
  f.save('README.md'); f.commit()
  const docs = inventorySnapshot({ repo: f.repo }).inventory
  assert.equal(docs.allTrackedEntries, 1); assert.equal(docs.eligibleFiles, 0); assert.equal(docs.omitted.length, 1)
  assert.throws(() => inventorySnapshot({ repo: f.repo, revision: 'does-not-exist' }), /Cannot read local Git metadata/)
})

test('inventory ignores inherited Git overrides and replacement objects', t => {
  const f = fixture(t); f.save('original.go'); const first = f.commit()
  const expected = inventorySnapshot({ repo: f.repo, revision: first })
  f.save('later.go'); const second = f.commit()
  f.git(['replace', first, second])
  const overrides = { GIT_DIR: resolve(f.root, 'missing'), GIT_WORK_TREE: resolve(f.root, 'missing'), GIT_OBJECT_DIRECTORY: resolve(f.root, 'missing'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' }
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, overrides)
    assert.deepEqual(inventorySnapshot({ repo: f.repo, revision: first }), expected)
  } finally {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

test('non-UTF-8 Git paths fail closed instead of producing an inexact inventory', t => {
  const f = fixture(t), blob = f.git(['hash-object', '-w', '--stdin'], 'synthetic')
  const treeBytes = Buffer.concat([Buffer.from('100644 bad-'), Buffer.from([0xff]), Buffer.from('.py\0'), Buffer.from(blob, 'hex')])
  const tree = f.git(['hash-object', '-w', '-t', 'tree', '--stdin'], treeBytes)
  const commit = f.git(['commit-tree', tree, '-m', 'Synthetic invalid filename'])
  f.git(['update-ref', 'refs/heads/main', commit])
  assert.throws(() => inventorySnapshot({ repo: f.repo }), /Cannot read local Git metadata/)
})
