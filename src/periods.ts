/**
 * Types for the epoch document produced by `npm run epochs`.
 *
 * It is deliberately a separate file from the atlas dataset rather than a field inside
 * it. Epoch detection needs model requests, the atlas does not, and a viewer that can
 * open a repository without one should keep working when no epoch document exists.
 */

export type PeriodLevelName = 'epoch' | 'era' | 'age' | string

export interface PeriodBoundarySignal {
  kind: 'phase-proposal' | 'path-focus-shift' | 'language-focus-shift'
  label: string
  /** `observed` for a measured divergence; `candidate` for a model's reading. */
  basis: 'observed' | 'candidate'
  weight: number
}

export interface PeriodBoundary {
  id: string
  status: 'candidate'
  confidence: number
  /** How many overlapping request windows independently proposed this boundary. */
  votes: number
  /** Where a reader saw the work change character. */
  proposedIndex: number
  proposedSha: string
  proposedAt: string
  /** Where the recorded history measurably changed shape, when a detector agreed. */
  settledIndex: number | null
  settledSha: string | null
  settledAt: string | null
  startIndex: number
  endIndex: number
  spanCommits: number
  spanDays: number
  corroborated: boolean
  before: string | null
  after: string | null
  signals: PeriodBoundarySignal[]
}

export interface Period {
  id: string
  level: number
  order: number
  startIndex: number
  endIndex: number
  commitCount: number
  firstCommitSha: string
  lastCommitSha: string
  firstAuthoredAt: string
  lastAuthoredAt: string
  childIds: string[]
  closedBy: string | null
  label?: string | null
  summary?: string | null
  /** False when the model could find no common thread — a signal about the boundaries. */
  coherent?: boolean | null
  labelConfidence?: number | null
  labelMethod?: string | null
  labelStatus?: 'candidate' | 'failed'
}

export interface UnpairedFocusPeak {
  index: number
  kind: 'path' | 'language'
  score: number
  commitSha: string
  authoredAt: string
  subject: string
}

export interface PeriodDocument {
  schemaVersion: string
  repository: string
  headSha: string
  method: string
  commitCount: number
  hierarchy: {
    depth: number
    levelNames: PeriodLevelName[]
    rationale: string
  }
  boundaries: PeriodBoundary[]
  /** Lowest level first: `levels[0]` is epochs, `levels[1]` eras, and so on. */
  levels: Period[][]
  unpairedFocusPeaks: UnpairedFocusPeak[]
}

/**
 * A local single-dataset install serves its epoch document beside `/atlas.json`. A gallery
 * subject names its own document instead, and a subject that names none has no periods:
 * the viewer requests nothing rather than probing a shared path that would 404.
 */
export const LOCAL_PERIODS_URL = '/epochs.json'

/** Only same-origin absolute paths are fetched; anything else is treated as absent. */
export function resolvePeriodsUrl(options: { gallery: boolean; subjectPeriods?: string | null }): string | null {
  if (!options.gallery) return LOCAL_PERIODS_URL
  const path = options.subjectPeriods
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return path
}

/**
 * An epoch document is pinned to the commit it was generated from. Boundaries are commit
 * indices, so a document built against a different head silently points at the wrong
 * commits — better to ignore it than to render misplaced periods.
 */
export function matchesDataset(
  document: PeriodDocument,
  repository: { name: string; headSha: string; commitCount: number },
): boolean {
  return (
    document.repository === repository.name &&
    document.headSha === repository.headSha &&
    document.commitCount === repository.commitCount
  )
}

export function parsePeriodDocument(value: unknown): PeriodDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<PeriodDocument>
  if (!Array.isArray(candidate.levels) || !Array.isArray(candidate.boundaries)) return null
  if (typeof candidate.repository !== 'string' || typeof candidate.headSha !== 'string') return null
  if (typeof candidate.commitCount !== 'number') return null
  return candidate as PeriodDocument
}

export function levelLabel(name: PeriodLevelName, count: number): string {
  const plural = count === 1 ? name : `${name}s`
  return `${count} ${plural}`
}

/** Boundaries that close a period, keyed for lookup from the period that ends there. */
export function boundariesById(document: PeriodDocument): Map<string, PeriodBoundary> {
  return new Map(document.boundaries.map((boundary) => [boundary.id, boundary]))
}
