import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { minimizeObservedAtlas } from '../scripts/prepare-zod-demo.mjs'

const pin = 'a'.repeat(40)
const areaId = 'area:' + 'b'.repeat(16)
const timestamp = '2025-01-02T12:00:00Z'
function raw() {
  return {
    schemaVersion: '0.3.0', analysis: { mode: 'observed-only', mergeDiffStrategy: 'diff-merges-first-parent', extra: 'private-sentinel' },
    repository: { name: 'private-sentinel', headSha: pin, commitCount: 1, clonePath: '/private-sentinel' },
    timeRange: { firstAuthoredAt: timestamp, lastAuthoredAt: timestamp },
    contributors: [{ id: 'contributor:private-sentinel', displayName: 'Private Sentinel', aliases: ['private-sentinel@example.test'] }],
    identityMatches: [{ id: 'private-sentinel' }], structuralEpisodes: [{ label: 'private-sentinel' }],
    featureCandidates: [{ rationale: 'private-sentinel' }], semanticEpisodes: [{ method: 'private-sentinel' }],
    codeAreas: [{ id: areaId, label: 'private-sentinel', pathPrefix: 'src', firstSeenAt: timestamp, lastSeenAt: timestamp, extra: 'private-sentinel' }],
    episodes: [{ id: 'episode:' + pin, commitSha: pin, subject: 'private-sentinel@example.test', body: 'private-sentinel',
      authoredAt: timestamp, committedAt: timestamp, parentShas: [], contributorIds: ['contributor:private-sentinel'],
      firstParent: true, codeAreaIds: [areaId], interpretationStatus: 'observed',
      changes: [{ path: 'src/main.js', previousPath: 'src/old.js', status: 'R', similarity: '100', extra: 'private-sentinel' }],
      extra: 'private-sentinel' }],
    relationships: [{ kind: 'authored', id: 'private-sentinel', extra: 'private-sentinel' }], extra: 'private-sentinel',
  }
}

test('minimized observed view removes identity and text at every raw boundary and preserves path evidence', () => {
  const input = raw(), original = JSON.stringify(input)
  const output = minimizeObservedAtlas(input, pin)
  assert.equal(JSON.stringify(input), original)
  assert.equal(JSON.stringify(output).includes('private-sentinel'), false)
  assert.equal(JSON.stringify(output).includes('Private Sentinel'), false)
  assert.deepEqual(output.contributors, [])
  assert.deepEqual(output.episodes[0].contributorIds, [])
  assert.equal(Object.hasOwn(output.episodes[0], 'body'), false)
  assert.equal(output.episodes[0].subject, 'Observed commit aaaaaaaa')
  assert.equal(output.codeAreas[0].label, 'src')
  assert.deepEqual(output.relationships.map(edge => edge.kind), ['touched'])
  assert.deepEqual(output.relationships[0].evidence, [{ commitSha: pin, paths: ['src/main.js', 'src/old.js'] }])
  assert.deepEqual(minimizeObservedAtlas(input, pin), output)
})

test('wrong mode, pin, graph references, unsafe paths and free-text timestamps fail closed', () => {
  const corruptions = [
    input => { input.analysis.mode = 'interpreted' },
    input => { input.repository.headSha = 'c'.repeat(40) },
    input => { input.repository.commitCount = 2 },
    input => { input.episodes[0].parentShas = ['c'.repeat(40)] },
    input => { input.episodes[0].codeAreaIds = ['area:missing'] },
    input => { input.episodes[0].changes[0].path = '/private/file' },
    input => { input.episodes[0].changes[0].path = 'src/private@example.test' },
    input => { input.episodes[0].authoredAt = 'Jan 2 2025 (private-sentinel@example.test)' },
    input => { input.episodes[0].changes[0].similarity = '101' },
    input => { input.episodes.push(structuredClone(input.episodes[0])); input.repository.commitCount = 2 },
  ]
  for (const corrupt of corruptions) {
    const input = raw(); corrupt(input)
    assert.throws(() => minimizeObservedAtlas(input, pin), /Invalid pinned observed atlas/)
  }
})

test('CLI refuses existing outputs and symlinked raw inputs without disclosing their contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-demo-privacy-'))
  const output = resolve('scratch', 'demo-test-' + directory.split('/').at(-1))
  try {
    const input = join(directory, 'input.json'), link = join(directory, 'linked.json')
    writeFileSync(input, '{private-sentinel@example.test}')
    symlinkSync(input, link)
    for (const [file, out, refusal] of [[link, output, 'Input must be a regular file without symlinks.'],
      [input, resolve('scratch'), 'Choose a new ignored scratch output directory.']]) {
      assert.throws(() => execFileSync(process.execPath, ['scripts/prepare-zod-demo.mjs', '--input', file,
        '--analysis-provenance', input, '--source', directory, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] }), error => {
        assert.equal(error.status, 1)
        assert.equal(error.stderr.toString().trim(), refusal)
        assert.equal(error.stderr.toString().includes('private-sentinel'), false)
        return true
      })
    }
    assert.equal(existsSync(output), false)
    assert.equal(execFileSync(process.execPath, ['scripts/prepare-zod-demo.mjs', '--help'], { encoding: 'utf8' }).includes('Never fetches'), true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
