import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCorpus,
  createClient,
  detectProvider,
  extractJson,
  interpretAtlas,
  interpretationMethod,
  mergeInterpretation,
  resolveProvider,
  supportsOutputConfig,
  validateFeatures,
  validateSemanticEpisodes,
} from '../scripts/lib/interpret.mjs'

function episode(shortSha, subject, paths, areaIds, authoredAt) {
  return {
    id: `episode:${shortSha}0000`,
    commitSha: `${shortSha}0000`,
    shortSha,
    subject,
    authoredAt,
    committedAt: authoredAt,
    parentShas: [],
    contributorIds: ['contributor:abc'],
    codeAreaIds: areaIds,
    changes: paths.map((path) => ({ path, status: 'M' })),
    interpretationStatus: 'observed',
  }
}

function observedDataset() {
  return {
    schemaVersion: '0.1.0',
    analysis: { mode: 'observed-only', historyRange: 'HEAD', mergeDiffStrategy: 'diff-merges-first-parent' },
    repository: { name: 'demo', ref: 'main', headSha: 'ffff0000', commitCount: 2 },
    timeRange: { firstAuthoredAt: '2025-01-01T00:00:00Z', lastAuthoredAt: '2025-02-01T00:00:00Z' },
    contributors: [],
    episodes: [
      episode('aaaa1111', 'Add ranking', ['src/rank.js'], ['area:src'], '2025-01-01T00:00:00Z'),
      episode('bbbb2222', 'Tune ranking', ['src/rank.js', 'test/rank.test.js'], ['area:src', 'area:test'], '2025-02-01T00:00:00Z'),
    ],
    codeAreas: [],
    featureCandidates: [],
    relationships: [{ id: 'authored:contributor:abc:aaaa11110000', kind: 'authored' }],
  }
}

test('buildCorpus renders each commit with its touched paths', () => {
  const corpus = buildCorpus(observedDataset())

  assert.equal(
    corpus,
    [
      'aaaa1111 2025-01-01 Add ranking',
      '    src/rank.js',
      'bbbb2222 2025-02-01 Tune ranking',
      '    src/rank.js test/rank.test.js',
    ].join('\n'),
  )
})

test('buildCorpus preserves old and new paths for rename evidence', () => {
  const dataset = observedDataset()
  dataset.episodes[0].changes = [
    {
      status: 'R',
      similarity: '100',
      previousPath: 'demo/frontend/app.ts',
      path: 'frontend/app.ts',
    },
  ]

  assert.match(buildCorpus(dataset), /demo\/frontend\/app\.ts -> frontend\/app\.ts/)
})

test('validateFeatures discards cited commits that are not in the dataset', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: 'Both commits build the ranking path.',
        confidence: 0.8,
        commitShas: ['aaaa1111', 'deadbeef', 'bbbb2222'],
      },
    ],
    observedDataset(),
  )

  assert.equal(result.featureCandidates.length, 1)
  assert.deepEqual(result.unresolvedShas, [{ label: 'Ranking pipeline', sha: 'deadbeef' }])
  assert.deepEqual(
    result.featureCandidates[0].evidence.map((reference) => reference.commitSha),
    ['aaaa11110000', 'bbbb22220000'],
  )
})

test('validateFeatures drops a feature whose evidence is entirely unresolvable', () => {
  const result = validateFeatures(
    [
      { label: 'Imagined', rationale: '', confidence: 0.9, commitShas: ['cafe0001'] },
      { label: 'Real', rationale: '', confidence: 0.5, commitShas: ['aaaa1111'] },
    ],
    observedDataset(),
  )

  assert.deepEqual(result.discardedFeatures, ['Imagined'])
  assert.deepEqual(
    result.featureCandidates.map((feature) => feature.label),
    ['Real'],
  )
})

test('validateFeatures marks every derived claim as a candidate interpretation', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: 'Shared ranking path.',
        confidence: 0.8,
        commitShas: ['aaaa1111', 'bbbb2222'],
      },
    ],
    observedDataset(),
  )

  const [feature] = result.featureCandidates
  assert.equal(feature.status, 'candidate')
  assert.equal(feature.method, 'llm-induction:anthropic:claude-opus-5')
  assert.equal('lifecycleStage' in feature, false)
  assert.ok(
    result.relationships.every(
      (relationship) => relationship.interpretationStatus === 'candidate',
    ),
  )
})

test('validateFeatures reads code areas off the supporting commits, not the model', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: '',
        confidence: 0.7,
        commitShas: ['aaaa1111', 'bbbb2222'],
      },
    ],
    observedDataset(),
  )

  const areaLinks = result.relationships.filter(
    (relationship) => relationship.kind === 'affects-area',
  )
  assert.deepEqual(
    areaLinks.map((relationship) => relationship.targetId),
    ['area:src', 'area:test'],
  )

  const supports = result.relationships.filter(
    (relationship) => relationship.kind === 'supports-feature',
  )
  assert.equal(supports.length, 2)
})

test('validateFeatures no longer stores a permanent feature-level lifecycle stage', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: '',
        confidence: 2,
        lifecycleStage: 'hardened',
        commitShas: ['aaaa1111'],
      },
    ],
    observedDataset(),
  )

  assert.equal('lifecycleStage' in result.featureCandidates[0], false)
  assert.equal(result.featureCandidates[0].confidence, 1)
})

test('mergeInterpretation preserves observed relationships and flips analysis mode', () => {
  const dataset = observedDataset()
  const validated = validateFeatures(
    [{ label: 'Ranking', rationale: '', confidence: 0.6, commitShas: ['aaaa1111'] }],
    dataset,
  )
  const merged = mergeInterpretation(dataset, validated)

  assert.equal(merged.analysis.mode, 'interpreted')
  assert.equal(merged.relationships[0].kind, 'authored')
  assert.equal(merged.relationships.length, dataset.relationships.length + validated.relationships.length)
  assert.equal(dataset.featureCandidates.length, 0, 'input dataset is not mutated')
})

test('validateSemanticEpisodes keeps lifecycle stages on evidence-scoped episodes', () => {
  const dataset = observedDataset()
  const features = validateFeatures(
    [{ label: 'Ranking', rationale: '', confidence: 0.8, commitShas: ['aaaa1111'] }],
    dataset,
  ).featureCandidates
  const result = validateSemanticEpisodes(
    [
      {
        featureId: features[0].id,
        label: 'Cover ranking edge cases',
        rationale: 'Adds tests to the existing ranking path.',
        confidence: 0.82,
        lifecycleStage: 'hardened',
        commitShas: ['bbbb2222', 'missing0'],
      },
      {
        featureId: 'feature:unknown',
        label: 'Imagined migration',
        rationale: '',
        confidence: 0.5,
        lifecycleStage: 'migrated',
        commitShas: ['aaaa1111'],
      },
    ],
    dataset,
    features,
  )

  assert.equal(result.semanticEpisodes.length, 1)
  assert.equal(result.semanticEpisodes[0].featureId, features[0].id)
  assert.equal(result.semanticEpisodes[0].lifecycleStage, 'hardened')
  assert.deepEqual(result.semanticEpisodes[0].evidence.map((entry) => entry.commitSha), [
    'bbbb22220000',
  ])
  assert.deepEqual(result.unresolvedShas, [
    { label: 'Cover ranking edge cases', sha: 'missing0' },
  ])
  assert.equal(result.unresolvedFeatureIds.length, 1)
  assert.ok(result.relationships.some((relationship) => relationship.kind === 'evolves-feature'))
})

test('validateSemanticEpisodes rejects reverted and structural-only migration claims', () => {
  const dataset = observedDataset()
  dataset.episodes[1].subject = 'Revert "Move ranking backend"'
  dataset.structuralEpisodes = [
    {
      evidence: [{ commitSha: dataset.episodes[0].commitSha }],
    },
  ]
  const features = validateFeatures(
    [{ label: 'Ranking', rationale: '', confidence: 0.8, commitShas: ['aaaa1111'] }],
    dataset,
  ).featureCandidates
  const result = validateSemanticEpisodes(
    [
      {
        featureId: features[0].id,
        label: 'Ranking folder renamed',
        rationale: 'A structural directory rename preserves the feature.',
        confidence: 0.8,
        lifecycleStage: 'migrated',
        commitShas: ['aaaa1111'],
      },
      {
        featureId: features[0].id,
        label: 'Failed backend transition reverted',
        rationale: 'The attempted move was reverted and restored the prior state.',
        confidence: 0.8,
        lifecycleStage: 'migrated',
        commitShas: ['bbbb2222'],
      },
    ],
    dataset,
    features,
  )

  assert.equal(result.semanticEpisodes.length, 0)
  assert.deepEqual(
    result.discardedEpisodeDetails.map((entry) => entry.reason),
    ['structural-only', 'reverted-transition'],
  )
})

test('interpretAtlas validates model output before it reaches the dataset', async () => {
  let call = 0
  const client = {
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                call++ === 0
                  ? {
                      features: [
                        {
                          label: 'Ranking pipeline',
                          rationale: 'Shared ranking path.',
                          confidence: 0.8,
                          commitShas: ['aaaa1111', 'nonexistent'],
                        },
                      ],
                    }
                  : { semanticEpisodes: [] },
              ),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      }),
    },
  }

  const { dataset, validated } = await interpretAtlas(observedDataset(), { client })

  assert.equal(dataset.featureCandidates.length, 1)
  assert.equal(dataset.featureCandidates[0].evidence.length, 1)
  assert.equal(validated.unresolvedShas.length, 1)
})

test('interpretAtlas performs a separate lifecycle pass and links episodes to features', async () => {
  const dataset = observedDataset()
  const proposedFeature = {
    label: 'Ranking pipeline',
    rationale: 'Shared ranking path.',
    confidence: 0.8,
    commitShas: ['aaaa1111'],
  }
  const featureId = validateFeatures([proposedFeature], dataset).featureCandidates[0].id
  const responses = [
    { features: [proposedFeature] },
    {
      semanticEpisodes: [
        {
          featureId,
          label: 'Add ranking coverage',
          rationale: 'Tests exercise the existing ranking path.',
          confidence: 0.85,
          lifecycleStage: 'hardened',
          commitShas: ['bbbb2222'],
        },
      ],
    },
  ]
  const requests = []
  const client = {
    messages: {
      stream: (request) => {
        const response = responses[requests.length]
        requests.push(request)
        return {
          finalMessage: async () => ({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(response) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        }
      },
    },
  }

  const result = await interpretAtlas(dataset, { client })

  assert.equal(requests.length, 2)
  assert.match(requests[1].system, /Do not assign one permanent lifecycle stage/)
  assert.equal(result.dataset.semanticEpisodes.length, 1)
  assert.equal(result.dataset.semanticEpisodes[0].lifecycleStage, 'hardened')
  assert.equal(result.dataset.semanticEpisodes[0].featureId, featureId)
  assert.equal(result.usage.input_tokens, 20)
  assert.equal('lifecycleStage' in result.dataset.featureCandidates[0], false)
})

test('interpretAtlas can reuse validated features when calibrating lifecycle discovery', async () => {
  const dataset = observedDataset()
  dataset.featureCandidates = validateFeatures(
    [{ label: 'Ranking', rationale: '', confidence: 0.8, commitShas: ['aaaa1111'] }],
    dataset,
  ).featureCandidates
  const requests = []
  const client = {
    messages: {
      stream: (request) => {
        requests.push(request)
        return {
          finalMessage: async () => ({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"semanticEpisodes":[]}' }],
            usage: {},
          }),
        }
      },
    },
  }

  const result = await interpretAtlas(dataset, { client, reuseFeatures: true })

  assert.equal(requests.length, 1)
  assert.match(requests[0].system, /semantic change episodes/)
  assert.equal(result.dataset.featureCandidates[0].id, dataset.featureCandidates[0].id)
})

for (const { name, options, provider, model } of [
  { name: 'Anthropic default', options: {}, provider: 'anthropic', model: 'claude-opus-5' },
  {
    name: 'OpenAI synchronous workaround',
    options: { provider: 'openai', model: 'gpt-6-luna' },
    provider: 'openai',
    model: 'gpt-6-luna',
  },
  {
    name: 'OpenAI model override',
    options: { provider: 'openai', model: 'gpt-5.4-mini' },
    provider: 'openai',
    model: 'gpt-5.4-mini',
  },
]) {
  test(`interpretAtlas records ${name} in feature and lifecycle candidates`, async () => {
    const observed = observedDataset()
    const proposedFeature = { label: 'Ranking', rationale: '', confidence: 0.6, commitShas: ['aaaa1111'] }
    const featureId = validateFeatures([proposedFeature], observed).featureCandidates[0].id
    const responses = [
      { features: [proposedFeature] },
      {
        semanticEpisodes: [{
          featureId,
          label: 'Add ranking coverage',
          rationale: 'Tests exercise the existing ranking path.',
          confidence: 0.85,
          lifecycleStage: 'hardened',
          commitShas: ['bbbb2222'],
        }],
      },
    ]
    const requests = []
    const client = {
      messages: {
        stream: (request) => {
          const response = responses[requests.length]
          requests.push(request)
          return {
            finalMessage: async () => ({
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: JSON.stringify(response) }],
              usage: {},
            }),
          }
        },
      },
    }

    const { dataset } = await interpretAtlas(observed, { client, ...options })

    assert.equal(requests.length, 2)
    assert.ok(requests.every((request) => request.model === model))
    for (const request of requests) {
      if (provider === 'anthropic') assert.equal(request.output_config.format.type, 'json_schema')
      else assert.equal('output_config' in request, false)
    }
    const method = `llm-induction:${provider}:${model}`
    assert.equal(dataset.featureCandidates[0].method, method)
    assert.equal(dataset.semanticEpisodes[0].method, method)
  })
}

test('resolveProvider rejects an unknown provider name', () => {
  assert.equal(resolveProvider('openai').transport, 'chat-completions')
  assert.throws(() => resolveProvider('openrouter'), /Unknown provider/)
  assert.throws(() => resolveProvider('ollama'), /Unknown provider/)
})

test('detectProvider prefers OpenAI only when it is the sole credential', () => {
  assert.equal(detectProvider({ OPENAI_API_KEY: 'x' }), 'openai')
  assert.equal(detectProvider({ ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' }), 'anthropic')
  assert.equal(detectProvider({ ANTHROPIC_API_KEY: 'x' }), 'anthropic')
  assert.equal(detectProvider({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: 'y' }), 'openai')
  assert.equal(detectProvider({ OPENROUTER_API_KEY: 'x' }), 'anthropic')
  assert.equal(detectProvider({}), 'anthropic')
})

test('createClient uses the Anthropic SDK only for Anthropic and refuses a missing OpenAI key', () => {
  const constructed = []
  class FakeAnthropic {
    constructor(options) {
      constructed.push(options)
    }
  }

  const env = { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant-test' }
  const openai = createClient(FakeAnthropic, 'openai', env)
  assert.equal(constructed.length, 0, 'the OpenAI provider never constructs the Anthropic SDK')
  assert.equal(typeof openai.messages.stream, 'function')

  // Anthropic can authenticate from an `ant auth login` profile, so an absent
  // environment variable must not be treated as a missing credential.
  createClient(FakeAnthropic, 'anthropic', {})
  assert.deepEqual(constructed[0], {})

  createClient(FakeAnthropic, 'anthropic', env)
  assert.deepEqual(constructed[1], { apiKey: 'sk-ant-test' })

  createClient(FakeAnthropic, 'anthropic', { OPENAI_API_KEY: 'sk-test' })
  assert.deepEqual(constructed[2], {}, 'an explicit Anthropic provider never uses the OpenAI key')

  assert.throws(
    () => createClient(FakeAnthropic, 'openai', {}),
    /OPENAI_API_KEY/,
  )
  assert.throws(
    () => createClient(FakeAnthropic, 'openai', { ANTHROPIC_API_KEY: 'sk-ant-test' }),
    /OPENAI_API_KEY/,
  )
})

test('the OpenAI client translates Messages requests to Chat Completions and back', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) })
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"features":[]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } },
      }),
    }
  }
  const client = createClient(class { constructor() { throw new Error('SDK constructed') } }, 'openai', { OPENAI_API_KEY: 'sk-test' }, { fetchImpl })
  const { dataset, usage } = await interpretAtlas(observedDataset(), { client, provider: 'openai', model: 'gpt-6-luna' })

  assert.equal(dataset.featureCandidates.length, 0)
  assert.equal(requests.length, 1)
  const [request] = requests
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(request.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(Object.keys(request.body).sort(), ['max_completion_tokens', 'messages', 'model', 'response_format'])
  assert.equal(request.body.model, 'gpt-6-luna')
  assert.equal(request.body.max_completion_tokens, 32000)
  assert.deepEqual(request.body.response_format, { type: 'json_object' })
  assert.deepEqual(request.body.messages.map((message) => message.role), ['system', 'user'])
  assert.match(request.body.messages[0].content, /candidate features/)
  assert.match(request.body.messages[1].content, /Propose at most 40 candidate features/)
  assert.doesNotMatch(JSON.stringify(request.body), /cache_control|output_config/)
  assert.deepEqual(usage, { input_tokens: 12, cache_read_input_tokens: 4, output_tokens: 3 })
})

test('the OpenAI client maps truncation and refusal to the shared failure messages', async () => {
  for (const [choice, pattern] of [
    [{ finish_reason: 'length', message: { content: '{"feat' } }, /truncated during feature discovery/],
    [{ finish_reason: 'stop', message: { content: null, refusal: 'Synthetic refusal' } }, /declined feature discovery \(Synthetic refusal\)/],
  ]) {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [choice] }) })
    const client = createClient(null, 'openai', { OPENAI_API_KEY: 'sk-test' }, { fetchImpl })
    await assert.rejects(interpretAtlas(observedDataset(), { client, provider: 'openai', model: 'gpt-6-luna' }), pattern)
  }
})

test('extractJson recovers an object from fenced or prose-wrapped output', () => {
  assert.deepEqual(extractJson('{"features":[]}'), { features: [] })
  assert.deepEqual(extractJson('```json\n{"features":[]}\n```'), { features: [] })
  assert.deepEqual(extractJson('Here you go:\n{"features":[]}\nHope that helps.'), {
    features: [],
  })
  assert.throws(() => extractJson('no object here'), /no JSON object/)
})

test('interpretAtlas requires persistent batch transport for the OpenAI default', async () => {
  const client = { messages: { stream: () => { throw new Error('Unexpected synchronous dispatch') } } }
  await assert.rejects(
    interpretAtlas(observedDataset(), { client, provider: 'openai' }),
    /requires a persistent OpenAI batchRunner/,
  )
})

test('interpretationMethod distinguishes provider and model', () => {
  assert.equal(interpretationMethod('openai', 'gpt-6-luna:batch'), 'llm-induction:openai:gpt-6-luna:batch')
  assert.equal(interpretationMethod('anthropic', 'claude-opus-5'), 'llm-induction:anthropic:claude-opus-5')
})

test('interpretAtlas surfaces a refusal rather than writing an empty interpretation', async () => {
  const client = {
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          stop_reason: 'refusal',
          stop_details: { category: 'cyber' },
          content: [],
        }),
      }),
    },
  }

  await assert.rejects(() => interpretAtlas(observedDataset(), { client }), /declined.*cyber/)
})

test('resolveProvider accepts a model override only for the OpenAI provider', () => {
  assert.equal(resolveProvider('openai', 'gpt-5.4-mini').model, 'gpt-5.4-mini')
  assert.equal(resolveProvider('openai').model, 'gpt-6-luna:batch')
  assert.equal(resolveProvider('anthropic').model, 'claude-opus-5')
  assert.equal(resolveProvider().name, 'anthropic')
  assert.equal(resolveProvider().model, 'claude-opus-5')
  assert.throws(() => resolveProvider('anthropic', 'some/other-model'), /only meaningful/)
  assert.throws(() => resolveProvider('anthropic', 'gpt-6-luna:batch'), /only meaningful/)
})

test('supportsOutputConfig gates Anthropic-only request fields', () => {
  assert.equal(supportsOutputConfig('claude-opus-5'), true)
  assert.equal(supportsOutputConfig('anthropic/claude-opus-5'), true)
  assert.equal(supportsOutputConfig('gpt-5.4-mini'), false)
  assert.equal(supportsOutputConfig('gpt-6-luna'), false)
  assert.equal(supportsOutputConfig('gpt-6-luna:batch'), false)
})

test('interpretAtlas omits output_config for a non-Anthropic model', async () => {
  const requests = []
  const client = {
    messages: {
      stream: (request) => {
        requests.push(request)
        return {
          finalMessage: async () => ({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '```json\n{"features":[]}\n```' }],
            usage: {},
          }),
        }
      },
    },
  }

  await interpretAtlas(observedDataset(), {
    client,
    provider: 'openai',
    model: 'gpt-5.4-mini',
  })
  assert.equal('output_config' in requests[0], false)

  await interpretAtlas(observedDataset(), { client, provider: 'anthropic' })
  assert.equal(requests[1].output_config.format.type, 'json_schema')
})
