import assert from 'node:assert/strict'
import test from 'node:test'

import type { AtlasDataset, ChangeEpisode } from '../src/model'
import { buildRepositoryShape } from '../src/directoryLifespans'
import { buildRepositoryTimeMachine } from '../src/repositorySnapshots'
import { buildStoryModel } from '../src/story'

function episode(
  sha: string,
  authoredAt: string,
  changes: ChangeEpisode['changes'],
): ChangeEpisode {
  return {
    id: `episode:${sha}`,
    commitSha: sha,
    shortSha: sha,
    subject: `Commit ${sha}`,
    authoredAt,
    committedAt: authoredAt,
    parentShas: [],
    contributorIds: ['contributor:a'],
    codeAreaIds: [],
    changes,
    interpretationStatus: 'observed',
  }
}

/** A directory that is created, renamed away from, grown, and partly emptied. */
const dataset: AtlasDataset = {
  schemaVersion: '0.1.0',
  analysis: { mode: 'interpreted', historyRange: 'HEAD', mergeDiffStrategy: 'diff-merges-first-parent' },
  repository: { name: 'example', ref: 'main', headSha: 'd4', commitCount: 4 },
  timeRange: {
    firstAuthoredAt: '2025-01-01T12:00:00Z',
    lastAuthoredAt: '2025-04-01T12:00:00Z',
  },
  contributors: [
    {
      id: 'contributor:a',
      displayName: 'Example Author',
      aliases: ['Example Author'],
      isBot: false,
      firstSeenAt: '2025-01-01T12:00:00Z',
      lastSeenAt: '2025-04-01T12:00:00Z',
    },
  ],
  codeAreas: [],
  featureCandidates: [],
  relationships: [],
  semanticEpisodes: [],
  structuralEpisodes: [
    {
      id: 'structural:prealpha',
      kind: 'repository-reorganization',
      label: 'Reorganize prealpha into demo',
      status: 'candidate',
      confidence: 0.95,
      method: 'test',
      rationale: 'Two Git rename records move paths out of prealpha.',
      evidence: [{ commitSha: 'd2' }],
      mappings: [{ fromPrefix: 'prealpha', toPrefix: 'demo', fileCount: 2 }],
      transitions: [
        {
          previousPath: 'prealpha/a.ts',
          path: 'demo/a.ts',
          basis: 'git-rename',
          confidence: 1,
          similarity: 100,
        },
      ],
    },
  ],
  episodes: [
    episode('d1', '2025-01-01T12:00:00Z', [
      { path: 'prealpha/a.ts', status: 'A' },
      { path: 'prealpha/b.ts', status: 'A' },
      { path: 'README.md', status: 'A' },
    ]),
    episode('d2', '2025-02-01T12:00:00Z', [
      { path: 'demo/a.ts', previousPath: 'prealpha/a.ts', status: 'R' },
      { path: 'demo/b.ts', previousPath: 'prealpha/b.ts', status: 'R' },
    ]),
    episode('d3', '2025-03-01T12:00:00Z', [{ path: 'demo/sub/c.ts', status: 'A' }]),
    episode('d4', '2025-04-01T12:00:00Z', [{ path: 'demo/b.ts', status: 'D' }]),
  ],
}

const story = buildStoryModel(dataset, [], dataset.structuralEpisodes ?? [], [])

test('buildRepositoryShape tracks a directory from first file to last', () => {
  const shape = buildRepositoryShape(dataset, story)
  const byLabel = new Map(shape.tracks.map((track) => [track.label, track]))

  const demo = byLabel.get('demo')!
  assert.equal(demo.peakFileCount, 3)
  assert.equal(demo.currentFileCount, 2)
  assert.equal(demo.isActive, true)
  assert.equal(demo.hasChildren, true, 'demo/sub makes demo drillable')

  const prealpha = byLabel.get('prealpha')!
  assert.equal(prealpha.peakFileCount, 2)
  assert.equal(prealpha.currentFileCount, 0)
  assert.equal(prealpha.isActive, false, 'renamed-away directories read as retired')
  assert.ok(prealpha.lastPercent < 100, 'a retired band stops before the end of the range')

  assert.equal(byLabel.get('(root files)')?.currentFileCount, 1)
})

test('buildRepositoryShape resolves prefix mappings to visible rows', () => {
  const shape = buildRepositoryShape(dataset, story)

  assert.equal(shape.transitions.length, 1)
  const [transition] = shape.transitions
  assert.equal(transition.fromLabel, 'prealpha')
  assert.equal(transition.toLabel, 'demo')
  assert.equal(transition.fileCount, 2)
  assert.equal(transition.episodeId, 'structural:prealpha')

  const rows = new Set(shape.tracks.map((track) => track.key))
  assert.ok(rows.has(transition.fromKey) && rows.has(transition.toKey))
  assert.equal(shape.markers.length, 1)
  assert.equal(shape.markers[0].withinScope, true)
})

test('buildRepositoryShape restricts tracks and transitions to the selected scope', () => {
  const shape = buildRepositoryShape(dataset, story, 'demo')

  assert.deepEqual(
    shape.tracks.map((track) => [track.label, track.currentFileCount]),
    [
      ['sub', 1],
      ['(files here)', 1],
    ],
    'directories rank above the loose files in the scope',
  )
  assert.equal(
    shape.transitions.length,
    0,
    'a transition between top-level paths does not belong inside demo',
  )
  assert.equal(shape.markers[0].withinScope, false)
})

test('buildRepositoryTimeMachine scopes its change summary and keeps every path', () => {
  const scoped = buildRepositoryTimeMachine(dataset, story, 'demo')
  const last = scoped.checkpoints.at(-1)!

  assert.equal(last.totalFiles, 2, 'demo/a.ts and demo/sub/c.ts remain')
  assert.equal(last.changes.commitCount, 1, 'only the deletion touches demo in this interval')
  assert.deepEqual(last.changes.paths, ['demo/b.ts'])

  const rename = scoped.checkpoints.find((entry) => entry.episode.commitSha === 'd2')!
  assert.equal(rename.changes.moved, 2)
  assert.deepEqual(rename.changes.paths, [
    'prealpha/a.ts → demo/a.ts',
    'prealpha/b.ts → demo/b.ts',
  ])
})

test('buildRepositoryTimeMachine reports the full changed-path list', () => {
  const wide: AtlasDataset = {
    ...dataset,
    episodes: [
      dataset.episodes[0],
      episode(
        'wide',
        '2025-05-01T12:00:00Z',
        Array.from({ length: 40 }, (_, index) => ({
          path: `src/file-${index}.ts`,
          status: 'A',
        })),
      ),
    ],
  }
  const model = buildRepositoryTimeMachine(wide, buildStoryModel(wide, [], [], []))
  const last = model.checkpoints.at(-1)!

  assert.equal(last.changes.added, 40)
  assert.equal(
    last.changes.paths.length,
    40,
    'the interval list is complete so the view can report an honest count',
  )
})
