import assert from 'node:assert/strict'
import test from 'node:test'

import { levelLabel, matchesDataset, parsePeriodDocument, type PeriodDocument } from '../src/periods'

function document(overrides: Partial<PeriodDocument> = {}): PeriodDocument {
  return {
    schemaVersion: '0.3.0',
    repository: 'course-recommender',
    headSha: 'ba900d8f',
    method: 'epoch-boundaries:openrouter:x-ai/grok-4.6',
    commitCount: 2693,
    hierarchy: { depth: 1, levelNames: ['epoch'], rationale: 'because' },
    boundaries: [],
    levels: [[]],
    unpairedFocusPeaks: [],
    ...overrides,
  }
}

test('a period document generated from the same head is accepted', () => {
  assert.equal(
    matchesDataset(document(), { name: 'course-recommender', headSha: 'ba900d8f', commitCount: 2693 }),
    true,
  )
})

test('a period document from a different head is rejected rather than misapplied', () => {
  // Boundaries are commit indices, so a stale document points at the wrong commits.
  assert.equal(
    matchesDataset(document(), { name: 'course-recommender', headSha: 'deadbeef', commitCount: 2693 }),
    false,
  )
  assert.equal(
    matchesDataset(document(), { name: 'course-recommender', headSha: 'ba900d8f', commitCount: 2600 }),
    false,
  )
  assert.equal(
    matchesDataset(document(), { name: 'zod', headSha: 'ba900d8f', commitCount: 2693 }),
    false,
  )
})

test('malformed period documents parse to null instead of rendering', () => {
  assert.equal(parsePeriodDocument(null), null)
  assert.equal(parsePeriodDocument('nope'), null)
  assert.equal(parsePeriodDocument({ levels: [], boundaries: [] }), null)
  assert.equal(parsePeriodDocument({ ...document(), levels: 'no' }), null)
  assert.ok(parsePeriodDocument(document()))
})

test('level labels pluralize the level name rather than a generic word', () => {
  assert.equal(levelLabel('epoch', 1), '1 epoch')
  assert.equal(levelLabel('epoch', 14), '14 epochs')
  assert.equal(levelLabel('era', 2), '2 eras')
})
