import { applyGraphProposal, buildGraphRequest, graphShape, hash } from './capability-graph.mjs'

const check = (ok, message) => { if (!ok) throw new Error(message) }

// The only condition difference is the presence of the existing contains edges.
// Strip old rationale, origin and round metadata from BOTH conditions.
export function umbrellaSeed(graph, condition) {
  check(['linked', 'unlinked'].includes(condition), 'unknown umbrella condition')
  return {
    nodes: graph.nodes.map(({ id, name, summary, evidenceIds }) => ({ id, name, summary, evidenceIds })),
    edges: graph.edges.filter((e) => condition === 'linked' || e.type !== 'contains')
      .map(({ id, from, to, type, evidenceIds }) => ({ id, from, to, type, evidenceIds })),
  }
}

export function umbrellaPacket(baseline) {
  const registry = new Map([...baseline.readingRegistry, ...baseline.evidence].map((e) => [e.id, e]))
  const selected = new Map(), coverage = []
  for (const node of baseline.graph.nodes) {
    const refs = node.evidenceIds.map((id) => {
      check(registry.has(id), `missing evidence ${id}`)
      return registry.get(id)
    })
    // Exact saved excerpts, never truncate or summarize them again. Prefer current
    // source; fall back to historical source. Selection cannot see condition/output.
    const source = refs.find((e) => e.kind === 'source' && e.commitSha === baseline.headSha)
      ?? refs.find((e) => e.kind === 'source')
    const reading = refs.find((e) => e.kind === 'reading')
    const evidence = [source, reading].filter(Boolean)
    evidence.forEach((e) => selected.set(e.id, e))
    coverage.push({ nodeId: node.id, evidenceIds: evidence.map((e) => e.id), hasSource: Boolean(source) })
  }
  const evidence = [...selected.values()]
  return { evidence, coverage, sha256: hash(evidence), bytes: Buffer.byteLength(JSON.stringify(evidence)) }
}

export function umbrellaRequest(graph, packet, round, model, previous) {
  const request = buildGraphRequest('decision', {
    graph, retrievedEvidence: packet.evidence, evidenceCoverage: packet.coverage,
    phase: round === 1 ? 'broader-outcome-discovery' : 'challenge-and-reconsider',
    ...(previous ? { priorUnresolved: previous.unresolved } : {}),
  }, { model, maxTokens: 9000 })
  request.messages[0].content += `
This bounded experiment investigates broader outcomes across existing capabilities while preserving their useful detail. The listed nodes are fallible descriptions, not a required partition. Their names and descriptions must remain intact for this preservation test: do not upsert or remove ANY of the input seed nodes (N-prefixed IDs). You may create new broader parents (use U-prefixed IDs) or place existing capabilities under other existing capabilities. New parents can contain other parents, with nonuniform depth and multiple parents where justified. Do not add narrower leaf capabilities in this experiment. There is no target number of groups, parents, layers, or size threshold. Returning no new umbrella is valid.
Existing containment links are revisable: retaining them is not a goal, and absent links do not establish independence. Keep all existing depends_on edges unchanged. A shared product outcome is not the same as dependency, a shared technology, or an administrative 'everything' label. Explain which narrower responsibilities serve each proposed outcome and why a dependency-only or separate arrangement is insufficient. Different implementations can serve the same outcome. Preserve distinctions among siblings rather than merge their identities. New parents must connect at least two seed capabilities as descendants. Use new edge IDs prefixed UE to avoid collisions.
Use the exact evidence packet only; old citations not in it are not retrieved proof. Source excerpts and reading interpretations may be incomplete. Missing evidence means uncertainty, not evidence of absence. Mention missing evidence needed to choose stronger structures. Do not infer implementation connectivity from a broad semantic umbrella. Do not use empty or placeholder rationales.
${round === 1 ? 'Review possible shared outcomes across the whole catalog, not just the first neighborhood. Create only defensible broader relationships; do not force every capability into a group.' : 'Challenge the previous arrangement. Remove weak proposed links or parents, revise overlapping or redundant scopes, and consider whether broader parents above the current parents are justified. Do not preserve a proposal merely because you proposed it earlier. Another layer is optional, not success. Return a sparse patch; unchanged seed nodes must not be upserted.'}`
  return request
}

export function descendants(graph, id) {
  graphShape(graph)
  const seen = new Set()
  const walk = (current) => graph.edges.filter((e) => e.type === 'contains' && e.from === current)
    .forEach((e) => { if (!seen.has(e.to)) { seen.add(e.to); walk(e.to) } })
  walk(id)
  return [...seen].sort()
}

export function validateUmbrella(raw, graph, seed, packet, round) {
  const seedIds = new Set(seed.nodes.map((n) => n.id))
  check(raw.upsertNodes?.every((n) => !seedIds.has(n.id) && /^U/.test(n.id)), 'preserve seed nodes; new parents use U IDs')
  check(raw.removeNodeIds?.every((id) => !seedIds.has(id)), 'cannot retire seed details')
  const dependencies = new Set(seed.edges.filter((e) => e.type === 'depends_on').map((e) => e.id))
  check(raw.removeEdgeIds?.every((id) => !dependencies.has(id)), 'cannot remove seed dependency')
  check(raw.upsertEdges?.every((e) => e.type === 'contains' && !dependencies.has(e.id)), 'only containment changes allowed')
  for (const item of [...raw.upsertNodes, ...raw.upsertEdges]) {
    check(typeof item.reason === 'string' && /[\p{L}\p{N}]/u.test(item.reason)
      && !/^(?:\.\.\.|tbd|todo|n\/a)$/i.test(item.reason.trim()), 'placeholder rationale')
  }
  const result = applyGraphProposal(graph, raw, packet.evidence, round)
  for (const node of seed.nodes) check(hash(result.graph.nodes.find((n) => n.id === node.id)) === hash(node), 'seed detail changed')
  for (const node of result.graph.nodes.filter((n) => !seedIds.has(n.id))) {
    check(descendants(result.graph, node.id).filter((id) => seedIds.has(id)).length >= 2, 'new parent needs at least two seed descendants')
  }
  return result
}

export function umbrellaMetrics(graph, baseline, { includeParent = false } = {}) {
  const seedIds = new Set(baseline.nodes.map((n) => n.id)), roots = new Set(graphShape(baseline).roots)
  const groups = graph.nodes.map((n) => ({ id: n.id, name: n.name,
    members: [...(includeParent && seedIds.has(n.id) ? [n.id] : []), ...descendants(graph, n.id).filter((id) => seedIds.has(id))].sort(),
  })).filter((g) => g.members.filter((id) => roots.has(id)).length >= 2)
  const pairs = new Set()
  for (const group of groups) for (let i = 0; i < group.members.length; i++) {
    for (let j = i + 1; j < group.members.length; j++) pairs.add([group.members[i], group.members[j]].sort().join('|'))
  }
  const edgeKey = (e) => `${e.type}:${e.from}:${e.to}`
  const present = new Set(graph.edges.map(edgeKey))
  return { ...graphShape(graph), broaderGroups: groups,
    preservedSeedNodes: baseline.nodes.filter((n) => graph.nodes.some((m) => m.id === n.id && m.name === n.name && m.summary === n.summary)).length,
    retainedOriginalContainment: baseline.edges.filter((e) => e.type === 'contains' && present.has(edgeKey(e))).length,
    coUmbrellaPairs: [...pairs].sort() }
}

export function pairAgreement(a, b) {
  const left = new Set(a.coUmbrellaPairs), right = new Set(b.coUmbrellaPairs)
  const union = new Set([...left, ...right]), intersection = [...left].filter((v) => right.has(v)).length
  // Two empty outputs are not positive evidence of membership agreement.
  return { intersection, union: union.size, jaccard: union.size ? intersection / union.size : null }
}
