/** Versioned exhaustive feedback. Historical fail-fast validators remain unchanged for replay. */
import { scopeTensions } from './behavior-ownership.mjs'
export function ownershipDiagnostics(raw, nodes, pairs, evidence) {
  const issues = [], add = (path, issue) => issues.push({ path, issue })
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!object(raw)) return [{ path: '$', issue: 'Expected ownership object' }]
  const array = (v, path, max = Infinity) => { if (!Array.isArray(v)) { add(path, 'Expected array'); return [] } if (v.length > max) add(path, `Maximum ${max} entries`); return v }
  const str = (v, path) => { if (typeof v !== 'string' || !v.trim()) add(path, 'Expected nonempty string') }
  const distinct = (v, path) => { if (new Set(v).size !== v.length) add(path, 'Duplicate entries') }
  const row = (v, path) => { if (!object(v)) { add(path, 'Expected object'); return {} } return v }
  const strings = (v, path, nonempty = false) => { const a = array(v, path); if (nonempty && !a.length) add(path, 'Must not be empty'); a.forEach((s, i) => str(s, `${path}[${i}]`)); return a }
  const sources = new Map(evidence.map((e) => [e.id, e]))
  const cite = (v, path, required, revisions = [], revisionPath = path) => {
    const ids = array(v, path); distinct(ids, path)
    ids.forEach((id, i) => { if (!sources.has(id)) add(`${path}[${i}]`, 'Unknown evidence ID') })
    if (required && !ids.some((id) => sources.get(id)?.kind === 'source')) add(path, 'Missing observed source; candidate readings do not establish source facts')
    distinct(revisions, revisionPath)
    revisions.forEach((sha, i) => {
      if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || !ids.some((id) => sources.get(id)?.kind === 'source' && sources.get(id)?.commitSha === sha)) add(`${revisionPath}[${i}]`, `Revision ${String(sha)} lacks a cited observed source at that revision. Withdraw or withhold unsupported claims; do not invent evidence.`)
    })
  }
  const behaviors = array(raw.behaviors, 'behaviors', 12).map((v, i) => row(v, `behaviors[${i}]`))
  const behaviorIds = behaviors.map((b) => b.id), nodeIds = nodes.map((n) => n.id)
  distinct(behaviorIds, 'behaviors.id')
  behaviors.forEach((b, i) => {
    const p = `behaviors[${i}]`; if (typeof b.id !== 'string' || !/^B[\w-]+$/.test(b.id)) add(`${p}.id`, 'Invalid behavior ID')
    str(b.text, `${p}.text`); str(b.conditions, `${p}.conditions`)
    cite(b.evidenceIds, `${p}.evidenceIds`, true, strings(b.atCommits, `${p}.atCommits`, true), `${p}.atCommits`)
  })
  const roles = array(raw.roles, 'roles').map((v, i) => row(v, `roles[${i}]`))
  distinct(roles.map((r) => `${r.nodeId}:${r.behaviorId}`), 'roles')
  for (const n of nodeIds) for (const b of behaviorIds) if (!roles.some((r) => r.nodeId === n && r.behaviorId === b)) add('roles', `Missing role for ${n}:${b}`)
  roles.forEach((r, i) => {
    const p = `roles[${i}]`
    if (!nodeIds.includes(r.nodeId)) add(`${p}.nodeId`, 'Unknown node')
    if (!behaviorIds.includes(r.behaviorId)) add(`${p}.behaviorId`, 'Unknown behavior')
    if (!['includes', 'uses', 'hosts', 'excludes', 'unknown'].includes(r.role)) add(`${p}.role`, 'Invalid role')
    str(r.reason, `${p}.reason`); cite(r.evidenceIds, `${p}.evidenceIds`, r.role !== 'unknown')
  })
  array(raw.implementations, 'implementations', 20).forEach((v, i) => {
    const p = `implementations[${i}]`, r = row(v, p)
    if (!nodeIds.includes(r.nodeId)) add(`${p}.nodeId`, 'Unknown node')
    str(r.text, `${p}.text`); cite(r.evidenceIds, `${p}.evidenceIds`, true, [r.atCommit], `${p}.atCommit`)
  })
  array(raw.history, 'history', 10).forEach((v, i) => {
    const p = `history[${i}]`, r = row(v, p); str(r.text, `${p}.text`)
    cite(r.evidenceIds, `${p}.evidenceIds`, true, strings(r.atCommits, `${p}.atCommits`, true), `${p}.atCommits`)
  })
  const decisions = array(raw.decisions, 'decisions').map((v, i) => row(v, `decisions[${i}]`))
  distinct(decisions.map((d) => d.id), 'decisions.id')
  pairs.forEach((p) => { if (!decisions.some((d) => d.id === p.id)) add('decisions', `Missing pair ${p.id}`) })
  const role = (n, b) => roles.find((r) => r.nodeId === n && r.behaviorId === b)?.role
  decisions.forEach((d, i) => {
    const p = `decisions[${i}]`, pair = pairs.find((x) => x.id === d.id)
    if (!pair) add(`${p}.id`, 'Unknown pair')
    if (!['same', 'overlapping', 'a_broader', 'b_broader', 'distinct', 'unresolved'].includes(d.relation)) add(`${p}.relation`, 'Invalid relation')
    str(d.reason, `${p}.reason`); cite(d.evidenceIds, `${p}.evidenceIds`, d.relation !== 'unresolved')
    strings(d.openQuestions, `${p}.openQuestions`, d.relation === 'unresolved'); strings(d.revisionTriggers, `${p}.revisionTriggers`, true)
    for (const field of ['sharedBehaviorIds', 'aOnlyBehaviorIds', 'bOnlyBehaviorIds']) {
      const ids = array(d[field], `${p}.${field}`); distinct(ids, `${p}.${field}`)
      ids.forEach((id, j) => {
        if (!behaviorIds.includes(id)) add(`${p}.${field}[${j}]`, 'Unknown behavior witness')
        if (!pair) return
        const a = role(pair.a, id), b = role(pair.b, id), expected = field === 'sharedBehaviorIds' ? ['includes', 'includes'] : field === 'aOnlyBehaviorIds' ? ['includes', 'excludes'] : ['excludes', 'includes']
        if (a !== expected[0] || b !== expected[1]) add(`${p}.${field}[${j}]`, `Witness ${id} needs ${expected.join('/')} but records ${a}/${b}. Uses, hosts and unknown do not prove exclusion. Withdraw unsupported witnesses, not invent exclusions.`)
      })
    }
  })
  const notes = array(raw.consistencyNotes, 'consistencyNotes').map((v, i) => row(v, `consistencyNotes[${i}]`))
  notes.forEach((n, i) => {
    const p = `consistencyNotes[${i}]`, ids = array(n.pairIds, `${p}.pairIds`); distinct(ids, `${p}.pairIds`)
    if (!ids.length || ids.some((id) => !pairs.some((x) => x.id === id))) add(`${p}.pairIds`, 'Expected known pair IDs')
    if (!['explained', 'unresolved'].includes(n.status)) add(`${p}.status`, 'Invalid status')
    str(n.reason, `${p}.reason`); cite(n.evidenceIds, `${p}.evidenceIds`, n.status === 'explained')
  })
  strings(raw.coverageLimits, 'coverageLimits', true)
  for (const t of scopeTensions(pairs, { decisions })) if (!notes.some((n) => Array.isArray(n.pairIds) && t.pairIds.every((id) => n.pairIds.includes(id)))) add('consistencyNotes', `Potential aligned-scope tension needs explanation or unresolved note: ${t.pairIds.join(', ')}; no automatic semantic correction`)
  return issues
}
