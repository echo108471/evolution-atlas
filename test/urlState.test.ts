import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_URL_STATE,
  parseAtlasUrl,
  serializeAtlasUrl,
  type AtlasUrlState,
} from '../src/urlState'

test('an empty query string parses to the default view', () => {
  assert.deepEqual(parseAtlasUrl(''), DEFAULT_URL_STATE)
  assert.deepEqual(parseAtlasUrl('?'), DEFAULT_URL_STATE)
})

test('defaults are omitted so common views keep a short link', () => {
  assert.equal(serializeAtlasUrl(DEFAULT_URL_STATE), '')
  assert.equal(
    serializeAtlasUrl({ ...DEFAULT_URL_STATE, section: 'features' }),
    '?view=features',
  )
})

test('paths and namespaced ids stay readable in the query string', () => {
  const search = serializeAtlasUrl({
    ...DEFAULT_URL_STATE,
    section: 'repository',
    chapterId: 'year:2024',
    scopePath: 'src/lib',
    checkpointSha: '8d0fb3a',
  })
  assert.equal(search, '?view=repository&chapter=year:2024&scope=src/lib&at=8d0fb3a')
})

test('parsing and serializing round-trip a fully populated state', () => {
  const state: AtlasUrlState = {
    section: 'people',
    subject: 'zod',
    chapterId: 'year:2023',
    lifecycleStage: 'hardened',
    evidencePreset: 'conservative',
    featureId: 'feature:abc123',
    contributorId: 'profile:aaa+bbb',
    selectedId: 'episode:def456',
    scopePath: 'src/viewer',
    checkpointSha: 'cb05280',
  }
  assert.deepEqual(parseAtlasUrl(serializeAtlasUrl(state)), state)
})

test('serialized key order does not depend on how the state was built', () => {
  const state: AtlasUrlState = {
    ...DEFAULT_URL_STATE,
    section: 'features',
    evidencePreset: 'all',
    featureId: 'feature:abc123',
    lifecycleStage: 'removed',
  }
  assert.equal(
    serializeAtlasUrl(state),
    '?view=features&stage=removed&evidence=all&feature=feature:abc123',
  )
})

test('unrecognized enum values fall back instead of throwing', () => {
  const parsed = parseAtlasUrl('?view=nowhere&stage=invented&evidence=maximal')
  assert.equal(parsed.section, DEFAULT_URL_STATE.section)
  assert.equal(parsed.lifecycleStage, DEFAULT_URL_STATE.lifecycleStage)
  assert.equal(parsed.evidencePreset, DEFAULT_URL_STATE.evidencePreset)
})

test('unknown keys and blank values are dropped', () => {
  const parsed = parseAtlasUrl('?unrelated=1&feature=&sel=%20&scope=')
  assert.equal(parsed.featureId, null)
  assert.equal(parsed.selectedId, null)
  assert.equal(parsed.scopePath, '')
  assert.equal(serializeAtlasUrl(parsed), '')
})

test('percent-encoded input is accepted and normalized on the way out', () => {
  const parsed = parseAtlasUrl('?scope=src%2Flib&chapter=year%3A2024')
  assert.equal(parsed.scopePath, 'src/lib')
  assert.equal(parsed.chapterId, 'year:2024')
  assert.equal(serializeAtlasUrl(parsed), '?chapter=year:2024&scope=src/lib')
})

test('a gallery subject survives a round trip and leads the query string', () => {
  assert.equal(parseAtlasUrl('?repo=zod').subject, 'zod')
  assert.equal(
    serializeAtlasUrl({ ...DEFAULT_URL_STATE, subject: 'zod', section: 'features' }),
    '?repo=zod&view=features',
  )
})

test('an absent subject means the single local dataset', () => {
  assert.equal(parseAtlasUrl('').subject, null)
  assert.equal(parseAtlasUrl('?repo=').subject, null)
  assert.equal(parseAtlasUrl('?repo=%20%20').subject, null)
  assert.equal(serializeAtlasUrl({ ...DEFAULT_URL_STATE, subject: null }), '')
})
