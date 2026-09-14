import { validateOwnership } from './behavior-ownership.mjs'
export const INVARIANCE_INSTRUCTIONS = `Additional experimental task: define behavioral identity before choosing implementation boundaries. For each discovered behavior, add behaviorContracts:[{behaviorId,actor,input,observableResult,conditions,implementationDetails:[]}]. Actor, input, observableResult and conditions are nonempty strings. implementationDetails lists mechanisms present in the cited code, kept outside the behavioral contract unless you justify an externally observable requirement. This does not require all capabilities to be atomic, identical, or overlapping.
Add implementationChallenges:[{pairId,hypotheticalChange,heldFixed,relationUnderChange,reason}] for every supplied pair. Imagine an implementation-only substitution of library, model/provider, file location, module boundary or interface surface while holding the relevant observable responsibility fixed. Clearly mark it hypothetical, not repository evidence. State what is held fixed and whether your working relation would change, using the same relation vocabulary. If it changes, explain the observable contractual difference that makes your supposed implementation-only change not actually behavior-preserving. Do not require the same file, model or code path to establish shared behavior. Different timing, persistence, actor, input or output contracts can matter; neither force sameness nor erase these distinctions. A check can expose uncertainty; it is not a prefilled answer or proof of invariance. Review your draft against this challenge before returning it. The original ownership output fields and evidence requirements still apply.`

export function invariantRequest(base) {
  const r = structuredClone(base)
  r.messages[0].content += '\n' + INVARIANCE_INSTRUCTIONS
  return r
}
export function ownershipFeedback(raw, nodes, pairs, evidence, treatment = false) {
  const issues = []
  try { validateOwnership(raw, nodes, pairs, evidence) } catch (e) { issues.push({ path: '$', issue: e.message }) }
  for (const [i, h] of (Array.isArray(raw?.history) ? raw.history : []).entries()) {
    for (const sha of h.atCommits ?? []) if (!(h.evidenceIds ?? []).some((id) => evidence.some((e) => e.id === id && e.kind === 'source' && e.commitSha === sha))) issues.push({ path: `history[${i}]`, issue: 'History revision lacks observed source evidence at that revision; a candidate reading is not source proof. Do not invent evidence. You may remove or explicitly withhold unsupported observations.' })
  }
  for (const d of Array.isArray(raw?.decisions) ? raw.decisions : []) {
    const p = pairs.find((p) => p.id === d.id); if (!p) continue
    const role = (n, b) => raw.roles?.find((r) => r.nodeId === n && r.behaviorId === b)?.role
    for (const [field, a, b] of [['aOnlyBehaviorIds', p.a, p.b], ['bOnlyBehaviorIds', p.b, p.a]]) for (const id of Array.isArray(d[field]) ? d[field] : []) {
      if (role(a, id) !== 'includes' || role(b, id) !== 'excludes') issues.push({ path: `decisions[${d.id}].${field}:${id}`, issue: `Exclusive witness requires includes/excludes; recorded roles are ${role(a, id)}/${role(b, id)}. Unknown, uses and hosts do not establish exclusion. Do not manufacture exclusion just to pass; narrow or withdraw unsupported witnesses.` })
    }
  }
  if (treatment) {
    const contracts = raw?.behaviorContracts, challenges = raw?.implementationChallenges
    const str = (x) => typeof x === 'string' && x.trim().length > 0
    if (!Array.isArray(contracts) || contracts.length !== raw.behaviors?.length || new Set(contracts.map((c) => c.behaviorId)).size !== contracts.length || contracts.some((c) => !raw.behaviors?.some((b) => b.id === c.behaviorId) || !['actor', 'input', 'observableResult', 'conditions'].every((k) => str(c[k])) || !Array.isArray(c.implementationDetails) || !c.implementationDetails.every(str))) issues.push({ path: 'behaviorContracts', issue: 'Supply one complete behavior contract per discovered behavior, with actor, input, observableResult, conditions and implementationDetails.' })
    if (!Array.isArray(challenges) || challenges.length !== pairs.length || new Set(challenges.map((c) => c.pairId)).size !== challenges.length || challenges.some((c) => !pairs.some((p) => p.id === c.pairId) || !['hypotheticalChange', 'heldFixed', 'reason'].every((k) => str(c[k])) || !['same', 'overlapping', 'a_broader', 'b_broader', 'distinct', 'unresolved'].includes(c.relationUnderChange))) issues.push({ path: 'implementationChallenges', issue: 'Supply one complete hypothetical implementation-change check for every pair.' })
  }
  return issues
}
export function correctionRequest(request, rawText, issues) {
  return { ...structuredClone(request), messages: [...structuredClone(request.messages), { role: 'assistant', content: rawText }, { role: 'user', content: `One explicitly recorded correction round. Here are deterministic validation errors, not expected semantic answers: ${JSON.stringify(issues)}. Return the complete corrected JSON. Preserve supported content; do not invent source or exclusions to satisfy checks. You may withdraw unsupported observations or witnesses, or revise a relation with evidence. All semantic changes will be reported separately; this is not a silent format repair.` }] }
}
