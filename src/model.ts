export type InterpretationStatus = 'observed' | 'candidate' | 'confirmed' | 'rejected'

export interface FileChange {
  path: string
  previousPath?: string
  status: string
  similarity?: string
}

export interface Contributor {
  id: string
  displayName: string
  aliases: string[]
  isBot: boolean
  firstSeenAt: string
  lastSeenAt: string
}

export interface ChangeEpisode {
  id: string
  commitSha: string
  shortSha: string
  subject: string
  authoredAt: string
  committedAt: string
  parentShas: string[]
  contributorIds: string[]
  codeAreaIds: string[]
  changes: FileChange[]
  interpretationStatus: 'observed'
}

export interface CodeArea {
  id: string
  label: string
  pathPrefix: string
  classification: 'top-level-path'
  firstSeenAt: string
  lastSeenAt: string
}

export interface EvidenceReference {
  commitSha: string
  paths?: string[]
}

export interface FeatureCandidate {
  id: string
  label: string
  status: Exclude<InterpretationStatus, 'observed'>
  confidence: number
  method: string
  /** Why these commits were grouped, and what the evidence does not establish. */
  rationale?: string
  lifecycleStage?: 'introduced' | 'expanded' | 'hardened' | 'migrated' | 'removed'
  evidence: EvidenceReference[]
}

export interface Relationship {
  id: string
  sourceId: string
  targetId: string
  kind: 'authored' | 'touched' | 'supports-feature' | 'affects-area'
  interpretationStatus: InterpretationStatus
  confidence: number
  evidence: EvidenceReference[]
}

export interface AtlasDataset {
  schemaVersion: '0.1.0'
  analysis: {
    mode: 'observed-only' | 'interpreted'
    historyRange: string
    mergeDiffStrategy: 'first-parent'
  }
  repository: {
    name: string
    ref: string
    headSha: string
    commitCount: number
  }
  timeRange: {
    firstAuthoredAt: string | null
    lastAuthoredAt: string | null
  }
  contributors: Contributor[]
  episodes: ChangeEpisode[]
  codeAreas: CodeArea[]
  featureCandidates: FeatureCandidate[]
  relationships: Relationship[]
}
