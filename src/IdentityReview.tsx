import { useState } from 'react'

import type { AtlasDataset } from './model'
import type {
  IdentityDecisionChoice,
  IdentityDecisionsDocument,
  IdentityResolution,
  ResolvedIdentityMatch,
} from './identity'

interface IdentityReviewProps {
  dataset: AtlasDataset
  resolution: IdentityResolution
  decisions: IdentityDecisionsDocument
  onDecision: (matchId: string, choice: IdentityDecisionChoice | null) => void
  onThresholdChange: (threshold: number) => void
  onImport: (value: unknown) => void
  onOpenContributor: (identityId: string) => void
}

/**
 * The analyzer only ever emits these confidences, so the control offers them as stops
 * rather than a continuous slider — every intermediate value behaves identically to the
 * stop below it, and a slider would imply precision the scoring does not have.
 */
const THRESHOLD_STOPS = [
  { value: 1, label: 'Never', detail: 'Every suggested match waits for you.' },
  { value: 0.97, label: '97%', detail: 'Only one email address used under two names.' },
  { value: 0.94, label: '94%', detail: 'A matching full name and a matching account handle.' },
  { value: 0.92, label: '92%', detail: 'A matching full name plus one supporting signal.' },
  { value: 0.86, label: '86%', detail: 'A matching full name on its own.' },
]

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function matchStateLabel(match: ResolvedIdentityMatch) {
  if (match.effectiveState === 'blocked') return 'Conflicting decisions'
  if (match.effectiveState === 'separate') return 'Kept separate'
  if (match.effectiveState === 'merged' && match.decisionSource === 'auto') {
    return 'Merged automatically'
  }
  if (match.effectiveState === 'merged' && match.decisionSource === 'repository') {
    return 'Repository-confirmed'
  }
  if (match.effectiveState === 'merged' && match.decisionSource === 'linked') {
    return 'Connected through confirmations'
  }
  if (match.effectiveState === 'merged') return 'Confirmed match'
  return 'Suggested match'
}

function IdentitySummary({
  dataset,
  identity,
}: {
  dataset: AtlasDataset
  identity: ResolvedIdentityMatch['identities'][number]
}) {
  const commitCount = dataset.episodes.filter((episode) =>
    episode.contributorIds.includes(identity.id),
  ).length
  return (
    <div className="identity-summary">
      <strong>{identity.displayName}</strong>
      <span>{identity.aliases.join(', ')}</span>
      <small>
        {commitCount} authored commits · {formatDate(identity.firstSeenAt)}–{formatDate(identity.lastSeenAt)}
      </small>
    </div>
  )
}

function MatchCard({
  dataset,
  match,
  hasUserDecision,
  onDecision,
  onOpenContributor,
}: {
  dataset: AtlasDataset
  match: ResolvedIdentityMatch
  hasUserDecision: boolean
  onDecision: IdentityReviewProps['onDecision']
  onOpenContributor: IdentityReviewProps['onOpenContributor']
}) {
  return (
    <article className={`identity-card identity-card--${match.effectiveState}`}>
      <header className="identity-card__header">
        <div>
          <span className="eyebrow">{matchStateLabel(match)}</span>
          <h3>
            {match.identities[0].displayName}
            <span aria-hidden="true"> ↔ </span>
            {match.identities[1].displayName}
          </h3>
        </div>
        <strong className="identity-confidence">{Math.round(match.confidence * 100)}%</strong>
      </header>

      <div className="identity-pair">
        <IdentitySummary dataset={dataset} identity={match.identities[0]} />
        <span className="identity-pair__join" aria-hidden="true">+</span>
        <IdentitySummary dataset={dataset} identity={match.identities[1]} />
      </div>

      <section className="identity-evidence" aria-label="Match evidence">
        <span>Why this appeared</span>
        <ul>
          {match.signals.map((signal) => (
            <li key={`${match.id}:${signal.kind}`}>
              <i className={`identity-signal identity-signal--${signal.basis}`} />
              <span>{signal.label}</span>
              <small>{signal.basis.replace('-', ' ')}</small>
            </li>
          ))}
        </ul>
      </section>

      {match.conflicts.length > 0 && (
        <section className="identity-evidence identity-evidence--against" aria-label="Evidence against">
          <span>Evidence against</span>
          <ul>
            {match.conflicts.map((signal) => (
              <li key={`${match.id}:conflict:${signal.kind}`}>
                <i className="identity-signal identity-signal--conflict" />
                <span>{signal.label}</span>
                <small>{signal.basis.replace('-', ' ')}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {match.effectiveState === 'blocked' && (
        <p className="identity-conflict">
          This merge would cross a pair you chose to keep separate. Undo one of those decisions
          before combining the profiles.
        </p>
      )}

      <footer className="identity-card__actions">
        {match.effectiveState === 'suggested' ? (
          <>
            <button type="button" className="identity-action identity-action--merge" onClick={() => onDecision(match.id, 'merged')}>
              Merge identities
            </button>
            <button type="button" className="identity-action" onClick={() => onDecision(match.id, 'separate')}>
              Keep separate
            </button>
          </>
        ) : (
          <>
            {match.effectiveState === 'merged' && (
              <button type="button" className="identity-action identity-action--trail" onClick={() => onOpenContributor(match.identityIds[0])}>
                Open contributor trail
              </button>
            )}
            {hasUserDecision ? (
              <button type="button" className="identity-action" onClick={() => onDecision(match.id, null)}>
                Undo decision
              </button>
            ) : (
              <button type="button" className="identity-action" onClick={() => onDecision(match.id, 'separate')}>
                Keep separate instead
              </button>
            )}
          </>
        )}
      </footer>
    </article>
  )
}

export function IdentityReview({
  dataset,
  resolution,
  decisions,
  onDecision,
  onThresholdChange,
  onImport,
  onOpenContributor,
}: IdentityReviewProps) {
  const [importError, setImportError] = useState<string | null>(null)
  const suggested = resolution.matches.filter((match) => match.effectiveState === 'suggested')
  const reviewed = resolution.matches.filter((match) => match.effectiveState !== 'suggested')
  const userDecisionIds = new Set(decisions.decisions.map((decision) => decision.matchId))

  const exportDecisions = () => {
    const blob = new Blob([`${JSON.stringify(decisions, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${dataset.repository.name}-identity-decisions.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importDecisions = async (file: File | undefined) => {
    if (!file) return
    try {
      onImport(JSON.parse(await file.text()))
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="identity-review">
      <section className="identity-review__intro">
        <div>
          <span className="eyebrow">Reversible resolution layer</span>
          <h3>Review likely Git identity matches</h3>
          <p>
            Confirmations change the contributor projection, never the underlying commits or raw
            author identities. Suggestions are deliberately conservative and explain their evidence.
          </p>
        </div>
        <div className="identity-file-actions">
          <button type="button" onClick={exportDecisions}>Export decisions</button>
          <label>
            Import decisions
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importDecisions(event.target.files?.[0])}
            />
          </label>
          {importError && <small role="alert">{importError}</small>}
        </div>
      </section>

      <section className="identity-automerge" aria-labelledby="identity-automerge-heading">
        <div className="identity-automerge__copy">
          <span className="eyebrow">Automatic merging</span>
          <h3 id="identity-automerge-heading">Merge above this confidence</h3>
          <p>
            {resolution.autoMergedCount > 0
              ? `${resolution.autoMergedCount} of ${resolution.matches.length} matches merged on their own. `
              : 'No match currently clears this bar. '}
            Lowering the bar merges weaker evidence without asking; raising it sends more
            pairs to review. Anything you decide by hand outranks this setting and survives
            a change to it.
          </p>
        </div>
        <div className="identity-automerge__stops" role="group" aria-label="Automatic merge threshold">
          {THRESHOLD_STOPS.map((stop) => (
            <button
              key={stop.label}
              type="button"
              aria-pressed={resolution.autoMergeThreshold === stop.value}
              className={
                resolution.autoMergeThreshold === stop.value
                  ? 'identity-stop identity-stop--active'
                  : 'identity-stop'
              }
              title={stop.detail}
              onClick={() => onThresholdChange(stop.value)}
            >
              {stop.label}
            </button>
          ))}
        </div>
      </section>

      <section className="identity-review__section" aria-labelledby="identity-suggestions-heading">
        <div className="identity-review__heading">
          <div>
            <span className="eyebrow">Needs review</span>
            <h3 id="identity-suggestions-heading">Suggested matches</h3>
          </div>
          <span>{suggested.length} unresolved</span>
        </div>
        {suggested.length > 0 ? (
          <div className="identity-card-list">
            {suggested.map((match) => (
              <MatchCard
                key={match.id}
                dataset={dataset}
                match={match}
                hasUserDecision={userDecisionIds.has(match.id)}
                onDecision={onDecision}
                onOpenContributor={onOpenContributor}
              />
            ))}
          </div>
        ) : (
          <div className="identity-review__empty">
            {/* One paragraph, so the grid centres a single item and the code stays inline. */}
            <p>
              No unresolved matches. A newly generated atlas can add suggestions from private email
              handles and repository <code>.mailmap</code> evidence without exposing email addresses.
            </p>
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="identity-review__section" aria-labelledby="identity-reviewed-heading">
          <div className="identity-review__heading">
            <div>
              <span className="eyebrow">Resolution history</span>
              <h3 id="identity-reviewed-heading">Reviewed and explicit matches</h3>
            </div>
            <span>{reviewed.length} resolved</span>
          </div>
          <div className="identity-card-list">
            {reviewed.map((match) => (
              <MatchCard
                key={match.id}
                dataset={dataset}
                match={match}
                hasUserDecision={userDecisionIds.has(match.id)}
                onDecision={onDecision}
                onOpenContributor={onOpenContributor}
              />
            ))}
          </div>
        </section>
      )}

      <p className="boundary-note identity-review__boundary">
        Name and account similarity can suggest that two Git records describe one person. Explicit
        repository mappings, your confirmation, and matches above the automatic threshold combine
        them into one profile; the underlying Git identities are never rewritten, and every merge
        above can be split. Code-area overlap, timing, and commit volume are not identity proof and
        are never used for ranking.
      </p>
    </div>
  )
}
