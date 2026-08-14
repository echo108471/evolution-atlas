import { useEffect, useMemo, useState } from 'react'

import { AreaMatrix } from './AreaMatrix'
import { ChapterStrip } from './ChapterStrip'
import { ContributorTrail } from './ContributorTrail'
import { FeatureNeighborhood } from './FeatureNeighborhood'
import { IdentityReview } from './IdentityReview'
import { StoryLanes } from './StoryLanes'
import { LIFECYCLE_STAGES, normalizeSemanticEpisodes } from './lifecycle'
import { buildStructuralEpisodes } from './structure.mjs'
import {
  applyIdentityDecision,
  emptyIdentityDecisions,
  parseIdentityDecisions,
  resolveIdentities,
  type ContributorProfile,
  type IdentityDecisionChoice,
  type IdentityDecisionsDocument,
  type IdentityResolution,
} from './identity'
import type {
  AtlasDataset,
  ChangeEpisode,
  CodeArea,
  Contributor,
  FeatureCandidate,
  LifecycleStage,
  SemanticEpisodeCandidate,
  StructuralEpisodeCandidate,
} from './model'
import {
  buildAreaMatrix,
  buildContributorTrail,
  buildStoryModel,
  deriveFeatureAssociations,
  featureTouchesChapter,
  semanticEpisodeTouchesChapter,
  structuralEpisodeTouchesChapter,
} from './story'

type SelectedEntity =
  | { kind: 'episode'; value: ChangeEpisode }
  | { kind: 'contributor'; value: Contributor }
  | { kind: 'profile'; value: ContributorProfile }
  | { kind: 'area'; value: CodeArea }
  | { kind: 'feature'; value: FeatureCandidate }
  | { kind: 'semantic'; value: SemanticEpisodeCandidate }
  | { kind: 'structural'; value: StructuralEpisodeCandidate }

type PrimaryView = 'story' | 'matrix'
type HistoryMode = 'repository' | 'contributor' | 'identity'

function identityStorageKey(repository: string) {
  return `evolution-atlas:identity-decisions:${repository}`
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatYearSpan(contributor: Contributor) {
  const firstYear = new Date(contributor.firstSeenAt).getUTCFullYear()
  const lastYear = new Date(contributor.lastSeenAt).getUTCFullYear()
  return firstYear === lastYear ? String(firstYear) : `${firstYear}–${lastYear}`
}

function findEntity(
  dataset: AtlasDataset,
  id: string | null,
  resolution: IdentityResolution,
): SelectedEntity | null {
  if (!id) return null
  const episode = dataset.episodes.find((candidate) => candidate.id === id)
  if (episode) return { kind: 'episode', value: episode }
  const contributor = dataset.contributors.find((candidate) => candidate.id === id)
  if (contributor) return { kind: 'contributor', value: contributor }
  const profile = resolution.profiles.find((candidate) => candidate.id === id)
  if (profile) return { kind: 'profile', value: profile }
  const area = dataset.codeAreas.find((candidate) => candidate.id === id)
  if (area) return { kind: 'area', value: area }
  const feature = dataset.featureCandidates.find((candidate) => candidate.id === id)
  if (feature) return { kind: 'feature', value: feature }
  const semantic = dataset.semanticEpisodes?.find((candidate) => candidate.id === id)
  if (semantic) return { kind: 'semantic', value: semantic }
  const structural = dataset.structuralEpisodes?.find((candidate) => candidate.id === id)
  if (structural) return { kind: 'structural', value: structural }
  return null
}

function EvidencePanel({
  entity,
  dataset,
  onSelect,
}: {
  entity: SelectedEntity | null
  dataset: AtlasDataset
  onSelect: (id: string) => void
}) {
  if (!entity) {
    return (
      <div className="inspector-placeholder">
        <span className="eyebrow">Evidence inspector</span>
        <h2>Select a feature or evidence event.</h2>
        <p>The repository story stays readable until you ask for supporting detail.</p>
      </div>
    )
  }

  if (entity.kind === 'feature') {
    const feature = entity.value
    const associations = deriveFeatureAssociations(dataset, feature)
    const lifecycleEpisodes = (dataset.semanticEpisodes ?? []).filter(
      (episode) => episode.featureId === feature.id,
    )
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">Candidate interpretation</span>
          <h2>{feature.label}</h2>
          <div className="status-line">
            <span>candidate feature</span>
            <span>{Math.round(feature.confidence * 100)}% confidence</span>
          </div>
        </div>

        {feature.rationale && (
          <section className="inspector-section">
            <h3>Why it was proposed</h3>
            <p>{feature.rationale}</p>
          </section>
        )}

        <section className="inspector-section">
          <h3>Lifecycle episodes</h3>
          {lifecycleEpisodes.length > 0 ? (
            <ol className="lifecycle-list">
              {lifecycleEpisodes.map((episode) => (
                <li key={episode.id}>
                  <button type="button" onClick={() => onSelect(episode.id)}>
                    <span className={`lifecycle-badge lifecycle-badge--${episode.lifecycleStage}`}>
                      {episode.lifecycleStage}
                    </span>
                    <strong>{episode.label}</strong>
                    <small>{Math.round(episode.confidence * 100)}%</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>No evidence-supported lifecycle episodes were proposed for this feature.</p>
          )}
        </section>

        <section className="inspector-section">
          <h3>Combined evidence trail</h3>
          <ol className="evidence-list">
            {associations.episodes.map((episode) => (
              <li key={episode.id}>
                <button type="button" onClick={() => onSelect(episode.id)}>
                  <span>{formatDate(episode.authoredAt)}</span>
                  <strong>{episode.subject}</strong>
                  <code>{episode.shortSha}</code>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <FeatureNeighborhood dataset={dataset} feature={feature} onSelect={onSelect} />

        <p className="boundary-note">
          This grouping was proposed from commit subjects and touched paths. It does not establish
          hidden intent, complete feature ownership, or that every relevant commit was found.
        </p>
      </div>
    )
  }

  if (entity.kind === 'semantic') {
    const semantic = entity.value
    const feature = dataset.featureCandidates.find(
      (candidate) => candidate.id === semantic.featureId,
    )
    const evidenceEpisodes = semantic.evidence
      .map((reference) =>
        dataset.episodes.find((episode) => episode.commitSha === reference.commitSha),
      )
      .filter((episode): episode is ChangeEpisode => Boolean(episode))
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">Candidate semantic episode</span>
          <h2>{semantic.label}</h2>
          <div className="status-line">
            <span className={`lifecycle-badge lifecycle-badge--${semantic.lifecycleStage}`}>
              {semantic.lifecycleStage}
            </span>
            <span>{Math.round(semantic.confidence * 100)}% confidence</span>
          </div>
        </div>

        {feature && (
          <section className="inspector-section">
            <h3>Feature trail</h3>
            <button
              className="inspector-link-button"
              type="button"
              onClick={() => onSelect(feature.id)}
            >
              {feature.label}
            </button>
          </section>
        )}

        <section className="inspector-section">
          <h3>Why this stage was proposed</h3>
          <p>{semantic.rationale}</p>
        </section>

        <section className="inspector-section">
          <h3>Supporting commits</h3>
          <ol className="evidence-list">
            {evidenceEpisodes.map((episode) => (
              <li key={episode.id}>
                <button type="button" onClick={() => onSelect(episode.id)}>
                  <span>{formatDate(episode.authoredAt)}</span>
                  <strong>{episode.subject}</strong>
                  <code>{episode.shortSha}</code>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <p className="boundary-note">
          This stage is a candidate interpretation of observable changes. It does not establish
          hidden intent, a complete feature lifetime, or that every related commit was found.
        </p>
      </div>
    )
  }

  if (entity.kind === 'structural') {
    const structural = entity.value
    const evidenceEpisodes = structural.evidence
      .map((reference) =>
        dataset.episodes.find((episode) => episode.commitSha === reference.commitSha),
      )
      .filter((episode): episode is ChangeEpisode => Boolean(episode))
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">Candidate structural episode</span>
          <h2>{structural.label}</h2>
          <div className="status-line">
            <span>repository reorganization</span>
            <span>{Math.round(structural.confidence * 100)}% confidence</span>
          </div>
        </div>

        <section className="inspector-section">
          <h3>Observable effect</h3>
          <p>{structural.rationale}</p>
        </section>

        <section className="inspector-section">
          <h3>Path-prefix mappings</h3>
          <ul className="structure-mapping-list">
            {structural.mappings.map((mapping) => (
              <li key={`${mapping.fromPrefix}:${mapping.toPrefix}`}>
                <code>{mapping.fromPrefix || '(repository root)'}</code>
                <span>→</span>
                <code>{mapping.toPrefix || '(repository root)'}</code>
                <small>{mapping.fileCount} files</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="inspector-section">
          <h3>Supporting commits</h3>
          <ol className="evidence-list">
            {evidenceEpisodes.map((episode) => (
              <li key={episode.id}>
                <button type="button" onClick={() => onSelect(episode.id)}>
                  <span>{formatDate(episode.authoredAt)}</span>
                  <strong>{episode.subject}</strong>
                  <code>{episode.shortSha}</code>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="inspector-section">
          <h3>Path transitions</h3>
          <ul className="structure-transition-list">
            {structural.transitions.map((transition) => (
              <li key={`${transition.previousPath}:${transition.path}`}>
                <span>{transition.basis === 'git-rename' ? 'Git rename' : 'Candidate pairing'}</span>
                <code>{transition.previousPath} → {transition.path}</code>
                <small>{Math.round(transition.confidence * 100)}%</small>
              </li>
            ))}
          </ul>
        </section>

        <p className="boundary-note">
          This identifies an observable path reorganization. It does not establish why the layout
          changed, whether the architecture changed with it, or whether every moved file was found.
        </p>
      </div>
    )
  }

  if (entity.kind === 'episode') {
    const episode = entity.value
    const supportedFeatures = dataset.featureCandidates.filter((feature) =>
      feature.evidence.some((reference) => reference.commitSha === episode.commitSha),
    )
    const supportedLifecycle = (dataset.semanticEpisodes ?? []).filter((candidate) =>
      candidate.evidence.some((reference) => reference.commitSha === episode.commitSha),
    )
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">Observed commit evidence</span>
          <h2>{episode.subject}</h2>
          <div className="status-line">
            <code>{episode.shortSha}</code>
            <span>{formatDate(episode.authoredAt)}</span>
          </div>
        </div>

        {supportedFeatures.length > 0 && (
          <section className="inspector-section">
            <h3>Supports candidate features</h3>
            <div className="association-list">
              {supportedFeatures.map((feature) => (
                <button key={feature.id} type="button" onClick={() => onSelect(feature.id)}>
                  {feature.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {supportedLifecycle.length > 0 && (
          <section className="inspector-section">
            <h3>Supports lifecycle candidates</h3>
            <div className="association-list">
              {supportedLifecycle.map((candidate) => (
                <button key={candidate.id} type="button" onClick={() => onSelect(candidate.id)}>
                  {candidate.lifecycleStage} · {candidate.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="inspector-section">
          <h3>Changed paths</h3>
          {episode.changes.length > 0 ? (
            <ul className="path-list">
              {episode.changes.map((change, index) => (
                <li key={`${change.path}:${index}`}>
                  <span>{change.status}</span>
                  <code>
                    {change.previousPath ? `${change.previousPath} → ${change.path}` : change.path}
                  </code>
                </li>
              ))}
            </ul>
          ) : (
            <p>No first-parent path changes were emitted for this commit.</p>
          )}
        </section>
      </div>
    )
  }

  if (entity.kind === 'contributor' || entity.kind === 'profile') {
    const contributor = entity.value
    const identityIds = new Set(
      entity.kind === 'profile' ? entity.value.identityIds : [entity.value.id],
    )
    const episodes = dataset.episodes.filter((episode) =>
      episode.contributorIds.some((identityId) => identityIds.has(identityId)),
    )
    const featureIds = new Set(
      dataset.featureCandidates
        .filter((feature) =>
          feature.evidence.some((reference) =>
            episodes.some((episode) => episode.commitSha === reference.commitSha),
          ),
        )
        .map((feature) => feature.id),
    )
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">
            {entity.kind === 'profile' ? 'Confirmed contributor profile' : 'Git author association'}
          </span>
          <h2>{contributor.displayName}</h2>
          <div className="status-line">
            <span>{episodes.length} authored commits</span>
            <span>{featureIds.size} candidate associations</span>
          </div>
        </div>
        <dl className="facts">
          <div><dt>First seen</dt><dd>{formatDate(contributor.firstSeenAt)}</dd></div>
          <div><dt>Last seen</dt><dd>{formatDate(contributor.lastSeenAt)}</dd></div>
          <div><dt>Aliases</dt><dd>{contributor.aliases.join(', ')}</dd></div>
          {entity.kind === 'profile' && (
            <div><dt>Git identities</dt><dd>{entity.value.identityIds.length}</dd></div>
          )}
        </dl>
        <p className="boundary-note">
          Git authorship is an observable association, not complete feature ownership or a
          performance measure.
        </p>
      </div>
    )
  }

  const area = entity.value
  const relatedFeatures = dataset.featureCandidates.filter((feature) => {
    const associations = deriveFeatureAssociations(dataset, feature)
    return associations.areas.some((entry) => entry.id === area.id)
  })
  return (
    <div className="inspector-content">
      <div className="inspector-heading">
        <span className="eyebrow">Observed path grouping</span>
        <h2>{area.label}</h2>
        <div className="status-line">
          <code>{area.pathPrefix || '(repository root)'}</code>
          <span>{relatedFeatures.length} candidate associations</span>
        </div>
      </div>
      <section className="inspector-section">
        <h3>Candidate features touching this area</h3>
        <div className="association-list">
          {relatedFeatures.map((feature) => (
            <button key={feature.id} type="button" onClick={() => onSelect(feature.id)}>
              {feature.label}
            </button>
          ))}
        </div>
      </section>
      <p className="boundary-note">
        This is a top-level path grouping, not a claim that the directory is an architectural
        component or belongs to a particular contributor.
      </p>
    </div>
  )
}

export default function App() {
  const [dataset, setDataset] = useState<AtlasDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [view, setView] = useState<PrimaryView>('story')
  const [historyMode, setHistoryMode] = useState<HistoryMode>('repository')
  const [selectedContributorId, setSelectedContributorId] = useState<string | null>(null)
  const [identityDecisions, setIdentityDecisions] =
    useState<IdentityDecisionsDocument | null>(null)
  const [minConfidence, setMinConfidence] = useState(0)
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage | 'all'>('all')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/atlas.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`atlas.json returned ${response.status}`)
        return response.json() as Promise<AtlasDataset>
      })
      .then((loadedDataset) => {
        const normalizedDataset: AtlasDataset = {
          ...loadedDataset,
          structuralEpisodes:
            loadedDataset.structuralEpisodes ?? buildStructuralEpisodes(loadedDataset.episodes),
        }
        normalizedDataset.semanticEpisodes = normalizeSemanticEpisodes(normalizedDataset)
        setDataset(normalizedDataset)
        const emptyDecisions = emptyIdentityDecisions(normalizedDataset.repository.name)
        try {
          const stored = window.localStorage.getItem(identityStorageKey(normalizedDataset.repository.name))
          setIdentityDecisions(
            stored
              ? parseIdentityDecisions(JSON.parse(stored), normalizedDataset.repository.name)
              : emptyDecisions,
          )
        } catch {
          setIdentityDecisions(emptyDecisions)
        }
        const firstFeature = normalizedDataset.featureCandidates[0]
        setSelectedId(firstFeature?.id ?? normalizedDataset.episodes.at(-1)?.id ?? null)
        const firstContributor = [...normalizedDataset.contributors].sort(
          (left, right) =>
            Number(left.isBot) - Number(right.isBot) ||
            left.displayName.localeCompare(right.displayName),
        )[0]
        const contextualContributor = firstFeature
          ? deriveFeatureAssociations(normalizedDataset, firstFeature).contributors.find(
              (contributor) => !contributor.isBot,
            )
          : null
        setSelectedContributorId(contextualContributor?.id ?? firstContributor?.id ?? null)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => controller.abort()
  }, [])

  const filteredByClaim = useMemo(() => {
    if (!dataset) return []
    const lifecycleFeatureIds = new Set(
      (dataset.semanticEpisodes ?? [])
        .filter(
          (episode) =>
            episode.confidence >= minConfidence &&
            (lifecycleStage === 'all' || episode.lifecycleStage === lifecycleStage),
        )
        .map((episode) => episode.featureId),
    )
    return dataset.featureCandidates.filter(
      (feature) =>
        feature.confidence >= minConfidence &&
        (lifecycleStage === 'all' || lifecycleFeatureIds.has(feature.id)),
    )
  }, [dataset, lifecycleStage, minConfidence])
  const filteredSemanticEpisodes = useMemo(
    () =>
      (dataset?.semanticEpisodes ?? []).filter(
        (episode) =>
          episode.confidence >= minConfidence &&
          (lifecycleStage === 'all' || episode.lifecycleStage === lifecycleStage),
      ),
    [dataset, lifecycleStage, minConfidence],
  )
  const filteredStructuralEpisodes = useMemo(
    () =>
      (dataset?.structuralEpisodes ?? []).filter(
        (structuralEpisode) => structuralEpisode.confidence >= minConfidence,
      ),
    [dataset, minConfidence],
  )

  const baseStory = useMemo(
    () =>
      dataset
        ? buildStoryModel(
            dataset,
            filteredByClaim,
            filteredStructuralEpisodes,
            filteredSemanticEpisodes,
          )
        : null,
    [dataset, filteredByClaim, filteredSemanticEpisodes, filteredStructuralEpisodes],
  )
  const selectedChapter =
    baseStory?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null
  const activeIdentityDecisions = useMemo(
    () =>
      dataset && identityDecisions?.repository === dataset.repository.name
        ? identityDecisions
        : emptyIdentityDecisions(dataset?.repository.name ?? ''),
    [dataset, identityDecisions],
  )
  const identityResolution = useMemo(
    () =>
      dataset
        ? resolveIdentities(dataset, activeIdentityDecisions)
        : {
            profiles: [],
            profileByIdentityId: new Map(),
            matches: [],
            suggestedCount: 0,
            mergedIdentityCount: 0,
            reviewedCount: 0,
          },
    [activeIdentityDecisions, dataset],
  )
  const contributorOptions = useMemo(
    () => identityResolution.profiles,
    [identityResolution.profiles],
  )
  const selectedContributor =
    contributorOptions.find((contributor) => contributor.id === selectedContributorId) ??
    (selectedContributorId
      ? identityResolution.profileByIdentityId.get(selectedContributorId)
      : null) ??
    contributorOptions[0] ??
    null
  const visibleFeatures = useMemo(() => {
    if (!dataset || !selectedChapter) return filteredByClaim
    if (lifecycleStage !== 'all') {
      const featureIds = new Set(
        filteredSemanticEpisodes
          .filter((episode) => semanticEpisodeTouchesChapter(dataset, episode, selectedChapter))
          .map((episode) => episode.featureId),
      )
      return filteredByClaim.filter((feature) => featureIds.has(feature.id))
    }
    return filteredByClaim.filter((feature) =>
      featureTouchesChapter(dataset, feature, selectedChapter, filteredSemanticEpisodes),
    )
  }, [dataset, filteredByClaim, filteredSemanticEpisodes, lifecycleStage, selectedChapter])
  const visibleSemanticEpisodes = useMemo(() => {
    if (!dataset) return []
    const featureIds = new Set(visibleFeatures.map((feature) => feature.id))
    return filteredSemanticEpisodes.filter(
      (episode) =>
        featureIds.has(episode.featureId) &&
        (!selectedChapter || semanticEpisodeTouchesChapter(dataset, episode, selectedChapter)),
    )
  }, [dataset, filteredSemanticEpisodes, selectedChapter, visibleFeatures])
  const visibleStructuralEpisodes = useMemo(() => {
    if (!dataset || !selectedChapter) return filteredStructuralEpisodes
    return filteredStructuralEpisodes.filter((structuralEpisode) =>
      structuralEpisodeTouchesChapter(dataset, structuralEpisode, selectedChapter),
    )
  }, [dataset, filteredStructuralEpisodes, selectedChapter])
  const story = useMemo(
    () =>
      dataset
        ? buildStoryModel(
            dataset,
            visibleFeatures,
            visibleStructuralEpisodes,
            visibleSemanticEpisodes,
          )
        : null,
    [dataset, visibleFeatures, visibleSemanticEpisodes, visibleStructuralEpisodes],
  )
  const matrix = useMemo(
    () => (dataset ? buildAreaMatrix(dataset, visibleFeatures) : null),
    [dataset, visibleFeatures],
  )
  const contributorTrail = useMemo(
    () =>
      dataset && selectedContributor
        ? buildContributorTrail(
            dataset,
            selectedContributor,
            filteredByClaim,
            selectedChapter,
            filteredSemanticEpisodes,
          )
        : null,
    [dataset, filteredByClaim, filteredSemanticEpisodes, selectedChapter, selectedContributor],
  )
  const selectedEntity = useMemo(
    () => (dataset ? findEntity(dataset, selectedId, identityResolution) : null),
    [dataset, identityResolution, selectedId],
  )
  const visibleEvidenceCount = useMemo(
    () =>
      new Set([
        ...visibleFeatures.flatMap((feature) =>
          feature.evidence.map((entry) => entry.commitSha),
        ),
        ...visibleSemanticEpisodes.flatMap((episode) =>
          episode.evidence.map((entry) => entry.commitSha),
        ),
      ]).size,
    [visibleFeatures, visibleSemanticEpisodes],
  )

  const handleSelect = (id: string) => {
    setSelectedId(id)
    const contributor = dataset?.contributors.find((candidate) => candidate.id === id)
    if (contributor) {
      const profile = identityResolution.profileByIdentityId.get(contributor.id)
      setSelectedContributorId(profile?.id ?? contributor.id)
      setSelectedId(profile?.id ?? contributor.id)
      setHistoryMode('contributor')
    }
  }

  const handleHistoryMode = (mode: HistoryMode) => {
    setHistoryMode(mode)
    if (mode === 'contributor') {
      const selectedFeature = dataset?.featureCandidates.find((feature) => feature.id === selectedId)
      const contextualContributor = selectedFeature
        ? deriveFeatureAssociations(dataset!, selectedFeature).contributors.find(
            (contributor) => !contributor.isBot,
          )
        : null
      const contributor = contextualContributor ?? selectedContributor
      if (contributor) {
        const profile = identityResolution.profileByIdentityId.get(contributor.id) ?? contributor
        setSelectedContributorId(profile.id)
        setSelectedId(profile.id)
      }
    } else if (
      mode === 'repository' &&
      (dataset?.contributors.some((contributor) => contributor.id === selectedId) ||
        identityResolution.profiles.some((profile) => profile.id === selectedId))
    ) {
      setSelectedId(visibleFeatures[0]?.id ?? dataset?.episodes.at(-1)?.id ?? null)
    }
  }

  const handleContributorChange = (id: string) => {
    setSelectedContributorId(id)
    setSelectedId(id)
  }

  const handleIdentityDecision = (
    matchId: string,
    choice: IdentityDecisionChoice | null,
  ) => {
    if (!dataset) return
    setIdentityDecisions((current) => {
      const base =
        current?.repository === dataset.repository.name
          ? current
          : emptyIdentityDecisions(dataset.repository.name)
      return applyIdentityDecision(base, matchId, choice)
    })
  }

  const handleIdentityImport = (value: unknown) => {
    if (!dataset) return
    setIdentityDecisions(parseIdentityDecisions(value, dataset.repository.name))
  }

  const handleOpenContributor = (identityId: string) => {
    const profile = identityResolution.profileByIdentityId.get(identityId)
    if (!profile) return
    setSelectedContributorId(profile.id)
    setSelectedId(profile.id)
    setHistoryMode('contributor')
  }

  useEffect(() => {
    if (!dataset || !identityDecisions) return
    try {
      window.localStorage.setItem(
        identityStorageKey(dataset.repository.name),
        JSON.stringify(identityDecisions),
      )
    } catch {
      // Import/export remains available when browser storage is unavailable.
    }
  }, [dataset, identityDecisions])

  if (!dataset || !baseStory || !story || !matrix) {
    return (
      <main className="load-state">
        <p className="brand-mark">EVOLUTION ATLAS</p>
        {loadError ? (
          <div className="load-card">
            <span className="eyebrow">Local dataset needed</span>
            <h1>Map a committed history.</h1>
            <p>Generate the ignored local dataset, then reload the page.</p>
            <code>npm run analyze -- --repo . --out public/atlas.json</code>
            <small>{loadError}</small>
          </div>
        ) : (
          <p>Loading repository evidence…</p>
        )}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="brand-mark">EVOLUTION ATLAS / EVIDENCE-LED HISTORY</p>
          <h1>{dataset.repository.name}</h1>
          <p className="subtitle">
            {historyMode === 'repository'
              ? 'Candidate capabilities, lifecycle episodes, structural reorganizations, and cited repository evidence.'
              : historyMode === 'contributor'
                ? 'One confirmed contributor profile projected through the repository story and its evidence.'
                : 'Review likely identity matches without rewriting the underlying Git evidence.'}
          </p>
        </div>
        <div className="repository-meta">
          <span>{dataset.repository.ref}</span>
          <code>{dataset.repository.headSha.slice(0, 8)}</code>
          <span>{dataset.analysis.mode}</span>
        </div>
      </header>

      <section className="summary-strip" aria-label="Current view summary">
        {historyMode === 'repository' ? (
          <>
            <div><strong>{visibleFeatures.length}</strong><span>candidate features</span></div>
            <div><strong>{visibleSemanticEpisodes.length}</strong><span>lifecycle episodes</span></div>
            <div><strong>{visibleStructuralEpisodes.length}</strong><span>structural episodes</span></div>
            <div><strong>{visibleEvidenceCount}</strong><span>cited commits</span></div>
          </>
        ) : historyMode === 'contributor' ? (
          <>
            <div><strong>{contributorTrail?.authoredEpisodes.length ?? 0}</strong><span>authored commits</span></div>
            <div><strong>{contributorTrail?.featureLanes.length ?? 0}</strong><span>candidate associations</span></div>
            <div><strong>{contributorTrail?.areaLanes.length ?? 0}</strong><span>observed code areas</span></div>
          </>
        ) : (
          <>
            <div><strong>{identityResolution.suggestedCount}</strong><span>needs review</span></div>
            <div><strong>{identityResolution.mergedIdentityCount}</strong><span>identities consolidated</span></div>
            <div><strong>{identityResolution.profiles.length}</strong><span>contributor profiles</span></div>
          </>
        )}
        <div>
          <strong>{historyMode === 'identity' ? identityResolution.reviewedCount : selectedChapter?.label ?? 'all'}</strong>
          <span>{historyMode === 'identity' ? 'resolved matches' : 'calendar range'}</span>
        </div>
      </section>

      {historyMode !== 'identity' && (
        <ChapterStrip
          chapters={baseStory.chapters}
          selectedId={selectedChapterId}
          onSelect={setSelectedChapterId}
        />
      )}

      <section className="view-toolbar" aria-label="Story controls">
        <div className="mode-switch" role="group" aria-label="History mode">
          <button
            type="button"
            className={historyMode === 'repository' ? 'is-active' : ''}
            aria-pressed={historyMode === 'repository'}
            onClick={() => handleHistoryMode('repository')}
          >
            Repository story
          </button>
          <button
            type="button"
            className={historyMode === 'contributor' ? 'is-active' : ''}
            aria-pressed={historyMode === 'contributor'}
            onClick={() => handleHistoryMode('contributor')}
          >
            Contributor trail
          </button>
          <button
            type="button"
            className={historyMode === 'identity' ? 'is-active' : ''}
            aria-pressed={historyMode === 'identity'}
            onClick={() => handleHistoryMode('identity')}
          >
            Identity review
          </button>
        </div>

        {historyMode === 'repository' ? (
          <div className="view-switch" role="group" aria-label="Repository view">
            <button
              type="button"
              className={view === 'story' ? 'is-active' : ''}
              onClick={() => setView('story')}
            >
              Feature lanes
            </button>
            <button
              type="button"
              className={view === 'matrix' ? 'is-active' : ''}
              onClick={() => setView('matrix')}
            >
              Code areas
            </button>
          </div>
        ) : historyMode === 'contributor' ? (
          <label className="compact-control contributor-control">
            <span>Contributor</span>
            <select
              value={selectedContributor?.id ?? ''}
              onChange={(event) => handleContributorChange(event.target.value)}
            >
              {contributorOptions.map((contributor) => (
                <option key={contributor.id} value={contributor.id}>
                  {contributor.displayName} · {formatYearSpan(contributor)}
                  {contributor.isBot ? ' · bot' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {historyMode !== 'identity' && (
          <>
            <label className="compact-control">
              <span>Confidence ≥ {Math.round(minConfidence * 100)}%</span>
              <input
                type="range"
                min="0"
                max="0.95"
                step="0.05"
                value={minConfidence}
                onChange={(event) => setMinConfidence(Number(event.target.value))}
              />
            </label>

            <label className="compact-control compact-control--select">
              <span>Lifecycle episode</span>
              <select
                value={lifecycleStage}
                onChange={(event) => setLifecycleStage(event.target.value as LifecycleStage | 'all')}
              >
                <option value="all">All stages</option>
                {LIFECYCLE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>{stage}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <section className={`workspace-grid${historyMode === 'identity' ? ' identity-workspace' : ''}`}>
        <div className="primary-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {historyMode === 'contributor'
                  ? 'Individual history'
                  : historyMode === 'identity'
                    ? 'Identity resolution'
                  : view === 'story'
                    ? 'Feature chronology'
                    : 'Structural comparison'}
              </span>
              <h2>
                {historyMode === 'contributor'
                  ? `${selectedContributor?.displayName ?? 'Contributor'} in repository context`
                  : historyMode === 'identity'
                    ? 'Confirm which Git identities belong together'
                  : view === 'story'
                    ? 'How capabilities and repository structure changed over time'
                    : 'Where cited feature evidence lives'}
              </h2>
            </div>
            <span className="candidate-key">
              {historyMode === 'contributor'
                ? 'Association, not ownership or performance'
                : historyMode === 'identity'
                  ? 'Suggestions never alter raw history'
                : 'Interpretations stay visibly candidate'}
            </span>
          </div>

          {historyMode === 'identity' ? (
            <IdentityReview
              dataset={dataset}
              resolution={identityResolution}
              decisions={activeIdentityDecisions}
              onDecision={handleIdentityDecision}
              onImport={handleIdentityImport}
              onOpenContributor={handleOpenContributor}
            />
          ) : historyMode === 'contributor' && contributorTrail ? (
            <ContributorTrail
              model={contributorTrail}
              selectedId={selectedId}
              selectedChapterId={selectedChapterId}
              onSelect={handleSelect}
            />
          ) : view === 'story' ? (
            <StoryLanes
              model={story}
              selectedId={selectedId}
              selectedChapterId={selectedChapterId}
              onSelect={handleSelect}
            />
          ) : (
            <AreaMatrix model={matrix} selectedId={selectedId} onSelect={handleSelect} />
          )}
        </div>

        {historyMode !== 'identity' && (
          <aside className="inspector-panel">
            <EvidencePanel entity={selectedEntity} dataset={dataset} onSelect={handleSelect} />
          </aside>
        )}
      </section>
    </main>
  )
}
