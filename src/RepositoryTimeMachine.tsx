import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { AtlasDataset } from './model'
import type { StoryModel } from './story'
import {
  buildRepositoryTimeMachine,
  type RepositoryCheckpoint,
} from './repositorySnapshots'
import { buildRepositoryShape, scopeBreadcrumb, scopeLabel } from './directoryLifespans'
import { RepositoryShape } from './RepositoryShape'

interface RepositoryTimeMachineProps {
  dataset: AtlasDataset
  story: StoryModel
  selectedId: string | null
  selectedChapterId: string | null
  onSelect: (id: string) => void
  inspector: ReactNode
}

const VISIBLE_PATH_COUNT = 18

function checkpointContainsId(checkpoint: RepositoryCheckpoint, id: string | null) {
  if (!id) return false
  if (checkpoint.id === id || checkpoint.episode.id === id) return true
  return checkpoint.structuralEpisodes.some((episode) => episode.id === id)
}

const formatDate = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}).format

function formatDateValue(value: string) {
  return formatDate(new Date(value))
}

export function RepositoryTimeMachine({
  dataset,
  story,
  selectedId,
  selectedChapterId,
  onSelect,
  inspector,
}: RepositoryTimeMachineProps) {
  const [scopePath, setScopePath] = useState('')

  const model = useMemo(
    () => buildRepositoryTimeMachine(dataset, story, scopePath),
    [dataset, story, scopePath],
  )
  const shape = useMemo(
    () => buildRepositoryShape(dataset, story, scopePath),
    [dataset, story, scopePath],
  )

  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.max(model.checkpoints.length - 1, 0),
  )
  const [panelMode, setPanelMode] = useState<'summary' | 'evidence'>('summary')
  const [showAllPaths, setShowAllPaths] = useState(false)

  const boundedSelectedIndex = Math.min(
    selectedIndex,
    Math.max(model.checkpoints.length - 1, 0),
  )
  const checkpoint = model.checkpoints[boundedSelectedIndex] ?? model.checkpoints[0]

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(model.checkpoints.length - 1, 0)),
    )
  }, [model.checkpoints.length])

  useEffect(() => {
    const matchingIndex = model.checkpoints.findIndex((entry) =>
      checkpointContainsId(entry, selectedId),
    )
    if (matchingIndex >= 0) setSelectedIndex(matchingIndex)
  }, [model.checkpoints, selectedId])

  useEffect(() => {
    if (!selectedChapterId) return
    const chapter = story.chapters.find((entry) => entry.id === selectedChapterId)
    if (!chapter) return
    const matchingIndex = model.checkpoints.findIndex((entry) => {
      const time = new Date(entry.episode.authoredAt).getTime()
      return time >= chapter.startTime && time <= chapter.endTime
    })
    if (matchingIndex >= 0) {
      setSelectedIndex(matchingIndex)
      setPanelMode('summary')
    }
  }, [model.checkpoints, selectedChapterId, story.chapters])

  useEffect(() => {
    setShowAllPaths(false)
  }, [boundedSelectedIndex, scopePath])

  // The chart snaps hover and clicks to these positions, so it needs the same list.
  const shapeCheckpoints = useMemo(
    () =>
      model.checkpoints.map((entry) => ({
        percent: entry.percent,
        label: formatDateValue(entry.episode.authoredAt),
      })),
    [model.checkpoints],
  )

  if (!checkpoint) {
    return <div className="empty-state">No repository checkpoints are available.</div>
  }

  const selectCheckpoint = (index: number) => {
    const nextIndex = Math.max(0, Math.min(model.checkpoints.length - 1, index))
    setSelectedIndex(nextIndex)
    setPanelMode('summary')
  }
  const selectNearestCheckpoint = (percent: number) => {
    let nearest = 0
    let smallest = Number.POSITIVE_INFINITY
    model.checkpoints.forEach((entry, index) => {
      const distance = Math.abs(entry.percent - percent)
      if (distance < smallest) {
        smallest = distance
        nearest = index
      }
    })
    selectCheckpoint(nearest)
  }
  const inspectEvidence = (id: string) => {
    onSelect(id)
    setPanelMode('evidence')
  }
  const changeScope = (nextScope: string) => {
    setScopePath(nextScope)
    setPanelMode('summary')
  }

  const totalVisibleFiles = Math.max(
    checkpoint.nodes.reduce((sum, node) => sum + node.fileCount, 0),
    1,
  )
  const crumbs = scopeBreadcrumb(scopePath)
  const visiblePaths = showAllPaths
    ? checkpoint.changes.paths
    : checkpoint.changes.paths.slice(0, VISIBLE_PATH_COUNT)
  const hiddenPathCount = checkpoint.changes.paths.length - visiblePaths.length

  return (
    <div className="time-machine">
      <header className="time-machine__header">
        <div>
          <span className="eyebrow">Directory lifespans</span>
          <h2>How {scopeLabel(scopePath)} changed shape</h2>
          <p>
            {shape.tracks.length} observed director
            {shape.tracks.length === 1 ? 'y' : 'ies'} ·{' '}
            {shape.filesInScopeAtEnd.toLocaleString()} files at the end of the range ·{' '}
            {shape.transitions.length} candidate path transition
            {shape.transitions.length === 1 ? '' : 's'} in view
          </p>
        </div>
        <nav className="scope-breadcrumb" aria-label="Repository scope">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path || 'root'}>
              {index > 0 && <i aria-hidden="true">/</i>}
              <button
                type="button"
                disabled={crumb.path === scopePath}
                aria-current={crumb.path === scopePath ? 'true' : undefined}
                onClick={() => changeScope(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <RepositoryShape
        model={shape}
        selectedId={selectedId}
        playheadPercent={checkpoint.percent}
        playheadLabel={formatDateValue(checkpoint.episode.authoredAt)}
        checkpoints={shapeCheckpoints}
        onSelectPercent={selectNearestCheckpoint}
        onSelectStructural={inspectEvidence}
        onScopeChange={changeScope}
      />

      {shape.hiddenTrackCount > 0 && (
        <p className="boundary-note boundary-note--inline">
          {shape.hiddenTrackCount} smaller director
          {shape.hiddenTrackCount === 1 ? 'y is' : 'ies are'} combined into one row. Bands
          are observed file counts; transitions and reorganizations remain candidate
          interpretations.
        </p>
      )}

      <div className="time-machine__detail">
        <section
          className="snapshot-canvas"
          aria-label={`Structure at ${formatDateValue(checkpoint.episode.authoredAt)}`}
        >
          <div className="snapshot-canvas__heading">
            <div>
              <span className="eyebrow">Structure at this checkpoint</span>
              <strong>{checkpoint.totalFiles.toLocaleString()} observed files</strong>
            </div>
            <span>
              {formatDateValue(checkpoint.episode.authoredAt)} · commit{' '}
              <code>{checkpoint.episode.shortSha}</code>
            </span>
          </div>

          <div className="snapshot-tree">
            {checkpoint.nodes.map((node) => (
              <article
                key={`${node.path}:${node.label}`}
                className="snapshot-node"
                style={{
                  '--snapshot-weight': Math.max(
                    0.35,
                    Math.min(
                      3.5,
                      (node.fileCount / totalVisibleFiles) * checkpoint.nodes.length,
                    ),
                  ).toFixed(2),
                } as CSSProperties}
              >
                <header>
                  <strong>{node.label}</strong>
                  <span>{node.fileCount.toLocaleString()}</span>
                </header>
                <div className="snapshot-node__children">
                  {node.children.map((child) => (
                    <div key={`${child.path}:${child.label}`}>
                      <span>{child.label}</span>
                      <i
                        aria-hidden="true"
                        style={{
                          width: `${Math.max(5, (child.fileCount / node.fileCount) * 100)}%`,
                        }}
                      />
                      <small>{child.fileCount}</small>
                    </div>
                  ))}
                </div>
                {node.groupedPathCount && (
                  <small>{node.groupedPathCount} smaller directories grouped</small>
                )}
              </article>
            ))}
          </div>
        </section>

        <aside className="checkpoint-panel" aria-label="Checkpoint detail">
          {panelMode === 'evidence' ? (
            <>
              <button
                type="button"
                className="checkpoint-panel__back"
                onClick={() => setPanelMode('summary')}
              >
                ← Back to checkpoint
              </button>
              <div className="checkpoint-panel__evidence">{inspector}</div>
            </>
          ) : (
            <>
              {/* Anchored above the heading: checkpoint labels wrap to different heights,
                  so a pager below them would move under the pointer between clicks. */}
              <div className="time-machine__navigation" aria-label="Checkpoint navigation">
                <button
                  type="button"
                  disabled={boundedSelectedIndex === 0}
                  onClick={() => selectCheckpoint(boundedSelectedIndex - 1)}
                >
                  ← Previous
                </button>
                <span>
                  {boundedSelectedIndex + 1} / {model.checkpoints.length}
                </span>
                <button
                  type="button"
                  disabled={boundedSelectedIndex === model.checkpoints.length - 1}
                  onClick={() => selectCheckpoint(boundedSelectedIndex + 1)}
                >
                  Next →
                </button>
              </div>

              <div className="checkpoint-panel__heading">
                <span className="eyebrow">
                  {boundedSelectedIndex === 0
                    ? 'At initial checkpoint'
                    : 'Since previous checkpoint'}
                </span>
                <h3>{checkpoint.label}</h3>
                <p>
                  {checkpoint.changes.commitCount} observed commit
                  {checkpoint.changes.commitCount === 1 ? '' : 's'} touching{' '}
                  {scopeLabel(scopePath)} in this interval.
                </p>
              </div>

              <div className="checkpoint-stats" aria-label="Observed path operations">
                <div><strong>{checkpoint.changes.added}</strong><span>added</span></div>
                <div><strong>{checkpoint.changes.moved}</strong><span>moved</span></div>
                <div><strong>{checkpoint.changes.removed}</strong><span>removed</span></div>
                <div><strong>{checkpoint.changes.modified}</strong><span>modified</span></div>
              </div>

              {checkpoint.structuralEpisodes.length > 0 ? (
                <section className="checkpoint-section checkpoint-section--structure">
                  <span className="eyebrow">Candidate reorganization</span>
                  {checkpoint.structuralEpisodes.map((episode) => (
                    <article key={episode.id}>
                      <div>
                        <strong>{episode.label}</strong>
                        <small>{Math.round(episode.confidence * 100)}% confidence</small>
                      </div>
                      <ul>
                        {episode.mappings.map((mapping) => (
                          <li key={`${mapping.fromPrefix}:${mapping.toPrefix}`}>
                            <code>{mapping.fromPrefix || '(root)'}</code>
                            <span>→</span>
                            <code>{mapping.toPrefix || '(root)'}</code>
                            <small>{mapping.fileCount} files</small>
                          </li>
                        ))}
                      </ul>
                      <button type="button" onClick={() => inspectEvidence(episode.id)}>
                        Inspect reorganization evidence
                      </button>
                    </article>
                  ))}
                </section>
              ) : (
                <section className="checkpoint-section">
                  <span className="eyebrow">Repository state</span>
                  <p>No candidate reorganization is attached to this checkpoint.</p>
                </section>
              )}

              <details className="checkpoint-paths">
                <summary>
                  Changed paths in this interval
                  <span>{checkpoint.changes.paths.length.toLocaleString()}</span>
                </summary>
                <ul>
                  {visiblePaths.map((path) => (
                    <li key={path}><code>{path}</code></li>
                  ))}
                </ul>
                {hiddenPathCount > 0 && (
                  <button
                    type="button"
                    className="checkpoint-paths__more"
                    onClick={() => setShowAllPaths(true)}
                  >
                    Show {hiddenPathCount.toLocaleString()} more path
                    {hiddenPathCount === 1 ? '' : 's'}
                  </button>
                )}
              </details>

              <button
                type="button"
                className="checkpoint-commit"
                onClick={() => inspectEvidence(checkpoint.episode.id)}
              >
                <span>Checkpoint commit</span>
                <strong>{checkpoint.episode.subject}</strong>
                <code>{checkpoint.episode.shortSha}</code>
              </button>

              <p className="boundary-note">
                Bands and counts reconstruct observed paths from Git change records.
                Reorganization labels remain candidate interpretations and do not claim
                architectural intent.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
