import assert from 'node:assert/strict'
import test from 'node:test'

import { hasOmittedSubject, labelEpisode, summarizeChangedPaths } from '../src/commitSubject'
import type { ChangeEpisode } from '../src/model'

function episode(overrides: Partial<ChangeEpisode> = {}): ChangeEpisode {
  return {
    id: 'episode:0bd8054804b142011ef311520b77475889692555',
    commitSha: '0bd8054804b142011ef311520b77475889692555',
    shortSha: '0bd80548',
    subject: 'Observed commit 0bd80548',
    authoredAt: '2020-03-08T22:03:00Z',
    committedAt: '2020-03-08T22:03:00Z',
    parentShas: [],
    contributorIds: [],
    codeAreaIds: [],
    changes: [
      { path: 'README.md', status: 'M' },
      { path: 'tests.ts', status: 'M' },
      { path: 'types/function.ts', status: 'M' },
    ],
    interpretationStatus: 'observed',
    ...overrides,
  } as ChangeEpisode
}

test('placeholder and empty subjects are recognized as omitted messages', () => {
  assert.equal(hasOmittedSubject(episode()), true)
  assert.equal(hasOmittedSubject(episode({ subject: '' })), true)
  assert.equal(hasOmittedSubject(episode({ subject: 'Fix discriminated union parsing' })), false)
  // A real message that merely starts with the same words is kept.
  assert.equal(hasOmittedSubject(episode({ subject: 'Observed commit counts in docs' })), false)
})

test('an omitted message is labelled by its changed paths, keeping the SHA separate', () => {
  const labelled = labelEpisode(episode())
  assert.equal(labelled.subject, 'README.md, tests.ts +1 path')
  assert.equal(labelled.subjectOmitted, true)
  assert.equal(labelled.shortSha, '0bd80548')
  assert.equal(summarizeChangedPaths(episode({ changes: [{ path: 'src/a.ts', status: 'A' }] })), 'a.ts')
  assert.equal(
    summarizeChangedPaths(episode({ changes: [] })),
    'Commit 0bd80548 · no first-parent path changes',
  )
})

test('real commit messages pass through untouched', () => {
  const original = episode({ subject: 'Add z.discriminatedUnion' })
  assert.equal(labelEpisode(original), original)
})
