import type {
  AtlasDataset,
  FeatureCandidate,
  LifecycleStage,
  SemanticEpisodeCandidate,
} from './model'

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  'introduced',
  'expanded',
  'hardened',
  'migrated',
  'removed',
]

const lifecycleStageSet = new Set<string>(LIFECYCLE_STAGES)

type LegacyFeatureCandidate = FeatureCandidate & { lifecycleStage?: unknown }

/**
 * Keep older ignored atlas files readable without pretending their feature-level
 * stage is equivalent to the new episode model. Regenerating the interpretation
 * replaces these compatibility candidates with evidence-scoped semantic episodes.
 */
export function normalizeSemanticEpisodes(dataset: AtlasDataset): SemanticEpisodeCandidate[] {
  if (Array.isArray(dataset.semanticEpisodes)) return dataset.semanticEpisodes

  return (dataset.featureCandidates as LegacyFeatureCandidate[])
    .filter(
      (feature): feature is LegacyFeatureCandidate & { lifecycleStage: LifecycleStage } =>
        typeof feature.lifecycleStage === 'string' && lifecycleStageSet.has(feature.lifecycleStage),
    )
    .map((feature) => ({
      id: `legacy-lifecycle:${feature.id}`,
      kind: 'feature-lifecycle',
      featureId: feature.id,
      label: `${feature.label} legacy stage claim`,
      lifecycleStage: feature.lifecycleStage,
      status: 'candidate',
      confidence: feature.confidence,
      method: `legacy-feature-stage:${feature.method}`,
      rationale:
        'Compatibility projection from an older dataset that assigned one lifecycle stage to the whole feature. Regenerate the interpretation for episode-level evidence.',
      evidence: feature.evidence,
    }))
}

export function lifecycleEpisodesForFeature(
  semanticEpisodes: SemanticEpisodeCandidate[],
  featureId: string,
) {
  return semanticEpisodes.filter((episode) => episode.featureId === featureId)
}
