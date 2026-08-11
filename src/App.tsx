import { useEffect, useMemo, useState } from 'react'

import { AtlasGraph } from './AtlasGraph'
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
  return (
    <div className="inspector-content">
      <span className="eyebrow">{feature.status} feature</span>
      <h2>{feature.label}</h2>
      <dl>
        <div><dt>Confidence</dt><dd>{Math.round(feature.confidence * 100)}%</dd></div>
        <div><dt>Method</dt><dd>{feature.method}</dd></div>
        <div><dt>Lifecycle</dt><dd>{feature.lifecycleStage ?? 'Not assigned'}</dd></div>
      </dl>
      <p className="boundary-note">This is an interpretation. Inspect its evidence before accepting it.</p>
    </div>
  )
}

export default function App() {
  const [dataset, setDataset] = useState<AtlasDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cutoffIndex, setCutoffIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/atlas.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`atlas.json returned ${response.status}`)
        return response.json() as Promise<AtlasDataset>
      })
      .then((loadedDataset) => {
        setDataset(loadedDataset)
        setCutoffIndex(Math.max(loadedDataset.episodes.length - 1, 0))
        setSelectedId(loadedDataset.episodes.at(-1)?.id ?? null)
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

  if (!dataset) {
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

  const cutoffEpisode = dataset.episodes[cutoffIndex]

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
        <div><strong>{Math.min(cutoffIndex + 1, dataset.episodes.length)}</strong><span>visible changes</span></div>
        <div><strong>{dataset.contributors.length}</strong><span>Git authors</span></div>
        <div><strong>{dataset.codeAreas.length}</strong><span>path areas</span></div>
        <div><strong>{dataset.featureCandidates.length}</strong><span>feature candidates</span></div>
      </section>

      <section className="timeline-control">
        <div>
          <span className="eyebrow">History cutoff</span>
          <strong>{cutoffEpisode ? formatDate(cutoffEpisode.authoredAt) : 'No commits'}</strong>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(dataset.episodes.length - 1, 0)}
          value={cutoffIndex}
          disabled={dataset.episodes.length < 2}
          aria-label="History cutoff"
          onChange={(event) => {
            setCutoffIndex(Number(event.target.value))
            setSelectedId(dataset.episodes[Number(event.target.value)]?.id ?? null)
          }}
        />
        <span className="cutoff-subject">{cutoffEpisode?.subject ?? 'No committed history'}</span>
      </section>

      <section className="workspace-grid">
        <div className="map-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Repository projection</span>
              <h2>Observed relationships over time</h2>
            </div>
            <div className="legend" aria-label="Node legend">
              <span className="legend-contributor">Author</span>
              <span className="legend-episode">Change</span>
              <span className="legend-area">Area</span>
            </div>
          </div>
          <AtlasGraph
            dataset={dataset}
            cutoffIndex={cutoffIndex}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <p className="map-footnote">
            Feature inference is off. Nodes currently represent Git observations and provisional path groupings.
          </p>
        </div>

        <aside className="inspector-panel">
          <EvidencePanel entity={selectedEntity} dataset={dataset} />
        </aside>
      </section>
    </main>
  )
}
