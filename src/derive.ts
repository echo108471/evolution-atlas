import type { AtlasDataset, ChangeEpisode, FeatureCandidate } from './model'

export type DetailLevel = 'features' | 'commits'

export interface ViewControls {
  detail: DetailLevel
  minConfidence: number
  contributorId: string | null
  lifecycleStages: string[]
  cutoffIndex: number
}

export const LIFECYCLE_STAGES = [
  'introduced',
  'expanded',
  'hardened',
  'migrated',
  'removed',
] as const

export function defaultControls(dataset: AtlasDataset): ViewControls {
  return {
    detail: dataset.featureCandidates.length > 0 ? 'features' : 'commits',
    minConfidence: 0,
    contributorId: null,
    lifecycleStages: [],
    cutoffIndex: Math.max(dataset.episodes.length - 1, 0),
  }
}

/**
 * Contributor-to-feature is never stored: it is the composition of an observed
 * `authored` edge with a candidate `supports-feature` edge. Deriving it here keeps
 * the claim honest — someone authored commits that support this feature, which is
 * not the same as owning it.
 */
export function deriveFeatureContributions(
  dataset: AtlasDataset,
): Map<string, Map<string, number>> {
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  const byFeature = new Map<string, Map<string, number>>()

  for (const feature of dataset.featureCandidates) {
    const counts = new Map<string, number>()
    for (const reference of feature.evidence) {
      const episode = episodeBySha.get(reference.commitSha)
      if (!episode) continue
      for (const contributorId of episode.contributorIds) {
        counts.set(contributorId, (counts.get(contributorId) ?? 0) + 1)
      }
    }
    byFeature.set(feature.id, counts)
  }

  return byFeature
}

export function featureEpisodes(
  feature: FeatureCandidate,
  episodeBySha: Map<string, ChangeEpisode>,
): ChangeEpisode[] {
  return feature.evidence
    .map((reference) => episodeBySha.get(reference.commitSha))
    .filter((episode): episode is ChangeEpisode => episode !== undefined)
}

/** Mean of the supporting commit dates, used to place a feature on the time axis. */
export function meanTimestamp(episodes: ChangeEpisode[]): number | null {
  if (episodes.length === 0) return null
  const total = episodes.reduce((sum, episode) => sum + new Date(episode.authoredAt).getTime(), 0)
  return total / episodes.length
}

export interface VisibleModel {
  features: FeatureCandidate[]
  episodes: ChangeEpisode[]
  contributorIds: Set<string>
  codeAreaIds: Set<string>
  contributions: Map<string, Map<string, number>>
  hiddenByConfidence: number
  hiddenByStage: number
  hiddenByContributor: number
}

/**
 * Resolve the controls into exactly what the graph and the summary should show, so
 * both read from one decision rather than filtering independently.
 */
export function selectVisible(dataset: AtlasDataset, controls: ViewControls): VisibleModel {
  const contributions = deriveFeatureContributions(dataset)
  const visibleEpisodes = dataset.episodes.slice(0, controls.cutoffIndex + 1)
  const visibleShas = new Set(visibleEpisodes.map((episode) => episode.commitSha))
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))

  let hiddenByConfidence = 0
  let hiddenByStage = 0
  let hiddenByContributor = 0

  const features = dataset.featureCandidates.filter((feature) => {
    // A feature enters the view once any supporting commit is within the cutoff.
    const withinCutoff = feature.evidence.some((reference) => visibleShas.has(reference.commitSha))
    if (!withinCutoff) return false

    if (feature.confidence < controls.minConfidence) {
      hiddenByConfidence += 1
      return false
    }
    if (
      controls.lifecycleStages.length > 0 &&
      !controls.lifecycleStages.includes(feature.lifecycleStage ?? 'unassigned')
    ) {
      hiddenByStage += 1
      return false
    }
    if (controls.contributorId && !contributions.get(feature.id)?.has(controls.contributorId)) {
      hiddenByContributor += 1
      return false
    }
    return true
  })

  const contributorIds = new Set<string>()
  const codeAreaIds = new Set<string>()

  for (const feature of features) {
    for (const contributorId of contributions.get(feature.id)?.keys() ?? []) {
      contributorIds.add(contributorId)
    }
    for (const episode of featureEpisodes(feature, episodeBySha)) {
      for (const areaId of episode.codeAreaIds) codeAreaIds.add(areaId)
    }
  }

  // Commit detail is opt-in; in feature mode only the evidence behind visible
  // features is drawn, never the whole history.
  const supportingShas = new Set(
    features.flatMap((feature) => feature.evidence.map((reference) => reference.commitSha)),
  )
  const episodes =
    controls.detail === 'commits'
      ? visibleEpisodes.filter((episode) => supportingShas.has(episode.commitSha))
      : []

  return {
    features,
    episodes,
    contributorIds,
    codeAreaIds,
    contributions,
    hiddenByConfidence,
    hiddenByStage,
    hiddenByContributor,
  }
}
