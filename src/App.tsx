import { useEffect, useMemo, useState } from 'react'

import { AtlasGraph } from './AtlasGraph'
import {
  LIFECYCLE_STAGES,
  defaultControls,
  selectVisible,
  type ViewControls,
} from './derive'
import type {
  AtlasDataset,
  ChangeEpisode,
  CodeArea,
  Contributor,
  FeatureCandidate,
} from './model'

type SelectedEntity =
  | { kind: 'episode'; value: ChangeEpisode }
  | { kind: 'contributor'; value: Contributor }
  | { kind: 'area'; value: CodeArea }
  | { kind: 'feature'; value: FeatureCandidate }

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function findEntity(dataset: AtlasDataset, id: string | null): SelectedEntity | null {
  if (!id) return null
  const episode = dataset.episodes.find((candidate) => candidate.id === id)
  if (episode) return { kind: 'episode', value: episode }
  const contributor = dataset.contributors.find((candidate) => candidate.id === id)
  if (contributor) return { kind: 'contributor', value: contributor }
  const area = dataset.codeAreas.find((candidate) => candidate.id === id)
  if (area) return { kind: 'area', value: area }
  const feature = dataset.featureCandidates.find((candidate) => candidate.id === id)
  if (feature) return { kind: 'feature', value: feature }
  return null
}

function EvidencePanel({ entity, dataset }: { entity: SelectedEntity | null; dataset: AtlasDataset }) {
  if (!entity) {
    return (
      <div className="inspector-placeholder">
        <span>Evidence inspector</span>
        <p>Select a node to inspect the Git observations behind it.</p>
      </div>
    )
  }

  if (entity.kind === 'episode') {
    const episode = entity.value
    return (
      <div className="inspector-content">
        <span className="eyebrow">Observed change episode</span>
        <h2>{episode.subject}</h2>
        <dl>
          <div><dt>Commit</dt><dd><code>{episode.shortSha}</code></dd></div>
          <div><dt>Authored</dt><dd>{formatDate(episode.authoredAt)}</dd></div>
          <div><dt>Parents</dt><dd>{episode.parentShas.length || 'Root commit'}</dd></div>
        </dl>
        <h3>Changed paths</h3>
        {episode.changes.length > 0 ? (
          <ul className="path-list">
            {episode.changes.map((change, index) => (
              <li key={`${change.path}:${index}`}>
                <span className="change-status">{change.status}</span>
                <code>{change.previousPath ? `${change.previousPath} → ${change.path}` : change.path}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p>No first-parent path changes were emitted for this commit.</p>
        )}
      </div>
    )
  }

  if (entity.kind === 'contributor') {
    const contributor = entity.value
    const episodeCount = dataset.episodes.filter((episode) =>
      episode.contributorIds.includes(contributor.id),
    ).length
    return (
      <div className="inspector-content">
        <span className="eyebrow">Git author association</span>
        <h2>{contributor.displayName}</h2>
        <dl>
          <div><dt>Authored commits</dt><dd>{episodeCount}</dd></div>
          <div><dt>First seen</dt><dd>{formatDate(contributor.firstSeenAt)}</dd></div>
          <div><dt>Last seen</dt><dd>{formatDate(contributor.lastSeenAt)}</dd></div>
        </dl>
        {contributor.aliases.length > 1 && <p>Observed aliases: {contributor.aliases.join(', ')}</p>}
        <p className="boundary-note">
          Git authorship is an association, not complete feature ownership or a performance measure.
        </p>
      </div>
    )
  }

  if (entity.kind === 'area') {
    const area = entity.value
    const episodeCount = dataset.episodes.filter((episode) =>
      episode.codeAreaIds.includes(area.id),
    ).length
    return (
      <div className="inspector-content">
        <span className="eyebrow">Provisional code area</span>
        <h2>{area.label}</h2>
        <dl>
          <div><dt>Classification</dt><dd>Top-level path</dd></div>
          <div><dt>Associated commits</dt><dd>{episodeCount}</dd></div>
          <div><dt>Path prefix</dt><dd><code>{area.pathPrefix || '(repository root)'}</code></dd></div>
        </dl>
        <p className="boundary-note">
          This structural grouping is observed from paths; it is not yet an architectural component claim.
        </p>
      </div>
    )
  }

  const feature = entity.value
  const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
  const contributorCounts = new Map<string, number>()
  for (const reference of feature.evidence) {
    for (const id of episodeBySha.get(reference.commitSha)?.contributorIds ?? []) {
      contributorCounts.set(id, (contributorCounts.get(id) ?? 0) + 1)
    }
  }
  const nameById = new Map(dataset.contributors.map((c) => [c.id, c.displayName]))

  return (
    <div className="inspector-content">
      <span className="eyebrow">{feature.status} feature</span>
      <h2>{feature.label}</h2>
      <dl>
        <div><dt>Confidence</dt><dd>{Math.round(feature.confidence * 100)}%</dd></div>
        <div><dt>Lifecycle</dt><dd>{feature.lifecycleStage ?? 'Not assigned'}</dd></div>
        <div><dt>Supporting commits</dt><dd>{feature.evidence.length}</dd></div>
        <div><dt>Method</dt><dd><code>{feature.method}</code></dd></div>
      </dl>

      {feature.rationale && <p className="rationale">{feature.rationale}</p>}

      <h3>Contributors</h3>
      <ul className="chip-list">
        {[...contributorCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([id, count]) => (
            <li key={id}>{nameById.get(id) ?? id}<span>{count}</span></li>
          ))}
      </ul>

      <h3>Evidence</h3>
      <ul className="path-list">
        {feature.evidence.map((reference) => {
          const episode = episodeBySha.get(reference.commitSha)
          return (
            <li key={reference.commitSha}>
              <span className="change-status">{episode?.shortSha.slice(0, 7) ?? '???????'}</span>
              <code>{episode?.subject ?? 'Commit not present in this dataset'}</code>
            </li>
          )
        })}
      </ul>

      <p className="boundary-note">
        This grouping is an interpretation produced by a model. The commits, their authors, and
        the areas they touched are observed; that they form one capability is not.
      </p>
    </div>
  )
}

export default function App() {
  const [dataset, setDataset] = useState<AtlasDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [controls, setControls] = useState<ViewControls | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function update(patch: Partial<ViewControls>) {
    setControls((current) => (current ? { ...current, ...patch } : current))
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch('/atlas.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`atlas.json returned ${response.status}`)
        return response.json() as Promise<AtlasDataset>
      })
      .then((loadedDataset) => {
        setDataset(loadedDataset)
        setControls(defaultControls(loadedDataset))
        setSelectedId(null)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => controller.abort()
  }, [])

  const selectedEntity = useMemo(
    () => (dataset ? findEntity(dataset, selectedId) : null),
    [dataset, selectedId],
  )

  const visible = useMemo(
    () => (dataset && controls ? selectVisible(dataset, controls) : null),
    [dataset, controls],
  )

  if (!dataset || !controls || !visible) {
    return (
      <main className="load-state">
        <p className="brand-mark">EVOLUTION ATLAS</p>
        {loadError ? (
          <div className="load-card">
            <span className="eyebrow">Local dataset needed</span>
            <h1>Map a committed history.</h1>
            <p>
              Generate the ignored local dataset, then reload the page. The viewer never reads your
              repository directly.
            </p>
            <code>npm run analyze -- --repo . --out public/atlas.json</code>
            <small>{loadError}</small>
          </div>
        ) : (
          <p>Loading repository evidence…</p>
        )}
      </main>
    )
  }

  const cutoffEpisode = dataset.episodes[controls.cutoffIndex]

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="brand-mark">EVOLUTION ATLAS / OBSERVED HISTORY</p>
          <h1>{dataset.repository.name}</h1>
          <p className="subtitle">
            An evidence-linked map of how this repository changed—without guessing why.
          </p>
        </div>
        <div className="repository-meta">
          <span>{dataset.repository.ref}</span>
          <code>{dataset.repository.headSha.slice(0, 8)}</code>
          <span>schema {dataset.schemaVersion}</span>
        </div>
      </header>

      <section className="stats" aria-label="Dataset summary">
        <div><strong>{visible.features.length}</strong><span>features shown</span></div>
        <div><strong>{visible.contributorIds.size}</strong><span>contributors shown</span></div>
        <div><strong>{visible.codeAreaIds.size}</strong><span>areas touched</span></div>
        <div><strong>{Math.min(controls.cutoffIndex + 1, dataset.episodes.length)}</strong><span>commits in range</span></div>
      </section>

      <section className="controls" aria-label="View controls">
        <div className="control">
          <span className="eyebrow">History cutoff</span>
          <input
            type="range"
            min="0"
            max={Math.max(dataset.episodes.length - 1, 0)}
            value={controls.cutoffIndex}
            disabled={dataset.episodes.length < 2}
            aria-label="History cutoff"
            onChange={(event) => update({ cutoffIndex: Number(event.target.value) })}
          />
          <small>{cutoffEpisode ? formatDate(cutoffEpisode.authoredAt) : 'No commits'}</small>
        </div>

        <div className="control">
          <span className="eyebrow">Minimum confidence</span>
          <input
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={controls.minConfidence}
            aria-label="Minimum confidence"
            onChange={(event) => update({ minConfidence: Number(event.target.value) })}
          />
          <small>
            {controls.minConfidence === 0
              ? 'Showing every candidate'
              : `${Math.round(controls.minConfidence * 100)}% and above`}
            {visible.hiddenByConfidence > 0 && ` · ${visible.hiddenByConfidence} hidden`}
          </small>
        </div>

        <div className="control">
          <span className="eyebrow">Contributor</span>
          <select
            value={controls.contributorId ?? ''}
            aria-label="Filter by contributor"
            onChange={(event) => update({ contributorId: event.target.value || null })}
          >
            <option value="">Everyone</option>
            {dataset.contributors.map((contributor) => (
              <option key={contributor.id} value={contributor.id}>
                {contributor.displayName}
              </option>
            ))}
          </select>
          <small>
            {controls.contributorId
              ? `${visible.hiddenByContributor} feature(s) hidden`
              : 'All contributions in view'}
          </small>
        </div>

        <div className="control">
          <span className="eyebrow">Commit detail</span>
          <div className="toggle-row" role="group" aria-label="Commit detail">
            <button
              type="button"
              className={controls.detail === 'features' ? 'is-active' : ''}
              onClick={() => update({ detail: 'features' })}
            >
              Features only
            </button>
            <button
              type="button"
              className={controls.detail === 'commits' ? 'is-active' : ''}
              onClick={() => update({ detail: 'commits' })}
            >
              Show evidence
            </button>
          </div>
          <small>
            {controls.detail === 'commits'
              ? `${visible.episodes.length} supporting commits drawn`
              : 'Commits stay in the inspector'}
          </small>
        </div>

        <div className="control control--wide">
          <span className="eyebrow">Lifecycle stage</span>
          <div className="toggle-row" role="group" aria-label="Lifecycle stage">
            {LIFECYCLE_STAGES.map((stage) => {
              const active = controls.lifecycleStages.includes(stage)
              const present = dataset.featureCandidates.some((f) => f.lifecycleStage === stage)
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={!present}
                  title={present ? undefined : 'No candidate carries this stage'}
                  className={active ? 'is-active' : ''}
                  onClick={() =>
                    update({
                      lifecycleStages: active
                        ? controls.lifecycleStages.filter((value) => value !== stage)
                        : [...controls.lifecycleStages, stage],
                    })
                  }
                >
                  {stage}
                </button>
              )
            })}
            {controls.lifecycleStages.length > 0 && (
              <button type="button" className="is-reset" onClick={() => update({ lifecycleStages: [] })}>
                clear
              </button>
            )}
          </div>
          <small>
            {controls.lifecycleStages.length === 0
              ? 'Every stage, including unassigned'
              : `${visible.hiddenByStage} feature(s) hidden`}
          </small>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="map-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Repository projection</span>
              <h2>Who built what, over time</h2>
            </div>
            <div className="legend" aria-label="Node legend">
              <span className="legend-contributor">Author</span>
              <span className="legend-feature">Feature</span>
              {controls.detail === 'commits' && <span className="legend-episode">Commit</span>}
              <span className="legend-area">Area</span>
            </div>
          </div>
          <AtlasGraph
            dataset={dataset}
            visible={visible}
            controls={controls}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <p className="map-footnote">
            Features are candidate interpretations; authorship and touched areas are observed.
            Node size reflects how much evidence stands behind a claim, not its importance, and a
            fainter feature dot carries lower model confidence. Horizontal position is the commit
            date; crowding is resolved vertically so the time axis stays true.
          </p>
        </div>

        <aside className="inspector-panel">
          <EvidencePanel entity={selectedEntity} dataset={dataset} />
        </aside>
      </section>
    </main>
  )
}
