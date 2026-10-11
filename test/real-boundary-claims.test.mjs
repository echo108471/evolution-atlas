import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeImmutable } from '../scripts/run-behavior-ownership.mjs'
import { claimsRequest, claimsDiagnostics, parserObservations, qualifyClaimIds } from '../scripts/lib/real-boundary-claims.mjs'
import { runRealClaims } from '../scripts/compare-real-boundary-claims.mjs'
import { renderRealClaims } from '../scripts/render-real-boundary-claims.mjs'
import { batchAcceptanceProbe } from '../scripts/check-real-claim-counterexamples.mjs'
const bundle = { cases: [{ id: 'P1', question: 'Compare', sources: ['S1'] }], initial: [{ id:'S1', text:'initial evidence' }], additional:[{ id:'S2', text:'additional evidence' }], observations:[{id:'O1',text:'executed observation'}] }
function answer(condition, stage) {
  const d = { id:'P1', relation:'distinct', sharedResponsibilities:[], distinctions:['Different observable outcomes'], reason:'Scoped distinction', implementationNotes:'Separate interfaces', historyNotes:'No continuity evidence', claims:[1,2,3].map(n=>({id:`P1-C${n}`,assertion:'Scoped assertion',status:'uncertain',evidenceRefs:['S1'],example:'Input X predicts Y',falsifier:'X producing Z',revision:stage==='initial'?'initial':'retained',changeReason:'Evidence still insufficient'})) }
  if(condition==='summary')Object.assign(d,{summaryA:'A',summaryB:'B'})
  else for(const s of ['A','B'])d[`boundary${s}`]={actor:'Actor',input:'Input',outcome:'Output',conditions:'Condition',outsideScope:'Excluded'}
  return {decisions:[d],coverageLimits:['Synthetic test fixture']}
}
test('expanded evidence and prior answer are isolated from initial requests; audit criteria never leak',()=>{
  const a=claimsRequest(bundle,'summary','initial','test'), b=claimsRequest(bundle,'boundary','expanded','test',answer('boundary','initial'))
  assert(!a.messages[1].content.includes('additional evidence')); assert(!a.messages[1].content.includes('executed observation'))
  assert(b.messages[1].content.includes('additional evidence')); assert(b.messages[1].content.includes('previousAnswer'))
  assert(!JSON.stringify(a).includes('A8')); assert.throws(()=>claimsRequest(bundle,'boundary','expanded','test'))
})
test('validation checks all claims, source availability, revision states, case coverage and representations',()=>{
  assert.deepEqual(claimsDiagnostics(answer('boundary','initial'),bundle,'boundary','initial'),[])
  const a=answer('summary','initial');a.decisions[0].claims[0].evidenceRefs=['S2'];a.decisions[0].claims[1].falsifier='';a.decisions[0].claims[2].revision='retained'
  const issues=claimsDiagnostics(a,bundle,'summary','initial');assert.equal(issues.length,3)
  assert(claimsDiagnostics(null,bundle,'boundary','expanded').length>0)
  a.decisions=[null];assert.doesNotThrow(()=>claimsDiagnostics(a,bundle,'summary','initial'))
})
test('parser extraction retains inspected logic and records explicit projection; marker drift fails closed',()=>{
  const source={id:'S',text:'  return useMemo(() => {\n let badgeColor: "green" | "red" | "yellow";\n if (summary.startsWith("recommended")) return {color:"green" as const}; return {text:summary};\n  }, [summary]);'}
  const o=parserObservations(source);assert.equal(o.probes.length,5);assert(o.original.includes(' as const'));assert(!o.javascript.includes(' as const'));assert.equal(o.probes[2].output.text,'NOT RECOMMENDED. Too fast.')
  assert.throws(()=>parserObservations({text:'missing'}))
})
function temp(t) {
  mkdirSync('scratch', { recursive: true })
  const dir=mkdtempSync(join(resolve('scratch'), 'evolution-atlas-real-claims-test-'));writeImmutable(`${dir}/baseline.json`,{nodes:[]})
  t.after(()=>{try{rmSync(dir,{recursive:true,force:true})}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;t.diagnostic('Owned ignored fixture retained due cleanup permission')}})
  return {dir,o:{in:`${dir}/baseline.json`,out:`${dir}/live`}}
}
function fakeProvider(counter, cost=0.01) {
  return async request=>{counter.calls++;const condition=request.messages[0].content.includes('summaryA and summaryB')?'summary':'boundary';const stage=JSON.parse(request.messages[1].content).previousAnswer?'expanded':'initial';return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer(condition,stage))}}],usage:cost===null?{}:{cost},model:'test'}}
}
test('four calls preserve exact replay, revisions and frozen artifacts without another paid call',async t=>{
  const {dir,o}=temp(t),counter={calls:0};const result=await runRealClaims(o,{prepareBundle:()=>bundle,apiKey:'synthetic',requestProvider:fakeProvider(counter)})
  assert.equal(result.status,'completed');assert.equal(counter.calls,4)
  const replay=await runRealClaims({...o,out:`${dir}/replay`,'replay-from':o.out},{requestProvider:()=>assert.fail('live replay'),apiKey:null})
  assert.deepEqual(replay,result);assert.equal(readFileSync(`${dir}/replay/output.json`,'utf8'),readFileSync(`${o.out}/output.json`,'utf8'))
})
test('missing cost stops subsequent inference and failure messages are sanitized',async t=>{
  const {o}=temp(t), counter={calls:0}
  const result=await runRealClaims(o,{prepareBundle:()=>bundle,apiKey:'synthetic',requestProvider:fakeProvider(counter,null)})
  assert.equal(counter.calls,1);assert.equal(result.costComplete,false);assert.equal(result.status,'incomplete')
  const other={...o,out:o.out+'-failure'}
  const failed=await runRealClaims(other,{prepareBundle:()=>bundle,apiKey:'synthetic',requestProvider:async()=>{throw Error('HTTP 403: private-token')}})
  assert.equal(failed.results[0].httpStatus,403);assert(!JSON.stringify(failed).includes('private-token'))
})
test('orphan request and missing replay outcome never cause an automatic retry',async t=>{
  const {o}=temp(t)
  await runRealClaims({...o,prepare:true},{prepareBundle:()=>bundle})
  writeImmutable(`${o.out}/summary-initial.request.json`,JSON.parse(readFileSync(`${o.out}/planned-summary-initial.json`,'utf8')))
  await assert.rejects(runRealClaims(o,{prepareBundle:()=>bundle,apiKey:'synthetic',requestProvider:()=>assert.fail('retry')}),/without outcome/)
  await assert.rejects(runRealClaims({...o,out:o.out+'-replay','replay-from':o.out},{requestProvider:()=>assert.fail('retry')}),/without outcome/)
})
test('report escapes source and model content and does not score relationship labels',()=>{
  const value=answer('summary','initial');value.decisions[0].reason='<script>unsafe</script>'
  const html=renderRealClaims({status:'completed',cost:0,costComplete:true,manifest:{},results:[{condition:'summary',stage:'initial',status:'valid',value}],receipts:[]},bundle)
  assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('relation unscored'))
})
test('identifier reconciliation changes only exact placeholders and preserves invalid raw evidence',()=>{
  const raw=answer('boundary','initial');raw.decisions[0].claims.forEach((c,i)=>c.id=`CASE-C${i+1}`)
  const before=JSON.stringify(raw),r=qualifyClaimIds(raw,bundle)
  assert.equal(JSON.stringify(raw),before);assert.equal(r.changes.length,3)
  assert.deepEqual(r.value,answer('boundary','initial'));assert.deepEqual(claimsDiagnostics(r.value,bundle,'boundary','initial'),[])
  raw.decisions[0].claims[0].id='made-up';assert.equal(qualifyClaimIds(raw,bundle).changes.length,2)
})
test('reconciled run reuses initial paid outcomes and replays without requalifying semantics',async t=>{
  const {dir,o}=temp(t),counter={calls:0}
  await runRealClaims(o,{prepareBundle:()=>bundle,apiKey:'synthetic',requestProvider:async request=>{
    const p=await fakeProvider(counter)(request)
    if(request.messages[0].content.includes('boundaryA and boundaryB')){const a=JSON.parse(p.choices[0].message.content);a.decisions[0].claims.forEach((c,i)=>c.id=`CASE-C${i+1}`);p.choices[0].message.content=JSON.stringify(a)}
    return p
  }})
  assert.equal(counter.calls,2)
  const rec=await runRealClaims({...o,out:`${dir}/rec`,'reconcile-from':o.out},{apiKey:'synthetic',requestProvider:fakeProvider(counter)})
  assert.equal(counter.calls,4);assert.equal(rec.status,'completed');assert.equal(rec.results[1].original.status,'invalid')
  const replay=await runRealClaims({...o,out:`${dir}/replay`,'replay-from':`${dir}/rec`},{apiKey:null,requestProvider:()=>assert.fail('live replay')})
  assert.deepEqual(rec,replay)
})
test('isolated batch probe executes only the extracted acceptance block with stubbed model output',()=>{
  const source={id:'S',text:'        try:\n            result = json.loads(ai_model(summary_prompt))\n            existing_summaries["professors"].append(result)\n        except Exception:\n            flagged_data.append({"professor": prof_name, "id": prof_id})\n\n    print("Stage 6: Saving results.")'}
  const r=batchAcceptanceProbe(source)
  assert.deepEqual(r.probes[0].output.accepted,[{}]);assert.deepEqual(r.probes[1].output.accepted,[[]]);assert.equal(r.probes[4].output.flagged.length,1)
  assert.throws(()=>batchAcceptanceProbe({text:'missing'}))
})
