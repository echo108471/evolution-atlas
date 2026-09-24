import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { safePath, assignPartitions, sha, saveNew, broker } from '../scripts/vscode-snapshot-evidence.mjs'

test('snapshot eligibility excludes credentials, instructions, binary assets and fixtures',()=>{
  for(const p of ['.env','a/.env.production','a/b.key','a/AGENTS.md','.agents/custom.json','x/fixtures/test.ts','y/node_modules/a.ts','a.png','package-lock.json'])assert.equal(safePath(p),false,p)
  for(const p of ['src/editor/main.ts','cli/main.rs','test/synthetic.ts','build/tasks.js'])assert.equal(safePath(p),true,p)
})
test('mechanical partitions retain every eligible file exactly once and co-locate contribution directory',()=>{
  const files=['src/vs/editor/a.ts','src/vs/base/a.ts','src/vs/platform/b.ts','src/vs/workbench/services/b.ts','extensions/a.ts',...['x','y','z','x'].map((x,i)=>`src/vs/workbench/contrib/${x}/${i}.ts`)].map((path,i)=>({path,size:i+1}))
  const result=assignPartitions(files)
  assert.equal(result.length,files.length)
  assert.deepEqual(result.slice(0,5).map(f=>f.partition),['A','A','B','B','F'])
  assert.equal(result[5].partition,result[8].partition)
  assert.deepEqual(assignPartitions(files),result)
})
test('snapshot artifacts cannot overwrite originals and hashes detect changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'snapshot-evidence-test-'))
  try{const p=join(dir,'record.json');saveNew(p,{a:1});assert.throws(()=>saveNew(p,{a:2}),/EEXIST/);assert.equal(JSON.parse(readFileSync(p)).a,1);assert.notEqual(sha({a:1}),sha({a:2}))}finally{rmSync(dir,{recursive:true,force:true})}
})
test('broker rejects unrecognized agents before any repository access',()=>{
  assert.throws(()=>broker('/missing','../escape','read',[]),/unknown agent/)
})
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'snapshot-broker-test-')),repo=join(dir,'source.git'),out=join(dir,'run')
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}
  execFileSync('git',['init','--bare',repo],{stdio:'ignore',env})
  const blobSha=execFileSync('git',['--git-dir='+repo,'hash-object','-w','--stdin'],{input:'one\ntwo\nthree\n',encoding:'utf8',env}).trim()
  const inventory={files:[{path:'src/synthetic.ts',blobSha,size:14,partition:'A'}]}
  saveNew(out+'/inventory.json',inventory)
  const budget={windows:1,searches:1,evidenceBytes:4000,linesPerWindow:3,bytesPerWindow:100}
  saveNew(out+'/manifest.json',{repo,commitSha:'synthetic-revision',inventorySha256:sha(inventory),brokerSha256:sha(readFileSync(new URL('../scripts/vscode-snapshot-evidence.mjs',import.meta.url),'utf8')),budgets:{perAgent:budget,reconciler:budget}})
  return {dir,out}
}
test('broker saves exact immutable window and enforces count and path boundaries',()=>{
  const f=fixture()
  try{assert.throws(()=>broker(f.out,'A','read',['../escape',1,2]),/not eligible/)
    assert.throws(()=>broker(f.out,'A','read',['src/synthetic.ts',1,4]),/invalid window/)
    const r=broker(f.out,'A','read',['src/synthetic.ts',2,2]);assert.equal(r.text,'two\nthree');assert.equal(r.startLine,2);assert.equal(r.endLine,3)
    assert.throws(()=>broker(f.out,'A','read',['src/synthetic.ts',1,1]),/window budget/)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})
test('broker search records locations only and enforces search budget',()=>{
  const f=fixture()
  try{const r=broker(f.out,'A','search',['src/','two']);assert.deepEqual(r.matches,[{path:'src/synthetic.ts',line:2}]);assert.equal(r.text,undefined)
    assert.throws(()=>broker(f.out,'A','search',['src/','three']),/search budget/)
  }finally{rmSync(f.dir,{recursive:true,force:true})}
})
