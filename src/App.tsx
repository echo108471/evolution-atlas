import { useEffect, useMemo, useState } from 'react'

import { ContributorTrail } from './ContributorTrail'
import { FeatureExplorer } from './FeatureExplorer'
import { GalleryIndex } from './GalleryIndex'
import { IdentityReview } from './IdentityReview'
import { RepositoryOverview } from './RepositoryOverview'
import { RepositoryTimeMachine } from './RepositoryTimeMachine'
import { LIFECYCLE_STAGES, normalizeSemanticEpisodes } from './lifecycle'
import {
  GALLERY_MANIFEST_URL,
  LOCAL_DATASET_URL,
  type GalleryManifest,
} from './gallery'
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
  buildContributorTrail,
  buildStoryModel,
  deriveFeatureAssociations,
  featureTouchesChapter,
  structuralEpisodeTouchesChapter,
} from './story'
import { useAtlasUrl } from './useAtlasUrl'
import { useMeasuredHeight } from './useMeasuredHeight'
import { DEFAULT_URL_STATE, type AtlasSection, type EvidencePreset } from './urlState'

type SelectedEntity =
  | { kind: 'episode'; value: ChangeEpisode }
  | { kind: 'contributor'; value: Contributor }
  | { kind: 'profile'; value: ContributorProfile }
  | { kind: 'area'; value: CodeArea }
  | { kind: 'feature'; value: FeatureCandidate }
  | { kind: 'semantic'; value: SemanticEpisodeCandidate }
  | { kind: 'structural'; value: StructuralEpisodeCandidate }

const EVIDENCE_PRESETS: Record<EvidencePreset, { label: string; threshold: number }> = {
  conservative: { label: 'Conservative', threshold: 0.85 },
  balanced: { label: 'Balanced', threshold: 0.7 },
  all: { label: 'All candidates', threshold: 0 },
}



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

function EvidenceCommitList({
  episodes,
  onSelect,
  includePathPreview = false,
}: {
  episodes: ChangeEpisode[]
  onSelect: (id: string) => void
  includePathPreview?: boolean
}) {
  return (
    <ol className="evidence-list">
      {episodes.map((episode) => {
        const previewChanges = episode.changes.slice(0, 2)
        const remainingPathCount = Math.max(episode.changes.length - previewChanges.length, 0)
        return (
          <li key={episode.id}>
            <button type="button" onClick={() => onSelect(episode.id)}>
              <span>{formatDate(episode.authoredAt)}</span>
              <strong>{episode.subject}</strong>
              <code>{episode.shortSha}</code>
              {includePathPreview && (
                <small className="evidence-list__paths">
                  {previewChanges.length > 0
                    ? previewChanges
                        .map((change) =>
                          change.previousPath
                            ? `${change.status} ${change.previousPath} → ${change.path}`
                            : `${change.status} ${change.path}`,
                        )
                        .join(' · ')
                    : 'No first-parent path changes recorded'}
                  {remainingPathCount > 0
                    ? ` · +${remainingPathCount} more path${remainingPathCount === 1 ? '' : 's'}`
                    : ''}
                </small>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
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
        <h2>Select a claim or commit mark.</h2>
        <p>The current view stays readable until you ask for supporting detail.</p>
      </div>
    )
  }

  if (entity.kind === 'feature') {
    const feature = entity.value
    const associations = deriveFeatureAssociations(dataset, feature)
    return (
      <div className="inspector-content">
        <div className="inspector-heading">
          <span className="eyebrow">Aggregate feature evidence</span>
          <h2>{feature.label}</h2>
          <div className="status-line">
            <span>candidate feature</span>
            <span>{Math.round(feature.confidence * 100)}% confidence</span>
          </div>
        </div>

        <section className="inspector-section">
          <h3>Evidence scope</h3>
          <p>
            {associations.episodes.length} observed commit{associations.episodes.length === 1 ? '' : 's'}
            {' '}across {associations.areas.length} top-level code area
            {associations.areas.length === 1 ? '' : 's'} support this candidate grouping.
          </p>
        </section>

        <section className="inspector-section">
          <h3>Supporting commits</h3>
          <EvidenceCommitList
            episodes={associations.episodes}
            onSelect={onSelect}
            includePathPreview
          />
        </section>

        <p className="boundary-note">
          This grouping was proposed from commit subjects and touched paths. It does not establish
          hidden intent, complete feature ownership, or that every relevant commit was found.
        </p>
      </div>
    )
  }

  if (entity.kind === 'semantic') {
    const semantic = entity.value
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

        <section className="inspector-section">
          <h3>Why this stage was proposed</h3>
          <p>{semantic.rationale}</p>
        </section>

        <section className="inspector-section">
          <h3>Supporting commits</h3>
          <EvidenceCommitList
            episodes={evidenceEpisodes}
            onSelect={onSelect}
            includePathPreview
          />
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
          <span className="eyebrow">Candidate repository reorganization</span>
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

function ScopeControls({
  chapters,
  selectedChapterId,
  onSelectChapter,
  lifecycleStage,
  onLifecycleStage,
  evidencePreset,
  onEvidencePreset,
  resultLabel,
  showLifecycle = true,
  title,
  help,
}: {
  chapters: Array<{ id: string; label: string }>
  selectedChapterId: string | null
  onSelectChapter: (id: string | null) => void
  lifecycleStage: LifecycleStage | 'all'
  onLifecycleStage: (stage: LifecycleStage | 'all') => void
  evidencePreset: EvidencePreset
  onEvidencePreset: (preset: EvidencePreset) => void
  resultLabel: string
  showLifecycle?: boolean
  title?: string
  help?: {
    lede: string
    boundary: string
  }
}) {
  const scopeBarRef = useMeasuredHeight('--scope-bar-height')

  return (
    <section
      ref={scopeBarRef}
      className="scope-bar"
      aria-label={title ? `${title} controls` : 'History scope'}
    >
      {title && (
        <div className="scope-title">
          <span>Explore</span>
          <strong>{title}</strong>
        </div>
      )}
      <div className="scope-group scope-group--time">
        <span>Time</span>
        <div role="group" aria-label="Calendar range">
          <button
            type="button"
            className={selectedChapterId === null ? 'is-active' : ''}
            aria-pressed={selectedChapterId === null}
            onClick={() => onSelectChapter(null)}
          >
            All
          </button>
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={selectedChapterId === chapter.id ? 'is-active' : ''}
              aria-pressed={selectedChapterId === chapter.id}
              onClick={() => onSelectChapter(selectedChapterId === chapter.id ? null : chapter.id)}
            >
              {chapter.label}
            </button>
          ))}
        </div>
      </div>

      {showLifecycle && (
        <label className="scope-select">
          <span>Lifecycle</span>
          <select
            value={lifecycleStage}
            onChange={(event) => onLifecycleStage(event.target.value as LifecycleStage | 'all')}
          >
            <option value="all">All stages</option>
            {LIFECYCLE_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </label>
      )}

      <div className="scope-group scope-group--evidence">
        <span>Evidence</span>
        <div role="group" aria-label="Evidence preset">
          {(Object.entries(EVIDENCE_PRESETS) as Array<[EvidencePreset, { label: string; threshold: number }]>).map(
            ([preset, definition]) => (
              <button
                key={preset}
                type="button"
                className={evidencePreset === preset ? 'is-active' : ''}
                aria-pressed={evidencePreset === preset}
                title={`${Math.round(definition.threshold * 100)}% minimum candidate confidence`}
                onClick={() => onEvidencePreset(preset)}
              >
                {definition.label}
              </button>
            ),
          )}
        </div>
      </div>

      <span className="scope-result">{resultLabel}</span>
      {help && (
        <details className="scope-help">
          <summary>How this works</summary>
          <div className="scope-help__panel">
            <p>{help.lede}</p>
            <p className="scope-help__boundary">{help.boundary}</p>
          </div>
        </details>
      )}
    </section>
  )
}

export default function App() {
  const [dataset, setDataset] = useState<AtlasDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [identityDecisions, setIdentityDecisions] =
    useState<IdentityDecisionsDocument | null>(null)
  const [manifest, setManifest] = useState<GalleryManifest | null>(null)
  const [manifestSettled, setManifestSettled] = useState(false)

  // Every navigation coordinate lives in the query string. Selections that the user never
  // made stay absent from the URL and are resolved to a default at render time instead.
  const [url, setUrl] = useAtlasUrl()
  const productHeaderRef = useMeasuredHeight('--product-header-height')
  const {
    subject: urlSubject,
    section,
    selectedId,
    chapterId: selectedChapterId,
    contributorId: selectedContributorId,
    evidencePreset,
    lifecycleStage,
  } = url

  useEffect(() => {
    const controller = new AbortController()
    fetch(GALLERY_MANIFEST_URL, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<GalleryManifest>) : null))
      .then((loaded) => {
        if (loaded && Array.isArray(loaded.subjects) && loaded.subjects.length > 0) {
          setManifest(loaded)
        }
      })
      .catch(() => {
        // No manifest means this is a local single-dataset install, not a failure.
      })
      .finally(() => setManifestSettled(true))

    return () => controller.abort()
  }, [])

  // A gallery with no slug in the URL is an arrival, not an error, so it opens the index
  // rather than guessing a subject. An unknown slug still resolves to the first subject so
  // that a stale link lands somewhere real instead of on a dead end.
  const activeSubject = useMemo(() => {
    if (!manifest || urlSubject === null) return null
    return manifest.subjects.find((entry) => entry.slug === urlSubject) ?? manifest.subjects[0]
  }, [manifest, urlSubject])

  const showGalleryIndex = manifest !== null && activeSubject === null

  // Null suppresses the fetch entirely. The index needs no dataset, and a gallery dataset
  // is measured in megabytes, so arriving at the front door should not download one.
  const datasetUrl = showGalleryIndex
    ? null
    : activeSubject
      ? `/gallery/${activeSubject.dataset}`
      : LOCAL_DATASET_URL

  useEffect(() => {
    if (!manifestSettled || datasetUrl === null) return
    const controller = new AbortController()
    setDataset(null)
    setLoadError(null)
    fetch(datasetUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`${datasetUrl} returned ${response.status}`)
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
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => controller.abort()
  }, [manifestSettled, datasetUrl])

  const minConfidence = EVIDENCE_PRESETS[evidencePreset].threshold
  const confidenceFeatures = useMemo(() => {
    if (!dataset) return []
    return dataset.featureCandidates.filter((feature) => feature.confidence >= minConfidence)
  }, [dataset, minConfidence])
  const confidenceSemanticEpisodes = useMemo(
    () =>
      (dataset?.semanticEpisodes ?? []).filter((episode) => episode.confidence >= minConfidence),
    [dataset, minConfidence],
  )
  const stageFilteredFeatures = useMemo(() => {
    if (lifecycleStage === 'all') return confidenceFeatures
    const featureIds = new Set(
      confidenceSemanticEpisodes
        .filter((episode) => episode.lifecycleStage === lifecycleStage)
        .map((episode) => episode.featureId),
    )
    return confidenceFeatures.filter((feature) => featureIds.has(feature.id))
  }, [confidenceFeatures, confidenceSemanticEpisodes, lifecycleStage])
  const confidenceStructuralEpisodes = useMemo(
    () =>
      (dataset?.structuralEpisodes ?? []).filter(
        (episode) => episode.confidence >= minConfidence,
      ),
    [dataset, minConfidence],
  )

  const overviewStory = useMemo(
    () => (dataset ? buildStoryModel(dataset) : null),
    [dataset],
  )
  const baseStory = useMemo(
    () =>
      dataset
        ? buildStoryModel(
            dataset,
            stageFilteredFeatures,
            confidenceStructuralEpisodes,
            confidenceSemanticEpisodes,
          )
        : null,
    [
      confidenceSemanticEpisodes,
      confidenceStructuralEpisodes,
      dataset,
      stageFilteredFeatures,
    ],
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
    if (!dataset || !selectedChapter) return stageFilteredFeatures
    return stageFilteredFeatures.filter((feature) =>
      featureTouchesChapter(dataset, feature, selectedChapter, confidenceSemanticEpisodes),
    )
  }, [confidenceSemanticEpisodes, dataset, selectedChapter, stageFilteredFeatures])
  const visibleStructuralEpisodes = useMemo(() => {
    if (!dataset || !selectedChapter) return confidenceStructuralEpisodes
    return confidenceStructuralEpisodes.filter((structuralEpisode) =>
      structuralEpisodeTouchesChapter(dataset, structuralEpisode, selectedChapter),
    )
  }, [confidenceStructuralEpisodes, dataset, selectedChapter])
  const visibleFeatureIds = useMemo(
    () => new Set(visibleFeatures.map((feature) => feature.id)),
    [visibleFeatures],
  )
  const visibleSemanticEpisodes = useMemo(
    () => confidenceSemanticEpisodes.filter((episode) => visibleFeatureIds.has(episode.featureId)),
    [confidenceSemanticEpisodes, visibleFeatureIds],
  )
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
  const repositoryStory = useMemo(
    () =>
      dataset
        ? buildStoryModel(
            dataset,
            [],
            visibleStructuralEpisodes,
            [],
          )
        : null,
    [dataset, visibleStructuralEpisodes],
  )
  const repositoryAreaCount = useMemo(
    () =>
      dataset
        ? dataset.codeAreas.filter((area) => {
            if (!selectedChapter) return true
            const firstSeen = new Date(area.firstSeenAt).getTime()
            const lastSeen = new Date(area.lastSeenAt).getTime()
            return firstSeen <= selectedChapter.endTime && lastSeen >= selectedChapter.startTime
          }).length
        : 0,
    [dataset, selectedChapter],
  )
  const contributorTrail = useMemo(
    () =>
      dataset && selectedContributor
        ? buildContributorTrail(
            dataset,
            selectedContributor,
            visibleFeatures,
            selectedChapter,
            confidenceSemanticEpisodes,
          )
        : null,
    [
      confidenceSemanticEpisodes,
      dataset,
      selectedChapter,
      selectedContributor,
      visibleFeatures,
    ],
  )
  // The URL records the feature the user asked for; what it resolves to depends on the
  // filters in force, so a link that no longer matches degrades to the first result.
  const selectedFeature =
    visibleFeatures.find((feature) => feature.id === url.featureId) ?? visibleFeatures[0] ?? null
  const selectedEntity = useMemo(
    () => (dataset ? findEntity(dataset, selectedId, identityResolution) : null),
    [dataset, identityResolution, selectedId],
  )

  const handleSelect = (id: string) => {
    const feature = dataset?.featureCandidates.find((candidate) => candidate.id === id)
    const semantic = dataset?.semanticEpisodes?.find((candidate) => candidate.id === id)
    const contributor = dataset?.contributors.find((candidate) => candidate.id === id)
    const profile = identityResolution.profiles.find((candidate) => candidate.id === id)

    if (contributor || profile) {
      const resolvedProfile = contributor
        ? identityResolution.profileByIdentityId.get(contributor.id)
        : profile
      const contributorId = resolvedProfile?.id ?? contributor?.id
      if (!contributorId) return
      setUrl({ section: 'people', contributorId, selectedId: contributorId })
      return
    }

    setUrl({
      selectedId: id,
      ...(feature ? { featureId: feature.id } : {}),
      ...(semantic ? { featureId: semantic.featureId } : {}),
    })
  }

  const handleSectionChange = (nextSection: AtlasSection) => {
    if (nextSection === 'features') {
      // No feature is written here: an unset `feature` already resolves to the first
      // visible one, and pinning it would put a choice in the link nobody made.
      setUrl({ section: nextSection, selectedId: null })
      return
    }
    if (nextSection === 'people') {
      // Carry the current feature's context across, so People opens on someone relevant.
      const contextualContributor = selectedFeature
        ? deriveFeatureAssociations(dataset!, selectedFeature).contributors.find(
            (contributor) => !contributor.isBot,
          )
        : null
      const contributor = contextualContributor ?? selectedContributor
      const resolved = contributor
        ? identityResolution.profileByIdentityId.get(contributor.id) ?? contributor
        : null
      setUrl({
        section: nextSection,
        ...(resolved ? { contributorId: resolved.id, selectedId: resolved.id } : {}),
      })
      return
    }
    setUrl({ section: nextSection })
  }

  const handleSelectFeature = (id: string) => {
    setUrl({ featureId: id, selectedId: null })
  }

  const handleViewAllFeatureEvidence = (id: string) => {
    setUrl({ featureId: id, selectedId: id })
  }

  const handleExploreFeature = (id: string) => {
    setUrl({ section: 'features', chapterId: null, featureId: id, selectedId: null })
  }

  const handleExploreStage = (stage: LifecycleStage) => {
    const featureId = confidenceSemanticEpisodes.find(
      (episode) => episode.lifecycleStage === stage,
    )?.featureId
    setUrl({
      section: 'features',
      chapterId: null,
      lifecycleStage: stage,
      selectedId: null,
      ...(featureId ? { featureId } : {}),
    })
  }

  const handleInspectStructure = (id: string) => {
    setUrl({ section: 'repository', chapterId: null, selectedId: id })
  }

  const handleContributorChange = (id: string) => {
    setUrl({ contributorId: id, selectedId: id })
  }

  // Filters replace the current entry: toggling through presets should not bury the view
  // the user arrived from under a dozen history steps.
  const handleSelectChapter = (id: string | null) => {
    setUrl({ chapterId: id }, { replace: true })
  }

  const handleLifecycleStage = (stage: LifecycleStage | 'all') => {
    setUrl({ lifecycleStage: stage }, { replace: true })
  }

  const handleEvidencePreset = (preset: EvidencePreset) => {
    setUrl({ evidencePreset: preset }, { replace: true })
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
    setUrl({ section: 'people', contributorId: profile.id, selectedId: profile.id })
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

  // The index is the gallery's entry point, so it renders before the dataset guard below —
  // there is no dataset to wait for.
  if (showGalleryIndex && manifest) {
    return (
      <GalleryIndex
        subjects={manifest.subjects}
        onSelectSubject={(slug) => setUrl({ ...DEFAULT_URL_STATE, subject: slug })}
      />
    )
  }

  if (!dataset || !overviewStory || !baseStory || !story || !repositoryStory) {
    return (
      <main className="load-state">
        <p className="brand-mark">EVOLUTION ATLAS</p>
        {loadError ? (
          <div className="load-card">
            <span className="eyebrow">{manifest ? 'Gallery dataset missing' : 'Local dataset needed'}</span>
            <h1>Map a committed history.</h1>
            {manifest ? (
              <>
                <p>This gallery subject has no dataset yet. Rebuild it, then reload.</p>
                <code>npm run gallery -- --only {activeSubject?.slug ?? '&lt;slug&gt;'}</code>
              </>
            ) : (
              <>
                <p>Generate the ignored local dataset, then reload the page.</p>
                <code>npm run analyze -- --repo . --out public/atlas.json</code>
              </>
            )}
            <small>{loadError}</small>
          </div>
        ) : (
          <p>Loading repository evidence…</p>
        )}
      </main>
    )
  }

  return (
    <main className={`app-shell app-shell--product${section === 'features' ? ' app-shell--features' : ''}`}>
      <header ref={productHeaderRef} className="product-header">
        <button
          type="button"
          className="product-brand"
          onClick={() =>
            manifest
              ? setUrl({ ...DEFAULT_URL_STATE, subject: null })
              : handleSectionChange('overview')
          }
          title={manifest ? 'Back to the gallery' : 'Repository overview'}
        >
          <span className="brand-mark">EVOLUTION ATLAS</span>
          <strong>{dataset.repository.name}</strong>
        </button>

        {manifest && manifest.subjects.length > 1 && activeSubject && (
          <label className="product-subject">
            <span className="visually-hidden">Repository</span>
            <select
              value={activeSubject.slug}
              onChange={(event) =>
                // Navigation coordinates belong to the previous subject; drop them.
                setUrl({
                  ...DEFAULT_URL_STATE,
                  subject: event.target.value,
                  section,
                })
              }
            >
              {manifest.subjects.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.title}
                  {entry.interpreted ? '' : ' (observed only)'}
                </option>
              ))}
            </select>
          </label>
        )}

        <nav className="product-nav" aria-label="Primary navigation">
          <button
            type="button"
            className={section === 'overview' ? 'is-active' : ''}
            aria-current={section === 'overview' ? 'page' : undefined}
            onClick={() => handleSectionChange('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={section === 'repository' ? 'is-active' : ''}
            aria-current={section === 'repository' ? 'page' : undefined}
            onClick={() => handleSectionChange('repository')}
          >
            Repository
          </button>
          <button
            type="button"
            className={section === 'features' ? 'is-active' : ''}
            aria-current={section === 'features' ? 'page' : undefined}
            onClick={() => handleSectionChange('features')}
          >
            Features
          </button>
          <button
            type="button"
            className={section === 'people' ? 'is-active' : ''}
            aria-current={section === 'people' ? 'page' : undefined}
            onClick={() => handleSectionChange('people')}
          >
            People
          </button>
        </nav>

        <div className="product-utilities">
          <button
            type="button"
            className={section === 'identity' ? 'is-active' : ''}
            onClick={() => handleSectionChange('identity')}
          >
            Manage identities
            {identityResolution.suggestedCount > 0 && <span>{identityResolution.suggestedCount}</span>}
          </button>
          <div className="repository-meta">
            <span>{dataset.repository.ref}</span>
            <code>{dataset.repository.headSha.slice(0, 8)}</code>
          </div>
        </div>
      </header>

      {section === 'overview' ? (
        <RepositoryOverview
          dataset={dataset}
          story={overviewStory}
          selectedChapterId={selectedChapterId}
          onSelectChapter={handleSelectChapter}
          onExplore={() => handleSectionChange('features')}
          onExploreFeature={handleExploreFeature}
          onExploreStage={handleExploreStage}
          onInspect={handleInspectStructure}
        />
      ) : section === 'repository' ? (
        <>
          <header className="section-header">
            <div>
              <span className="eyebrow">Repository history</span>
              <h1>See how the codebase changed shape.</h1>
            </div>
            <span className="candidate-key">Observed activity with candidate structure overlays</span>
          </header>
          <ScopeControls
            chapters={baseStory.chapters}
            selectedChapterId={selectedChapterId}
            onSelectChapter={handleSelectChapter}
            lifecycleStage={lifecycleStage}
            onLifecycleStage={handleLifecycleStage}
            evidencePreset={evidencePreset}
            onEvidencePreset={handleEvidencePreset}
            resultLabel={`${repositoryAreaCount} observed code areas · ${repositoryStory.structuralEvents.length} candidate reorganizations`}
            showLifecycle={false}
          />
          <section className="repository-workspace">
            <RepositoryTimeMachine
              dataset={dataset}
              story={repositoryStory}
              selectedId={selectedId}
              selectedChapterId={selectedChapterId}
              onSelect={handleSelect}
              inspector={
                <div className="inspector-panel inspector-panel--sticky">
                  <EvidencePanel entity={selectedEntity} dataset={dataset} onSelect={handleSelect} />
                </div>
              }
            />
          </section>
        </>
      ) : section === 'features' ? (
        <>
          <ScopeControls
            title="Feature stories"
            help={{
              lede: 'Pick a candidate, follow its lifecycle, then inspect the commits behind each claim.',
              boundary: 'Feature groupings and lifecycle labels are candidate interpretations, not established facts. Contributor counts describe Git authorship, not ownership or performance.',
            }}
            chapters={baseStory.chapters}
            selectedChapterId={selectedChapterId}
            onSelectChapter={handleSelectChapter}
            lifecycleStage={lifecycleStage}
            onLifecycleStage={handleLifecycleStage}
            evidencePreset={evidencePreset}
            onEvidencePreset={handleEvidencePreset}
            resultLabel={`${visibleFeatures.length} matching features`}
          />
          <section className="explore-workspace">
            <FeatureExplorer
              dataset={dataset}
              story={story}
              visibleFeatures={visibleFeatures}
              selectedFeature={selectedFeature}
              selectedId={selectedId}
              selectedChapterId={selectedChapterId}
              selectedLifecycleStage={lifecycleStage}
              onSelect={handleSelect}
              onSelectFeature={handleSelectFeature}
              onViewAllEvidence={handleViewAllFeatureEvidence}
              inspector={
                <div className="inspector-panel inspector-panel--sticky">
                  <EvidencePanel entity={selectedEntity} dataset={dataset} onSelect={handleSelect} />
                </div>
              }
            />
          </section>
        </>
      ) : section === 'people' ? (
        <>
          <header className="section-header people-header">
            <div>
              <span className="eyebrow">People in repository context</span>
              <h1>Trace authored evidence without turning it into a score.</h1>
            </div>
            <label className="people-picker">
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
          </header>
          <ScopeControls
            chapters={baseStory.chapters}
            selectedChapterId={selectedChapterId}
            onSelectChapter={handleSelectChapter}
            lifecycleStage={lifecycleStage}
            onLifecycleStage={handleLifecycleStage}
            evidencePreset={evidencePreset}
            onEvidencePreset={handleEvidencePreset}
            resultLabel={`${contributorTrail?.authoredEpisodes.length ?? 0} authored commits in scope`}
          />
          <section className="people-workspace">
            <div className="people-primary">
              {contributorTrail ? (
                <ContributorTrail
                  model={contributorTrail}
                  selectedId={selectedId}
                  selectedChapterId={selectedChapterId}
                  onSelect={handleSelect}
                />
              ) : (
                <div className="empty-state">No contributor profile is available.</div>
              )}
            </div>
            <aside className="inspector-panel inspector-panel--sticky">
              <EvidencePanel entity={selectedEntity} dataset={dataset} onSelect={handleSelect} />
            </aside>
          </section>
        </>
      ) : (
        <section className="identity-workspace utility-workspace">
          <header className="section-header">
            <div>
              <span className="eyebrow">Data management</span>
              <h1>Confirm which Git identities belong together.</h1>
            </div>
            <button type="button" className="quiet-action" onClick={() => handleSectionChange('people')}>
              Back to people
            </button>
          </header>
          <IdentityReview
            dataset={dataset}
            resolution={identityResolution}
            decisions={activeIdentityDecisions}
            onDecision={handleIdentityDecision}
            onImport={handleIdentityImport}
            onOpenContributor={handleOpenContributor}
          />
        </section>
      )}
    </main>
  )
}
