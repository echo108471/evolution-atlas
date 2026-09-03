/** Compare disagreement critics without treating any assignment run as ground truth. */

const assignmentKey = (ids) => [...ids].sort().join('|')

const resolvedIds = (decision) => {
  if (decision.verdict === 'assign') return decision.selectedCapabilityIds ?? []
  if (decision.verdict === 'unassigned') return []
  return null
}

function summarize(dataset, document, id) {
  const decisions = document.decisions ?? []
  if (decisions.length !== dataset.disagreements.length) {
    throw new Error(`${id} does not cover the disagreement dataset`)
  }
  if (new Set(decisions.map((decision) => decision.input)).size !== decisions.length) {
    throw new Error(`${id} repeats a disagreement decision`)
  }
  let resolved = 0
  let exactPlurality = 0
  let matchesObservedAlternative = 0
  let exactCandidateUnion = 0
  let outsideCandidateUnion = 0
  let selectedEdges = 0
  let selectedCandidateEdges = 0
  let outsideCandidateEdges = 0
  let candidateEdges = 0
  let overlapping = 0
  let citedReferences = 0

  for (const decision of decisions) {
    const disagreement = dataset.disagreements[decision.input]
    if (!disagreement || disagreement.commitSha !== decision.commitSha) {
      throw new Error(`${id} decision ${decision.input} does not match the dataset`)
    }
    if ((decision.referenceExemplarIds ?? []).length > 0) citedReferences += 1
    const selected = resolvedIds(decision)
    if (selected === null) continue
    resolved += 1
    selectedEdges += selected.length
    candidateEdges += disagreement.candidateCapabilityIds.length
    for (const capabilityId of selected) {
      if (disagreement.candidateCapabilityIds.includes(capabilityId)) selectedCandidateEdges += 1
      else outsideCandidateEdges += 1
    }
    if (selected.length > 1) overlapping += 1
    const selectedKey = assignmentKey(selected)
    const maximum = Math.max(...disagreement.alternatives.map((entry) => entry.occurrences))
    const plurality = disagreement.alternatives.filter((entry) => entry.occurrences === maximum)
    if (plurality.length === 1 && assignmentKey(plurality[0].capabilityIds) === selectedKey) {
      exactPlurality += 1
    }
    if (disagreement.alternatives.some(
      (entry) => assignmentKey(entry.capabilityIds) === selectedKey)) {
      matchesObservedAlternative += 1
    }
    if (assignmentKey(disagreement.candidateCapabilityIds) === selectedKey) {
      exactCandidateUnion += 1
    }
    if (selected.some((capabilityId) =>
      !disagreement.candidateCapabilityIds.includes(capabilityId))) {
      outsideCandidateUnion += 1
    }
  }

  const count = (verdict) => decisions.filter((decision) => decision.verdict === verdict).length
  return {
    id,
    protocol: document.protocol ?? null,
    usage: document.usage ?? null,
    shape: {
      decisions: decisions.length,
      resolved,
      assigned: count('assign'),
      unassigned: count('unassigned'),
      ambiguous: count('ambiguous'),
      mapInsufficient: count('map_insufficient'),
      missing: count('missing'),
      overlapping,
      selectedEdges,
      selectedCandidateEdges,
      outsideCandidateEdges,
      candidateEdges,
      candidateEdgeRetentionShare: candidateEdges === 0
        ? null
        : selectedCandidateEdges / candidateEdges,
      exactPlurality,
      exactPluralityShare: resolved === 0 ? null : exactPlurality / resolved,
      matchesObservedAlternative,
      observedAlternativeShare: resolved === 0 ? null : matchesObservedAlternative / resolved,
      exactCandidateUnion,
      exactCandidateUnionShare: resolved === 0 ? null : exactCandidateUnion / resolved,
      outsideCandidateUnion,
      citedReferences,
    },
  }
}

export function compareCapabilityCritics(dataset, documents, { ids } = {}) {
  if (documents.length !== 2) throw new Error('exactly two critic documents are required')
  const expectedSource = dataset.protocol?.contentSha256 ?? null
  for (const document of documents) {
    if (document.repository !== dataset.repository || document.headSha !== dataset.headSha) {
      throw new Error('critic and disagreement dataset must describe the same repository head')
    }
    if (document.source?.disagreementContentSha256 !== expectedSource) {
      throw new Error('critic was produced from a different disagreement dataset')
    }
  }
  const runIds = ids ?? ['left', 'right']
  const summaries = documents.map((document, index) => summarize(dataset, document, runIds[index]))
  const decisionMaps = documents.map((document) => new Map(
    document.decisions.map((decision) => [decision.input, decision]),
  ))
  let sameVerdict = 0
  let exactDecision = 0
  let bothResolved = 0
  let exactResolvedAssignment = 0
  const edgeSets = decisionMaps.map((decisions) => new Set())

  for (let index = 0; index < dataset.disagreements.length; index += 1) {
    const left = decisionMaps[0].get(index)
    const right = decisionMaps[1].get(index)
    if (left.verdict === right.verdict) sameVerdict += 1
    if (
      left.verdict === right.verdict &&
      assignmentKey(left.selectedCapabilityIds ?? []) === assignmentKey(right.selectedCapabilityIds ?? []) &&
      assignmentKey(left.plausibleCapabilityIds ?? []) === assignmentKey(right.plausibleCapabilityIds ?? []) &&
      Boolean(left.unassignedPlausible) === Boolean(right.unassignedPlausible)
    ) exactDecision += 1

    const selected = [resolvedIds(left), resolvedIds(right)]
    if (selected[0] !== null && selected[1] !== null) {
      bothResolved += 1
      if (assignmentKey(selected[0]) === assignmentKey(selected[1])) exactResolvedAssignment += 1
    }
    selected.forEach((idsForDecision, run) => {
      for (const capabilityId of idsForDecision ?? []) edgeSets[run].add(`${index}\t${capabilityId}`)
    })
  }
  const intersection = [...edgeSets[0]].filter((edge) => edgeSets[1].has(edge)).length
  const edgeDenominator = edgeSets[0].size + edgeSets[1].size
  return {
    schemaVersion: '0.1.0',
    method: 'capability-disagreement-critic-comparison',
    repository: dataset.repository,
    headSha: dataset.headSha,
    source: { disagreementContentSha256: expectedSource },
    critics: summaries,
    comparison: {
      decisions: dataset.disagreements.length,
      sameVerdict,
      sameVerdictShare: sameVerdict / dataset.disagreements.length,
      exactDecision,
      exactDecisionShare: exactDecision / dataset.disagreements.length,
      bothResolved,
      exactResolvedAssignment,
      exactResolvedAssignmentShare: bothResolved === 0 ? null : exactResolvedAssignment / bothResolved,
      selectedEdgeIntersection: intersection,
      selectedEdgeF1: edgeDenominator === 0 ? 1 : 2 * intersection / edgeDenominator,
    },
  }
}
