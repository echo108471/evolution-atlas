import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMBINED_CHANNELS,
  OBSERVED_CHANNELS,
  READING_CHANNELS,
  channelSimilarity,
  clusterByAssignment,
  clusterFeatures,
  clusterObserved,
  clusteringShape,
  commitFeatures,
  evidenceChannels,
  groupingStability,
  jaccard,
  observedSimilarity,
  pairwiseAgreement,
  pathDirectories,
  subjectText,
} from '../scripts/lib/capability-cluster.mjs'
import {
  CONSOLIDATE_SYSTEM_PROMPT,
  buildConsolidationRequest,
  consolidateCapabilities,
  parseConsolidation,
  renderNames,
} from '../scripts/lib/capability-consolidate.mjs'
import { buildNamingRequest } from '../scripts/lib/capability-naming.mjs'

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

test('the namer is never told which arm produced a group', async () => {
  // Two arms that disagree cannot be ranked by cluster counts and no gold set exists, so
  // the same prompt judges both. Telling it the provenance would be telling it the answer.
  const { buildNamingRequest, NAMING_SYSTEM_PROMPT } = await import('../scripts/lib/capability-naming.mjs')
  const body = buildNamingRequest(
    [{ subject: 'add retry to upload' }, { subject: 'fix upload timeout' }],
    { model: 'test' },
  )
  const rendered = JSON.stringify(body)
  assert.doesNotMatch(rendered, /baseline|deterministic|model arm|cluster|jaccard|consolidat/i)
  assert.match(NAMING_SYSTEM_PROMPT, /refus/i, 'refusal must be offered as a valid answer')
})

test('a group is sampled across its whole span, not just its opening', async () => {
  const { sampleSubjects } = await import('../scripts/lib/capability-naming.mjs')
  const evidence = Array.from({ length: 40 }, (_, index) => ({ subject: `commit ${index}` }))
  const sampled = sampleSubjects(evidence, 4)
  assert.equal(sampled.length, 4)
  assert.equal(sampled[0], 'commit 0')
  assert.ok(Number(sampled.at(-1).split(' ')[1]) >= 30, `last sample was ${sampled.at(-1)}`)
  assert.deepEqual(sampleSubjects([{ subject: 'only one' }], 4), ['only one'])
})

test('a refusal is recorded as incoherent, not as an empty name', async () => {
  const { parseNaming } = await import('../scripts/lib/capability-naming.mjs')
  const refused = parseNaming({
    choices: [{ message: { content: '{"coherent":false,"name":null,"reason":"unrelated work"}' } }],
  })
  assert.equal(refused.coherent, false)
  assert.equal(refused.name, null)

  // A group claimed coherent but given no name is a refusal in disguise.
  const empty = parseNaming({ choices: [{ message: { content: '{"coherent":true,"name":"   "}' } }] })
  assert.equal(empty.coherent, false)
})

test('singletons are excluded so splitting more cannot raise an arm score', async () => {
  const { evaluateArm } = await import('../scripts/lib/capability-naming.mjs')
  const { mapWithConcurrency } = await import('../scripts/lib/commit-analysis.mjs')
  const capabilities = [
    { commitCount: 3, evidence: [{ subject: 'a' }, { subject: 'b' }, { subject: 'c' }] },
    { commitCount: 1, evidence: [{ subject: 'lonely' }] },
    { commitCount: 2, evidence: [{ subject: 'd' }, { subject: 'e' }] },
  ]
  const seen = []
  const request = async (evidence) => {
    seen.push(evidence.length)
    return { coherent: evidence.length === 3, name: 'x', reason: null, usage: null }
  }
  const result = await evaluateArm(capabilities, { apiKey: 'k', request, mapper: mapWithConcurrency })
  assert.deepEqual(seen.sort(), [2, 3], 'the one-commit group must not be judged')
  assert.equal(result.groupsJudged, 2)
  assert.equal(result.coherentShare, 0.5)
})

test('a failed naming request is not counted as a refusal', async () => {
  const { evaluateArm } = await import('../scripts/lib/capability-naming.mjs')
  const { mapWithConcurrency } = await import('../scripts/lib/commit-analysis.mjs')
  const request = async () => { throw new Error('HTTP 500') }
  const result = await evaluateArm(
    [{ commitCount: 2, evidence: [{ subject: 'a' }, { subject: 'b' }] }],
    { apiKey: 'k', request, mapper: mapWithConcurrency },
  )
  assert.equal(result.failures, 1)
  assert.equal(result.groupsJudged, 0)
  assert.equal(result.incoherent, 0)
})

test('evidence channels keep observed facts and interpretation apart', () => {
  const channels = evidenceChannels(
    { subject: 'add professor rating import', changes: [{ path: 'api/ratings/import.ts' }] },
    { capability: 'Professor rating ingestion', summary: 'Imports ratings from the scraper.' },
  )
  assert.ok(channels.directories.has('api/ratings'))
  assert.ok(channels.subject.has('professor'))
  assert.ok(channels.capability.has('ingestion'))
  assert.ok(channels.summary.has('scraper'))
  // A reading-free commit still yields the observed channels, so an arm that ignores
  // interpretation never depends on interpretation having run.
  const observedOnly = evidenceChannels({ subject: 'tidy', changes: [{ path: 'api/x.ts' }] }, null)
  assert.equal(observedOnly.capability.size, 0)
  assert.equal(observedOnly.summary.size, 0)
})

test('channel weights of zero exclude a channel entirely', () => {
  const left = evidenceChannels(
    { subject: 'search ranking', changes: [{ path: 'search/rank.ts' }] },
    { capability: 'Billing', summary: 'Charges cards.' },
  )
  const right = evidenceChannels(
    { subject: 'search ranking', changes: [{ path: 'search/rank.ts' }] },
    { capability: 'Scheduling', summary: 'Builds timetables.' },
  )
  // Identical observation, unrelated readings: the observed arm must not see the disagreement.
  assert.equal(channelSimilarity(left, right, OBSERVED_CHANNELS), 1)
  assert.equal(channelSimilarity(left, right, READING_CHANNELS), 0)
})

test('the combined weights are the plain mean of the two arms, not a tuned mixture', () => {
  // Guards the claim in the module comment. With no gold set, any hand-tuned mixture would
  // be fitted to whichever arm looked better afterwards, so drift here is a real finding.
  for (const channel of Object.keys(COMBINED_CHANNELS)) {
    const mean = (OBSERVED_CHANNELS[channel] + READING_CHANNELS[channel]) / 2
    assert.equal(COMBINED_CHANNELS[channel], mean, `${channel} is no longer the mean`)
  }
  const total = Object.values(COMBINED_CHANNELS).reduce((sum, weight) => sum + weight, 0)
  assert.equal(total, 1)
})

test('reading channels group commits that share a capability across unrelated paths', () => {
  const episodes = [
    { subject: 'wire stripe', changes: [{ path: 'api/pay/stripe.ts' }] },
    { subject: 'invoice pdf', changes: [{ path: 'jobs/pdf/render.ts' }] },
    { subject: 'nav tweak', changes: [{ path: 'web/nav/bar.tsx' }] },
  ]
  const readings = [
    { capability: 'Payment collection', summary: 'Collects payment from customers.' },
    { capability: 'Payment collection', summary: 'Collects payment from customers.' },
    { capability: 'Site navigation', summary: 'Moves between pages.' },
  ]
  const features = episodes.map((episode, index) => evidenceChannels(episode, readings[index]))
  const shaping = { threshold: 0.35, neighbours: 2 }

  const observed = clusterFeatures(features, { ...shaping, weights: OBSERVED_CHANNELS })
  assert.equal(observed[0].length, 1, 'paths alone share nothing here')

  const byReading = clusterFeatures(features, { ...shaping, weights: READING_CHANNELS })
  assert.deepEqual(byReading[0].sort(), [0, 1])
})

test('the baseline is the shared clustering under observed weights, not a separate path', () => {
  const episodes = [
    { subject: 'search ranking tweak', changes: [{ path: 'search/rank.ts' }] },
    { subject: 'search ranking fix', changes: [{ path: 'search/rank.ts' }] },
    { subject: 'billing webhook', changes: [{ path: 'billing/hook.ts' }] },
  ]
  const shaping = { threshold: 0.35, neighbours: 2 }
  const viaWrapper = clusterObserved(episodes, shaping)
  const viaFeatures = clusterFeatures(
    episodes.map((episode) => evidenceChannels(episode, null)),
    { ...shaping, weights: OBSERVED_CHANNELS },
  )
  assert.deepEqual(viaWrapper, viaFeatures)
})

test('stability counts pairs, because cluster counts hide membership churn', () => {
  // Both runs produce two groups of two. Reading only the shape, they look identical;
  // over pairs, they share nothing at all.
  const first = [[0, 1], [2, 3]]
  const second = [[0, 2], [1, 3]]
  const churn = groupingStability([first, second])
  assert.equal(churn.everPaired, 4)
  assert.equal(churn.alwaysPaired, 0)
  assert.equal(churn.alwaysShare, 0)

  const steady = groupingStability([first, [[1, 0], [3, 2]]])
  assert.equal(steady.everPaired, 2)
  assert.equal(steady.alwaysShare, 1)

  // A pair held by two runs of three is reported at two, not rounded up to agreement.
  const partial = groupingStability([[[0, 1]], [[0, 1]], [[0, 2]]])
  assert.deepEqual(partial.pairsByRunCount, [0, 1, 1, 0])
  assert.equal(partial.everPaired, 2)
})

test('singletons are not counted as stable pairs', () => {
  const stability = groupingStability([[[0], [1], [2]], [[0], [1], [2]]])
  assert.equal(stability.everPaired, 0)
  assert.equal(stability.alwaysShare, 0)
})

test('the naming prompt shows readings only when asked, and never says which arm', () => {
  const evidence = [
    { subject: 'add stripe webhook', reading: 'Handles payment confirmations.' },
    { subject: 'retry failed charges', reading: 'Retries a declined card.' },
  ]
  const plain = buildNamingRequest(evidence, { model: 'test' })
  const plainText = JSON.stringify(plain)
  assert.ok(plainText.includes('add stripe webhook'))
  assert.ok(!plainText.includes('Handles payment confirmations'), 'the neutral judge must not see readings')

  const withReadings = JSON.stringify(buildNamingRequest(evidence, { model: 'test', withReadings: true }))
  assert.ok(withReadings.includes('Handles payment confirmations'))

  for (const text of [plainText, withReadings]) {
    for (const leak of ['baseline', 'combined', 'cluster', 'arm']) {
      assert.ok(!text.toLowerCase().includes(leak), `the judge must not learn the arm (${leak})`)
    }
  }
})

test('a commit without a reading still renders in the reading-aware prompt', () => {
  const request = buildNamingRequest([{ subject: 'tidy imports' }], { model: 'test', withReadings: true })
  assert.ok(JSON.stringify(request).includes('tidy imports'))
})

test('merge subjects contribute the branch name, never the account it came from', () => {
  assert.equal(subjectText('Merge pull request #431 from AggieWorks/prefetch-api'), 'prefetch-api')
  assert.equal(subjectText("Merge remote-tracking branch 'origin/fix-routes'"), 'fix-routes')
  assert.equal(subjectText("Merge branch 'staging' into main"), 'staging')
  assert.equal(subjectText('cleanup'), 'cleanup', 'an ordinary subject passes through')

  // Two merges from different contributors, describing different work, must not be drawn
  // together by the account names alone.
  const left = evidenceChannels({ subject: 'Merge pull request #1 from octocat/billing-retry', changes: [] }, null)
  const right = evidenceChannels({ subject: 'Merge pull request #2 from octocat/search-ranking', changes: [] }, null)
  assert.equal(channelSimilarity(left, right, OBSERVED_CHANNELS), 0)
  assert.ok(!left.subject.has('octocat'))
})

test('issue numbers are not capability words', () => {
  const channels = evidenceChannels({ subject: 'Update etl-pipeline.yml (#743)', changes: [] }, null)
  assert.ok(!channels.subject.has('743'))
  assert.ok(channels.subject.has('etl'))
})
