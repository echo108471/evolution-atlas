/**
 * A published gallery describes its subjects in a manifest beside the datasets. When the
 * manifest is absent the viewer falls back to the single local `/atlas.json`, so a
 * maintainer analyzing their own repository needs no gallery at all.
 */
export interface GalleryInterpretation {
  provider: string
  model: string
  method: string
  featureCandidateCount: number
  semanticEpisodeCount: number
}

export interface GallerySubject {
  slug: string
  title: string
  description: string | null
  /** Why this repository earned a place in the gallery — the selection rationale. */
  why: string | null
  url: string
  license: string | null
  dataset: string
  headSha: string
  commitCount: number
  contributorCount: number
  codeAreaCount: number
  firstAuthoredAt: string
  lastAuthoredAt: string
  interpreted: boolean
  interpretation: GalleryInterpretation | null
  /**
   * Same-origin path of this subject's epoch document (e.g. `/gallery/zod-epochs.json`).
   * Absent when no periods were generated; the viewer then requests none.
   */
  periods?: string
  /** Reviewed snapshot metadata served beside an optional exported demo. */
  notice?: string
  provenance?: string
}

export interface GalleryManifest {
  version: number
  generatedAt: string
  subjects: GallerySubject[]
}

export const GALLERY_MANIFEST_URL = '/gallery/manifest.json'
export const LOCAL_DATASET_URL = '/atlas.json'
