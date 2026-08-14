import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStructuralEpisodes } from '../src/structure.mjs'

function episode(changes) {
  return {
    id: 'episode:reorg',
    commitSha: 'abc123',
    shortSha: 'abc123',
    subject: 'Reorganize repository layout',
    authoredAt: '2025-02-01T00:00:00Z',
    committedAt: '2025-02-01T00:00:00Z',
    parentShas: [],
    contributorIds: [],
    codeAreaIds: [],
    changes,
    interpretationStatus: 'observed',
  }
}

test('structural detector groups a removed wrapper directory into one reorganization', () => {
  const structuralEpisodes = buildStructuralEpisodes([
    episode([
      { status: 'R', similarity: '100', previousPath: 'demo/frontend/app.ts', path: 'frontend/app.ts' },
      { status: 'R', similarity: '098', previousPath: 'demo/frontend/ui.ts', path: 'frontend/ui.ts' },
      { status: 'R', similarity: '100', previousPath: 'demo/backend/api.ts', path: 'backend/api.ts' },
      { status: 'R', similarity: '100', previousPath: 'demo/infra/main.tf', path: 'infra/main.tf' },
    ]),
  ])

  assert.equal(structuralEpisodes.length, 1)
  assert.equal(structuralEpisodes[0].label, 'Promote demo contents to repository root')
  assert.deepEqual(structuralEpisodes[0].mappings, [
    { fromPrefix: 'demo', toPrefix: '', fileCount: 4 },
  ])
  assert.equal(structuralEpisodes[0].transitions.length, 4)
  assert.ok(structuralEpisodes[0].transitions.every((transition) => transition.basis === 'git-rename'))
  assert.ok(structuralEpisodes[0].confidence >= 0.85)
})

test('structural detector cautiously pairs corroborating delete and add paths', () => {
  const structuralEpisodes = buildStructuralEpisodes([
    episode([
      { status: 'D', path: 'demo/frontend/app.ts' },
      { status: 'D', path: 'demo/backend/api.ts' },
      { status: 'D', path: 'demo/infra/main.tf' },
      { status: 'A', path: 'frontend/app.ts' },
      { status: 'A', path: 'backend/api.ts' },
      { status: 'A', path: 'infra/main.tf' },
    ]),
  ])

  assert.equal(structuralEpisodes.length, 1)
  assert.equal(structuralEpisodes[0].mappings[0].fromPrefix, 'demo')
  assert.ok(
    structuralEpisodes[0].transitions.every(
      (transition) => transition.basis === 'delete-add-path-continuity',
    ),
  )
  assert.ok(structuralEpisodes[0].confidence < 0.75)
})

test('structural detector abstains from isolated or weakly related file moves', () => {
  const structuralEpisodes = buildStructuralEpisodes([
    episode([
      { status: 'R', similarity: '100', previousPath: 'old/a.ts', path: 'new/a.ts' },
      { status: 'R', similarity: '100', previousPath: 'old/b.ts', path: 'new/b.ts' },
      { status: 'D', path: 'one/index.ts' },
      { status: 'A', path: 'unrelated/index.ts' },
    ]),
  ])

  assert.deepEqual(structuralEpisodes, [])
})
