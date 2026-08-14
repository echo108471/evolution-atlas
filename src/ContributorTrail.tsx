import type { ContributorTrailModel } from './story'

interface ContributorTrailProps {
  model: ContributorTrailModel
  selectedId: string | null
  selectedChapterId: string | null
  onSelect: (id: string) => void
}

function TimelineAxis({
  model,
  selectedChapterId,
  leftLabel,
  rightLabel,
}: {
  model: ContributorTrailModel
  selectedChapterId: string | null
  leftLabel: string
  rightLabel: string
}) {
  return (
    <div className="story-axis story-grid contributor-trail__axis">
      <span>{leftLabel}</span>
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
      <span>{rightLabel}</span>
    </div>
  )
}

function ChapterBands({
  model,
  selectedChapterId,
}: {
  model: ContributorTrailModel
  selectedChapterId: string | null
}) {
  return model.chapters.map((chapter) => (
    <span
      key={chapter.id}
      className={`story-lane__chapter${selectedChapterId === chapter.id ? ' is-selected' : ''}`}
      style={{ left: `${chapter.startPercent}%`, width: `${chapter.widthPercent}%` }}
    />
  ))
}

export function ContributorTrail({
  model,
  selectedId,
  selectedChapterId,
  onSelect,
}: ContributorTrailProps) {
  return (
    <div className="contributor-trail">
      <section className="contributor-trail__identity" aria-label="Selected contributor">
        <div>
          <span className="eyebrow">Contributor trail</span>
          <h3>{model.contributor.displayName}</h3>
          <p>
            {model.contributor.identityIds.length > 1
              ? `${model.contributor.identityIds.length} confirmed Git identities · Recorded names: ${model.contributor.aliases.join(', ')}`
              : model.contributor.aliases.length > 1
                ? `One Git identity · Recorded names: ${model.contributor.aliases.join(', ')}`
                : 'Using one recorded Git author identity; suggested matches remain separate until confirmed.'}
          </p>
        </div>
        <div className="trail-legend" aria-label="Evidence legend">
          <span><i className="trail-key trail-key--authored" />Authored evidence</span>
          <span><i className="trail-key trail-key--context" />Feature context</span>
        </div>
      </section>

      {model.authoredEpisodes.length === 0 ? (
        <div className="empty-state">No authored changes appear in the selected calendar range.</div>
      ) : (
        <>
          <section className="contributor-trail__section" aria-labelledby="contributor-features-heading">
            <div className="trail-section-heading">
              <div>
                <span className="eyebrow">Candidate associations</span>
                <h3 id="contributor-features-heading">Feature evidence with repository context</h3>
              </div>
              <span>{model.featureLanes.length} candidate trails</span>
            </div>

            {model.featureLanes.length > 0 ? (
              <div className="story-lanes contributor-feature-lanes">
                <TimelineAxis
                  model={model}
                  selectedChapterId={selectedChapterId}
                  leftLabel="Candidate feature"
                  rightLabel="Authored / cited"
                />
                <ol className="story-lanes__rows">
                  {model.featureLanes.map((lane) => (
                    <li
                      key={lane.feature.id}
                      className={`story-grid story-lane${selectedId === lane.feature.id ? ' is-selected' : ''}`}
                    >
                      <button
                        type="button"
                        className="story-lane__label"
                        onClick={() => onSelect(lane.feature.id)}
                      >
                        <span>{lane.feature.label}</span>
                        <small>
                          {lane.lifecycleEvents.length > 0
                            ? lane.lifecycleEvents
                                .map((event) => event.semanticEpisode.lifecycleStage)
                                .join(' → ')
                            : 'lifecycle unassigned'}{' '}
                          ·{' '}
                          {Math.round(lane.feature.confidence * 100)}% confidence
                        </small>
                      </button>

                      <div className="story-lane__track">
                        <ChapterBands model={model} selectedChapterId={selectedChapterId} />
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
                            className={`trail-event ${
                              event.isAuthored ? 'trail-event--authored' : 'trail-event--context'
                            }${selectedId === event.id ? ' is-selected' : ''}`}
                            style={{
                              left: `${event.percent}%`,
                              transform: `translate(-50%, ${event.stack * 7 - 7}px)`,
                            }}
                            aria-label={`${event.isAuthored ? 'Authored' : 'Context'} commit ${event.episode.shortSha}: ${event.episode.subject}`}
                            title={`${event.isAuthored ? 'Authored evidence' : 'Feature context'} · ${event.episode.shortSha} · ${event.episode.subject}`}
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
                            title={`${event.semanticEpisode.lifecycleStage} · ${event.semanticEpisode.label}`}
                            onClick={() => onSelect(event.id)}
                          />
                        ))}
                      </div>

                      <span className="story-lane__count">
                        {lane.authoredEvents.length}/{lane.events.length}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="trail-empty">
                Authored changes are present, but none are cited by candidate features matching the
                current filters.
              </div>
            )}
            <details className="method-disclosure">
              <summary>How to read feature associations</summary>
              <p>
                Filled marks are commits attributed to this Git author. Rings preserve the other cited
                commits in the feature trail. Colored bars show candidate lifecycle episodes; none of
                these associations establish complete ownership.
              </p>
            </details>
          </section>

          <section className="contributor-trail__section" aria-labelledby="contributor-areas-heading">
            <div className="trail-section-heading">
              <div>
                <span className="eyebrow">Observed footprint</span>
                <h3 id="contributor-areas-heading">Authored changes across code areas</h3>
              </div>
              <span>{model.uncitedEpisodes.length} authored commits outside candidate evidence</span>
            </div>

            <div className="story-lanes contributor-area-lanes">
              <TimelineAxis
                model={model}
                selectedChapterId={selectedChapterId}
                leftLabel="Observed code area"
                rightLabel="Commits"
              />
              <ol className="story-lanes__rows">
                {model.areaLanes.map((lane) => (
                  <li
                    key={lane.area.id}
                    className={`story-grid story-lane area-activity-lane${selectedId === lane.area.id ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="story-lane__label"
                      onClick={() => onSelect(lane.area.id)}
                    >
                      <span>{lane.area.label}</span>
                      <small>{lane.area.pathPrefix || 'repository root'}</small>
                    </button>
                    <div className="story-lane__track">
                      <ChapterBands model={model} selectedChapterId={selectedChapterId} />
                      {lane.events.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className={`area-activity-event${selectedId === event.id ? ' is-selected' : ''}`}
                          style={{
                            left: `${event.percent}%`,
                            transform: `translate(-50%, ${event.stack * 6 - 6}px)`,
                          }}
                          aria-label={`${event.episode.shortSha}: ${event.episode.subject}`}
                          title={`${event.episode.shortSha} · ${event.episode.subject}`}
                          onClick={() => onSelect(event.id)}
                        />
                      ))}
                    </div>
                    <span className="story-lane__count">{lane.events.length}</span>
                  </li>
                ))}
              </ol>
            </div>
            <details className="method-disclosure">
              <summary>How to read code-area activity</summary>
              <p>
                Area rows include all observed commits attributed to this confirmed profile in the selected
                range, including work not cited by a candidate feature. Density is not an impact score.
              </p>
            </details>
          </section>
        </>
      )}

      <p className="boundary-note contributor-trail__boundary">
        This is a projection of repository evidence. Git authorship can omit pair work, squash
        contributors, and design or review participation; it does not establish feature ownership or
        performance.
      </p>
    </div>
  )
}
