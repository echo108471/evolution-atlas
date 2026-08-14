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

export type IdentityMatchStatus = 'candidate' | 'confirmed'

export interface IdentityMatchSignal {
  kind:
    | 'mailmap'
    | 'github-account'
    | 'email-handle'
    | 'exact-name'
    | 'name-handle-alignment'
  label: string
  basis: 'observed' | 'repository-config' | 'heuristic'
  weight: number
}

export interface IdentityMatchCandidate {
  id: string
  identityIds: [string, string]
  status: IdentityMatchStatus
  confidence: number
  method: string
  signals: IdentityMatchSignal[]
  conflicts: IdentityMatchSignal[]
}

export interface StructuralPathTransition {
  previousPath: string
  path: string
  basis: 'git-rename' | 'delete-add-path-continuity'
  confidence: number
  similarity?: number
}

export interface StructuralPrefixMapping {
  fromPrefix: string
  toPrefix: string
  fileCount: number
}

export interface StructuralEpisodeCandidate {
  id: string
  kind: 'repository-reorganization'
  label: string
  status: 'candidate' | 'confirmed'
  confidence: number
  method: string
  rationale: string
  evidence: EvidenceReference[]
  mappings: StructuralPrefixMapping[]
  transitions: StructuralPathTransition[]
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

export type LifecycleStage = 'introduced' | 'expanded' | 'hardened' | 'migrated' | 'removed'

export interface FeatureCandidate {
  id: string
  label: string
  status: Exclude<InterpretationStatus, 'observed'>
  confidence: number
  method: string
  /** Why these commits were grouped, and what the evidence does not establish. */
  rationale?: string
  evidence: EvidenceReference[]
}

export interface SemanticEpisodeCandidate {
  id: string
  kind: 'feature-lifecycle'
  featureId: string
  label: string
  lifecycleStage: LifecycleStage
  status: 'candidate' | 'confirmed'
  confidence: number
  method: string
  rationale: string
  evidence: EvidenceReference[]
}

export interface Relationship {
  id: string
  sourceId: string
  targetId: string
  kind:
    | 'authored'
    | 'touched'
    | 'supports-feature'
    | 'affects-area'
    | 'supports-lifecycle'
    | 'evolves-feature'
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
  identityMatches?: IdentityMatchCandidate[]
  structuralEpisodes?: StructuralEpisodeCandidate[]
  semanticEpisodes?: SemanticEpisodeCandidate[]
  episodes: ChangeEpisode[]
  codeAreas: CodeArea[]
  featureCandidates: FeatureCandidate[]
  relationships: Relationship[]
}
