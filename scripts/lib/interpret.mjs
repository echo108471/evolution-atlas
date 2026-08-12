import { createHash } from 'node:crypto'

/**
 * OpenRouter serves the Anthropic Messages API, so the same client and request shape
 * work against either provider; only the base URL, credential, and model naming differ.
 */
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    model: 'claude-opus-5',
    baseURL: undefined,
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    // The Anthropic SDK also resolves an `ant auth login` profile, so a missing
    // environment variable is not by itself a missing credential.
    requiresApiKey: false,
  },
  openrouter: {
    label: 'OpenRouter',
    // Pinned rather than a floating `~...-latest` alias: each candidate records the
    // model that produced it, and that record has to stay true to be worth anything.
    model: 'x-ai/grok-4.6',
    baseURL: 'https://openrouter.ai/api',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    requiresApiKey: true,
  },
}

export const DEFAULT_PROVIDER = 'anthropic'

export function interpretationMethod(providerName, model) {
  return `llm-induction:${providerName}:${model}`
}

const LIFECYCLE_STAGES = ['introduced', 'expanded', 'hardened', 'migrated', 'removed']
const MAX_PATHS_PER_COMMIT = 12
const MAX_SUBJECT_LENGTH = 160

function stableId(namespace, value) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `${namespace}:${digest}`
}

const SYSTEM_PROMPT = `You group a repository's commits into candidate features.

A feature is a user-visible or system capability that several commits built up over
time. It is not a directory, not a commit message restated, and not a technology name.
"Course ranking pipeline" is a feature; "src/lib changes" and "refactoring" are not.

Every feature you propose is a candidate for a maintainer to accept or reject, so:

- Cite only commits that genuinely evidence the capability. A smaller, well-evidenced
  feature is worth more than a large speculative one.
- Cite commits by the short SHA exactly as it appears in the input. Never invent one.
- Set confidence to how strongly the commit record supports the grouping, not to how
  useful the feature sounds. Use the full range; below 0.5 means "a maintainer should
  probably reject this".
- Assign a lifecycle stage only when the commits show it. Prefer omitting it over
  guessing.
- Say what the evidence does NOT establish in the rationale when that matters. Tangled
  commits, renames, and large refactors often touch a capability without changing it.

Leave commits ungrouped when they do not belong to a coherent capability. Most
repositories contain maintenance work that is not part of any feature.

Reply with JSON only — no prose, no markdown fences — shaped as:

{"features": [{"label": string, "rationale": string, "confidence": number between 0
and 1, "lifecycleStage": one of ${[...LIFECYCLE_STAGES, 'unassigned'].map((stage) => `"${stage}"`).join(' ')},
"commitShas": [string]}]}`

const FEATURE_SCHEMA = {
  type: 'object',
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Short human-readable capability name, e.g. "Course ranking pipeline".',
          },
          rationale: {
            type: 'string',
            description:
              'Why these commits form one capability, and what the evidence does not establish.',
          },
          confidence: {
            type: 'number',
            description: 'Between 0 and 1. How strongly the commit record supports this grouping.',
          },
          lifecycleStage: {
            type: 'string',
            enum: [...LIFECYCLE_STAGES, 'unassigned'],
            description: 'Use "unassigned" unless the commits clearly show a stage.',
          },
          commitShas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short SHAs copied exactly from the input.',
          },
        },
        required: ['label', 'rationale', 'confidence', 'lifecycleStage', 'commitShas'],
        additionalProperties: false,
      },
    },
  },
  required: ['features'],
  additionalProperties: false,
}

/**
 * Render the observed episodes as a compact commit corpus. Diffs are deliberately
 * excluded: subjects and touched paths are enough to propose groupings, and they keep
 * the request small enough to analyze a repository's whole history in one pass.
 */
export function buildCorpus(dataset) {
  const lines = []

  for (const episode of dataset.episodes) {
    const subject = episode.subject.slice(0, MAX_SUBJECT_LENGTH)
    lines.push(`${episode.shortSha} ${episode.authoredAt.slice(0, 10)} ${subject}`)

    const paths = episode.changes.map((change) => change.path)
    if (paths.length === 0) continue

    const shown = paths.slice(0, MAX_PATHS_PER_COMMIT)
    const suffix = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : ''
    lines.push(`    ${shown.join(' ')}${suffix}`)
  }

  return lines.join('\n')
}

function clampConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Convert proposed features into candidates whose every claim resolves to a commit in
 * the observed dataset. Unresolvable SHAs are discarded rather than trusted, and a
 * feature left with no surviving evidence is discarded with them.
 */
export function validateFeatures(proposed, dataset, method = interpretationMethod(DEFAULT_PROVIDER, PROVIDERS[DEFAULT_PROVIDER].model)) {
  const episodeBySha = new Map()
  for (const episode of dataset.episodes) {
    episodeBySha.set(episode.commitSha, episode)
    episodeBySha.set(episode.shortSha, episode)
  }

  const featureCandidates = []
  const relationships = []
  const unresolvedShas = []
  const discardedFeatures = []

  proposed.forEach((feature, index) => {
    const seen = new Set()
    const episodes = []

    for (const rawSha of feature.commitShas ?? []) {
      const sha = String(rawSha).trim()
      const episode = episodeBySha.get(sha) ?? episodeBySha.get(sha.slice(0, 8))

      if (!episode) {
        unresolvedShas.push({ label: feature.label, sha })
        continue
      }
      if (seen.has(episode.commitSha)) continue

      seen.add(episode.commitSha)
      episodes.push(episode)
    }

    if (episodes.length === 0) {
      discardedFeatures.push(feature.label)
      return
    }

    episodes.sort((left, right) => left.authoredAt.localeCompare(right.authoredAt))

    const featureId = stableId('feature', `${index}:${feature.label}`)
    const stage = LIFECYCLE_STAGES.includes(feature.lifecycleStage)
      ? feature.lifecycleStage
      : undefined

    const candidate = {
      id: featureId,
      label: feature.label,
      status: 'candidate',
      confidence: clampConfidence(feature.confidence),
      method,
      rationale: feature.rationale,
      evidence: episodes.map((episode) => ({
        commitSha: episode.commitSha,
        paths: episode.changes.map((change) => change.path).sort(),
      })),
    }
    if (stage) candidate.lifecycleStage = stage
    featureCandidates.push(candidate)

    for (const episode of episodes) {
      relationships.push({
        id: `supports-feature:${episode.commitSha}:${featureId}`,
        sourceId: episode.id,
        targetId: featureId,
        kind: 'supports-feature',
        interpretationStatus: 'candidate',
        confidence: candidate.confidence,
        evidence: [{ commitSha: episode.commitSha }],
      })
    }

    // A feature's code areas are not proposed by the model; they are read off the
    // areas its supporting commits actually touched.
    const areaEvidence = new Map()
    for (const episode of episodes) {
      for (const areaId of episode.codeAreaIds) {
        const shas = areaEvidence.get(areaId) ?? []
        shas.push(episode.commitSha)
        areaEvidence.set(areaId, shas)
      }
    }

    for (const [areaId, shas] of [...areaEvidence.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      relationships.push({
        id: `affects-area:${featureId}:${areaId}`,
        sourceId: featureId,
        targetId: areaId,
        kind: 'affects-area',
        interpretationStatus: 'candidate',
        confidence: candidate.confidence,
        evidence: shas.sort().map((commitSha) => ({ commitSha })),
      })
    }
  })

  return { featureCandidates, relationships, unresolvedShas, discardedFeatures }
}

export function mergeInterpretation(dataset, validated) {
  return {
    ...dataset,
    analysis: { ...dataset.analysis, mode: 'interpreted' },
    featureCandidates: validated.featureCandidates,
    relationships: [...dataset.relationships, ...validated.relationships],
  }
}

export function resolveProvider(name = DEFAULT_PROVIDER, modelOverride = null) {
  const provider = PROVIDERS[name]
  if (!provider) {
    throw new Error(`Unknown provider "${name}". Expected one of: ${Object.keys(PROVIDERS).join(', ')}`)
  }
  if (modelOverride && !provider.baseURL) {
    throw new Error('--model is only meaningful for a gateway provider such as openrouter')
  }
  return { name, ...provider, model: modelOverride ?? provider.model }
}

/**
 * `output_config` (effort, native JSON schema) is Anthropic-specific. A gateway will
 * happily route to a model that does not implement it, so only send it when the model
 * is one that does; the prompt-level JSON contract covers everything else.
 */
export function supportsOutputConfig(model) {
  return /(^|\/)claude-/.test(model)
}

/**
 * Pick a provider from the environment when the caller did not name one: an
 * OpenRouter key is only useful for OpenRouter, so its presence is a clear signal.
 */
export function detectProvider(env = process.env) {
  if (env.OPENROUTER_API_KEY && !env.ANTHROPIC_API_KEY) return 'openrouter'
  return DEFAULT_PROVIDER
}

export function createClient(Anthropic, providerName, env = process.env) {
  const provider = resolveProvider(providerName)
  const apiKey = env[provider.apiKeyEnv]

  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`${provider.label} requires ${provider.apiKeyEnv} to be set`)
  }

  return new Anthropic({
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  })
}

/**
 * Models occasionally wrap JSON in prose or a markdown fence, and OpenRouter may not
 * forward every provider-native output constraint. Recover the object rather than
 * failing the whole run on formatting.
 */
export function extractJson(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error('no JSON object found in model output')
    }
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

/**
 * Propose feature candidates for an observed dataset. The client is injected so the
 * validation path above stays testable without a network call or an API key.
 */
export async function interpretAtlas(
  dataset,
  { client, provider = DEFAULT_PROVIDER, model: modelOverride = null, maxFeatures = 40, onProgress } = {},
) {
  const { model, label } = resolveProvider(provider, modelOverride)
  const method = interpretationMethod(provider, model)

  if (dataset.episodes.length === 0) {
    return {
      dataset: mergeInterpretation(dataset, validateFeatures([], dataset, method)),
      usage: null,
    }
  }

  const corpus = buildCorpus(dataset)
  onProgress?.(
    `Sending ${dataset.episodes.length} commits from ${dataset.repository.name} to ${label} (${model})`,
  )

  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    ...(supportsOutputConfig(model)
      ? {
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: FEATURE_SCHEMA },
          },
        }
      : {}),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Repository: ${dataset.repository.name}\nCommits, oldest first. Each commit is a line of "<shortSha> <date> <subject>" followed by an indented line of the paths it changed.\n\n${corpus}`,
            // The corpus is byte-stable for a given dataset, so re-runs while iterating
            // on the prompt read it from cache instead of paying for it again.
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `Propose at most ${maxFeatures} candidate features for this repository.`,
          },
        ],
      },
    ],
  })

  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') {
    throw new Error(
      `Model declined to analyze this repository (${message.stop_details?.category ?? 'unspecified'})`,
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('Model output was truncated; retry with a lower --max-features')
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  let parsed
  try {
    parsed = extractJson(text)
  } catch (error) {
    throw new Error(`Model returned unparseable output: ${error.message}`)
  }

  const validated = validateFeatures(parsed.features ?? [], dataset, method)

  return {
    dataset: mergeInterpretation(dataset, validated),
    validated,
    usage: message.usage,
  }
}
