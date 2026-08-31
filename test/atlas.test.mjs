import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildAtlas, parseNameStatus } from '../scripts/lib/atlas.mjs'

function git(repositoryPath, args, date) {
  const env = date
    ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    : process.env
  return execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    env,
  })
}

test('parseNameStatus preserves rename evidence', () => {
  assert.deepEqual(parseNameStatus('R097\0src/old.js\0src/new.js\0M\0README.md\0'), [
    {
      path: 'src/new.js',
      previousPath: 'src/old.js',
      status: 'R',
      similarity: '097',
    },
    { path: 'README.md', status: 'M' },
  ])
})

test('buildAtlas emits observed identities, episodes, areas, and evidence links', () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'evolution-atlas-test-'))

  try {
    git(repositoryPath, ['init', '-b', 'main'])
    git(repositoryPath, ['config', 'user.name', 'Example Author'])
    git(repositoryPath, ['config', 'user.email', 'author@example.test'])

    mkdirSync(join(repositoryPath, 'src'))
    writeFileSync(join(repositoryPath, 'src', 'index.js'), 'export const answer = 42\n')
    git(repositoryPath, ['add', 'src/index.js'])
    git(repositoryPath, ['commit', '-m', 'Introduce answer module'], '2025-01-02T12:00:00Z')

    git(repositoryPath, ['config', 'user.name', 'Example Alias'])
    mkdirSync(join(repositoryPath, 'docs'))
    renameSync(join(repositoryPath, 'src', 'index.js'), join(repositoryPath, 'src', 'main.js'))
    writeFileSync(join(repositoryPath, 'docs', 'notes.md'), '# Notes\n')
    git(repositoryPath, ['add', '-A'])
    git(repositoryPath, ['commit', '-m', 'Move module and document it'], '2025-02-03T12:00:00Z')

    const dataset = buildAtlas(repositoryPath)

    assert.equal(dataset.schemaVersion, '0.3.0')
    assert.equal(dataset.analysis.mode, 'observed-only')
    assert.equal(dataset.repository.name, repositoryPath.split('/').at(-1))
    assert.equal(dataset.repository.ref, 'main')
    assert.equal(dataset.repository.commitCount, 2)
    assert.equal(dataset.episodes.length, 2)
    assert.equal(dataset.featureCandidates.length, 0)
    assert.deepEqual(
      dataset.codeAreas.map((area) => area.label),
      ['docs', 'src'],
    )

    assert.equal(dataset.contributors.length, 1)
    assert.equal(dataset.contributors[0].displayName, 'Example Author')
    assert.deepEqual(dataset.contributors[0].aliases, ['Example Alias', 'Example Author'])
    assert.equal(dataset.contributors[0].isBot, false)
    assert.equal('email' in dataset.contributors[0], false)

    const secondEpisode = dataset.episodes[1]
    const rename = secondEpisode.changes.find((change) => change.status === 'R')
    assert.equal(rename.previousPath, 'src/index.js')
    assert.equal(rename.path, 'src/main.js')
    assert.deepEqual(secondEpisode.parentShas, [dataset.episodes[0].commitSha])

    const authoredRelationships = dataset.relationships.filter(
      (relationship) => relationship.kind === 'authored',
    )
    const touchedRelationships = dataset.relationships.filter(
      (relationship) => relationship.kind === 'touched',
    )
    assert.equal(authoredRelationships.length, 2)
    assert.equal(touchedRelationships.length, 3)
    assert.ok(
      touchedRelationships.every(
        (relationship) =>
          relationship.interpretationStatus === 'observed' && relationship.confidence === 1,
      ),
    )
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true })
  }
})

test('buildAtlas proposes a cross-email name match without serializing emails', () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'evolution-atlas-identity-test-'))

  try {
    git(repositoryPath, ['init', '-b', 'main'])
    git(repositoryPath, ['config', 'user.name', 'Example Author'])
    git(repositoryPath, ['config', 'user.email', 'personal@example.test'])
    writeFileSync(join(repositoryPath, 'first.txt'), 'first\n')
    git(repositoryPath, ['add', 'first.txt'])
    git(repositoryPath, ['commit', '-m', 'First identity'], '2025-01-02T12:00:00Z')

    git(repositoryPath, ['config', 'user.email', 'work@example.test'])
    writeFileSync(join(repositoryPath, 'second.txt'), 'second\n')
    git(repositoryPath, ['add', 'second.txt'])
    git(repositoryPath, ['commit', '-m', 'Second identity'], '2025-01-03T12:00:00Z')

    const dataset = buildAtlas(repositoryPath)
    assert.equal(dataset.contributors.length, 2)
    assert.equal(dataset.identityMatches.length, 1)
    assert.equal(dataset.identityMatches[0].status, 'candidate')
    assert.equal(dataset.identityMatches[0].signals[0].kind, 'exact-name')
    assert.equal(JSON.stringify(dataset.identityMatches).includes('@'), false)
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true })
  }
})

test('buildAtlas recognizes an explicit repository mailmap identity', () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'evolution-atlas-mailmap-test-'))

  try {
    git(repositoryPath, ['init', '-b', 'main'])
    git(repositoryPath, ['config', 'user.name', 'Old Name'])
    git(repositoryPath, ['config', 'user.email', 'old@example.test'])
    writeFileSync(
      join(repositoryPath, '.mailmap'),
      [
        'Canonical Person <canonical@example.test> Old Name <old@example.test>',
        'Canonical Person <canonical@example.test> Work Name <work@example.test>',
        '',
      ].join('\n'),
    )
    git(repositoryPath, ['add', '.mailmap'])
    git(repositoryPath, ['commit', '-m', 'Add identity map'], '2025-01-02T12:00:00Z')

    git(repositoryPath, ['config', 'user.name', 'Work Name'])
    git(repositoryPath, ['config', 'user.email', 'work@example.test'])
    writeFileSync(join(repositoryPath, 'work.txt'), 'work\n')
    git(repositoryPath, ['add', 'work.txt'])
    git(repositoryPath, ['commit', '-m', 'Use work identity'], '2025-01-03T12:00:00Z')

    const dataset = buildAtlas(repositoryPath)
    assert.equal(dataset.contributors.length, 2)
    assert.equal(dataset.identityMatches.length, 1)
    assert.equal(dataset.identityMatches[0].status, 'confirmed')
    assert.equal(dataset.identityMatches[0].signals[0].kind, 'mailmap')
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true })
  }
})

test('buildAtlas keeps both sides of a root-folder reorganization', () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'evolution-atlas-reorganization-test-'))

  try {
    git(repositoryPath, ['init', '-b', 'main'])
    git(repositoryPath, ['config', 'user.name', 'Example Author'])
    git(repositoryPath, ['config', 'user.email', 'author@example.test'])
    for (const [area, file] of [
      ['frontend', 'app.ts'],
      ['backend', 'api.ts'],
      ['infra', 'main.tf'],
    ]) {
      mkdirSync(join(repositoryPath, 'demo', area), { recursive: true })
      writeFileSync(join(repositoryPath, 'demo', area, file), `${area}\n`)
    }
    git(repositoryPath, ['add', 'demo'])
    git(repositoryPath, ['commit', '-m', 'Add demo layout'], '2025-01-02T12:00:00Z')

    for (const area of ['frontend', 'backend', 'infra']) {
      renameSync(join(repositoryPath, 'demo', area), join(repositoryPath, area))
    }
    git(repositoryPath, ['add', '-A'])
    git(repositoryPath, ['commit', '-m', 'Promote services to repository root'], '2025-01-03T12:00:00Z')

    const dataset = buildAtlas(repositoryPath)
    const reorganization = dataset.structuralEpisodes[0]
    const reorganizationEpisode = dataset.episodes[1]

    assert.equal(dataset.structuralEpisodes.length, 1)
    assert.equal(reorganization.label, 'Promote demo contents to repository root')
    assert.deepEqual(
      reorganization.mappings,
      [{ fromPrefix: 'demo', toPrefix: '', fileCount: 3 }],
    )
    assert.deepEqual(
      reorganizationEpisode.changes.map((change) => change.status),
      ['R', 'R', 'R'],
    )
    assert.deepEqual(
      reorganizationEpisode.codeAreaIds.map(
        (areaId) => dataset.codeAreas.find((area) => area.id === areaId).label,
      ).sort(),
      ['backend', 'demo', 'frontend', 'infra'],
    )
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true })
  }
})

test('a merge records what it brought onto the branch, and the chain is marked', () => {
  // `--first-parent` on diff-tree emits nothing at all for a merge, so every merge in a
  // history recorded zero changes and no code area - 25.7% of the pilot. `-m` is not the
  // fix: it emits a section per parent, so the second parent's diff arrives as if it were
  // the first's.
  const repository = mkdtempSync(join(tmpdir(), 'atlas-merge-'))
  try {
    git(repository, ['init', '--initial-branch=main', '.'])
    git(repository, ['config', 'user.email', 'test@example.com'])
    git(repository, ['config', 'user.name', 'Test'])

    writeFileSync(join(repository, 'base.txt'), 'base\n')
    git(repository, ['add', '-A'])
    git(repository, ['commit', '-m', 'base'], '2025-01-01T00:00:00Z')

    git(repository, ['checkout', '-b', 'feature'])
    writeFileSync(join(repository, 'one.txt'), 'one\n')
    git(repository, ['add', '-A'])
    git(repository, ['commit', '-m', 'branch work'], '2025-01-02T00:00:00Z')

    git(repository, ['checkout', 'main'])
    writeFileSync(join(repository, 'side.txt'), 'side\n')
    git(repository, ['add', '-A'])
    git(repository, ['commit', '-m', 'main work'], '2025-01-03T00:00:00Z')

    git(repository, ['merge', '--no-ff', 'feature', '-m', 'Merge pull request #1'], '2025-01-04T00:00:00Z')

    const dataset = buildAtlas(repository)
    const merge = dataset.episodes.find((episode) => episode.subject.startsWith('Merge'))
    const branch = dataset.episodes.find((episode) => episode.subject === 'branch work')

    // The merge carries the branch's contribution, and nothing from its second parent.
    assert.deepEqual(
      merge.changes.map((change) => change.path),
      ['one.txt'],
    )
    assert.ok(merge.codeAreaIds.length > 0, 'a merge with a diff belongs to a code area')

    // The chain is what main itself saw; the branch commit is a state main never had.
    assert.equal(merge.firstParent, true)
    assert.equal(branch.firstParent, false)
    assert.equal(dataset.episodes.filter((episode) => episode.firstParent).length, 3)
    assert.equal(dataset.analysis.mergeDiffStrategy, 'diff-merges-first-parent')
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('commit bodies are captured, and absent rather than empty when unwritten', () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'evolution-atlas-body-'))

  try {
    git(repositoryPath, ['init', '-b', 'main'])
    git(repositoryPath, ['config', 'user.name', 'Example Author'])
    git(repositoryPath, ['config', 'user.email', 'author@example.test'])

    writeFileSync(join(repositoryPath, 'a.js'), 'export const a = 1\n')
    git(repositoryPath, ['add', '-A'])
    git(repositoryPath, ['commit', '-m', 'Subject only'], '2025-01-02T12:00:00Z')

    writeFileSync(join(repositoryPath, 'b.js'), 'export const b = 2\n')
    git(repositoryPath, ['add', '-A'])
    // The shape that matters: a subject that says nothing and a body that says what it was.
    git(
      repositoryPath,
      ['commit', '-m', 'Merge pull request #7 from someone/branch', '-m', 'feat: professor subpage'],
      '2025-01-03T12:00:00Z',
    )

    const dataset = buildAtlas(repositoryPath)
    const [first, second] = dataset.episodes

    assert.equal(first.subject, 'Subject only')
    assert.ok(!('body' in first), 'a commit with no body carries no body field')
    assert.equal(second.subject, 'Merge pull request #7 from someone/branch')
    assert.equal(second.body, 'feat: professor subpage')
  } finally {
    rmSync(repositoryPath, { recursive: true, force: true })
  }
})
