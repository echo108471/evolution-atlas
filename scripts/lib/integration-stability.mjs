// Structural recurrence only. No labels are matched semantically or scored as truth.
const key = value => JSON.stringify(value)
const sorted = values => [...new Set(values)].sort()
export function setRecurrence(left, right) {
  const a = new Set(left), b = new Set(right), shared = [...a].filter(x => b.has(x))
  const union = new Set([...a, ...b])
  return { left: a.size, right: b.size, shared: shared.length, jaccard: union.size ? shared.length / union.size : null,
    leftOnly: [...a].filter(x => !b.has(x)).sort(), rightOnly: [...b].filter(x => !a.has(x)).sort() }
}
function memberships(graph) {
  const owners = new Map(graph.nodes.map(n => [n.id, []]))
  for (const l of graph.lineage) for (const id of l.successorIds) owners.get(id).push(l.originalId)
  const children = new Map(graph.nodes.map(n => [n.id, []]))
  for (const e of graph.edges.filter(e => e.type === 'contains')) children.get(e.from).push(e.to)
  const groups = graph.nodes.filter(n => children.get(n.id).length).map(n => {
    const visiting = new Set(), visited = new Set(), members = []
    const walk = id => {
      if (visiting.has(id)) throw new Error('containment cycle')
      if (visited.has(id)) return
      visiting.add(id); members.push(...owners.get(id)); children.get(id).forEach(walk); visiting.delete(id); visited.add(id)
    }
    children.get(n.id).forEach(walk)
    return { id: n.id, name: n.name, predecessors: sorted(owners.get(n.id)), members: sorted(members) }
  })
  const mergedPairs = []
  for (const ids of owners.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) mergedPairs.push(key([ids[i], ids[j]].sort()))
  return { groups, mergedPairs }
}
function actions(left, right, id, decision) {
  const a = new Map(left.map(r => [id(r), decision(r)])), b = new Map(right.map(r => [id(r), decision(r)]))
  if (a.size !== left.length || b.size !== right.length || a.size !== b.size || [...a.keys()].some(k => !b.has(k))) throw new Error('incomplete/duplicate action accounting')
  const differences = [...a].filter(([k, v]) => v !== b.get(k)).map(([id, left]) => ({ id, left, right: b.get(id) }))
  return { total: a.size, same: a.size - differences.length, differences }
}
function comparisons(graph) {
  const byTarget = new Map()
  for (const c of graph.comparisons) {
    const target = key([c.newNodeId, sorted(c.existingNodeIds)])
    byTarget.set(target, sorted([...(byTarget.get(target) ?? []), c.relation]))
  }
  return byTarget
}
export function compareIntegrations(left, right, originals) {
  const a = memberships(left), b = memberships(right), ca = comparisons(left), cb = comparisons(right)
  const sharedTargets = [...ca.keys()].filter(k => cb.has(k))
  const comparisonDifferences = sharedTargets.filter(k => key(ca.get(k)) !== key(cb.get(k))).map(k => ({ target: JSON.parse(k), left: ca.get(k), right: cb.get(k) }))
  const expected = sorted(originals)
  for (const g of [left, right]) if (key(sorted(g.lineage.map(l => l.originalId))) !== key(expected)) throw new Error('original identity universe changed')
  return { kind: 'structural-recurrence-not-accuracy',
    nodeActions: actions(left.lineage, right.lineage, l => l.originalId, l => l.decision),
    inputEdgeActions: actions(left.edgeLineage, right.edgeLineage, l => `${l.source}:${l.originalIndex}`, l => l.decision),
    comparisonTargets: { ...setRecurrence([...ca.keys()], [...cb.keys()]),
      sameRelationsOnSharedTargets: sharedTargets.length - comparisonDifferences.length, differences: comparisonDifferences,
      recordsLeft: [...ca].map(([target, relations]) => ({ target: JSON.parse(target), relations })),
      recordsRight: [...cb].map(([target, relations]) => ({ target: JSON.parse(target), relations })) },
    containmentMemberships: { ...setRecurrence(a.groups.map(g => key(g.members)), b.groups.map(g => key(g.members))), leftGroups: a.groups, rightGroups: b.groups },
    coMergedOriginalPairs: setRecurrence(a.mergedPairs, b.mergedPairs),
    limits: ['Two runs do not establish population stability or semantic correctness.',
      'Action agreement includes unchanged baseline records and can be dominated by retention.',
      'Comparison label agreement is only among identical explicitly examined alternative sets; all unmatched sets are reported.',
      'Exact containment member sets ignore generated names but do not prove the same meaning; multiple parents with the same set are retained in group records.',
      'Input-edge actions do not measure all new relationships or their explanations; inspect complete maps.',
      'No positive co-merge pairs in either run yields null, not a perfect merge score.'] }
}
