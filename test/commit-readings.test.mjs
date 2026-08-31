import assert from 'node:assert/strict'
import test from 'node:test'

import { classify, substantiveIndices, triage } from '../scripts/lib/triage.mjs'
import { buildContextIndex, renderContext, situate } from '../scripts/lib/commit-context.mjs'
import {
  TIER1_SYSTEM_PROMPT,
  TIER2_SYSTEM_PROMPT,
  buildTier1Request,
  buildTier2Request,
  capabilityTokens,
  compareReadings,
  mapWithConcurrency,
  parseCommitResponse,
  renderCommitPrompt,
} from '../scripts/lib/commit-analysis.mjs'

function change(path, status = 'M', extra = {}) {
  return { path, status, ...extra }
}

function episode(index, { subject = 'work', changes = [change('src/app.ts')], parents = ['p'], areas = ['area:src'], date } = {}) {
  const sha = `c${String(index).padStart(7, '0')}${'f'.repeat(31)}`
  const day = String((index % 27) + 1).padStart(2, '0')
  return {
    id: `episode:${sha}`,
    commitSha: sha,
    shortSha: sha.slice(0, 8),
    subject,
    authoredAt: date ?? `2025-03-${day}T00:00:00Z`,
    committedAt: date ?? `2025-03-${day}T00:00:00Z`,
    parentShas: parents,
    contributorIds: [],
    codeAreaIds: areas,
    changes,
    interpretationStatus: 'observed',
  }
}

const dataset = (episodes, areas = [{ id: 'area:src', label: 'src' }]) => ({
  repository: { name: 'fixture' },
  codeAreas: areas,
  episodes,
})

test('a merge carrying no first-parent diff is filtered on structural grounds', () => {
  const result = classify(episode(1, { subject: 'Merge pull request #4', changes: [], parents: ['a', 'b'] }))
  assert.equal(result.class, 'merge')
  assert.equal(result.substantive, false)
  assert.equal(result.signals[0].basis, 'structural')
})

test('a merge that resolved conflicts by hand survives', () => {
  const result = classify(
    episode(2, { subject: 'Merge branch main', changes: [change('src/parser.ts')], parents: ['a', 'b'] }),
  )
  assert.equal(result.substantive, true)
})

test('documentation is recognized from paths, not from the subject', () => {
  assert.equal(classify(episode(3, { subject: 'anything', changes: [change('docs/guide.md')] })).class, 'docs')
  assert.equal(
    classify(episode(4, { subject: 'anything', changes: [change('README.md'), change('LICENSE')] })).class,
    'docs',
  )
})

test('a commit labelled chore that edits source is kept', () => {
  // The subject is a convention the author may ignore; the diff is a fact. A mislabelled
  // `chore:` touching the parser is exactly what this pipeline exists to find.
  const result = classify(episode(5, { subject: 'chore: tidy up', changes: [change('src/parser.ts')] }))
  assert.equal(result.class, 'code')
  assert.equal(result.substantive, true)
})

test('reverts stay substantive because undoing work is a lifecycle event', () => {
  const result = classify(episode(6, { subject: 'Revert "add caching"', changes: [change('src/cache.ts')] }))
  assert.equal(result.class, 'revert')
  assert.equal(result.substantive, true)
})

test('lockfiles and build output are filtered', () => {
  assert.equal(classify(episode(7, { changes: [change('package-lock.json')] })).class, 'dependencies')
  assert.equal(classify(episode(8, { changes: [change('dist/bundle.min.js')] })).class, 'generated')
})

test('triage reports what it removed', () => {
  const episodes = [
    episode(9, { changes: [] , parents: ['a', 'b'], subject: 'Merge pull request #1' }),
    episode(10, { changes: [change('docs/a.md')] }),
    episode(11, { changes: [change('src/a.ts')] }),
  ]
  const result = triage(episodes)
  assert.equal(result.substantiveCount, 1)
  assert.equal(result.filteredCount, 2)
  assert.equal(result.counts.merge, 1)
  assert.deepEqual(substantiveIndices(episodes), [2])
})

test('context marks a path the first time it is seen and the last', () => {
  const episodes = [
    episode(12, { changes: [change('src/a.ts')] }),
    episode(13, { changes: [change('src/a.ts', 'D')] }),
  ]
  const data = dataset(episodes)
  const index = buildContextIndex(episodes)

  const first = situate(data, index, 0)
  assert.equal(first.changes[0].isNewPath, true)
  assert.equal(first.areas[0].isNew, true)

  const second = situate(data, index, 1)
  assert.equal(second.changes[0].isNewPath, false)
  assert.equal(second.changes[0].isLastTouch, true)
  assert.equal(second.deletedCount, 1)
  assert.equal(second.areas[0].priorCommits, 1)
})

test('neighbours authored after the commit are dropped, not reported as earlier', () => {
  // Commits are indexed in topological order, which is not authoring order. Reporting a
  // later commit as "3 days earlier" is how the epoch pass first produced periods that
  // ended before they began.
  const episodes = [
    episode(14, { date: '2025-06-10T00:00:00Z' }),
    episode(15, { date: '2025-01-01T00:00:00Z' }),
    episode(16, { date: '2025-06-20T00:00:00Z' }),
  ]
  const data = dataset(episodes)
  const situation = situate(data, buildContextIndex(episodes), 2)
  assert.equal(situation.recent.length, 2)
  assert.ok(situation.recent.every((neighbour) => neighbour.daysBefore >= 0))
})

test('rendered context names the area and the recent work', () => {
  const episodes = [episode(17, { subject: 'add the parser' }), episode(18, { subject: 'fix the parser' })]
  const rendered = renderContext(situate(dataset(episodes), buildContextIndex(episodes), 1))
  assert.match(rendered, /Commit 2 of 2/)
  assert.match(rendered, /src \(1 prior commits/)
  assert.match(rendered, /add the parser/)
})

test('neither tier is told what the other concluded', () => {
  // Tier 2 saw tier 1's answer in the first build and ratified it: 3 revisions across 14
  // commits, all rhetorical. Blind reading is what makes their agreement a measurement.
  const diff = { totalLines: 10, truncated: false, text: 'diff', files: [{}], included: ['a'] }
  const body = buildTier2Request({
    repositoryName: 'fixture',
    contextText: 'context',
    subject: 'subject',
    diff,
    model: 'test-model',
  })
  const rendered = JSON.stringify(body)
  assert.doesNotMatch(rendered, /first pass|earlier pass|revisesFirstPass|capability:/i)
  assert.doesNotMatch(TIER2_SYSTEM_PROMPT, /earlier pass|first pass/i)
})

test('neither prompt names a capability for the model to find', () => {
  for (const prompt of [TIER1_SYSTEM_PROMPT, TIER2_SYSTEM_PROMPT]) {
    assert.doesNotMatch(prompt, /authentication|parser|database|the repository is/i)
  }
})

test('a partial diff is announced as partial', () => {
  const partial = renderCommitPrompt({
    repositoryName: 'fixture',
    contextText: 'context',
    subject: 'big change',
    diff: { totalLines: 9000, truncated: true, text: 'summary', files: [{}, {}, {}], included: ['a'] },
  })
  assert.match(partial, /partial - 1 of 3 files/)

  const whole = renderCommitPrompt({
    repositoryName: 'fixture',
    contextText: 'context',
    subject: 'small change',
    diff: { totalLines: 12, truncated: false, text: 'patch', files: [{}], included: ['a'] },
  })
  assert.match(whole, /complete, 12 changed lines/)
})

test('tier 1 asks for the lowest reasoning effort the endpoint allows', () => {
  // Reasoning is billed and budgeted as output. Left at its default the volume model
  // spent 866 of a 900-token budget thinking and was cut off mid-JSON on 17 of 19
  // commits; the endpoint rejects disabling it outright.
  const body = buildTier1Request({
    repositoryName: 'fixture',
    contextText: 'context',
    subject: 'subject',
    diff: { totalLines: 5, truncated: false, text: 'patch', files: [{}], included: ['a'] },
    model: 'test-model',
  })
  assert.deepEqual(body.reasoning, { effort: 'low' })
})

test('a response is coerced rather than trusted', () => {
  const payload = {
    choices: [{ finish_reason: 'stop', message: { content: '```json\n{"summary":"s","capability":"c","kind":"MIGRATE","significance":"1.7","confidence":"nope","needsDepth":true,"depthCause":"partial"}\n```' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  }
  const { reading } = parseCommitResponse(payload, { tier: 1 })
  assert.equal(reading.kind, 'migrate')
  assert.equal(reading.significance, 1)
  assert.equal(reading.confidence, 0)
  assert.equal(reading.depthCause, 'partial')
  assert.equal(reading.interpretationStatus, 'candidate')
})

test('an unrecognized kind degrades one field instead of failing the commit', () => {
  const payload = {
    choices: [{ finish_reason: 'stop', message: { content: '{"summary":"s","capability":"c","kind":"tidying"}' } }],
  }
  assert.equal(parseCommitResponse(payload, { tier: 1 }).reading.kind, 'unclear')
})

test('a truncated response whose JSON still parses is kept', () => {
  const payload = {
    choices: [{ finish_reason: 'length', message: { content: '{"summary":"s","capability":"c","kind":"fix"}' } }],
  }
  assert.equal(parseCommitResponse(payload, { tier: 1 }).reading.kind, 'fix')
})

test('a truncation that ate the whole budget reports why', () => {
  const payload = {
    choices: [{ finish_reason: 'length', message: { content: '{"summary": "half a sen' } }],
    usage: { completion_tokens_details: { reasoning_tokens: 866 } },
  }
  assert.throws(() => parseCommitResponse(payload, { tier: 1 }), /866 reasoning tokens/)
})

test('agreement ignores the words every capability name carries', () => {
  assert.deepEqual([...capabilityTokens('Identity management system for the users')].sort(), [
    'identity',
    'users',
  ])
})

test('agreement scores two independent readings of one commit', () => {
  const agree = compareReadings(
    { capability: 'contributor identity matching', kind: 'fix', significance: 0.8 },
    { capability: 'contributor identity matching', kind: 'fix', significance: 0.75 },
  )
  assert.equal(agree.capabilityOverlap, 1)
  assert.equal(agree.kindAgrees, true)
  assert.ok(agree.significanceDelta < 0.06)

  const differ = compareReadings(
    { capability: 'gallery publishing', kind: 'introduce', significance: 0.9 },
    { capability: 'url routing', kind: 'refactor', significance: 0.2 },
  )
  assert.equal(differ.capabilityOverlap, 0)
  assert.equal(differ.kindAgrees, false)
  assert.equal(compareReadings(null, { capability: 'x' }), null)
})

test('the request pool preserves input order and bounds what is in flight', async () => {
  let inFlight = 0
  let peak = 0
  const results = await mapWithConcurrency([...Array(20).keys()], 4, async (value) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
    return value * 2
  })
  assert.deepEqual(results.slice(0, 4), [0, 2, 4, 6])
  assert.equal(results.length, 20)
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded the limit`)
})

test('a timed-out request is retryable, not a permanently dropped commit', async () => {
  // An AbortError carries no status, so the shared retry policy treated it as fatal. The
  // commits slowest to answer are the largest ones, which are the ones worth reading.
  const { requestReading } = await import('../scripts/lib/commit-analysis.mjs')
  const { isRetryable } = await import('../scripts/lib/retry.mjs')
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })

  const error = await requestReading({}, { apiKey: 'k', tier: 1, fetchImpl: hang, timeoutMs: 10 }).then(
    () => null,
    (thrown) => thrown,
  )
  assert.equal(error.status, 408)
  assert.equal(isRetryable(error), true)
})

test('datasets and media are filtered; tests and infrastructure are kept', () => {
  // An open-vocabulary pass over 247 pilot commits produced labels for datasets, media,
  // tests, and deployment work that tier 0 was calling ordinary source. Only the first
  // two are noise: a regenerated scrape is not a capability, but a Grafana dashboard is
  // something the product gained.
  assert.equal(classify(episode(19, { changes: [change('data/reviews.csv')] })).class, 'data')
  assert.equal(classify(episode(20, { changes: [change('scraped/professors.json')] })).class, 'data')
  assert.equal(classify(episode(21, { changes: [change('web/logo.svg')] })).class, 'assets')
  assert.equal(classify(episode(22, { changes: [change('data/x.csv')] })).substantive, false)

  const tests = classify(episode(23, { changes: [change('src/parser.test.ts')] }))
  assert.equal(tests.class, 'tests')
  assert.equal(tests.substantive, true)

  const infra = classify(episode(24, { changes: [change('deploy/grafana/dashboard.json')] }))
  assert.equal(infra.class, 'infrastructure')
  assert.equal(infra.substantive, true)
  assert.equal(classify(episode(25, { changes: [change('Dockerfile')] })).class, 'infrastructure')
})

test('a bare .json outside a data directory is not a dataset', () => {
  // `.json` is also how half the ecosystem writes configuration, so the extension alone
  // cannot carry the classification.
  assert.notEqual(classify(episode(26, { changes: [change('src/config.json')] })).class, 'data')
})

test('a commit mixing a dataset with source is source', () => {
  const result = classify(episode(27, { changes: [change('data/x.csv'), change('src/loader.ts')] }))
  assert.equal(result.class, 'code')
  assert.equal(result.substantive, true)
})

test('the diff budget counts bytes, not only lines', async () => {
  // A single-line minified dataset in the pilot reports one changed line and emits 12.87
  // MB of patch. Ordering by line count admitted it first, so the budget selected the
  // worst possible file and sent 3.2 million tokens to a 1.3 million token endpoint.
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { readCommitDiff } = await import('../scripts/lib/commit-diff.mjs')

  const repository = mkdtempSync(join(tmpdir(), 'atlas-bytes-'))
  const git = (args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
  try {
    git(['init', '--initial-branch=main', '.'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Test'])
    writeFileSync(join(repository, 'seed.txt'), 'seed\n')
    git(['add', '-A'])
    git(['commit', '-m', 'seed'])

    // One line, one megabyte - the shape that broke the budget.
    writeFileSync(join(repository, 'data.json'), `${'x'.repeat(1024 * 1024)}\n`)
    writeFileSync(join(repository, 'small.ts'), 'export const value = 1\n')
    git(['add', '-A'])
    git(['commit', '-m', 'add a minified dataset and a small module'])

    const diff = readCommitDiff(repository, 'HEAD', { maxLines: 400, maxBytes: 64 * 1024 })
    assert.equal(diff.truncated, true, 'a one-line megabyte must not count as under budget')
    assert.ok(diff.text.length < 200 * 1024, `patch was ${diff.text.length} bytes`)
    assert.ok(diff.included.includes('small.ts'), 'the small file should still be shown')
    assert.ok(!diff.included.includes('data.json'), 'the megabyte file should be summarized only')
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})
