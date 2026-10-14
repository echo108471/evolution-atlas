import { createHash } from 'node:crypto'
import { buildStructuralEpisodes } from '../../src/structure.mjs'
import { DEFAULT_OPENROUTER_MODEL, requireSynchronousModel } from './model-defaults.mjs'

/**
 * OpenRouter serves the Anthropic Messages API, so the same client and request shape
 * work against either provider for synchronous models. Batch-only IDs need a separate
 * Batch API submission path, which is not implemented.
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
    // Candidates record the selected model ID, including its routing suffix.
    model: DEFAULT_OPENROUTER_MODEL,
    baseURL: 'https://openrouter.ai/api',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    requiresApiKey: true,
  },
}

export const DEFAULT_PROVIDER = 'anthropic'

export function interpretationMethod(providerName, model) {
  return `llm-induction:${providerName}:${model}`
}

export const LIFECYCLE_STAGES = ['introduced', 'expanded', 'hardened', 'migrated', 'removed']
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
- Say what the evidence does NOT establish in the rationale when that matters. Tangled
  commits, renames, and large refactors often touch a capability without changing it.

Leave commits ungrouped when they do not belong to a coherent capability. Most
repositories contain maintenance work that is not part of any feature.

Reply with JSON only — no prose, no markdown fences — shaped as:

{"features": [{"label": string, "rationale": string, "confidence": number between 0
and 1, "commitShas": [string]}]}`

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
          commitShas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short SHAs copied exactly from the input.',
          },
        },
        required: ['label', 'rationale', 'confidence', 'commitShas'],
        additionalProperties: false,
      },
    },
  },
  required: ['features'],
  additionalProperties: false,
}

const LIFECYCLE_SYSTEM_PROMPT = `You identify candidate semantic change episodes in the
history of already-proposed repository features.

A semantic change episode is one observable change to a feature, supported by one or
more commits. A feature may have several episodes over time and may repeat a stage.
Do not assign one permanent lifecycle stage to a feature.

Use these stage boundaries:

- introduced: establishes the capability for the first time.
- expanded: adds behavior or scope to an existing capability.
- hardened: improves verification, correctness, reliability, security, observability,
  validation, or failure handling without primarily adding new behavior.
- migrated: preserves or replaces a capability across old and new implementations,
  representations, schemas, storage, or interfaces. A directory move or rename alone
  is structural reorganization, not feature migration.
- removed: removes the capability or its reachable entry points without a surviving
  replacement in the analyzed evidence.

Every episode is a candidate for maintainer review. Cite only short SHAs copied from
the corpus. Keywords may help find evidence but never establish a stage by themselves.
Do not invent episodes to fill stage quotas: a repository or feature may genuinely
have no support for a stage. Prefer a small, coherent episode over a broad story, and
state important uncertainty in the rationale.

Classify the primary observable effect, not every incidental file in a commit. Tests
that accompany new behavior do not automatically make that episode hardened. Cosmetic
or quality-of-life UI changes are expansion or unassigned, not hardening. A migration
must leave the capability operating through the new representation; a failed change
that is reverted to the prior state is not a migration.

Reply with JSON only, shaped as:

{"semanticEpisodes": [{"featureId": string copied from the supplied feature list,
"label": string, "rationale": string, "confidence": number between 0 and 1,
"lifecycleStage": one of ${LIFECYCLE_STAGES.map((stage) => `"${stage}"`).join(' ')},
"commitShas": [string]}]}`

const LIFECYCLE_SCHEMA = {
  type: 'object',
  properties: {
    semanticEpisodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          featureId: {
            type: 'string',
            description: 'Feature id copied exactly from the supplied feature list.',
          },
          label: {
            type: 'string',
            description: 'Short observable change label, e.g. "Add ranking validation".',
          },
          rationale: {
            type: 'string',
            description: 'Why the evidence supports this stage and what remains uncertain.',
          },
          confidence: {
            type: 'number',
            description: 'Between 0 and 1. Strength of evidence for this episode and stage.',
          },
          lifecycleStage: {
            type: 'string',
            enum: LIFECYCLE_STAGES,
          },
          commitShas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short SHAs copied exactly from the commit corpus.',
          },
        },
        required: [
          'featureId',
          'label',
          'rationale',
          'confidence',
          'lifecycleStage',
          'commitShas',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['semanticEpisodes'],
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

    const paths = episode.changes.map((change) =>
      change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path,
    )
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

export function validateSemanticEpisodes(
  proposed,
  dataset,
  featureCandidates,
  method = interpretationMethod(DEFAULT_PROVIDER, PROVIDERS[DEFAULT_PROVIDER].model),
) {
  const episodeBySha = new Map()
  for (const episode of dataset.episodes) {
    episodeBySha.set(episode.commitSha, episode)
    episodeBySha.set(episode.shortSha, episode)
  }
  const featureById = new Map(featureCandidates.map((feature) => [feature.id, feature]))
  const semanticEpisodes = []
  const relationships = []
  const unresolvedShas = []
  const unresolvedFeatureIds = []
  const discardedEpisodes = []
  const discardedEpisodeDetails = []
  const structuralEpisodes = dataset.structuralEpisodes ?? buildStructuralEpisodes(dataset.episodes)
  const structuralCommitShas = new Set(
    structuralEpisodes.flatMap((candidate) =>
      candidate.evidence.map((reference) => reference.commitSha),
    ),
  )

  proposed.forEach((proposal, index) => {
    const feature = featureById.get(proposal.featureId)
    if (!feature) {
      unresolvedFeatureIds.push({ label: proposal.label, featureId: proposal.featureId })
      discardedEpisodes.push(proposal.label)
      discardedEpisodeDetails.push({ label: proposal.label, reason: 'unknown-feature' })
      return
    }
    if (!LIFECYCLE_STAGES.includes(proposal.lifecycleStage)) {
      discardedEpisodes.push(proposal.label)
      discardedEpisodeDetails.push({ label: proposal.label, reason: 'unknown-stage' })
      return
    }

    const seen = new Set()
    const episodes = []
    for (const rawSha of proposal.commitShas ?? []) {
      const sha = String(rawSha).trim()
      const episode = episodeBySha.get(sha) ?? episodeBySha.get(sha.slice(0, 8))
      if (!episode) {
        unresolvedShas.push({ label: proposal.label, sha })
        continue
      }
      if (seen.has(episode.commitSha)) continue
      seen.add(episode.commitSha)
      episodes.push(episode)
    }

    if (episodes.length === 0) {
      discardedEpisodes.push(proposal.label)
      discardedEpisodeDetails.push({ label: proposal.label, reason: 'no-resolvable-evidence' })
      return
    }
    episodes.sort((left, right) => left.authoredAt.localeCompare(right.authoredAt))

    if (proposal.lifecycleStage === 'migrated') {
      const explanation = `${proposal.label ?? ''} ${proposal.rationale ?? ''}`.toLowerCase()
      const revertsPriorState =
        /\b(revert(?:ed)?|switch(?:es|ed)? back|return(?:s|ed)? to|restor(?:e|ed|ing)|failed)\b/.test(
          explanation,
        ) &&
        (/\b(prior|previous|old|back|revert|restore|pretotype)\b/.test(explanation) ||
          episodes.some((episode) => /^revert\b/i.test(episode.subject)))
      const onlyStructuralRename =
        episodes.some((episode) => structuralCommitShas.has(episode.commitSha)) &&
        /\b(folder|director(?:y|ies)|rename|relocat(?:e|es|ed|ing)|path|layout|structural)\b/.test(
          explanation,
        ) &&
        !/\b(api|database|schema|service|storage|interface|adapter|implementation|representation|format|endpoint|data model)\b/.test(
          explanation,
        )
      if (revertsPriorState || onlyStructuralRename) {
        discardedEpisodes.push(proposal.label)
        discardedEpisodeDetails.push({
          label: proposal.label,
          reason: revertsPriorState ? 'reverted-transition' : 'structural-only',
        })
        return
      }
    }

    const semanticEpisodeId = stableId(
      'semantic-episode',
      `${index}:${feature.id}:${proposal.lifecycleStage}:${proposal.label}`,
    )
    const candidate = {
      id: semanticEpisodeId,
      kind: 'feature-lifecycle',
      featureId: feature.id,
      label: proposal.label,
      lifecycleStage: proposal.lifecycleStage,
      status: 'candidate',
      confidence: clampConfidence(proposal.confidence),
      method: proposal.method ?? method,
      rationale: proposal.rationale,
      evidence: episodes.map((episode) => ({
        commitSha: episode.commitSha,
        paths: episode.changes.map((change) => change.path).sort(),
      })),
    }
    semanticEpisodes.push(candidate)

    for (const episode of episodes) {
      relationships.push({
        id: `supports-lifecycle:${episode.commitSha}:${semanticEpisodeId}`,
        sourceId: episode.id,
        targetId: semanticEpisodeId,
        kind: 'supports-lifecycle',
        interpretationStatus: 'candidate',
        confidence: candidate.confidence,
        evidence: [{ commitSha: episode.commitSha }],
      })
    }
    relationships.push({
      id: `evolves-feature:${semanticEpisodeId}:${feature.id}`,
      sourceId: semanticEpisodeId,
      targetId: feature.id,
      kind: 'evolves-feature',
      interpretationStatus: 'candidate',
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })
  })

  semanticEpisodes.sort((left, right) => {
    const leftDate = episodeBySha.get(left.evidence[0].commitSha)?.authoredAt ?? ''
    const rightDate = episodeBySha.get(right.evidence[0].commitSha)?.authoredAt ?? ''
    return leftDate.localeCompare(rightDate) || left.label.localeCompare(right.label)
  })

  return {
    semanticEpisodes,
    relationships,
    unresolvedShas,
    unresolvedFeatureIds,
    discardedEpisodes,
    discardedEpisodeDetails,
  }
}

export function mergeInterpretation(dataset, validated, lifecycle = null) {
  const observedRelationships = dataset.relationships.filter(
    (relationship) =>
      relationship.interpretationStatus === 'observed' ||
      relationship.kind === 'authored' ||
      relationship.kind === 'touched',
  )
  return {
    ...dataset,
    analysis: { ...dataset.analysis, mode: 'interpreted' },
    structuralEpisodes: dataset.structuralEpisodes ?? buildStructuralEpisodes(dataset.episodes),
    featureCandidates: validated.featureCandidates,
    semanticEpisodes: lifecycle?.semanticEpisodes ?? [],
    relationships: [
      ...observedRelationships,
      ...validated.relationships,
      ...(lifecycle?.relationships ?? []),
    ],
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

export function createClient(Anthropic, providerName, env = process.env, { maxRetries } = {}) {
  const provider = resolveProvider(providerName)
  const apiKey = env[provider.apiKeyEnv]

  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`${provider.label} requires ${provider.apiKeyEnv} to be set`)
  }

  return new Anthropic({
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(maxRetries === undefined ? {} : { maxRetries }),
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

function parseInterpretationMessage(message, phase, retryHint) {
  if (message.stop_reason === 'refusal') {
    throw new Error(
      `Model declined ${phase} (${message.stop_details?.category ?? 'unspecified'})`,
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`Model output was truncated during ${phase}; ${retryHint}`)
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  try {
    return extractJson(text)
  } catch (error) {
    throw new Error(`Model returned unparseable ${phase} output: ${error.message}`)
  }
}

function aggregateUsage(...usages) {
  const totals = {}
  for (const usage of usages.filter(Boolean)) {
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value
    }
  }
  return Object.keys(totals).length > 0 ? totals : null
}

/**
 * Propose feature candidates for an observed dataset. The client is injected so the
 * validation path above stays testable without a network call or an API key.
 */
export async function interpretAtlas(
  dataset,
  {
    client,
    provider = DEFAULT_PROVIDER,
    model: modelOverride = null,
    maxFeatures = 40,
    maxLifecycleEpisodes = 160,
    reuseFeatures = false,
    onProgress,
  } = {},
) {
  const { model, label } = resolveProvider(provider, modelOverride)
  const method = interpretationMethod(provider, model)

  if (dataset.episodes.length === 0) {
    const features = validateFeatures([], dataset, method)
    const lifecycle = validateSemanticEpisodes([], dataset, [], method)
    return {
      dataset: mergeInterpretation(dataset, features, lifecycle),
      validated: { ...features, semanticEpisodes: [], lifecycle },
      usage: null,
    }
  }

  requireSynchronousModel(model)
  const corpus = buildCorpus(dataset)
  let featureMessage = null
  let validated
  if (reuseFeatures) {
    onProgress?.(`Reusing ${dataset.featureCandidates.length} validated feature candidates`)
    validated = validateFeatures(
      dataset.featureCandidates.map((feature) => ({
        label: feature.label,
        rationale: feature.rationale,
        confidence: feature.confidence,
        commitShas: feature.evidence.map((reference) => reference.commitSha),
      })),
      dataset,
      method,
    )
  } else {
    onProgress?.(`Discovering candidate features with ${label} (${model})`)
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

    featureMessage = await stream.finalMessage()
    const parsedFeatures = parseInterpretationMessage(
      featureMessage,
      'feature discovery',
      'retry with a lower --max-features',
    )
    validated = validateFeatures(parsedFeatures.features ?? [], dataset, method)
  }

  let lifecycle = validateSemanticEpisodes([], dataset, validated.featureCandidates, method)
  let lifecycleMessage = null
  if (validated.featureCandidates.length > 0) {
    onProgress?.(
      `Finding lifecycle episodes for ${validated.featureCandidates.length} candidate features`,
    )
    const featureList = validated.featureCandidates.map((feature) => ({
      id: feature.id,
      label: feature.label,
      rationale: feature.rationale,
      discoveryEvidence: feature.evidence.map((reference) =>
        dataset.episodes.find((episode) => episode.commitSha === reference.commitSha)?.shortSha,
      ).filter(Boolean),
    }))
    const lifecycleStream = client.messages.stream({
      model,
      max_tokens: 32000,
      system: LIFECYCLE_SYSTEM_PROMPT,
      ...(supportsOutputConfig(model)
        ? {
            output_config: {
              effort: 'high',
              format: { type: 'json_schema', schema: LIFECYCLE_SCHEMA },
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
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: `Candidate features:\n${JSON.stringify(featureList)}\n\nPropose at most ${maxLifecycleEpisodes} evidence-supported semantic lifecycle episodes across these features. Review the complete history for later expansion, hardening, migration, and removal; do not limit evidence to the discovery commits and do not fill stage quotas.`,
            },
          ],
        },
      ],
    })
    lifecycleMessage = await lifecycleStream.finalMessage()
    const parsedLifecycle = parseInterpretationMessage(
      lifecycleMessage,
      'lifecycle discovery',
      'retry with a lower --max-lifecycle-episodes',
    )
    lifecycle = validateSemanticEpisodes(
      parsedLifecycle.semanticEpisodes ?? [],
      dataset,
      validated.featureCandidates,
      method,
    )
  }

  return {
    dataset: mergeInterpretation(dataset, validated, lifecycle),
    validated: {
      ...validated,
      semanticEpisodes: lifecycle.semanticEpisodes,
      lifecycle,
    },
    usage: aggregateUsage(featureMessage?.usage, lifecycleMessage?.usage),
  }
}
