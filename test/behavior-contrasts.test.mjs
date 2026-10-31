import test from 'node:test'
import assert from 'node:assert/strict'
import { contrastFixture, contrastOracle, contrastRequest, contrastDiagnostics, scoreContrasts } from '../scripts/lib/behavior-contrasts.mjs'
test('fixed contrasts have executed witnesses for three changes and no observed refactor differences', () => {
  const o = contrastOracle(contrastFixture())
  assert.deepEqual(o.map((x) => x.expectedDelta), ['unchanged','changed','unchanged','changed','unchanged','changed','unresolved','unresolved'])
  for (const x of o.filter((x) => x.expectedDelta === 'changed')) assert.ok(x.probes.some((p) => !p.equal))
  assert.equal(o.find((x) => x.id === 'C3').probes.length, 48)
  assert.equal(o.find((x) => x.id === 'C5').probes.length, 120)
})
test('visible packets are identical across conditions and contain no oracle, family or probe fields', () => {
  const c = contrastFixture(), a = contrastRequest(c,'summary',false,'synthetic'), b = contrastRequest(c,'boundary',false,'synthetic'), reverse = contrastRequest(c,'summary',true,'synthetic')
  assert.equal(a.messages[1].content, b.messages[1].content)
  const visible = JSON.parse(a.messages[1].content).cases
  assert.deepEqual(visible, JSON.parse(reverse.messages[1].content).cases.reverse())
  for (const x of visible) assert.deepEqual(Object.keys(x).sort(), ['domain','id','sources'])
  assert.equal(a.model, b.model); assert.equal(a.max_completion_tokens, b.max_completion_tokens)
})
const valid = () => ({ decisions: [{ id:'C1', summaryA:'A', summaryB:'B', behaviorDelta:'unchanged', capabilityRelation:'same', reason:'Evidence', revisionTrigger:'New output evidence', sourceRefs:['C1:A','C1:B'] }], coverageLimits:['Synthetic only'] })
test('diagnostics locate all missing or invalid output fields without mutating', () => {
  const r=valid(), cases=[{id:'C1'}]; assert.deepEqual(contrastDiagnostics(r,cases,'summary'), [])
  r.decisions[0].sourceRefs=['C1:A','invented']; r.decisions[0].behaviorDelta='wrong'; const before=structuredClone(r)
  assert.equal(contrastDiagnostics(r,cases,'summary').length,2); assert.deepEqual(r,before)
  assert.ok(contrastDiagnostics(null,cases,'boundary').length)
  assert.ok(contrastDiagnostics({decisions:[null]},cases,'boundary').length)
})
test('boundary condition requires both complete contracts', () => {
  const r=valid(), c=[{id:'C1'}]; assert.equal(contrastDiagnostics(r,c,'boundary').length,12)
  const b={actor:'Caller',input:'Input',observableResult:'Result',conditions:'Condition',outsideScope:'Other behavior',implementationDetails:[]}
  r.decisions[0].boundaryA=b; r.decisions[0].boundaryB=b; assert.deepEqual(contrastDiagnostics(r,c,'boundary'),[])
})
test('invalid results stay unscored and relation labels are not an oracle', () => {
  assert.equal(scoreContrasts({status:'invalid',value:valid()},[]),null)
  const r=valid(); r.decisions[0].capabilityRelation='distinct'
  assert.equal(scoreContrasts({status:'valid',value:r},[{id:'C1',expectedDelta:'unchanged'}]).correct,1)
})
