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

    assert.equal(dataset.schemaVersion, '0.1.0')
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
