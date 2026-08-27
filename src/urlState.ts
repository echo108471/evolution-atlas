import { LIFECYCLE_STAGES } from './lifecycle'
import type { LifecycleStage } from './model'

/**
 * The viewer keeps its navigation coordinates in the query string so any view can be
 * linked, reloaded, and stepped through with the browser's own history. This module is
 * the whole contract: parsing is tolerant, serializing is canonical, and neither side
 * touches the DOM.
 */

export type AtlasSection = 'overview' | 'repository' | 'features' | 'people' | 'identity'
export type EvidencePreset = 'conservative' | 'balanced' | 'all'

export const ATLAS_SECTIONS: AtlasSection[] = [
  'overview',
  'repository',
  'features',
  'people',
  'identity',
]

export const EVIDENCE_PRESET_KEYS: EvidencePreset[] = ['conservative', 'balanced', 'all']

export interface AtlasUrlState {
  /** Gallery subject slug. Null means the single local dataset at `/atlas.json`. */
  subject: string | null
  section: AtlasSection
  /** Calendar range from the scope bar, e.g. `year:2024`. */
  chapterId: string | null
  lifecycleStage: LifecycleStage | 'all'
  evidencePreset: EvidencePreset
  featureId: string | null
  contributorId: string | null
  /** Whatever the evidence inspector is showing. */
  selectedId: string | null
  /** Repository-tab directory scope; empty string is the repository root. */
  scopePath: string
  /** Abbreviated commit SHA of the selected checkpoint. Ids stay stable when scope changes. */
  checkpointSha: string | null
}

export const DEFAULT_URL_STATE: AtlasUrlState = {
  subject: null,
  section: 'overview',
  chapterId: null,
  lifecycleStage: 'all',
  evidencePreset: 'balanced',
  featureId: null,
  contributorId: null,
  selectedId: null,
  scopePath: '',
  checkpointSha: null,
}

/** Serialization order, so two equal states always produce byte-identical query strings. */
const PARAM_ORDER = [
  'repo',
  'view',
  'chapter',
  'stage',
  'evidence',
  'feature',
  'who',
  'sel',
  'scope',
  'at',
] as const

function readEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value !== null && (allowed as string[]).includes(value) ? (value as T) : fallback
}

function readText(value: string | null) {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Reads a query string into navigation state. Unknown keys and unrecognized values fall
 * back to defaults rather than throwing, so a hand-edited or stale link still loads.
 */
export function parseAtlasUrl(search: string): AtlasUrlState {
  const params = new URLSearchParams(search)
  return {
    subject: readText(params.get('repo')),
    section: readEnum(params.get('view'), ATLAS_SECTIONS, DEFAULT_URL_STATE.section),
    chapterId: readText(params.get('chapter')),
    lifecycleStage: readEnum(
      params.get('stage'),
      [...LIFECYCLE_STAGES, 'all' as const],
      DEFAULT_URL_STATE.lifecycleStage,
    ),
    evidencePreset: readEnum(
      params.get('evidence'),
      EVIDENCE_PRESET_KEYS,
      DEFAULT_URL_STATE.evidencePreset,
    ),
    featureId: readText(params.get('feature')),
    contributorId: readText(params.get('who')),
    selectedId: readText(params.get('sel')),
    scopePath: readText(params.get('scope')) ?? DEFAULT_URL_STATE.scopePath,
    checkpointSha: readText(params.get('at')),
  }
}

/**
 * `URLSearchParams` percent-encodes characters the query component allows verbatim.
 * Restoring them keeps shared links readable: `?scope=src/lib&chapter=year:2024`.
 */
function relaxQueryEncoding(search: string) {
  return search.replace(/%2F/g, '/').replace(/%3A/g, ':')
}

/**
 * Writes navigation state back to a query string, omitting every value that already
 * matches its default so the common views stay short.
 */
export function serializeAtlasUrl(state: AtlasUrlState): string {
  const values: Record<(typeof PARAM_ORDER)[number], string | null> = {
    repo: state.subject,
    view: state.section === DEFAULT_URL_STATE.section ? null : state.section,
    chapter: state.chapterId,
    stage: state.lifecycleStage === DEFAULT_URL_STATE.lifecycleStage ? null : state.lifecycleStage,
    evidence:
      state.evidencePreset === DEFAULT_URL_STATE.evidencePreset ? null : state.evidencePreset,
    feature: state.featureId,
    who: state.contributorId,
    sel: state.selectedId,
    scope: state.scopePath.length > 0 ? state.scopePath : null,
    at: state.checkpointSha,
  }

  const params = new URLSearchParams()
  for (const key of PARAM_ORDER) {
    const value = values[key]
    if (value !== null && value.length > 0) params.set(key, value)
  }

  const query = relaxQueryEncoding(params.toString())
  return query.length > 0 ? `?${query}` : ''
}
