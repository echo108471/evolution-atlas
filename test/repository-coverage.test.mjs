import test from 'node:test'
import assert from 'node:assert/strict'
import { planRepositoryCoverage } from '../scripts/lib/repository-coverage.mjs'

const inventory = paths => ({ files: paths.map(path => ({ path, size: 10 })) })
const receipt = (path, extra = {}) => ({ kind: 'source', path, ...extra })
const selected = plan => plan.assignments.flatMap(a => a.regions)

test('metadata routing is deterministic, repository neutral and does not mutate inputs', () => {
  const input = inventory(['p/b/x.go', 'q/x.rs', 'p/a/x.ts', 'entry.py'])
  const before = JSON.stringify(input)
  const a = planRepositoryCoverage(input, []), b = planRepositoryCoverage({ files: [...input.files].reverse() }, [])
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(a.assignments.map(x => x.agent), ['A', 'B', 'C'])
  assert.equal(a.inventory.fileCount, 4)
  assert.equal(a.inventory.unreadFileCount, 4)
  assert.equal(a.inventory.uniqueInspectedLineCount, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a)
  const renamed = planRepositoryCoverage(inventory(['v/b/x.go', 'w/x.rs', 'v/a/x.ts', 'entry.py']), [])
  assert.deepEqual(renamed.inventory, a.inventory)
  assert.match(a.routing.evidenceFollowing, /cross-region/)
})

test('untouched regions precede partially inspected regions within one subtree', () => {
  const plan = planRepositoryCoverage(inventory(['p/a/1.go', 'p/a/2.go', 'p/b/1.go', 'p/b/2.go']), [receipt('p/a/1.go')],
    { maxRegionFiles: 2, assignmentCount: 1, regionsPerAssignment: 1 })
  assert.equal(selected(plan)[0].pathPrefix, 'p/b/')
  assert.equal(plan.inventory.inspectedFileCount, 1)
  assert.equal(plan.inventory.unreadFileCount, 3)
})

test('diversity reserves alternatives even when one subtree has more untouched regions', () => {
  const paths = [...Array.from({ length: 8 }, (_, i) => `p/d${i}/a.go`), 'q/a.go', 'q/b.go']
  const plan = planRepositoryCoverage(inventory(paths), [receipt('q/a.go')], { maxRegionFiles: 1 })
  assert.equal(selected(plan).length, 6)
  assert.ok(selected(plan).some(r => r.topLevelSubtree === 'q'))
  assert.ok(plan.assignments.every(a => a.regions.length === 2))
  assert.match(plan.routing.diversity, /takes precedence/)
})

test('partitions include exclusive direct-file groups, exact prefixes and root files', () => {
  const paths = ['entry.go', 'other.go', 'p/a.go', 'p/b.go', 'p/child/x.go', 'p/child/y.go']
  const plan = planRepositoryCoverage(inventory(paths), [], { maxRegionFiles: 1 })
  assert.deepEqual(plan.regions.flatMap(r => r.assignedFilePaths).sort(), paths.sort())
  const direct = plan.regions.find(r => r.kind === 'direct-files')
  assert.equal(direct.pathPrefix, 'p/')
  assert.deepEqual(direct.assignedFilePaths, ['p/a.go', 'p/b.go'])
  assert.equal(direct.oversized, true)
  assert.equal(plan.regions.filter(r => r.kind === 'file').length, 2)
  const limited = planRepositoryCoverage(inventory(paths), [], { maxRegionFiles: 1, maxDepth: 1 })
  assert.deepEqual(limited.regions.find(r => r.pathPrefix === 'p/').assignedFilePaths, ['p/a.go', 'p/b.go', 'p/child/x.go', 'p/child/y.go'])
})

test('empty and exhausted inventories leave explicit empty slots without repeated regions', () => {
  for (const [input, receipts] of [[inventory([]), []], [inventory(['a.go']), [receipt('a.go')]]]) {
    const plan = planRepositoryCoverage(input, receipts)
    assert.equal(plan.batch.selectedRegionCount, 0)
    assert.equal(plan.batch.unfilledRegionSlots, 6)
    assert.equal(plan.inventory.exhausted, true)
    assert.equal(plan.batch.selectionPoolExhausted, true)
    assert.ok(plan.assignments.every(a => a.regions.length === 0))
  }
  const plan = planRepositoryCoverage(inventory(['a.go']), [])
  assert.equal(selected(plan).length, 1)
  assert.equal(plan.batch.unfilledRegionSlots, 5)
  assert.equal(plan.inventory.exhausted, false)
  assert.equal(plan.batch.selectionPoolExhausted, true)
})

test('source receipts deduplicate files and union overlapping inclusive lines independently', () => {
  const rs = [receipt('p/a.go', { startLine: 1, endLine: 5, totalLines: 20 }),
    receipt('p/a.go', { startLine: 4, endLine: 8, totalLines: 20 }),
    receipt('p/a.go', { startLine: 1, endLine: 5 }), receipt('p/b.go'),
    { kind: 'search', matches: [{ path: 'p/c.go', line: 1 }] }]
  const input = inventory(['p/a.go', 'p/b.go', 'p/c.go']), plan = planRepositoryCoverage(input, rs)
  assert.equal(plan.inventory.inspectedFileCount, 2)
  assert.equal(plan.inventory.unreadFileCount, 1)
  assert.equal(plan.inventory.uniqueInspectedLineCount, 8)
  assert.equal(plan.inventory.inspectedFilesWithoutRanges, 1)
  assert.equal(plan.inventory.knownTotalLineCount, 20)
  assert.equal(plan.inventory.filesWithKnownLineCount, 1)
  assert.deepEqual(plan.regions[0].assignedFilePaths, ['p/a.go', 'p/b.go', 'p/c.go'])
  assert.deepEqual(plan.regions[0].unreadFilePaths, ['p/c.go'])
  assert.deepEqual(selected(plan)[0].unreadFilePaths, ['p/c.go'])
  assert.deepEqual(planRepositoryCoverage(input, [...rs].reverse()), plan)
})

test('invalid options and inventory metadata fail closed', () => {
  const input = inventory(['a.go'])
  for (const options of [null, [], { maxDepth: 0 }, { maxDepth: 65 }, { maxRegionFiles: 0 }, { maxRegionFiles: 1.2 },
    { assignmentCount: 7 }, { assignmentCount: 0 }, { regionsPerAssignment: -1 }, { regionsPerAssignment: 101 }, { unexpected: 1 }]) {
    assert.throws(() => planRepositoryCoverage(input, [], options))
  }
  for (const value of [null, [], { files: {} }, inventory(['a.go', 'a.go']), inventory(['a.go', 'a.go/b.go']),
    { files: [{ path: 'a.go', size: -1 }] }, { ...input, eligibleFiles: 2 }, { ...input, allTrackedEntries: 0 },
    { ...input, commitSha: 'HEAD' }, { files: [{ path: 'a.go', size: 1, totalLines: -1 }] },
    { files: [{ path: 'a.go', size: Number.MAX_SAFE_INTEGER }, { path: 'b.go', size: 1 }] }]) {
    assert.throws(() => planRepositoryCoverage(value, []))
  }
  for (const path of ['/a.go', '../a.go', 'p/../a.go', 'p//a.go', 'p\\a.go', 'a\u0000.go', '.env', 'p/x.pem']) {
    assert.throws(() => planRepositoryCoverage(inventory([path]), []))
  }
})

test('unknown paths, inconsistent line metadata and invalid source ranges fail closed', () => {
  const input = inventory(['a.go'])
  for (const rs of [null, [null], [{}], [receipt('missing.go')], [receipt('../a.go')],
    [receipt('a.go', { startLine: 1 })], [receipt('a.go', { startLine: 0, endLine: 2 })],
    [receipt('a.go', { startLine: 2, endLine: 1 })], [receipt('a.go', { startLine: 1, endLine: 3, totalLines: 2 })],
    [receipt('a.go', { totalLines: 2 }), receipt('a.go', { totalLines: 3 })]]) {
    assert.throws(() => planRepositoryCoverage(input, rs))
  }
  assert.throws(() => planRepositoryCoverage({ ...input, commitSha: 'a'.repeat(40) }, [receipt('a.go', { commitSha: 'b'.repeat(40) })]), /snapshot mismatch/)
})
