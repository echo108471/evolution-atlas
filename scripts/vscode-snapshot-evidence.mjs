#!/usr/bin/env node
/** Snapshot-only evidence broker. Never executes target code or calls a model. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
export const sha = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex')
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
export function saveNew(p, x) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(x, null, 2) + '\n', { flag: 'wx' })
}
export function safePath(p) {
  return !/(^|\/)(\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|SKILL\.md|node_modules|vendor|fixtures|\.git|\.agents)(\/|$)/i.test(p)
    && !/\.(key|pem|p12|pfx|lock|map|svg|png|jpg|woff2?|ttf)$/i.test(p)
    && !/(^|\/)(package-lock|yarn\.lock|pnpm-lock|Cargo\.lock|ThirdPartyNotices)/i.test(p)
    && /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|sh|css|html|json|ya?ml)$/.test(p)
}
function git(repo, args) { return execFileSync('git', ['--git-dir=' + repo, ...args], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }) }
export function assignPartitions(files) {
  const contrib = new Map()
  for (const f of files) if (f.path.startsWith('src/vs/workbench/contrib/')) {
    const key = f.path.split('/')[4]; contrib.set(key, (contrib.get(key) ?? 0) + f.size)
  }
  const bins = [0, 0, 0], groups = new Map()
  for (const [name, size] of [...contrib].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))) {
    const n = bins.indexOf(Math.min(...bins)); groups.set(name, ['C','D','E'][n]); bins[n] += size
  }
  return files.map(f => ({ ...f, partition: f.path.startsWith('src/vs/workbench/contrib/') ? groups.get(f.path.split('/')[4])
    : /^src\/vs\/(base|editor)\//.test(f.path) ? 'A'
      : /^src\/vs\/(platform|workbench)\//.test(f.path) ? 'B' : 'F' }))
}
export function prepare(repo, out, instructions) {
  repo = resolve(repo); out = resolve(out)
  execFileSync('git', ['check-ignore', '-q', out + '/manifest.json'])
  const commitSha = git(repo, ['rev-parse','HEAD']).trim()
  const all = git(repo, ['ls-tree','-rlz',commitSha]).split('\0').filter(Boolean).map(row => {
    const [meta,path] = row.split('\t'); const [mode,type,blobSha,size] = meta.trim().split(/\s+/)
    return {path,mode,type,blobSha,size:Number(size)}
  })
  const files = assignPartitions(all.filter(f => f.mode === '100644' || f.mode === '100755').filter(f => safePath(f.path) && f.size <= 1048576))
  saveNew(out + '/inventory.json', { commitSha, allTrackedEntries: all.length, eligibleFiles: files.length,
    omitted: all.filter(f => !files.some(x => x.path === f.path)).map(f=>({path:f.path,reason:'path/type/size eligibility; not inspected'})), files })
  const protocolText = readFileSync(instructions,'utf8')
  const manifest = { protocol:'vscode-subagent-snapshot-v1', repository:'https://github.com/microsoft/vscode', repo, commitSha,
    frozenAt: new Date().toISOString(), inference:'Codex subscription subagents; no external model API',
    initialization:'fresh context, source-only; no previous maps or owner labels',
    inventorySha256:sha(readJson(out+'/inventory.json')), instructionSha256:sha(protocolText),
    brokerSha256:sha(readFileSync(new URL(import.meta.url),'utf8')),
    partitions:['A','B','C','D','E','F'], maxConcurrentDiscoveryAgents:3,
    budgets:{perAgent:{windows:20,searches:8,evidenceBytes:72000,linesPerWindow:160,bytesPerWindow:16000},reconciler:{windows:12,searches:4,evidenceBytes:48000,linesPerWindow:160,bytesPerWindow:16000}},
    stages:['six independent discovery assignments','one global reconciliation','structural/provenance validation','one structural-only correction if needed','complete report before owner review'],
    statusPolicy:'all nodes and edges candidate; proposer assessment distinct from independent verification (not performed); errors annotate affected claims',
    limitations:['Public repository may be familiar from training','Snapshot only, no historical conclusions','Bounded sampling is not exhaustive coverage','New model/orchestration/initialization variant, not exact API baseline','No runtime or semantic correctness verification','Agent instructions enforce browsing discipline; broker enforces retrieval limits; no hard total-token limit'],
    baselineGraphSha256:sha(readJson('public/graph-reviews/whole-project-2-etl/output.json')) }
  saveNew(out+'/manifest.json',manifest)
  return { ...manifest, eligibleFiles:files.length, assignments:Object.fromEntries(manifest.partitions.map(p=>[p,{files:files.filter(f=>f.partition===p).length,bytes:files.filter(f=>f.partition===p).reduce((s,f)=>s+f.size,0)}])) }
}
export function broker(out, agent, action, args) {
  if(!/^(A|B|C|D|E|F|R)$/.test(agent)) throw new Error('unknown agent')
  const m=readJson(out+'/manifest.json'), inv=readJson(out+'/inventory.json')
  if(sha(inv)!==m.inventorySha256)throw new Error('inventory changed')
  if(sha(readFileSync(new URL(import.meta.url),'utf8'))!==m.brokerSha256)throw new Error('broker changed after freeze')
  const dir=out+'/receipts/'+agent, prior=existsSync(dir)?readdirSync(dir).filter(p=>p.endsWith('.json')).sort().map(p=>readJson(dir+'/'+p)):[]
  const budget=agent==='R'?m.budgets.reconciler:m.budgets.perAgent
  if(action==='list') {
    const [prefix='',offset='0']=args, start=Number(offset)
    if(!Number.isInteger(start)||start<0)throw new Error('invalid offset')
    const files=inv.files.filter(f=>(!prefix ? agent==='R'||f.partition===agent : f.path.startsWith(prefix)))
    return {total:files.length,offset:start,nextOffset:start+150<files.length?start+150:null,files:files.slice(start,start+150)}
  }
  const bytes=prior.reduce((s,r)=>s+Buffer.byteLength(JSON.stringify(r)),0)
  if(bytes>=budget.evidenceBytes)throw new Error('evidence byte budget reached')
  const id=agent+'-'+String(prior.length+1).padStart(3,'0')
  let record
  if(action==='read') {
    if(prior.filter(r=>r.kind==='source').length>=budget.windows)throw new Error('window budget reached')
    const [path,startArg='1',countArg='120']=args, f=inv.files.find(f=>f.path===path)
    if(!f)throw new Error('path not eligible')
    const start=Number(startArg),count=Number(countArg)
    if(!Number.isInteger(start)||start<1||!Number.isInteger(count)||count<1||count>budget.linesPerWindow)throw new Error('invalid window')
    const text=git(m.repo,['cat-file','blob',f.blobSha])
    if(text.includes('\0')||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bsk-proj-[A-Za-z0-9_-]{50,}/.test(text))throw new Error('binary or secret-shaped blob excluded; stop using this file')
    const lines=text.split('\n');if(start>lines.length)throw new Error('start beyond file')
    let selected=lines.slice(start-1,start-1+count)
    while(Buffer.byteLength(selected.join('\n'))>budget.bytesPerWindow)selected.pop()
    if(!selected.length)throw new Error('line exceeds byte cap')
    record={id,kind:'source',commitSha:m.commitSha,blobSha:f.blobSha,path,startLine:start,endLine:start+selected.length-1,totalLines:lines.length,
      partition:f.partition,crossPartition:agent!=='R'&&agent!==f.partition,text:selected.join('\n'),truncated:start>1||start+selected.length-1<lines.length}
  } else if(action==='search') {
    if(prior.filter(r=>r.kind==='search').length>=budget.searches)throw new Error('search budget reached')
    const [prefix,literal]=args;if(!prefix||!literal||literal.length>100)throw new Error('prefix and short literal required')
    const paths=inv.files.filter(f=>f.path.startsWith(prefix)).map(f=>f.path)
    let matches=[]
    // Read eligible immutable blobs only; never search excluded files or instructions.
    for(const path of paths){const f=inv.files.find(f=>f.path===path); const s=git(m.repo,['cat-file','blob',f.blobSha]);
      s.split('\n').forEach((line,n)=>{if(line.includes(literal))matches.push({path,line:n+1})})}
    record={id,kind:'search',commitSha:m.commitSha,prefix,literal,searchedFiles:paths.length,totalMatches:matches.length,matches:matches.slice(0,50),omittedMatches:Math.max(0,matches.length-50),note:'locations only; not support until source window inspected'}
  }else throw new Error('unknown action')
  if(bytes+Buffer.byteLength(JSON.stringify(record))>budget.evidenceBytes)throw new Error('request would exceed evidence byte budget; request fewer lines')
  saveNew(dir+'/'+id+'.json',record);return record
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const [action,...args]=process.argv.slice(2);let r
    if(action==='prepare')r=prepare(...args)
    else{const [out,agent,...rest]=args;r=broker(resolve(out),agent,action,rest)}
    process.stdout.write(JSON.stringify(r,null,2)+'\n')
  }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
