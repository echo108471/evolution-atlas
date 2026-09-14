#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { DEFAULT_MODEL, API_KEY_ENV, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { writeImmutable } from './run-behavior-ownership.mjs'
import { scopeReviewRequest, reviewDiagnostics } from './lib/claim-scope-review.mjs'
const read=p=>JSON.parse(readFileSync(p,'utf8'))
export function scopeInputs(prior,bundle,batchChecks){
  return Object.fromEntries(['summary','boundary'].map(condition=>{
    const rows=['initial','expanded'].map(stage=>prior.results.find(r=>r.condition===condition&&r.stage===stage))
    if(rows.some(r=>r?.status!=='valid'))throw Error('Expected valid interpreted records; preserve original normalization provenance separately')
    return [condition,{cases:bundle.cases,documents:{previous:rows[0].value,current:rows[1].value},evidence:[...bundle.initial,...bundle.additional],observations:bundle.observations,batchChecks}]
  }))
}
export async function runScopeReview(o,{requestProvider=requestHierarchyCriticRequestPayload,apiKey=process.env[API_KEY_ENV]}={}){
  const out=resolve(o.out),baseline=read(o.in),prior=read(`${o.prior}/output.json`),bundle=read(`${o.prior}/bundle.json`),batchChecks=read(`${o.prior}/batch-counterexamples.json`)
  execFileSync('git',['check-ignore','-q',`${out}/output.json`])
  const inputs=scopeInputs(prior,bundle,batchChecks)
  const manifest={protocol:'claim-scope-review-v1',baselineSha256:hash(baseline),priorSha256:hash(prior),bundleSha256:hash(bundle),batchChecksSha256:hash(batchChecks),model:DEFAULT_MODEL,
    design:'Fresh reviewer calls on each prior expanded answer plus its prior initial answer. Factor: original evidence versus original evidence plus post-answer isolated batch acceptance checks. Four cells: summary-source, boundary-checks, boundary-source, summary-checks. No root audit findings, owner taxonomy, preferred relations, cross-arm answers or prior reviewer outputs supplied. All requests frozen before inference. Review produces explicit scoped decisions and located corrections; no patches applied and no correction calls.',
    limits:{maxRequests:4,maxPromptCharacters:105000,maxOutputTokens:9000,costStopBeforeNextRequest:0.75,note:'Recorded-cost stop before the next request, not an in-flight hard ceiling.'},
    limitations:'One same-model reviewer sample per cell; not an independent model family or research team. Three related, familiar cases with known errors, not a held-out benchmark. Audit instructions target general failure classes learned from prior runs. Added checks isolate exposure to this diagnostic evidence, not all possible evidence. Revising a label is not necessarily improvement. All proposals require source-grounded assessment.',applicationStatus:'not-applied'}
  writeImmutable(`${out}/manifest.json`,manifest);writeImmutable(`${out}/inputs.json`,inputs)
  const cells=[['summary',false],['boundary',true],['boundary',false],['summary',true]].map(([target,withChecks])=>({target,withChecks,name:`${target}-${withChecks?'checks':'source'}`,request:scopeReviewRequest(inputs[target],withChecks,DEFAULT_MODEL)}))
  for(const c of cells){if(c.request.messages.reduce((n,m)=>n+m.content.length,0)>manifest.limits.maxPromptCharacters)throw Error('Prompt budget exceeded');writeImmutable(`${out}/planned-${c.name}.json`,c.request)}
  if(o.prepare)return {status:'prepared-not-run'}
  const results=[],receipts=[]
  for(const c of cells){
    const stem=`${resolve(o['replay-from']??out)}/${c.name}`;let payload,failure
    if(existsSync(`${stem}.request.json`)){
      if(hash(read(`${stem}.request.json`))!==hash(c.request))throw Error('Saved request mismatch')
      if(existsSync(`${stem}.response.json`))payload=read(`${stem}.response.json`)
      else if(existsSync(`${stem}.failure.json`))failure=read(`${stem}.failure.json`)
      else throw Error('Request without outcome; reconcile before retry')
    }else{
      if(o['replay-from'])throw Error('Missing replay response; no live fallback')
      if(receipts.some(r=>!Number.isFinite(r.usage.cost)||r.usage.cost<0)||receipts.reduce((n,r)=>n+r.usage.cost,0)>=manifest.limits.costStopBeforeNextRequest)break
      if(!apiKey)throw Error('Provider key unavailable')
      writeImmutable(`${stem}.request.json`,c.request);process.stderr.write(`${c.name}: requesting\n`)
      try{payload=await requestProvider(c.request,{apiKey})}catch(e){failure={httpStatus:Number(e.message?.match(/^HTTP (\d{3}):/)?.[1])||null,error:'Provider failure; no automatic retry. Reconcile before another attempt.'};writeImmutable(`${stem}.failure.json`,failure)}
      if(payload)writeImmutable(`${stem}.response.json`,payload)
    }
    writeImmutable(`${out}/${c.name}.request.json`,c.request)
    if(payload)writeImmutable(`${out}/${c.name}.response.json`,payload)
    if(failure)writeImmutable(`${out}/${c.name}.failure.json`,failure)
    let result
    if(failure)result={status:'provider_error',...failure}
    else try{const value=parseResponse(payload),issues=reviewDiagnostics(value,inputs[c.target],c.withChecks);result={status:issues.length?'invalid':'valid',value,issues}}catch(e){result={status:'invalid',issues:[{path:'$',issue:e.message}]}}
    results.push({target:c.target,withChecks:c.withChecks,name:c.name,...result});receipts.push({name:c.name,requestSha256:hash(c.request),status:result.status,model:payload?.model??c.request.model,usage:payload?.usage??{}})
    writeImmutable(`${out}/${c.name}.result.json`,results.at(-1));writeImmutable(`${out}/receipts-${receipts.length}.json`,receipts)
    process.stderr.write(`${c.name}: ${result.status}\n`);if(failure)break
  }
  if(hash(read(o.in))!==manifest.baselineSha256)throw Error('Accepted graph changed')
  const output={manifest,results,receipts,status:results.length===4?'calls-completed':'incomplete',allStructurallyValid:results.length===4&&results.every(r=>r.status==='valid'),cost:receipts.reduce((n,r)=>n+(Number.isFinite(r.usage.cost)?r.usage.cost:0),0),costComplete:receipts.every(r=>Number.isFinite(r.usage.cost)),applicationStatus:'not-applied'}
  writeImmutable(`${out}/output.json`,output);return output
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{
  const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i++){if(args[i]==='--prepare'){o.prepare=true;continue}if(!['--in','--out','--prior','--replay-from'].includes(args[i])||!args[i+1])throw Error('Invalid arguments');o[args[i].slice(2)]=args[++i]}
  for(const k of ['in','out','prior'])if(!o[k])throw Error(`Missing ${k}`)
  const r=await runScopeReview(o);process.stdout.write(JSON.stringify({status:r.status,allStructurallyValid:r.allStructurallyValid,cost:r.cost,costComplete:r.costComplete})+'\n')
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}}
