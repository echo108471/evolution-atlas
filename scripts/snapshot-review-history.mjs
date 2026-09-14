#!/usr/bin/env node
// Attach old review records only AFTER blind discovery and integration have frozen.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { inspectWorkflow, freezeWorkflow, writeExact } from './snapshot-workflow.mjs'
import { assembleRechecks, recheckOverlay } from './vscode-revision-loop.mjs'
import { prefixBaseline } from './vscode-expansion.mjs'
import { readJson, sha } from './vscode-snapshot-evidence.mjs'
import { projectReviewHistory, renderReviewHistory } from './lib/review-continuity.mjs'

export function buildSnapshotReviewHistory(out, prior, suffix = '') {
  if (!/^(?:-[a-z]+)?$/.test(suffix)) throw new Error('invalid artifact suffix')
  out = resolve(out); prior = resolve(prior)
  const state = inspectWorkflow(out)
  if (!state.complete || state.issues.length) throw new Error('complete frozen workflow required')
  freezeWorkflow(out) // Verify the entire frozen output and rendered base, not only graph content.
  const review = assembleRechecks(prior), overlay = recheckOverlay(review)
  if (!isDeepStrictEqual(overlay, readJson(prior + '/recheck-overlay.json'))) throw new Error('saved review overlay changed')
  const { graph, receipts } = review.candidate
  if (sha(graph) !== state.context.plan.baselineGraphSha256) throw new Error('review is not for the exact expansion baseline')
  const baseline = prefixBaseline(graph, receipts)
  if (!isDeepStrictEqual(baseline, state.context.baseline)) throw new Error('baseline namespace correspondence changed')
  const output = readJson(out + '/output.json')
  if (!isDeepStrictEqual(output.graph, state.graph)) throw new Error('saved output graph changed')
  const lineage = graph.nodes.map(n => {
    const rows = state.graph.lineage.filter(l => l.originalId === 'old:' + n.id)
    if (rows.length !== 1) throw new Error('missing/ambiguous baseline lineage')
    return { sourceId: n.id, targetIds: rows[0].successorIds }
  })
  const history = projectReviewHistory({ sourceGraph: graph, targetGraph: state.graph, overlay, lineage,
    sourceReceipts: receipts, targetReceipts: state.receipts,
    evidenceAliases: Object.fromEntries(receipts.map(r => [r.id, 'old:' + r.id])) })
  history.sourceOverlaySha256 = sha(overlay)
  history.sourceReviewDirectory = prior
  const baseHtml = readFileSync(out + '/index.html', 'utf8')
  return { history, html: renderReviewHistory(baseHtml, history, { historyHref: `review-history${suffix}.json` }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [out, prior, suffix = ''] = process.argv.slice(2), result = buildSnapshotReviewHistory(out, prior, suffix)
  console.log(JSON.stringify({ records: result.history.entries.length,
    reviewedNodes: new Set(result.history.entries.map(e => e.nodeId)).size,
    projections: result.history.entries.flatMap(e => e.projections).length,
    unchangedReviewedContent: result.history.entries.flatMap(e => e.projections).filter(p => p.reviewedContentUnchanged).length,
    history: writeExact(resolve(out) + `/review-history${suffix}.json`, JSON.stringify(result.history, null, 2) + '\n'),
    report: writeExact(resolve(out) + `/reviewed${suffix}.html`, result.html) }, null, 2))
}
