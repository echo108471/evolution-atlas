#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { hash } from './lib/capability-graph.mjs'
import { writeImmutable } from './run-behavior-ownership.mjs'

export function batchAcceptanceProbe(source) {
  const start = '        try:\n', end = '\n    print("Stage 6: Saving results.")'
  if (!source.text.includes(start) || !source.text.includes(end)) throw new Error('Batch extraction markers changed')
  const original = start + source.text.split(start)[1].split(end)[0]
  const python = original.split('\n').map(line => line.startsWith('        ') ? line.slice(8) : line).join('\n')
  if (/\b(open|exec|eval|__import__)\s*\(/.test(python)) throw new Error('Unexpected operation in inspected block')
  const inputs = ['{}', '[]', 'null', '"plain string"', 'not json']
  const probes = inputs.map(modelResponse => {
    const harness = `import json, re\nsummarized_results_path = ''\nexisting_summaries = {"professors": []}\nflagged_data = []\nprof_name = 'Synthetic'\nprof_id = 'test'\nsummary_prompt = ''\ndef ai_model(prompt):\n    return ${JSON.stringify(modelResponse)}\n${python}\nprint(json.dumps({"accepted": existing_summaries["professors"], "flagged": flagged_data}))`
    return { modelResponse, output: JSON.parse(execFileSync('python3', ['-c', harness], { encoding: 'utf8', timeout: 5000 })) }
  })
  return { id: 'O-batch-acceptance', sourceRefs: [source.id], kind: 'executed-isolated-source-block-with-stubbed-model', original, originalSha256: hash(original), python, probes,
    provenance: 'Post-response diagnostic confirming pre-registered check A7; not supplied to either initial or expanded deciding-model request. Selected after inspecting a boundary-expanded claim, not a new held-out accuracy sample.',
    limitations: 'Exact inspected try/except block dedented. Model stub returns fixed strings; local in-memory lists only. No Spark, provider, application, input files, or file writes executed. Demonstrates syntax acceptance, not general batch correctness or production model-output frequencies.' }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const out=resolve(process.argv[2]),bundle=JSON.parse(readFileSync(`${out}/bundle.json`,'utf8'))
  execFileSync('git',['check-ignore','-q',`${out}/batch-counterexamples.json`])
  const source=bundle.additional.find(e=>e.id==='S0235cc4de9fc2e84-tail')
  if(!source)throw Error('Missing inspected source')
  const result=batchAcceptanceProbe(source);writeImmutable(`${out}/batch-counterexamples.json`,result)
  process.stdout.write(JSON.stringify(result.probes)+'\n')
}
