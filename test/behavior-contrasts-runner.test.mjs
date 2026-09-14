import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { runContrasts } from '../scripts/compare-behavior-contrasts.mjs'
import { writeImmutable } from '../scripts/run-behavior-ownership.mjs'
import { renderContrasts } from '../scripts/render-behavior-contrasts.mjs'
function setup(t) {
  const dir=mkdtempSync(resolve('public/graph-reviews/contrast-test-'))
  t.after(()=>{try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;t.diagnostic(`Cleanup restricted; retained ignored synthetic test directory ${dir}`)}})
  const o={in:`${dir}/baseline.json`,prepared:`${dir}/prepared`,prior:`${dir}/prior`,previous:`${dir}/previous`,out:`${dir}/run`}
  writeImmutable(o.in,{synthetic:true}); writeImmutable(`${o.prepared}/packet.json`,{evidence:['S71375ea117d2451c','S7f89ea5b400deafb','S0235cc4de9fc2e84'].map(id=>({id,kind:'source',text:'synthetic'}))})
  writeImmutable(`${o.prior}/output.json`,{nodes:[],pairs:[]}); writeImmutable(`${o.previous}/output.json`,{cells:[]})
  return {dir,o}
}
function payload(request,cost=0.01) {
  const cases=JSON.parse(request.messages[1].content).cases, boundary=request.messages[0].content.includes('boundaryA and boundaryB')
  const b={actor:'Caller',input:'Input',observableResult:'Result',conditions:'Known domain',outsideScope:'Other behavior',implementationDetails:[]}
  return {usage:{cost},choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:cases.map(c=>({id:c.id,...(boundary?{boundaryA:b,boundaryB:b}:{summaryA:'A',summaryB:'B'}),behaviorDelta:'unresolved',capabilityRelation:'unresolved',reason:'Synthetic fake',revisionTrigger:'More evidence',sourceRefs:[`${c.id}:A`,`${c.id}:B`]})),coverageLimits:['Synthetic test response']})}}]}
}
test('runner saves outcomes, executes four cells and replays without provider access',async t=>{
  const {dir,o}=setup(t); let calls=0
  const a=await runContrasts(o,{apiKey:'synthetic',requestProvider:async r=>{calls++;return payload(r)}})
  assert.equal(calls,4);assert.equal(a.cost,0.04);assert.equal(a.status,'completed')
  const b=await runContrasts({...o,out:`${dir}/replay`,'replay-from':o.out},{requestProvider:async()=>{throw new Error('No live replay')}})
  assert.deepEqual(a,b)
  assert.equal(readFileSync(`${o.out}/output.json`,'utf8'),readFileSync(`${dir}/replay/output.json`,'utf8'))
})
test('provider errors are retained, sanitized and stop further requests',async t=>{
  const {o}=setup(t);let calls=0
  const r=await runContrasts(o,{apiKey:'synthetic',requestProvider:async()=>{calls++;throw new Error('HTTP 403: sensitive-test-marker')}})
  assert.equal(calls,1);assert.equal(r.status,'incomplete');assert.equal(r.costComplete,false)
  assert.ok(!readFileSync(`${o.out}/summary-forward.failure.json`,'utf8').includes('sensitive-test-marker'))
})
test('missing usage stops additional spending and does not turn invalid data into scored output',async t=>{
  const {o}=setup(t);let calls=0
  const r=await runContrasts(o,{apiKey:'synthetic',requestProvider:async()=>{calls++;return {choices:[{message:{content:'{}'}}]}}})
  assert.equal(calls,1);assert.equal(r.costComplete,false);assert.equal(r.results[0].status,'invalid');assert.equal(r.results[0].score,null)
})
test('orphaned requests cannot be retried silently',async t=>{
  const {o}=setup(t);mkdirSync(o.out,{recursive:true});writeImmutable(`${o.out}/summary-forward.request.json`,{orphaned:true})
  let calls=0;await assert.rejects(runContrasts(o,{apiKey:'synthetic',requestProvider:async()=>{calls++}}),/request mismatch/i);assert.equal(calls,0)
})
test('renderer escapes model content and labels invalid decisions as unscored',()=>{
  const r={condition:'summary',order:'forward',status:'invalid',value:{decisions:[{id:'C1',reason:'<script>alert(1)</script>',behaviorDelta:'changed',capabilityRelation:'distinct'}]},score:null}
  const html=renderContrasts({results:[r],status:'incomplete',cost:0,costComplete:false,manifest:{design:'Synthetic',limitations:'Partial'}},[{id:'C1',family:'synthetic',domain:'Test',a:'<unsafe>',b:'B'}],[{id:'C1',expectedDelta:'changed',probes:[]}],{})
  assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('(unscored)'))
})
