import type { ChangeEpisode } from './model'

/**
 * Some exports omit original commit messages and write a generic placeholder subject
 * (`Observed commit <sha>`) or none at all. A placeholder repeats the SHA the viewer
 * already shows beside every subject, so it is replaced with a summary of the observed
 * changed paths. The summary is derived only from the commit's own path records; it is a
 * navigation label, not a recovered message.
 */
const PLACEHOLDER_SUBJECT = /^Observed commit [0-9a-f]{7,40}$/i
const PREVIEW_PATHS = 2

export function hasOmittedSubject(episode: Pick<ChangeEpisode, 'subject'>): boolean {
  const subject = episode.subject?.trim() ?? ''
  return subject === '' || PLACEHOLDER_SUBJECT.test(subject)
}

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** "README.md, tests.ts +1 path" — or the SHA alone when no path change was recorded. */
export function summarizeChangedPaths(episode: Pick<ChangeEpisode, 'shortSha' | 'changes'>): string {
  const paths = [...new Set(episode.changes.map((change) => change.path))]
  if (paths.length === 0) return `Commit ${episode.shortSha} · no first-parent path changes`
  const shown = paths.slice(0, PREVIEW_PATHS).map(baseName)
  const remaining = paths.length - shown.length
  return `${shown.join(', ')}${remaining > 0 ? ` +${remaining} path${remaining === 1 ? '' : 's'}` : ''}`
}

export function labelEpisode(episode: ChangeEpisode): ChangeEpisode {
  if (!hasOmittedSubject(episode)) return episode
  return { ...episode, subject: summarizeChangedPaths(episode), subjectOmitted: true }
}
