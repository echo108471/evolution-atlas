import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { reviewFields, scopeReviewRequest, reviewDiagnostics } from '../scripts/lib/claim-scope-review.mjs'
import { runScopeReview } from '../scripts/review-claim-scopes.mjs'
import { writeImmutable } from '../scripts/run-behavior-ownership.mjs'
import { renderScopeReview } from '../scripts/render-claim-scope-review.mjs'
const docs={previous:{decisions:[{id:'P1',reason:'Old reason'}]},current:{decisions:[{id:'P1',reason:'Current reason'}]}}
const input={cases:[{id:'P1'}],documents:docs,evidence:[{id:'S1',text:'Source'}],observations:[{id:'O1',text:'Earlier check'}],batchChecks:{id:'O2',text:'New check'}}
function answer(){return {cases:[{id:'P1',disposition:'revise',findings:[{fieldId:'F4',quote:'Current reason',issue:'Supported concern',evidenceRefs:['S1'],suggestedCorrection:'New scoped reason'}],scopeA:{included:['A'],excluded:[]},scopeB:{included:['B'],excluded:[]},proposedRelation:'unresolved',reason:'Need evidence',revisionReview:'Previous statement needs revision',remainingUncertainty:['Unknown']}],coverageLimits:['Synthetic']}}
test('field enumeration gives stable exact paths, and check exposure is the only evidence difference',()=>{
  assert.deepEqual(reviewFields(docs).map(f=>f.path),['/previous/decisions/0/id','/previous/decisions/0/reason','/current/decisions/0/id','/current/decisions/0/reason'])
  const a=scopeReviewRequest(input,false,'test'),b=scopeReviewRequest(input,true,'test')
  assert.equal(a.messages[0].content,b.messages[0].content)
  const av=JSON.parse(a.messages[1].content),bv=JSON.parse(b.messages[1].content);assert.equal(av.observations.length,1);assert.equal(bv.observations.length,2)
  delete av.observations;delete bv.observations;assert.deepEqual(av,bv)
})
test('review validation checks quotations, evidence visibility, scope and completeness',()=>{
  assert.deepEqual(reviewDiagnostics(answer(),input,false),[])
  const a=answer();a.cases[0].findings[0].quote='Inexact';a.cases[0].findings[0].evidenceRefs=['O2'];a.cases[0].scopeA.included=[]
  assert.equal(reviewDiagnostics(a,input,false).length,3);assert.equal(reviewDiagnostics(a,input,true).length,2)
  assert(reviewDiagnostics(null,input,false).length>0)
})
test('findings cannot silently cite another case or a global metadata field',()=>{
  const extra=structuredClone(input);extra.documents.current.decisions[0].id='P2'
  assert(reviewDiagnostics(answer(),extra,false).some(i=>i.issue.includes('another case')))
})
function setup(t){
  const dir=mkdtempSync(resolve('public/graph-reviews/scope-test-'))
  t.after(()=>{try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;t.diagnostic('Owned fixture directory retained due permissions')}})
  const o={in:`${dir}/baseline.json`,prior:`${dir}/prior`,out:`${dir}/run`}
  writeImmutable(o.in,{graph:{nodes:[]}})
  writeImmutable(`${o.prior}/output.json`,{results:['summary','boundary'].flatMap(condition=>['initial','expanded'].map(stage=>({condition,stage,status:'valid',value:stage==='initial'?docs.previous:docs.current})))})
  writeImmutable(`${o.prior}/bundle.json`,{cases:input.cases,initial:input.evidence,additional:[],observations:input.observations});writeImmutable(`${o.prior}/batch-counterexamples.json`,input.batchChecks)
  return {dir,o}
}
const payload=(cost=0.01)=>({model:'test',usage:cost===null?{}:{cost},choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer())}}]})
test('four reviewer calls preserve exact replay with no live fallback',async t=>{
  const {dir,o}=setup(t);let calls=0
  const a=await runScopeReview(o,{apiKey:'synthetic',requestProvider:async()=>{calls++;return payload()}})
  assert.equal(calls,4);assert.equal(a.allStructurallyValid,true)
  const b=await runScopeReview({...o,out:`${dir}/replay`,'replay-from':o.out},{apiKey:null,requestProvider:()=>assert.fail('replay spent')})
  assert.deepEqual(a,b);assert.equal(readFileSync(`${o.out}/output.json`,'utf8'),readFileSync(`${dir}/replay/output.json`,'utf8'))
})
test('missing usage stops subsequent requests and invalid reports are preserved',async t=>{
  const {o}=setup(t);let calls=0
  const result=await runScopeReview(o,{apiKey:'synthetic',requestProvider:async()=>{calls++;const p=payload(null);p.choices[0].message.content='{}';return p}})
  assert.equal(calls,1);assert.equal(result.costComplete,false);assert.equal(result.results[0].status,'invalid')
})
test('provider error is sanitized and orphan request is not retried',async t=>{
  const {o}=setup(t)
  const r=await runScopeReview(o,{apiKey:'synthetic',requestProvider:async()=>{throw Error('HTTP 403: private-string')}})
  assert.equal(r.results[0].httpStatus,403);assert(!JSON.stringify(r).includes('private-string'))
  const other={...o,out:o.out+'-orphan'};await runScopeReview({...other,prepare:true})
  writeImmutable(`${other.out}/summary-source.request.json`,JSON.parse(readFileSync(`${other.out}/planned-summary-source.json`,'utf8')))
  await assert.rejects(runScopeReview(other,{apiKey:'synthetic',requestProvider:()=>assert.fail('orphan retried')}),/without outcome/)
})
test('review renderer escapes all target and model prose and labels relations unscored',()=>{
  const value=answer();value.cases[0].findings[0].issue='<script>unsafe</script>'
  const html=renderScopeReview({status:'calls-completed',cost:0,costComplete:true,manifest:{},results:[{name:'summary-source',target:'summary',status:'valid',value}]},{summary:input,boundary:input})
  assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('unscored'))
})
