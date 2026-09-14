import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { inventorySnapshot } from '../scripts/lib/repository-snapshot.mjs'
import { sourceReader } from '../scripts/lib/repository-source.mjs'

function fixture(t, contents = { 'src/main.go': 'one\ntwo\n' }) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repository-source-test-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q', '-b', 'main']); git(['config', 'user.name', 'Synthetic Test']); git(['config', 'user.email', 'synthetic@example.invalid'])
  const save = (path, value) => { const full = resolve(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, value) }
  for (const [path, value] of Object.entries(contents)) save(path, value)
  const commit = () => { git(['add', '--all']); git(['commit', '-qm', 'Synthetic source']); return git(['rev-parse', 'HEAD']) }
  commit()
  const { repo, inventory } = inventorySnapshot({ repo: root })
  return { root, repo, inventory, save, git, commit, reader: () => sourceReader(repo, inventory) }
}

test('reads pinned blob bytes and records line and partition metadata without observing worktree changes', t => {
  const f = fixture(t), reader = f.reader(), file = f.inventory.files[0]
  f.save('src/main.go', 'changed working tree')
  const result = reader.read('src/main.go')
  assert.deepEqual(result, { kind: 'source', commitSha: f.inventory.commitSha, blobSha: file.blobSha, path: file.path,
    startLine: 1, endLine: 3, totalLines: 3, partition: file.partition, crossPartition: false, text: 'one\ntwo\n', truncated: false })
  f.commit()
  assert.deepEqual(reader.read('src/main.go'), result)
  assert.deepEqual(f.reader().read('src/main.go'), result)
  assert.equal(reader.read(file.path, 1, 1, file.partition).crossPartition, false)
  assert.equal(reader.read(file.path, 1, 1, file.partition === 'A' ? 'B' : 'A').crossPartition, true)
  assert.equal(reader.read(file.path, 2, 1).truncated, true)
  f.inventory.files[0].blobSha = '0'.repeat(40)
  assert.deepEqual(reader.read(file.path), result)
})

test('line windows enforce UTF-8 byte caps and verify the actual cropped range', t => {
  const f = fixture(t, { 'src/unicode.py': 'é'.repeat(8000) + '\nsecond\nthird', 'src/long.py': 'x'.repeat(16001), 'src/empty.py': '', 'src/many.py': Array(200).fill('line').join('\n') })
  const reader = f.reader(), receipt = reader.read('src/unicode.py', 1, 3)
  assert.equal(Buffer.byteLength(receipt.text), 16000); assert.equal(receipt.endLine, 1); assert.equal(receipt.truncated, true)
  assert.equal(reader.verify({ id: 'A-001', ...receipt }), true)
  assert.equal(reader.read('src/many.py', 1, 160).endLine, 160)
  assert.equal(reader.read('src/empty.py').text, '')
  assert.equal(reader.read('src/empty.py').totalLines, 1)
  assert.throws(() => reader.read('src/long.py'), /line exceeds byte cap/)
  for (const [start, count] of [[0, 1], [1, 0], [1, 161], [1.5, 1], [1, 1.5], [201, 1], ['1', 1]]) assert.throws(() => reader.read('src/many.py', start, count), /window/)
  assert.throws(() => reader.read('src/many.py', 1, 1, 'G'), /agent/)
})

test('literal search returns stable locations only, counts matching lines and caps results at fifty', t => {
  const f = fixture(t, { 'src/a.go': Array(55).fill('a.b a.b').join('\n'), 'src/b.go': 'a.b\nother', 'test/c.py': 'a.b' })
  const reader = f.reader(), result = reader.search('src/', 'a.b')
  assert.equal(result.searchedFiles, 2); assert.equal(result.totalMatches, 56); assert.equal(result.omittedMatches, 6)
  assert.deepEqual(result.matches, Array.from({ length: 50 }, (_, i) => ({ path: 'src/a.go', line: i + 1 })))
  assert.equal(result.note, 'locations only; not support until source window inspected')
  assert.equal(result.matches[0].text, undefined)
  assert.equal(reader.verify({ ...result, id: 'arbitrary opaque id' }), true)
  assert.equal(reader.search('absent/', 'a.b').searchedFiles, 0)
  for (const [prefix, literal] of [['', 'a'], ['../', 'a'], ['src//', 'a'], ['src/', ''], ['src/', 'a'.repeat(101)], ['src/', 'a\n']]) assert.throws(() => reader.search(prefix, literal), /safe prefix/)
})

test('source and search verification reject any changed evidence field and any unexpected payload property', t => {
  const f = fixture(t), reader = f.reader(), source = reader.read('src/main.go'), search = reader.search('src/', 'one')
  assert.equal(reader.verify({ ...source, id: 'anything' }), true)
  for (const [key, value] of Object.entries({ text: 'invented', commitSha: '0'.repeat(40), blobSha: '0'.repeat(40), path: 'src/other.go', startLine: 2, endLine: 2, totalLines: 99, partition: 'F', crossPartition: 'false', truncated: true, invented: 1 })) {
    assert.throws(() => reader.verify({ ...source, [key]: value }), undefined, key)
  }
  for (const [key, value] of Object.entries({ commitSha: '0'.repeat(40), searchedFiles: 99, totalMatches: 99, matches: [], omittedMatches: 1, note: 'source evidence', invented: 1 })) {
    assert.throws(() => reader.verify({ ...search, [key]: value }), undefined, key)
  }
  for (const receipt of [null, [], {}, { kind: 'other' }]) assert.throws(() => reader.verify(receipt), /receipt/)
})

test('both read and search reject binary, invalid UTF-8 and secret-shaped blobs without leaking source text', t => {
  const marker = 'sensitive-synthetic-marker'
  const contents = {
    'nul/main.py': marker + '\0data', 'utf/main.py': Buffer.from([0xff, 0xfe, 0x41]),
    'pem/main.py': marker + '\n-----BEGIN PRIVATE KEY-----\nsynthetic',
    'github/main.py': marker + '\nghp_' + 'a'.repeat(36),
    'aws/main.py': marker + '\nAKIA' + 'A'.repeat(16),
    'assignment/main.py': marker + '\napi_key = "' + 'z'.repeat(32) + '"',
  }
  const f = fixture(t, contents), reader = f.reader()
  for (const path of Object.keys(contents)) {
    for (const action of [() => reader.read(path), () => reader.search(path.split('/')[0] + '/', 'no-match')]) {
      assert.throws(action, error => error.message === `Rejected source blob: ${path}` && !error.message.includes(marker))
    }
  }
})

test('inventory records must be eligible real tree members with exact metadata, while subsets retain assigned partitions', t => {
  const f = fixture(t, { 'src/a.go': 'a', 'src/b.py': 'b', 'README.md': 'metadata only' })
  for (const change of [
    inv => { inv.commitSha = '0'.repeat(40) }, inv => { inv.files[0].path = '../outside.go' },
    inv => { inv.files[0].path = 'README.md' }, inv => { inv.files[0].blobSha = inv.files[1].blobSha },
    inv => { inv.files[0].size++ }, inv => { inv.files[0].mode = '120000' }, inv => { inv.files[0].type = 'tree' },
    inv => { inv.files[0].partition = 'R' }, inv => { inv.files.push(inv.files[0]); inv.eligibleFiles++ },
    inv => { inv.eligibleFiles++ }, inv => { inv.allTrackedEntries++ },
  ]) {
    const inventory = structuredClone(f.inventory); change(inventory)
    assert.throws(() => sourceReader(f.repo, inventory))
  }
  const subset = structuredClone(f.inventory); subset.files = [subset.files[1]]; subset.eligibleFiles = 1
  const reader = sourceReader(f.repo, subset)
  assert.equal(reader.read('src/b.py').partition, subset.files[0].partition)
  assert.throws(() => reader.read('src/a.go'), /not eligible/)
  assert.throws(() => reader.read('README.md'), /not eligible/)
  assert.equal(reader.search('src/', 'b').searchedFiles, 1)
})

test('safe decoded blobs are cached per reader and missing local objects do not trigger another source', t => {
  const f = fixture(t), reader = f.reader(), receipt = reader.read('src/main.go')
  const sha = f.inventory.files[0].blobSha
  rmSync(resolve(f.repo, 'objects', sha.slice(0, 2), sha.slice(2)))
  assert.deepEqual(reader.read('src/main.go'), receipt)
  assert.equal(reader.search('src/', 'one').totalMatches, 1)
  assert.equal(reader.verify(receipt), true)
})

test('blob reads ignore inherited Git environment overrides', t => {
  const f = fixture(t), reader = f.reader(), keys = ['GIT_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE']
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) process.env[key] = resolve(f.root, 'missing')
    assert.equal(reader.read('src/main.go').text, 'one\ntwo\n')
  } finally {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
