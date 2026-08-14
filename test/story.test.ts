import assert from 'node:assert/strict'
import test from 'node:test'

import type { AtlasDataset } from '../src/model'
import {
  buildAreaMatrix,
  buildContributorTrail,
  buildStoryModel,
  deriveFeatureAssociations,
} from '../src/story'

const dataset: AtlasDataset = {
  schemaVersion: '0.1.0',
  analysis: {
    mode: 'interpreted',
    historyRange: 'HEAD',
    mergeDiffStrategy: 'first-parent',
  },
  repository: { name: 'example', ref: 'main', headSha: 'bbb', commitCount: 3 },
  timeRange: {
    firstAuthoredAt: '2024-12-20T12:00:00Z',
    lastAuthoredAt: '2025-03-01T12:00:00Z',
  },
  contributors: [
    {
      id: 'contributor:a',
      displayName: 'Example Author',
      aliases: ['Example Author'],
      isBot: false,
      firstSeenAt: '2024-12-20T12:00:00Z',
      lastSeenAt: '2025-03-01T12:00:00Z',
    },
  ],
  codeAreas: [
    {
      id: 'area:src',
      label: 'src',
      pathPrefix: 'src',
      classification: 'top-level-path',
      firstSeenAt: '2024-12-20T12:00:00Z',
      lastSeenAt: '2025-03-01T12:00:00Z',
    },
    {
      id: 'area:test',
      label: 'test',
      pathPrefix: 'test',
      classification: 'top-level-path',
      firstSeenAt: '2025-01-15T12:00:00Z',
      lastSeenAt: '2025-01-15T12:00:00Z',
    },
  ],
  episodes: [
    {
      id: 'episode:aaa',
      commitSha: 'aaa',
      shortSha: 'aaa',
      subject: 'Introduce capability',
      authoredAt: '2024-12-20T12:00:00Z',
      committedAt: '2024-12-20T12:00:00Z',
      parentShas: [],
      contributorIds: ['contributor:a'],
      codeAreaIds: ['area:src'],
      changes: [{ path: 'src/index.ts', status: 'A' }],
      interpretationStatus: 'observed',
    },
    {
      id: 'episode:bbb',
      commitSha: 'bbb',
      shortSha: 'bbb',
      subject: 'Cover capability',
      authoredAt: '2025-01-15T12:00:00Z',
      committedAt: '2025-01-15T12:00:00Z',
      parentShas: ['aaa'],
      contributorIds: ['contributor:a'],
      codeAreaIds: ['area:src', 'area:test'],
      changes: [
        { path: 'src/index.ts', status: 'M' },
        { path: 'test/index.test.ts', status: 'A' },
      ],
      interpretationStatus: 'observed',
    },
    {
      id: 'episode:ccc',
      commitSha: 'ccc',
      shortSha: 'ccc',
      subject: 'Unrelated work',
      authoredAt: '2025-03-01T12:00:00Z',
      committedAt: '2025-03-01T12:00:00Z',
      parentShas: ['bbb'],
      contributorIds: ['contributor:a'],
      codeAreaIds: ['area:src'],
      changes: [{ path: 'src/other.ts', status: 'A' }],
      interpretationStatus: 'observed',
    },
  ],
  featureCandidates: [
    {
      id: 'feature:capability',
      label: 'Example capability',
      status: 'candidate',
      confidence: 0.8,
      method: 'test',
      evidence: [{ commitSha: 'bbb' }, { commitSha: 'aaa' }, { commitSha: 'bbb' }],
    },
  ],
  semanticEpisodes: [
    {
      id: 'semantic:introduced',
      kind: 'feature-lifecycle',
      featureId: 'feature:capability',
      label: 'Introduce capability',
      lifecycleStage: 'introduced',
      status: 'candidate',
      confidence: 0.88,
      method: 'test',
      rationale: 'The first commit establishes the capability.',
      evidence: [{ commitSha: 'aaa' }],
    },
    {
      id: 'semantic:hardened',
      kind: 'feature-lifecycle',
      featureId: 'feature:capability',
      label: 'Cover capability behavior',
      lifecycleStage: 'hardened',
      status: 'candidate',
      confidence: 0.82,
      method: 'test',
      rationale: 'Tests cover the existing capability.',
      evidence: [{ commitSha: 'bbb' }],
    },
  ],
  structuralEpisodes: [
    {
      id: 'structural:layout',
      kind: 'repository-reorganization',
      label: 'Promote demo contents to repository root',
      status: 'candidate',
      confidence: 0.9,
      method: 'test',
      rationale: 'Three Git rename records move paths out of demo.',
      evidence: [{ commitSha: 'bbb', paths: ['demo/src/index.ts', 'src/index.ts'] }],
      mappings: [{ fromPrefix: 'demo', toPrefix: '', fileCount: 3 }],
      transitions: [
        {
          previousPath: 'demo/src/index.ts',
          path: 'src/index.ts',
          basis: 'git-rename',
          confidence: 1,
          similarity: 100,
        },
      ],
    },
  ],
  relationships: [],
}

test('buildStoryModel makes calendar chapters and de-duplicates cited events', () => {
  const model = buildStoryModel(dataset)

  assert.deepEqual(model.chapters.map((chapter) => chapter.label), ['2024', '2025'])
  assert.deepEqual(model.chapters.map((chapter) => chapter.commitCount), [1, 2])
  assert.deepEqual(model.chapters.map((chapter) => chapter.featureCount), [1, 1])
  assert.deepEqual(model.lanes[0].events.map((event) => event.episode.commitSha), ['aaa', 'bbb'])
  assert.ok(model.lanes[0].startPercent < model.lanes[0].endPercent)
  assert.deepEqual(
    model.lanes[0].lifecycleEvents.map((event) => event.semanticEpisode.lifecycleStage),
    ['introduced', 'hardened'],
  )
  assert.equal(model.structuralEvents.length, 1)
  assert.equal(model.structuralEvents[0].episode.commitSha, 'bbb')
})

test('buildAreaMatrix counts distinct cited commits per observed path area', () => {
  const matrix = buildAreaMatrix(dataset)
  const row = matrix.rows[0]

  assert.deepEqual(matrix.columns.map((area) => area.label), ['src', 'test'])
  assert.equal(row.cells.get('area:src')?.count, 2)
  assert.equal(row.cells.get('area:test')?.count, 1)
  assert.equal(matrix.maxCount, 2)
})

test('deriveFeatureAssociations keeps authorship and touched areas as counts over evidence', () => {
  const associations = deriveFeatureAssociations(dataset, dataset.featureCandidates[0])

  assert.deepEqual(associations.episodes.map((episode) => episode.commitSha), ['aaa', 'bbb'])
  assert.equal(associations.contributors[0].count, 2)
  assert.deepEqual(
    associations.areas.map((area) => [area.label, area.count]),
    [
      ['src', 2],
      ['test', 1],
    ],
  )
})

test('buildContributorTrail keeps authored evidence distinct from whole-feature context', () => {
  const contextualDataset = structuredClone(dataset)
  contextualDataset.contributors.push({
    id: 'contributor:b',
    displayName: 'Context Author',
    aliases: ['Context Author'],
    isBot: false,
    firstSeenAt: '2025-03-01T12:00:00Z',
    lastSeenAt: '2025-03-01T12:00:00Z',
  })
  contextualDataset.episodes[2].contributorIds = ['contributor:b']
  contextualDataset.featureCandidates[0].evidence.push({ commitSha: 'ccc' })

  const contributor = contextualDataset.contributors[0]
  const trail = buildContributorTrail(contextualDataset, contributor)

  assert.deepEqual(
    trail.authoredEpisodes.map((episode) => episode.commitSha),
    ['aaa', 'bbb'],
  )
  assert.deepEqual(
    trail.featureLanes[0].events.map((event) => [event.episode.commitSha, event.isAuthored]),
    [
      ['aaa', true],
      ['bbb', true],
      ['ccc', false],
    ],
  )
  assert.equal(trail.featureLanes[0].authoredEvents.length, 2)
  assert.equal(trail.featureLanes[0].lifecycleEvents.length, 2)
  assert.deepEqual(
    trail.areaLanes.map((lane) => [lane.area.label, lane.events.length]),
    [
      ['src', 2],
      ['test', 1],
    ],
  )
})

test('buildContributorTrail uses a calendar chapter as an authored-history focus', () => {
  const chapter = buildStoryModel(dataset).chapters.find((entry) => entry.label === '2025')!
  const trail = buildContributorTrail(dataset, dataset.contributors[0], dataset.featureCandidates, chapter)

  assert.deepEqual(
    trail.authoredEpisodes.map((episode) => episode.commitSha),
    ['bbb', 'ccc'],
  )
  assert.equal(trail.featureLanes.length, 1)
  assert.deepEqual(
    trail.areaLanes.map((lane) => [lane.area.label, lane.events.length]),
    [
      ['src', 2],
      ['test', 1],
    ],
  )
  assert.deepEqual(
    trail.uncitedEpisodes.map((episode) => episode.commitSha),
    ['ccc'],
  )
})
