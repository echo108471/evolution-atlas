import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROVIDERS,
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
    analysis: { mode: 'observed-only', historyRange: 'HEAD', mergeDiffStrategy: 'first-parent' },
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

test('validateFeatures discards cited commits that are not in the dataset', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: 'Both commits build the ranking path.',
        confidence: 0.8,
        lifecycleStage: 'introduced',
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
      { label: 'Imagined', rationale: '', confidence: 0.9, lifecycleStage: 'introduced', commitShas: ['cafe0001'] },
      { label: 'Real', rationale: '', confidence: 0.5, lifecycleStage: 'unassigned', commitShas: ['aaaa1111'] },
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
        lifecycleStage: 'introduced',
        commitShas: ['aaaa1111', 'bbbb2222'],
      },
    ],
    observedDataset(),
  )

  const [feature] = result.featureCandidates
  assert.equal(feature.status, 'candidate')
  assert.equal(feature.method, 'llm-induction:anthropic:claude-opus-5')
  assert.equal(feature.lifecycleStage, 'introduced')
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
        lifecycleStage: 'unassigned',
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

test('validateFeatures rejects an unrecognized lifecycle stage instead of storing it', () => {
  const result = validateFeatures(
    [
      {
        label: 'Ranking pipeline',
        rationale: '',
        confidence: 2,
        lifecycleStage: 'unassigned',
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
    [{ label: 'Ranking', rationale: '', confidence: 0.6, lifecycleStage: 'unassigned', commitShas: ['aaaa1111'] }],
    dataset,
  )
  const merged = mergeInterpretation(dataset, validated)

  assert.equal(merged.analysis.mode, 'interpreted')
  assert.equal(merged.relationships[0].kind, 'authored')
  assert.equal(merged.relationships.length, dataset.relationships.length + validated.relationships.length)
  assert.equal(dataset.featureCandidates.length, 0, 'input dataset is not mutated')
})

test('interpretAtlas validates model output before it reaches the dataset', async () => {
  const client = {
    messages: {
      stream: () => ({
        finalMessage: async () => ({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                features: [
                  {
                    label: 'Ranking pipeline',
                    rationale: 'Shared ranking path.',
                    confidence: 0.8,
                    lifecycleStage: 'introduced',
                    commitShas: ['aaaa1111', 'nonexistent'],
                  },
                ],
              }),
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

test('interpretAtlas records which provider and model produced the candidates', async () => {
  const seen = {}
  const client = {
    messages: {
      stream: (request) => {
        seen.model = request.model
        return {
          finalMessage: async () => ({
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  features: [
                    {
                      label: 'Ranking',
                      rationale: '',
                      confidence: 0.6,
                      lifecycleStage: 'unassigned',
                      commitShas: ['aaaa1111'],
                    },
                  ],
                }),
              },
            ],
            usage: {},
          }),
        }
      },
    },
  }

  const { dataset } = await interpretAtlas(observedDataset(), { client, provider: 'openrouter' })

  assert.equal(seen.model, 'x-ai/grok-4.6')
  assert.equal(dataset.featureCandidates[0].method, 'llm-induction:openrouter:x-ai/grok-4.6')
})

test('resolveProvider rejects an unknown provider name', () => {
  assert.equal(resolveProvider('openrouter').baseURL, 'https://openrouter.ai/api')
  assert.throws(() => resolveProvider('ollama'), /Unknown provider/)
})

test('detectProvider prefers OpenRouter only when it is the sole credential', () => {
  assert.equal(detectProvider({ OPENROUTER_API_KEY: 'x' }), 'openrouter')
  assert.equal(detectProvider({ ANTHROPIC_API_KEY: 'x', OPENROUTER_API_KEY: 'y' }), 'anthropic')
  assert.equal(detectProvider({}), 'anthropic')
})

test('createClient points the SDK at the provider base URL and refuses a missing key', () => {
  const constructed = []
  class FakeAnthropic {
    constructor(options) {
      constructed.push(options)
    }
  }

  createClient(FakeAnthropic, 'openrouter', { OPENROUTER_API_KEY: 'sk-or-test' })
  assert.deepEqual(constructed[0], {
    baseURL: PROVIDERS.openrouter.baseURL,
    apiKey: 'sk-or-test',
  })

  // Anthropic can authenticate from an `ant auth login` profile, so an absent
  // environment variable must not be treated as a missing credential.
  createClient(FakeAnthropic, 'anthropic', {})
  assert.deepEqual(constructed[1], {})

  assert.throws(
    () => createClient(FakeAnthropic, 'openrouter', {}),
    /OPENROUTER_API_KEY/,
  )
})

test('extractJson recovers an object from fenced or prose-wrapped output', () => {
  assert.deepEqual(extractJson('{"features":[]}'), { features: [] })
  assert.deepEqual(extractJson('```json\n{"features":[]}\n```'), { features: [] })
  assert.deepEqual(extractJson('Here you go:\n{"features":[]}\nHope that helps.'), {
    features: [],
  })
  assert.throws(() => extractJson('no object here'), /no JSON object/)
})

test('interpretationMethod distinguishes provider and model', () => {
  assert.equal(interpretationMethod('openrouter', 'anthropic/claude-opus-5'), 'llm-induction:openrouter:anthropic/claude-opus-5')
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

test('resolveProvider accepts a model override only for gateway providers', () => {
  assert.equal(
    resolveProvider('openrouter', '~deepseek/deepseek-v4-flash-latest').model,
    '~deepseek/deepseek-v4-flash-latest',
  )
  assert.equal(resolveProvider('openrouter').model, 'x-ai/grok-4.6')
  assert.throws(() => resolveProvider('anthropic', 'some/other-model'), /only meaningful/)
})

test('supportsOutputConfig gates Anthropic-only request fields', () => {
  assert.equal(supportsOutputConfig('claude-opus-5'), true)
  assert.equal(supportsOutputConfig('anthropic/claude-opus-5'), true)
  assert.equal(supportsOutputConfig('~deepseek/deepseek-v4-flash-latest'), false)
  assert.equal(supportsOutputConfig('x-ai/grok-4.6'), false)
  assert.equal(supportsOutputConfig('openai/gpt-5.2'), false)
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
    provider: 'openrouter',
    model: '~deepseek/deepseek-v4-flash-latest',
  })
  assert.equal('output_config' in requests[0], false)

  await interpretAtlas(observedDataset(), {
    client,
    provider: 'openrouter',
    model: 'anthropic/claude-opus-5',
  })
  assert.equal(requests[1].output_config.format.type, 'json_schema')
})
