#!/usr/bin/env node
/** Read-only summary of a current repository-engine experiment run. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { inspectEngine } from './repository-engine.mjs'

function regularFile(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Regular artifact required: ${path}`)
    return stat.isFile()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function countByKind(receipts) {
  const counts = {}
  for (const receipt of receipts) counts[receipt.kind] = (counts[receipt.kind] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

export function summarizeExperiment(directory) {
  const run = inspectEngine(directory)
  if (run.plan.version !== 'repository-engine/3') {
    throw new Error('This summary is for version 3 runs; use repository-engine.mjs status for archived runs')
  }

  const out = run.out ?? resolve(directory)
  const outputPath = join(out, 'output.json')
  const reportPath = join(out, 'index.html')
  const reviewedPath = join(out, 'reviewed-output.json')
  const reviewedReportPath = join(out, 'reviewed.html')
  const artifacts = {
    output: regularFile(outputPath) ? outputPath : null,
    report: regularFile(reportPath) ? reportPath : null,
    reviewedOutput: regularFile(reviewedPath) ? reviewedPath : null,
    reviewedReport: regularFile(reviewedReportPath) ? reviewedReportPath : null,
  }

  let candidateMap = null
  if (artifacts.output) {
    const output = JSON.parse(readFileSync(outputPath, 'utf8'))
    const graph = run.jobs.at(-1)?.value
    const planHash = createHash('sha256').update(readFileSync(join(out, 'run-plan.json'))).digest('hex')
    if (run.status !== 'candidate-map-produced' || output.version !== run.plan.version ||
        output.commitSha !== run.plan.commitSha || output.mode !== run.plan.mode ||
        output.provenance?.runPlanSha256 !== planHash ||
        !isDeepStrictEqual(output.graph, graph) || !isDeepStrictEqual(output.receipts, run.receipts)) {
      throw new Error('Published output does not match the pinned run and checkpointed graph')
    }
    candidateMap = {
      nodes: output.graph.nodes.length,
      edges: output.graph.edges.length,
      claims: output.graph.nodes.reduce((total, node) => total + node.claims.length, 0),
      receiptsByKind: countByKind(output.receipts),
      historyClaims: output.history?.lineage?.length ?? 0,
      historyOmissions: output.history?.omissions?.length ?? 0,
      independentVerification: output.independentVerification,
    }
  }

  return {
    runDirectory: out,
    version: run.plan.version,
    mode: run.plan.mode,
    commitSha: run.plan.commitSha,
    status: run.status,
    eligibleFiles: run.inventory.eligibleFiles,
    jobs: run.jobs.map(({ agent, state, handle, validation }) => ({ agent, state, handle: handle ?? null, validationIssueCount: validation.length })),
    validationIssueCount: run.validationIssues.length,
    artifacts,
    candidateMap,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: experiment-status.mjs RUN')
    console.log(JSON.stringify(summarizeExperiment(process.argv[2]), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
