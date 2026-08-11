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
