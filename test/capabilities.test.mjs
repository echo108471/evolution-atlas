import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clusterByAssignment,
  clusterObserved,
  clusteringShape,
  commitFeatures,
  jaccard,
  observedSimilarity,
  pairwiseAgreement,
  pathDirectories,
} from '../scripts/lib/capability-cluster.mjs'
import {
  CONSOLIDATE_SYSTEM_PROMPT,
  buildConsolidationRequest,
  consolidateCapabilities,
  parseConsolidation,
  renderNames,
} from '../scripts/lib/capability-consolidate.mjs'

const episode = (subject, paths) => ({
  commitSha: `sha-${subject}`,
  subject,
  changes: paths.map((path) => ({ path, status: 'M' })),
})

test('a path contributes every directory depth, not only its top level', () => {
  // Two commits under `frontend/` share almost nothing; two under
  // `frontend/src/search/` share a great deal. Counting every prefix lets the deeper
  // agreement outweigh the shallow one.
  assert.deepEqual([...pathDirectories(episode('x', ['a/b/c/file.ts']))], ['a', 'a/b', 'a/b/c'])
  assert.deepEqual([...pathDirectories(episode('x', ['top.ts']))], [])
})

test('jaccard is zero against an empty set and one against itself', () => {
  const set = new Set(['a', 'b'])
  assert.equal(jaccard(set, set), 1)
  assert.equal(jaccard(set, new Set()), 0)
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3)
})

test('similarity weights where a change landed over what it was called', () => {
  const samePath = observedSimilarity(
    commitFeatures(episode('completely different words here', ['src/search/index.ts'])),
    commitFeatures(episode('nothing alike whatsoever', ['src/search/index.ts'])),
  )
  const sameWords = observedSimilarity(
    commitFeatures(episode('course search filtering', ['alpha/one.ts'])),
    commitFeatures(episode('course search filtering', ['beta/two.ts'])),
  )
  assert.ok(samePath > sameWords, `paths ${samePath} should outweigh words ${sameWords}`)
})

test('mutual-kNN denies a hub the power to merge everything it touches', () => {
  // Linking every pair above a threshold and taking connected components collapsed the
  // pilot into one cluster of 568 units out of 606 at every threshold tried, because a
  // few sprawling commits touch enough of the tree to join unrelated work. Requiring the
  // link to be mutual denies them that: a hub is nobody's nearest neighbour.
  const episodes = []
  for (const area of ['search', 'billing', 'profile', 'inbox']) {
    for (let index = 0; index < 3; index += 1) {
      episodes.push(episode(`${area} work ${index}`, [`src/${area}/file${index}.ts`]))
    }
  }
  episodes.push(
    episode('sweeping rename across the tree', [
      'src/search/file0.ts', 'src/billing/file0.ts', 'src/profile/file0.ts', 'src/inbox/file0.ts',
    ]),
  )

  const linked = clusterObserved(episodes, { threshold: 0.2, method: 'components' })
  const mutual = clusterObserved(episodes, { threshold: 0.2, method: 'mutual-knn', neighbours: 3 })
  assert.equal(linked.length, 1, 'single linkage lets the hub merge every area')
  assert.ok(mutual.length >= 4, `mutual-kNN produced ${mutual.length} clusters, expected the areas to stay apart`)
})

test('commits sharing a deep directory group; unrelated ones stay apart', () => {
  const episodes = [
    episode('search ranking', ['src/search/rank.ts']),
    episode('search filters', ['src/search/filter.ts']),
    episode('billing invoice', ['src/billing/invoice.ts']),
  ]
  const clusters = clusterObserved(episodes, { threshold: 0.35, neighbours: 2 })
  const labels = new Array(3)
  clusters.forEach((members, order) => members.forEach((index) => { labels[index] = order }))
  assert.equal(labels[0], labels[1], 'the two search commits belong together')
  assert.notEqual(labels[0], labels[2], 'billing does not belong with search')
})

test('clustering shape reports singletons rather than hiding them', () => {
  const shape = clusteringShape([[0, 1, 2], [3], [4]], 5)
  assert.equal(shape.clusters, 3)
  assert.equal(shape.largest, 3)
  assert.equal(shape.singletons, 2)
  assert.equal(shape.groupedShare, 3 / 5)
})

test('agreement is counted over pairs, so splitting cannot flatter an arm', () => {
  const identical = pairwiseAgreement([[0, 1], [2, 3]], [[0, 1], [2, 3]], 4)
  assert.equal(identical.f1, 1)

  const disjoint = pairwiseAgreement([[0, 1], [2, 3]], [[0, 2], [1, 3]], 4)
  assert.equal(disjoint.pairsTogetherInBoth, 0)
  assert.equal(disjoint.f1, 0)

  // One arm merging everything has perfect recall and poor precision, which is the
  // asymmetry a cluster count would have concealed.
  const merged = pairwiseAgreement([[0, 1], [2, 3]], [[0, 1, 2, 3]], 4)
  assert.equal(merged.recall, 1)
  assert.ok(merged.precision < 0.5)
})

test('the consolidation prompt shows names and nothing else', () => {
  // Shown paths it would be solving the baseline's problem; shown the baseline's groups
  // it would ratify them.
  const body = buildConsolidationRequest(['alpha handling', 'beta reporting'], { model: 'test' })
  const userMessage = body.messages.find((message) => message.role === 'user').content
  assert.match(userMessage, /alpha handling/)
  assert.doesNotMatch(userMessage, /path|src\/|commit sha|cluster|baseline/i)
  assert.match(renderNames(['a', 'b']), /^0\. a\n1\. b$/)
})

test('the consolidation prompt does not name a capability to find', () => {
  // It did. The prompt illustrated "capability" with "course search" and "professor
  // review scraping", which are two of the pilot repository's actual capabilities - the
  // answers, written into the question. Illustrations here can only anchor.
  assert.doesNotMatch(CONSOLIDATE_SYSTEM_PROMPT, /course|professor|authentication|billing|search/i)
})

test('a name the model drops becomes its own capability rather than vanishing', () => {
  // Losing a capability silently is worse than reporting one that should have merged.
  const payload = {
    choices: [{ message: { content: '{"groups":[{"name":"Search","members":[0,1]}]}' } }],
  }
  const { groups, dropped } = parseConsolidation(payload, ['a', 'b', 'c'])
  assert.equal(dropped, 1)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[1], { name: 'c', members: [2] })
})

test('a member claimed twice is kept only by the first group that claimed it', () => {
  const payload = {
    choices: [{ message: { content: '{"groups":[{"name":"A","members":[0,1]},{"name":"B","members":[1,2,99,-3]}]}' } }],
  }
  const { groups } = parseConsolidation(payload, ['a', 'b', 'c'])
  assert.deepEqual(groups.map((group) => group.members), [[0, 1], [2]])
})

test('names split across batches are rejoined by a second round', async () => {
  const names = ['search a', 'billing a', 'search b', 'billing b']
  const calls = []
  const request = async (batch, { system }) => {
    calls.push({ batch: [...batch], merge: system !== undefined })
    if (system === undefined) {
      // Round one groups within a batch of two: each name stands alone.
      return { groups: batch.map((name, index) => ({ name, members: [index] })), dropped: 0, usage: null }
    }
    // Round two sees four batch names and merges the two search and two billing groups.
    return {
      groups: [
        { name: 'Search', members: [0, 2] },
        { name: 'Billing', members: [1, 3] },
      ],
      dropped: 0,
      usage: null,
    }
  }

  const result = await consolidateCapabilities(names, { apiKey: 'k', chunkSize: 2, request })
  assert.equal(result.rounds, 2)
  assert.equal(calls.length, 3, 'two batches plus one merge round')
  const search = result.groups.find((group) => group.name === 'Search')
  assert.deepEqual(search.members.sort((a, b) => a - b), [0, 2])
})

test('assignment groups readings and leaves unassigned ones alone', () => {
  const clusters = clusterByAssignment(4, new Map([[0, 'A'], [1, 'A'], [2, 'B']]))
  assert.equal(clusters.length, 3)
  assert.deepEqual(clusters[0], { label: 'A', members: [0, 1] })
})
