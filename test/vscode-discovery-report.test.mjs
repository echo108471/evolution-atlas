import test from 'node:test'
import assert from 'node:assert/strict'
import { graphIssues, intervalCoverage, render } from '../scripts/report-vscode-discovery.mjs'
const receipts=[{id:'A-001',kind:'source',path:'src/synthetic.ts',startLine:1,endLine:3,text:'first\nsecond\nthird',commitSha:'a'.repeat(40),blobSha:'b'.repeat(40),truncated:true},{id:'A-002',kind:'search',matches:[]}]
const node=id=>({id,name:'Synthetic '+id,summary:'A synthetic behavior',actor:'Test actor',inputs:[],outcomes:['Result'],conditions:[],exclusions:[],implementations:[],uncertainty:[],claims:[{text:'Result occurs',evidenceIds:['A-001'],assessment:'partial'}],assessment:'partial',evidenceIds:['A-001']})
const edge=(from,to)=>({from,to,type:'contains',reason:'Synthetic composition',assessment:'partial',evidenceIds:['A-001']})
test('candidate validator validates citations without claiming semantic correctness',()=>{
  const graph={nodes:[node('N1')],edges:[]};assert.deepEqual(graphIssues(graph,receipts),[])
  graph.nodes[0].claims[0].evidenceIds=['A-002'];assert.ok(graphIssues(graph,receipts).some(e=>e.message.includes('non-source')))
})
test('candidate validator detects dangling endpoints, duplicates and containment cycles',()=>{
  const graph={nodes:[node('N1'),node('N2')],edges:[edge('N1','N2'),edge('N2','N1'),edge('N1','N2'),edge('N1','N3')]}
  const issues=graphIssues(graph,receipts).map(e=>e.message)
  for(const key of ['containment cycle','duplicate edge','dangling endpoint'])assert.ok(issues.includes(key))
})
test('lineage must account for every original and use real successors',()=>{
  const graph={nodes:[node('N1')],edges:[],lineage:[{originalId:'A1',successorIds:['bad'],decision:'retain',reason:'Synthetic'}]}
  const issues=graphIssues(graph,receipts,['A1','B1']);assert.ok(issues.some(e=>e.message==='missing lineage'));assert.ok(issues.some(e=>e.message.includes('successors')))
})
test('source coverage unions overlapping windows instead of double counting',()=>{
  assert.deepEqual(intervalCoverage([...receipts,{...receipts[0],id:'B-001',startLine:2,endLine:5}]),{files:1,uniqueLines:5})
})
test('report preserves every node, assessments and escaped source with multiple parents',()=>{
  const graph={nodes:[node('N1'),node('N2'),node('N3')],edges:[edge('N1','N3'),edge('N2','N3')]};graph.nodes[0].name='<script>bad()</script>'
  const output={graph,manifest:{commitSha:'a'.repeat(40)},coverage:{files:1,eligibleFiles:100,uniqueLines:3,assignments:[]},receipts,amendments:[],proposals:[],graphIssues:[],provenanceIssues:[],proposalIssues:[],limitations:['No semantic audit'],baselineUnchanged:true}
  const html=render(output)
  assert.ok(!html.includes('<script>bad()'))
  assert.ok(html.includes('&lt;script&gt;'))
  for(const n of graph.nodes)assert.ok(html.includes(`id="${n.id}"`))
  assert.ok(html.includes('independent verification: not performed'))
  assert.ok(html.includes('No semantic audit'))
  assert.ok(html.includes('id="evidence-A-001"'))
})
