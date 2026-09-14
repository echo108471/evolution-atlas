#!/usr/bin/env node
/** Offline candidate-map accounting and report. No inference, no semantic repair. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readJson, saveNew, sha } from './vscode-snapshot-evidence.mjs'
export function graphIssues(graph, receipts, originals=null) {
  const errors=[], ids=new Set(), source=new Set(receipts.filter(r=>r.kind==='source').map(r=>r.id))
  const issue=(target,message)=>errors.push({target,message})
  const cites=(x,target)=>{if(!Array.isArray(x.evidenceIds))issue(target,'evidenceIds array missing');else{
    for(const ref of x.evidenceIds)if(!source.has(ref))issue(target,`unknown or non-source evidence ${ref}`)
    if(x.assessment!=='unresolved'&&!x.evidenceIds.length)issue(target,'non-unresolved claim has no source citation')
  }}
  if(!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))return[{target:'graph',message:'nodes and edges arrays required'}]
  for(const n of graph.nodes){
    if(typeof n.id!=='string'||!n.id||ids.has(n.id))issue(n.id??'node','missing/duplicate ID');ids.add(n.id)
    for(const k of ['name','summary','actor'])if(typeof n[k]!=='string'||!n[k].trim())issue(n.id,`${k} missing`)
    for(const k of ['inputs','outcomes','conditions','exclusions','implementations','uncertainty','claims'])if(!Array.isArray(n[k]))issue(n.id,`${k} array missing`)
    if(!['supported','partial','unresolved'].includes(n.assessment))issue(n.id,'invalid proposer assessment')
    cites(n,n.id)
    for(const [i,c]of(n.claims??[]).entries()){if(!c.text)issue(n.id,`claim ${i} text missing`);if(!['supported','partial','unresolved'].includes(c.assessment))issue(n.id,`claim ${i} assessment invalid`);cites(c,`${n.id}:claim${i}`)}
  }
  const edgeKeys=new Set(), child=new Map([...ids].map(id=>[id,[]]))
  for(const[e,i]of graph.edges.map((e,i)=>[e,i])){
    const target=`edge:${i+1}`,key=[e.from,e.to,e.type].join(':')
    if(!ids.has(e.from)||!ids.has(e.to))issue(target,'dangling endpoint')
    if(e.from===e.to)issue(target,'self edge')
    if(edgeKeys.has(key))issue(target,'duplicate edge');edgeKeys.add(key)
    if(!['contains','depends_on','supports','overlaps'].includes(e.type))issue(target,'unknown relationship type')
    if(!e.reason)issue(target,'reason missing')
    if(!['supported','partial','unresolved'].includes(e.assessment))issue(target,'invalid assessment')
    cites(e,target);if(e.type==='contains'&&child.has(e.from)&&child.has(e.to))child.get(e.from).push(e.to)
  }
  const done=new Set(),active=new Set()
  function visit(id){if(active.has(id)){issue(id,'containment cycle');return}if(done.has(id))return;active.add(id);for(const c of child.get(id)??[])visit(c);active.delete(id);done.add(id)}
  for(const id of ids)visit(id)
  if(originals){const lineage=graph.lineage??[],seen=new Set()
    for(const l of lineage){if(seen.has(l.originalId)||!originals.includes(l.originalId))issue(l.originalId,'duplicate/unknown lineage original');seen.add(l.originalId)
      if(!['retain','merge','split','rename','remove'].includes(l.decision))issue(l.originalId,'invalid lineage decision')
      if(!l.reason||!Array.isArray(l.successorIds)||l.successorIds.some(id=>!ids.has(id)))issue(l.originalId,'invalid lineage successors/reason')
      if(l.decision!=='remove'&&!l.successorIds?.length)issue(l.originalId,'non-removal missing successor')
    }
    for(const id of originals)if(!seen.has(id))issue(id,'missing lineage')
    for(const[d,i]of(graph.decisions??[]).map((d,i)=>[d,i])){if(!d.question||!d.decision||!d.reason||!Array.isArray(d.uncertainty))issue(`decision:${i}`,'incomplete decision');cites({...d,assessment:'unresolved'},`decision:${i}`)}
  }
  return errors
}
export function intervalCoverage(receipts){
  const files=new Map()
  for(const r of receipts.filter(r=>r.kind==='source')){if(!files.has(r.path))files.set(r.path,new Set());for(let n=r.startLine;n<=r.endLine;n++)files.get(r.path).add(n)}
  return{files:files.size,uniqueLines:[...files.values()].reduce((s,v)=>s+v.size,0)}
}
export function assemble(out){
  const manifest=readJson(out+'/manifest.json'),inventory=readJson(out+'/inventory.json')
  if(sha(inventory)!==manifest.inventorySha256)throw new Error('inventory hash mismatch')
  if(sha(readFileSync(out+'/protocol.md','utf8'))!==manifest.instructionSha256)throw new Error('frozen protocol changed')
  if(sha(readFileSync(new URL('./vscode-snapshot-evidence.mjs',import.meta.url),'utf8'))!==manifest.brokerSha256)throw new Error('broker changed')
  const receipts=[],proposals=[],fingerprints={},provenanceIssues=[]
  for(const agent of [...manifest.partitions,'R']){
    const dir=out+'/receipts/'+agent
    if(existsSync(dir))for(const p of readdirSync(dir).filter(p=>p.endsWith('.json')).sort()){const r=readJson(dir+'/'+p);receipts.push(r);fingerprints['receipts/'+agent+'/'+p]=sha(readFileSync(dir+'/'+p,'utf8'))}
    const proposal=out+'/proposals/'+agent+'.json'
    if(existsSync(proposal)){const value=readJson(proposal);proposals.push(value);fingerprints['proposals/'+agent+'.json']=sha(readFileSync(proposal,'utf8'))}
  }
  const known=new Map(inventory.files.map(f=>[f.path,f])),git=(args)=>execFileSync('git',['--git-dir='+manifest.repo,...args],{encoding:'utf8',maxBuffer:3*1024*1024})
  for(const r of receipts.filter(r=>r.kind==='source')){
    const f=known.get(r.path)
    if(!f||r.blobSha!==f.blobSha||r.commitSha!==manifest.commitSha){provenanceIssues.push({target:r.id,message:'source identity mismatch'});continue}
    const text=git(['cat-file','blob',r.blobSha]).split('\n').slice(r.startLine-1,r.endLine).join('\n')
    if(text!==r.text)provenanceIssues.push({target:r.id,message:'source excerpt mismatch'})
  }
  if(existsSync(out+'/reconciliation-input.json')){
    const packet=readJson(out+'/reconciliation-input.json')
    for(const p of packet.proposals)if(fingerprints[p.path]!==p.sha256)provenanceIssues.push({target:p.path,message:'original proposal changed after reconciliation input freeze'})
    if(packet.commitSha!==manifest.commitSha)provenanceIssues.push({target:'reconciliation-input',message:'snapshot identity mismatch'})
  }
  const proposalIssues=proposals.flatMap(p=>graphIssues(p,receipts.filter(r=>r.id.startsWith(p.agent+'-'))).map(e=>({...e,agent:p.agent})))
  const complete=manifest.partitions.every(a=>proposals.some(p=>p.agent===a)),reconciledPath=out+'/reconciled.json'
  const graph=existsSync(reconciledPath)?readJson(reconciledPath):null
  if(graph)fingerprints['reconciled.json']=sha(readFileSync(reconciledPath,'utf8'))
  const issues=graph?graphIssues(graph,receipts,proposals.flatMap(p=>p.nodes.map(n=>n.id))):[]
  const coverage={eligibleFiles:inventory.eligibleFiles,allTrackedEntries:inventory.allTrackedEntries,...intervalCoverage(receipts),
    assignments:manifest.partitions.map(a=>({agent:a,eligibleFiles:inventory.files.filter(f=>f.partition===a).length,
      ...intervalCoverage(receipts.filter(r=>r.partition===a)),retrievals:receipts.filter(r=>r.id.startsWith(a+'-')).length,
      returned:proposals.some(p=>p.agent===a)}))}
  const baselineUnchanged=sha(readJson('public/graph-reviews/whole-project-2-etl/output.json'))===manifest.baselineGraphSha256
  return{protocol:manifest.protocol,manifest,completeAssignments:complete,status:graph&&complete?'candidate-map-produced':'incomplete',
    independentVerification:'not-performed',externalModelApiCalls:0,externalModelApiCost:0,subscriptionUsage:'shared allowance; no per-agent cost receipt',
    interpretationStatus:'candidate',graph,proposals,receipts,coverage,proposalIssues,graphIssues:issues,provenanceIssues,
    baselineUnchanged,inputFingerprints:fingerprints,
    amendments:existsSync(out+'/amendments.json')?readJson(out+'/amendments.json'):[],
    executionRecord:existsSync(out+'/execution-record.json')?readJson(out+'/execution-record.json'):null,
    exclusions:inventory.omitted,limitations:manifest.limitations}
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const list=xs=>`<ul>${(xs??[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`
const raw=x=>`<pre>${esc(JSON.stringify(x,null,2))}</pre>`
export function render(output){
  const graph=output.graph??{nodes:output.proposals.flatMap(p=>p.nodes),edges:output.proposals.flatMap(p=>p.edges)},nodeMap=new Map(graph.nodes.map(n=>[n.id,n]))
  const refs=ids=>(ids??[]).map(id=>`<a href="#evidence-${esc(id)}">${esc(id)}</a>`).join(', ')
  const link=id=>`<a href="#${esc(id)}">${esc(nodeMap.get(id)?.name??id)}</a>`
  const roots=graph.nodes.filter(n=>!graph.edges.some(e=>e.type==='contains'&&e.to===n.id))
  const groupedRoots=roots.filter(n=>graph.edges.some(e=>e.type==='contains'&&e.from===n.id)),standaloneRoots=roots.filter(n=>!groupedRoots.includes(n))
  function branch(n,ancestors=[]){if(ancestors.includes(n.id))return`<li>${link(n.id)} (cycle)</li>`;const children=graph.edges.filter(e=>e.type==='contains'&&e.from===n.id).map(e=>nodeMap.get(e.to)).filter(Boolean)
    return`<li>${link(n.id)}${children.length?`<ul>${children.map(c=>branch(c,[...ancestors,n.id])).join('')}</ul>`:''}</li>`}
  const sourceReceipts=output.receipts.filter(r=>r.kind==='source')
  return`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VS Code — candidate capability map</title><style>
body{margin:0;font:16px/1.6 system-ui;color:#23333e;background:#f7f8fa}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:34px;line-height:1.2}h2{margin-top:38px}a{color:#175b9b}nav{display:flex;gap:18px;flex-wrap:wrap}.notice{padding:16px;border-left:4px solid #c18b26;background:#fff3d8}.overview{columns:2;column-gap:36px}.overview>li{break-inside:avoid;margin-bottom:14px}.capability{background:white;border:1px solid #d4dce3;border-radius:8px;padding:20px;margin:20px 0;scroll-margin-top:12px}.capability h2{margin-top:0}.meta{color:#4a6170;font-size:14px}details{border-top:1px solid #d4dce3;padding:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#edf1f5;padding:12px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;border:1px solid #d4dce3;text-align:left;vertical-align:top}th{font-weight:600}.table{overflow:auto}code{overflow-wrap:anywhere}ul{padding-left:22px}section{scroll-margin-top:12px}@media(max-width:720px){main{padding:16px}.overview{columns:1}h1{font-size:28px}.capability{padding:14px}}@media(prefers-color-scheme:dark){body{background:#17212a;color:#e2e9ee}.capability,table{background:#202e39}a{color:#91c5f4}.meta{color:#b4c7d5}pre{background:#283846}.notice{background:#3b321e}}
</style><main><nav><a href="../experiment-summary/index.html">All experiments</a><a href="#map">Map</a><a href="#capabilities">All capabilities</a><a href="#relationships">Relationships</a><a href="#coverage">Coverage</a><a href="#records">Evidence & raw records</a></nav>
<h1>VS Code: a first capability map</h1><p>A source-grounded candidate interpretation of Code–OSS at <a href="https://github.com/microsoft/vscode/tree/${output.manifest.commitSha}">${output.manifest.commitSha.slice(0,12)}</a>. Source presence does not establish availability in your installed VS Code build.</p>
<p class="notice">${output.status==='incomplete'?'Internal partial preview; assignments and reconciliation are not yet complete.':'Complete resulting output, not exhaustive repository coverage.'} All capabilities and relationships are candidates. Assessments below are the proposing model’s judgments; independent verification has not been performed. No historical claims are evaluated in this snapshot experiment.</p>
<p>${graph.nodes.length} capabilities · ${graph.edges.length} relationships · ${sourceReceipts.length} source windows · ${output.coverage.files.toLocaleString()} / ${output.coverage.eligibleFiles.toLocaleString()} eligible files inspected · no external model API calls.</p>
<p>Your review: does this broadly make sense, does it help you understand the project, and are important areas obviously missing? No feedback has been used to tune this output.</p>
${output.amendments.length?`<details open><summary>Protocol changes and limits</summary>${raw(output.amendments)}</details>`:''}
${output.graphIssues.length||output.provenanceIssues.length||output.proposalIssues.length?`<details open><summary>Validation issues — retained, not hidden</summary>${raw({graph:output.graphIssues,provenance:output.provenanceIssues,proposals:output.proposalIssues})}</details>`:''}
<section id="map"><h2>Capability organization</h2><p>Indented items show proposed containment. A capability can appear beneath multiple parents. Other relationship types are listed separately below.</p>${groupedRoots.length?`<h3>Broader groupings</h3><ul class="overview">${groupedRoots.map(n=>branch(n)).join('')}</ul>`:''}${standaloneRoots.length?`<h3>Other capabilities</h3><p>These remain independently visible, not placed under the groupings above. This does not mean they are less important or have no broader relationships.</p><ul class="overview">${standaloneRoots.map(n=>branch(n)).join('')}</ul>`:''}</section>
<section id="capabilities"><h2>Every capability</h2>${graph.nodes.map(n=>`<article class="capability" id="${esc(n.id)}"><h2>${esc(n.name)}</h2><p>${esc(n.summary)}</p><p class="meta">${esc(n.id)} · candidate · proposer assessment: ${esc(n.assessment)} · independently verified: not performed</p><p><strong>Actor:</strong> ${esc(n.actor)}</p><p><strong>Observable outcomes</strong></p>${list(n.outcomes)}<p><strong>Conditions</strong></p>${list(n.conditions)}<p><strong>Outside this scope</strong></p>${list(n.exclusions)}${n.uncertainty?.length?`<p><strong>Uncertainty</strong></p>${list(n.uncertainty)}`:''}<p><strong>Source:</strong> ${refs(n.evidenceIds)}</p><details><summary>Inputs, implementations and individual claims</summary><h3>Inputs</h3>${list(n.inputs)}<h3>Implementations</h3>${list(n.implementations)}${(n.claims??[]).map(c=>`<p>${esc(c.text)}<br><span class="meta">Proposer: ${esc(c.assessment)} · ${refs(c.evidenceIds)} · independent verification: not performed</span></p>`).join('')}</details><details><summary>Relationships involving this capability</summary>${graph.edges.filter(e=>e.from===n.id||e.to===n.id).map(e=>`<p>${link(e.from)} — ${esc(e.type)} → ${link(e.to)}<br>${esc(e.reason)}<br><span class="meta">${esc(e.assessment)} · ${refs(e.evidenceIds)}</span></p>`).join('')||'<p>No relationship proposed.</p>'}</details></article>`).join('')}</section>
<section id="relationships"><h2>Every relationship</h2><div class="table"><table><thead><tr><th>From</th><th>Relationship / to</th><th>Reason & source</th></tr></thead><tbody>${graph.edges.map(e=>`<tr><td>${link(e.from)}</td><td>${esc(e.type)} → ${link(e.to)}</td><td>${esc(e.reason)}<br><small>Candidate · proposer ${esc(e.assessment)} · ${refs(e.evidenceIds)}</small></td></tr>`).join('')}</tbody></table></div></section>
<section id="coverage"><h2>What was and wasn’t inspected</h2><p>${output.coverage.uniqueLines.toLocaleString()} unique source lines inspected. File coverage counts a file once even if only a small excerpt was read. This is not a percentage of capabilities discovered.</p><div class="table"><table><thead><tr><th>Assignment</th><th>Eligible files</th><th>Files with inspected excerpts</th><th>Unique lines</th></tr></thead><tbody>${output.coverage.assignments.map(a=>`<tr><td>${a.agent}</td><td>${a.eligibleFiles}</td><td>${a.files}</td><td>${a.uniqueLines}</td></tr>`).join('')}</tbody></table></div>${output.proposals.map(p=>`<details><summary>Assignment ${esc(p.agent)} — scope and omissions</summary><p>${esc(p.scopeSummary)}</p>${raw(p.coverage)}<h3>Cross-assignment leads</h3>${list(p.crossPartitionLeads)}</details>`).join('')}<h3>Limitations</h3>${list([...output.limitations,...(graph.limitations??[])])}</section>
<section id="records"><h2>Evidence and frozen records</h2><p><a href="output.json">Full output</a> · <a href="manifest.json">Frozen manifest</a> · <a href="protocol.md">Frozen procedure</a> · <a href="inventory.json">Source inventory</a>${output.graph?' · <a href="reconciled.json">Original reconciler output</a>':''}</p><details><summary>Global scope decisions and lineage</summary>${raw({decisions:graph.decisions,lineage:graph.lineage})}</details>${output.proposals.map(p=>`<details><summary>Unedited proposal ${esc(p.agent)}</summary><a href="proposals/${esc(p.agent)}.json">Raw JSON</a>${raw(p)}</details>`).join('')}
${sourceReceipts.map(r=>`<details id="evidence-${esc(r.id)}"><summary>${esc(r.id)} · ${esc(r.path)}:${r.startLine}–${r.endLine}</summary><p><a href="https://github.com/microsoft/vscode/blob/${r.commitSha}/${r.path.split('/').map(encodeURIComponent).join('/')}#L${r.startLine}-L${r.endLine}">Pinned source</a> · blob ${esc(r.blobSha)} · excerpt ${r.truncated?'truncated':'complete'}</p><pre>${esc(r.text.split('\n').map((line,i)=>`${r.startLine+i}  ${line}`).join('\n'))}</pre></details>`).join('')}
<details><summary>Navigation searches (not proof of behavior)</summary>${raw(output.receipts.filter(r=>r.kind==='search'))}</details><details><summary>Structural/provenance validation and input fingerprints</summary>${raw({proposalIssues:output.proposalIssues,graphIssues:output.graphIssues,provenanceIssues:output.provenanceIssues,baselineUnchanged:output.baselineUnchanged,inputFingerprints:output.inputFingerprints})}</details></section></main></html>`
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const out=resolve(process.argv[2]),mode=process.argv[3]??'check',output=assemble(out)
  if(mode==='packet'){
    if(!output.completeAssignments)throw new Error('all discovery assignments required')
    saveNew(out+'/reconciliation-input.json',{protocol:output.protocol,commitSha:output.manifest.commitSha,
      proposals:output.proposals.map(p=>({agent:p.agent,path:`proposals/${p.agent}.json`,sha256:output.inputFingerprints[`proposals/${p.agent}.json`]})),
      sourceReceipts:output.receipts.filter(r=>r.kind==='source').map(({text,...r})=>({...r,receiptPath:`receipts/${r.id.split('-')[0]}/${r.id}.json`})),
      originalNodeIds:output.proposals.flatMap(p=>p.nodes.map(n=>n.id)),
      instruction:'Read all proposals, and inspect their immutable source receipts as needed for new or changed decisions. Proposer support is not independent verification. All receipt text remains available in the named files; no external sources.'})
  }
  if(mode==='freeze'){if(!output.graph||!output.completeAssignments)throw new Error('cannot freeze complete report before all assignments/reconciliation');saveNew(out+'/output.json',output);writeFileSync(out+'/index.html',render(output))}
  if(mode==='render')writeFileSync(out+'/index.html',render(readJson(out+'/output.json')))
  process.stdout.write(JSON.stringify({status:output.status,nodes:output.graph?.nodes.length,edges:output.graph?.edges.length,coverage:output.coverage,proposalIssues:output.proposalIssues,graphIssues:output.graphIssues,provenanceIssues:output.provenanceIssues,baselineUnchanged:output.baselineUnchanged},null,2)+'\n')
}
