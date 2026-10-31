/** Synthetic browser fixtures. Never read from or write to public/ or real run data. */
export function syntheticAtlas() {
  const firstSha = 'a'.repeat(40)
  const headSha = 'b'.repeat(40)
  const contributorIds = ['contributor:ada', 'contributor:ada-alt']
  const firstAt = '2025-01-02T12:00:00.000Z'
  const lastAt = '2025-02-03T12:00:00.000Z'

  return {
    schemaVersion: '0.3.0',
    analysis: {
      mode: 'interpreted',
      historyRange: 'synthetic fixture',
      mergeDiffStrategy: 'diff-merges-first-parent',
    },
    repository: { name: 'Synthetic Repository', ref: 'fixture', headSha, commitCount: 2 },
    timeRange: { firstAuthoredAt: firstAt, lastAuthoredAt: lastAt },
    contributors: [
      {
        id: contributorIds[0],
        displayName: 'Ada Example',
        aliases: ['Ada Example'],
        isBot: false,
        firstSeenAt: firstAt,
        lastSeenAt: firstAt,
      },
      {
        id: contributorIds[1],
        displayName: 'Ada Example',
        aliases: ['Ada Example'],
        isBot: false,
        firstSeenAt: lastAt,
        lastSeenAt: lastAt,
      },
    ],
    identityMatches: [
      {
        id: 'identity-match:contributor:ada|contributor:ada-alt',
        identityIds: contributorIds,
        status: 'candidate',
        confidence: 0.78,
        method: 'synthetic verification fixture',
        signals: [{
          kind: 'exact-name',
          label: 'The synthetic fixture gives both identities the same display name.',
          basis: 'heuristic',
          weight: 0.78,
        }],
        conflicts: [],
      },
    ],
    structuralEpisodes: [],
    semanticEpisodes: [
      {
        id: 'semantic:introduced',
        kind: 'feature-lifecycle',
        featureId: 'feature:catalog',
        label: 'Introduce the synthetic catalog',
        lifecycleStage: 'introduced',
        status: 'candidate',
        confidence: 0.8,
        method: 'synthetic verification fixture',
        rationale: 'A deterministic label used to exercise the rendered story path.',
        evidence: [{ commitSha: firstSha, paths: ['src/catalog.ts'] }],
      },
      {
        id: 'semantic:hardened',
        kind: 'feature-lifecycle',
        featureId: 'feature:catalog',
        label: 'Add a synthetic catalog check',
        lifecycleStage: 'hardened',
        status: 'candidate',
        confidence: 0.76,
        method: 'synthetic verification fixture',
        rationale: 'A deterministic label used to exercise the rendered story path.',
        evidence: [{ commitSha: headSha, paths: ['test/catalog.test.ts'] }],
      },
    ],
    episodes: [
      {
        id: 'episode:catalog',
        commitSha: firstSha,
        shortSha: 'aaaaaaa',
        subject: 'Add synthetic catalog',
        authoredAt: firstAt,
        committedAt: firstAt,
        parentShas: [],
        contributorIds: [contributorIds[0]],
        codeAreaIds: ['area:src'],
        changes: [{ path: 'src/catalog.ts', status: 'A' }],
        interpretationStatus: 'observed',
      },
      {
        id: 'episode:catalog-test',
        commitSha: headSha,
        shortSha: 'bbbbbbb',
        subject: 'Add synthetic catalog check',
        authoredAt: lastAt,
        committedAt: lastAt,
        parentShas: [firstSha],
        contributorIds: [contributorIds[1]],
        codeAreaIds: ['area:test'],
        changes: [{ path: 'test/catalog.test.ts', status: 'A' }],
        interpretationStatus: 'observed',
      },
    ],
    codeAreas: [
      {
        id: 'area:src',
        label: 'src',
        pathPrefix: 'src',
        classification: 'top-level-path',
        firstSeenAt: firstAt,
        lastSeenAt: firstAt,
      },
      {
        id: 'area:test',
        label: 'test',
        pathPrefix: 'test',
        classification: 'top-level-path',
        firstSeenAt: lastAt,
        lastSeenAt: lastAt,
      },
    ],
    featureCandidates: [{
      id: 'feature:catalog',
      label: 'Synthetic catalog feature',
      status: 'candidate',
      confidence: 0.8,
      method: 'synthetic verification fixture',
      rationale: 'A deterministic candidate label used only to exercise the viewer.',
      evidence: [{ commitSha: firstSha, paths: ['src/catalog.ts'] }, { commitSha: headSha, paths: ['test/catalog.test.ts'] }],
    }],
    relationships: [],
  }
}

export function syntheticPeriods(dataset = syntheticAtlas()) {
  const first = dataset.episodes[0]
  const last = dataset.episodes.at(-1)
  return {
    schemaVersion: 'epochs/1',
    repository: dataset.repository.name,
    headSha: dataset.repository.headSha,
    method: 'synthetic verification fixture',
    commitCount: dataset.episodes.length,
    hierarchy: {
      depth: 1,
      levelNames: ['epoch'],
      rationale: 'A deterministic period used to exercise the viewer.',
    },
    boundaries: [],
    levels: [[{
      id: 'period:synthetic',
      level: 0,
      order: 0,
      startIndex: 0,
      endIndex: dataset.episodes.length - 1,
      commitCount: dataset.episodes.length,
      firstCommitSha: first.commitSha,
      lastCommitSha: last.commitSha,
      firstAuthoredAt: first.authoredAt,
      lastAuthoredAt: last.authoredAt,
      childIds: [],
      closedBy: null,
      label: 'Synthetic epoch',
      summary: 'A deterministic period used to exercise period details.',
      coherent: true,
    }]],
    unpairedFocusPeaks: [],
  }
}

export function syntheticCandidateMap() {
  return {
    displayName: 'Synthetic Candidate Map',
    commitSha: 'c'.repeat(40),
    mode: 'candidate',
    independentVerification: 'not-performed',
    graph: {
      nodes: [{
        id: 'cap:catalog',
        name: 'Synthetic catalog lookup',
        summary: 'Returns a catalog entry for a supplied key.',
        actor: 'A caller with a catalog key',
        inputs: ['Catalog key'],
        outcomes: ['A matching entry or no result'],
        conditions: ['The entry exists'],
        exclusions: ['Does not verify the caller identity'],
        implementations: ['src/catalog.ts'],
        evidenceIds: ['S1'],
        assessment: 'partial',
        uncertainty: ['This fixture does not establish runtime behavior.'],
        claims: [{
          text: 'Returns the matching entry for a known key.',
          evidenceIds: ['S1'],
          assessment: 'partial',
        }],
      }],
      edges: [],
    },
    receipts: [{
      id: 'S1',
      kind: 'source',
      path: 'src/catalog.ts',
      startLine: 3,
      endLine: 6,
      text: 'export function lookup(key) { return catalog.get(key) }',
    }],
    coverage: { files: 1, eligibleFiles: 3, omissions: ['Two synthetic files were not inspected.'] },
  }
}

export function syntheticGallery(dataset = syntheticAtlas()) {
  return {
    version: 1,
    generatedAt: '2025-02-04T12:00:00.000Z',
    subjects: [{
      slug: 'synthetic',
      title: 'Synthetic Gallery Project',
      description: 'A local fixture for exercising the gallery entry path.',
      why: 'Created for repeatable UI verification.',
      url: 'https://example.invalid/synthetic',
      license: 'Fixture only',
      dataset: 'synthetic-atlas.json',
      periods: '/gallery/synthetic-epochs.json',
      headSha: dataset.repository.headSha,
      commitCount: dataset.episodes.length,
      contributorCount: dataset.contributors.length,
      codeAreaCount: dataset.codeAreas.length,
      firstAuthoredAt: dataset.timeRange.firstAuthoredAt,
      lastAuthoredAt: dataset.timeRange.lastAuthoredAt,
      interpreted: true,
      interpretation: {
        provider: 'synthetic',
        model: 'synthetic fixture',
        method: 'synthetic verification fixture',
        featureCandidateCount: dataset.featureCandidates.length,
        semanticEpisodeCount: dataset.semanticEpisodes.length,
      },
    }],
  }
}


/** A fictional version 3 descendant comparison, including cached interpretations that are not Git proof. */
export function syntheticHistoryCandidateMap() {
  const artifact = syntheticCandidateMap()
  const baselineNode = { ...artifact.graph.nodes[0], id: 'old:cap:catalog', name: 'Baseline catalog lookup', evidenceIds: ['old:S1'], claims: [] }
  const historyReceipts = [
    { id: 'Q1', kind: 'search', query: 'catalog', hits: [{ path: 'src/catalog.ts', line: 3 }] },
    { id: 'H1', kind: 'diff', path: 'src/catalog.ts', commitSha: artifact.commitSha, text: '+ return catalog.get(key)' },
    { id: 'R1', kind: 'commit-reading', commitSha: artifact.commitSha, interpretationStatus: 'candidate', directSourceProof: false,
      readings: [{ summary: 'A fictional cached reading of catalog lookup.' }] },
  ]
  return { ...artifact, version: 'repository-engine/3', displayName: 'Synthetic History Map', mode: 'expansion',
    receipts: [...artifact.receipts, { ...artifact.receipts[0], id: 'old:S1', commitSha: 'b'.repeat(40) }, ...historyReceipts],
    graph: { ...artifact.graph,
      comparisons: [{ newNodeId: 'Acatalog', existingNodeIds: ['old:cap:catalog'], relation: 'same', reason: 'Synthetic proposal matches the baseline lookup.',
        disposition: 'revised into cap:catalog', evidenceIds: ['S1'], uncertainty: [] }],
      decisions: [{ question: 'Keep a single lookup capability?', decision: 'Yes, one candidate capability.', reason: 'Synthetic proposals overlap.', evidenceIds: ['S1'], uncertainty: [] }],
      lineage: [{ originalId: 'old:cap:catalog', decision: 'revise', successorIds: ['cap:catalog'], reason: 'Synthetic definition change.' }],
      edgeLineage: [] },
    baselineGraph: { nodes: [baselineNode], edges: [] },
    provenance: { runPlanSha256: '1'.repeat(64), integrationPacketSha256: '2'.repeat(64), outputFingerprints: { A: '3'.repeat(64), R: '4'.repeat(64) } },
    history: {
      version: 'repository-history/1',
      transition: { fromCommitSha: 'b'.repeat(40), toCommitSha: artifact.commitSha, relation: 'descendant',
        added: [], changed: [{ path: 'src/catalog.ts', fromBlobSha: 'd'.repeat(40), toBlobSha: 'e'.repeat(40) }], unchanged: [], deleted: [],
        omissions: ['Only the fictional catalog path was compared.'] },
      receiptIds: historyReceipts.map(receipt => receipt.id),
      priorMaps: [{ id: 'M1', displayName: 'Synthetic earlier map', commitSha: 'c'.repeat(40), version: 'repository-engine/3', artifactSha256: 'f'.repeat(64),
        nodeCount: 4, edgeCount: 2, accessedNodeCount: 1, unaccessedNodeCount: 3, interpretationStatus: 'candidate' }],
      commitReadings: [{ artifactId: 'C1', commitSha: artifact.commitSha, subject: 'Synthetic lookup change', readings: [{ tier: 1, summary: 'Synthetic tier-one reading used during integration.' }],
        interpretationStatus: 'candidate', directSourceProof: false }],
      lineage: [{ id: 'history:catalog', from: { commitSha: 'b'.repeat(40), nodeId: 'old:cap:catalog' },
        to: [{ commitSha: artifact.commitSha, nodeId: 'cap:catalog' }], decision: 'revise', assessment: 'partial',
        claim: 'Catalog lookup changed in the compared revision.', reason: 'A synthetic diff illustrates the receipt route.', evidenceIds: ['H1'] }],
      edgeLineage: [], omissions: ['Synthetic history does not establish real semantic behavior.'],
    } }
}
