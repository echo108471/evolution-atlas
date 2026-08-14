import { LIFECYCLE_STAGES } from './lifecycle'
import type { StoryModel } from './story'

interface StoryLanesProps {
  model: StoryModel
  selectedId: string | null
  selectedChapterId: string | null
  onSelect: (id: string) => void
}

export function StoryLanes({ model, selectedId, selectedChapterId, onSelect }: StoryLanesProps) {
  if (model.lanes.length === 0 && model.structuralEvents.length === 0) {
    return <div className="empty-state">No candidate features or structural episodes match the current view.</div>
  }

  return (
    <div className="story-lanes">
      <div className="visual-legend visual-legend--lanes" aria-label="Timeline legend">
        {LIFECYCLE_STAGES.map((stage) => (
          <span key={stage}>
            <i className={`legend-mark legend-mark--${stage}`} />
            {stage}
          </span>
        ))}
        <span><i className="legend-mark legend-mark--commit" />cited commit</span>
        <span><i className="legend-mark legend-mark--structure" />reorganization</span>
      </div>
      <div className="story-axis story-grid">
        <span>Candidate episode or feature</span>
        <div className="story-axis__track" aria-hidden="true">
          {model.chapters.map((chapter) => (
            <span
              key={chapter.id}
              className={selectedChapterId === chapter.id ? 'is-selected' : ''}
              style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
            >
              {chapter.label}
            </span>
          ))}
        </div>
        <span>Evidence</span>
      </div>

      {model.structuralEvents.length > 0 && (
        <ol className="story-lanes__rows structural-lanes" aria-label="Candidate structural episodes">
          {model.structuralEvents.map((event) => (
            <li
              key={event.id}
              className={`story-grid story-lane structural-lane${selectedId === event.id ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                className="story-lane__label"
                onClick={() => onSelect(event.id)}
              >
                <span>{event.structuralEpisode.label}</span>
                <small>
                  structural reorganization · {Math.round(event.structuralEpisode.confidence * 100)}% confidence
                </small>
              </button>
              <div className="story-lane__track">
                {model.chapters.map((chapter) => (
                  <span
                    key={chapter.id}
                    className={`story-lane__chapter${selectedChapterId === chapter.id ? ' is-selected' : ''}`}
                    style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
                  />
                ))}
                <button
                  type="button"
                  className={`structural-event${selectedId === event.id ? ' is-selected' : ''}`}
                  style={{ left: `${event.percent}%` }}
                  aria-label={`${event.structuralEpisode.label}: ${event.episode.shortSha}`}
                  title={`${event.structuralEpisode.label} · ${event.episode.shortSha}`}
                  onClick={() => onSelect(event.id)}
                />
              </div>
              <span className="story-lane__count">{event.structuralEpisode.transitions.length}</span>
            </li>
          ))}
        </ol>
      )}

      <ol className={`story-lanes__rows${model.structuralEvents.length > 0 ? ' feature-lanes-after-structure' : ''}`}>
        {model.lanes.map((lane) => {
          const selected = selectedId === lane.feature.id
          const lifecycleSequence = lane.lifecycleEvents.map(
            (event) => event.semanticEpisode.lifecycleStage,
          )
          return (
            <li key={lane.feature.id} className={`story-grid story-lane${selected ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="story-lane__label"
                onClick={() => onSelect(lane.feature.id)}
              >
                <span>{lane.feature.label}</span>
                <small>
                  {lifecycleSequence.length > 0
                    ? lifecycleSequence.join(' → ')
                    : 'lifecycle unassigned'}{' '}
                  ·{' '}
                  {Math.round(lane.feature.confidence * 100)}% confidence
                </small>
              </button>

              <div className="story-lane__track">
                {model.chapters.map((chapter) => (
                  <span
                    key={chapter.id}
                    className={`story-lane__chapter${selectedChapterId === chapter.id ? ' is-selected' : ''}`}
                    style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
                  />
                ))}
                {lane.events.length > 1 && (
                  <span
                    className="evidence-span"
                    style={{
                      left: `${lane.startPercent}%`,
                      width: `${Math.max(lane.endPercent - lane.startPercent, 0.2)}%`,
                    }}
                  />
                )}
                {lane.events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`evidence-event${selectedId === event.id ? ' is-selected' : ''}`}
                    style={{
                      left: `${event.percent}%`,
                      transform: `translate(-50%, ${event.stack * 7 - 7}px)`,
                    }}
                    aria-label={`${event.episode.shortSha}: ${event.episode.subject}`}
                    title={`${event.episode.shortSha} · ${event.episode.subject}`}
                    onClick={() => onSelect(event.id)}
                  />
                ))}
                {lane.lifecycleEvents.map((event, index) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`lifecycle-event lifecycle-event--${event.semanticEpisode.lifecycleStage}${selectedId === event.id ? ' is-selected' : ''}`}
                    style={{
                      left: `${event.startPercent}%`,
                      width: `${Math.max(event.endPercent - event.startPercent, 0.7)}%`,
                      transform: `translateY(${(index % 3) * 7 - 7}px)`,
                    }}
                    aria-label={`${event.semanticEpisode.lifecycleStage}: ${event.semanticEpisode.label}`}
                    title={`${event.semanticEpisode.lifecycleStage} · ${event.semanticEpisode.label} · ${Math.round(event.semanticEpisode.confidence * 100)}% confidence`}
                    onClick={() => onSelect(event.id)}
                  />
                ))}
              </div>

              <span className="story-lane__count">{lane.events.length}</span>
            </li>
          )
        })}
      </ol>

      <details className="method-disclosure">
        <summary>How to read all timelines</summary>
        <p>
          Diamonds are candidate repository reorganizations grounded in path transitions. Dots are
          cited commits. Colored bars are candidate semantic lifecycle episodes and span only their
          cited evidence. Dashed lines are a visual index, not a claim of continuous development or
          a complete feature lifetime.
        </p>
      </details>
    </div>
  )
}
