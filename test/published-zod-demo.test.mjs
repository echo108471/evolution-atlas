import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('published Zod interpretations stay linked to the minimized observed history', () => {
  const dataset = JSON.parse(readFileSync('publication/assets/zod/zod.json', 'utf8'))
  const gallery = JSON.parse(readFileSync('publication/assets/zod/manifest.json', 'utf8'))
  assert.equal(dataset.analysis.mode, 'interpreted')
  assert.equal(gallery.subjects.length, 1)
  const subject = gallery.subjects[0]
  assert.equal(subject.headSha, dataset.repository.headSha)
  assert.equal(subject.commitCount, dataset.episodes.length)
  assert.equal(subject.contributorCount, dataset.contributors.length)
  assert.equal(subject.codeAreaCount, dataset.codeAreas.length)
  assert.equal(subject.interpreted, true)
  assert.equal(subject.interpretation.featureCandidateCount, dataset.featureCandidates.length)
  assert.equal(subject.interpretation.semanticEpisodeCount, dataset.semanticEpisodes.length)
  assert.ok(dataset.featureCandidates.length > 0)
  assert.ok(dataset.semanticEpisodes.length > 0)
  assert.deepEqual(dataset.contributors, [])
  assert.deepEqual(dataset.identityMatches, [])

  const commits = new Map(dataset.episodes.map(episode => [episode.commitSha, episode]))
  const entities = new Set([...dataset.episodes, ...dataset.codeAreas, ...dataset.featureCandidates, ...dataset.semanticEpisodes].map(entity => entity.id))
  const featureIds = new Set(dataset.featureCandidates.map(feature => feature.id))
  for (const episode of dataset.episodes) assert.deepEqual(episode.contributorIds, [])
  for (const feature of dataset.featureCandidates) assert.equal(feature.status, 'candidate')
  for (const episode of dataset.semanticEpisodes) {
    assert.equal(episode.status, 'candidate')
    assert.ok(featureIds.has(episode.featureId))
  }
  for (const relationship of dataset.relationships) {
    assert.notEqual(relationship.kind, 'authored')
    assert.ok(entities.has(relationship.sourceId))
    assert.ok(entities.has(relationship.targetId))
  }
  for (const item of [...dataset.featureCandidates, ...dataset.semanticEpisodes, ...dataset.relationships]) {
    for (const reference of item.evidence ?? []) {
      const commit = commits.get(reference.commitSha)
      assert.ok(commit, 'evidence references an observed commit')
      const paths = new Set(commit.changes.flatMap(change => [change.path, change.previousPath].filter(Boolean)))
      for (const path of reference.paths ?? []) assert.ok(paths.has(path), 'evidence path occurs in its cited commit')
    }
  }
})
