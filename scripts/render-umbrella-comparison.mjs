#!/usr/bin/env node
/** Local broad-review index. Exact candidate graphs are rendered separately. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash } from './lib/capability-graph.mjs'
import { umbrellaMetrics, pairAgreement } from './lib/umbrella-experiment.mjs'
const input = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !process.argv[3]) throw new Error('comparison output.json and frozen baseline.json required')
const out = dirname(input), raw = JSON.parse(readFileSync(input, 'utf8'))
const baseline = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'))
if (hash(baseline) !== raw.manifest.baselineSha256) throw new Error('baseline fingerprint mismatch')
execFileSync('git', ['check-ignore', '-q', `${out}/index.html`])
const runs = raw.runs.map((r) => {
  const result = JSON.parse(readFileSync(`${out}/${r.runId}/output.json`, 'utf8'))
  return { ...r, metrics: umbrellaMetrics(result.graph, baseline.graph, { includeParent: true }) }
})
const comparisons = runs.flatMap((a, i) => runs.slice(i + 1).map((b) => ({ a: a.runId, b: b.runId,
  kind: a.condition === b.condition ? 'within-condition' : 'cross-condition', ...pairAgreement(a.metrics, b.metrics) })))
const data = { ...raw, runs, comparisons, scoringVersion: 'root-inclusive-scope-v2',
  scoringNote: 'Post-run correction: original descendant-only scoring missed a seed root reused as the broader parent. Scope includes that parent itself. Original scoring and model outputs are preserved in output.json; no inference changed.',
  rawOutputSha256: hash(raw) }
const analysisBody = JSON.stringify(data, null, 2) + '\n', analysisPath = `${out}/analysis.json`
if (existsSync(analysisPath)) {
  if (readFileSync(analysisPath, 'utf8') !== analysisBody) throw new Error('refusing to overwrite different analysis')
} else writeFileSync(analysisPath, analysisBody, { flag: 'wx' })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const names = new Map(JSON.parse(readFileSync(`${out}/${data.runs[0].runId}/output.json`, 'utf8')).graph.nodes.map((n) => [n.id, n.name]))
const totalContainment = baseline.graph.edges.filter((e) => e.type === 'contains').length, totalNodes = baseline.graph.nodes.length
const rows = data.runs.map((r) => `<tr><th><a href="${r.runId}/index.html#map">${esc(r.runId)}</a></th><td>${r.metrics.nodes}</td><td>${r.metrics.maxDepth}</td><td>${r.metrics.broaderGroups.length}</td><td>${r.metrics.retainedOriginalContainment} / ${totalContainment}</td><td>${r.metrics.preservedSeedNodes} / ${totalNodes}</td></tr>`).join('')
const cards = data.runs.map((r) => `<section><h2>${esc(r.runId)}</h2><p><a href="${r.runId}/index.html#map">Open the full expandable map</a> · $${r.usage.cost?.toFixed(4) ?? 'unknown'}</p>${r.metrics.broaderGroups.length ? r.metrics.broaderGroups.map((g) => `<details open><summary>${esc(g.name)}</summary><p>${g.members.map((id) => esc(names.get(id) ?? id)).join(' · ')}</p></details>`).join('') : '<p>No umbrella spanning two original top-level capabilities.</p>'}</section>`).join('')
const agreement = data.comparisons.map((c) => `<tr><td>${esc(c.a)} / ${esc(c.b)}</td><td>${esc(c.kind)}</td><td>${c.jaccard === null ? 'No grouped pairs' : (100 * c.jaccard).toFixed(1) + '%'}</td></tr>`).join('')
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Broader umbrellas — matched-evidence experiment</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:36px auto;padding:0 22px;color:#202522;background:#fafbf9}h1,h2{line-height:1.2}a{color:#146448}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #cbd5cb}section{border:1px solid #d5ddd5;background:white;border-radius:9px;padding:18px 24px;margin:24px 0}summary{font-weight:600;cursor:pointer}details{margin:18px 0}details p{margin-top:6px;color:#445248}.scroll{overflow-x:auto}.note{background:#edf1eb;padding:18px;border-radius:8px}code{overflow-wrap:anywhere}</style>
<h1>Can the model find broader umbrellas?</h1>
<p>Four candidate maps, with the same ${totalNodes} capability descriptions and the same evidence. <strong>Linked</strong> starts with the ${totalContainment} existing containment links; <strong>unlinked</strong> hides only those links. Dependencies are retained in both. Each run gets a discovery pass and a challenge pass.</p>
<p class="note">Your review is broad: does the organization make sense, and do the umbrellas add useful meaning? The full maps have one overall ballot each; individual evidence checks are optional. Nothing here replaces the accepted map.</p>
<div class="scroll"><table><thead><tr><th>Run</th><th>Capabilities</th><th>Depth</th><th>Broader umbrellas</th><th>Original links retained / recovered</th><th>Seed details preserved</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>“Broader umbrella” means a scope covering at least two original top-level capabilities, including the parent itself when an existing capability becomes that umbrella. Counts and depth measure structural behavior, not quality. Covered seed capabilities are shown below, including nested and shared capabilities.</p>
${cards}
<h2>How similar are the memberships?</h2><p>Overlap of capability pairs placed together under broader umbrellas (intersection / union). Names and generated IDs do not affect this score. This measures agreement, not correctness; one very broad parent can inflate it.</p>
<div class="scroll"><table><thead><tr><th>Runs</th><th>Comparison</th><th>Pair overlap</th></tr></thead><tbody>${agreement}</tbody></table></div>
<h2>Limits and reproducibility</h2><p>${esc(data.manifest.limits)}</p>
<p>${esc(data.scoringNote)} <a href="analysis.json">Root-inclusive analysis</a>.</p>
<p>One linked-1 challenge failed because its proposed deletion lacked an evidence receipt. The sole correction regenerated a different decision, retaining the parent it had tried to delete. This is a semantic repair confound, not just formatting. Rejected and accepted responses remain saved.</p>
<p>Packet: ${data.packet.coverage.filter((n) => n.hasSource).length} / ${data.packet.coverage.length} capabilities have a directly cited source excerpt. No new evidence was retrieved. Earlier descriptions and selected excerpts can still carry anchoring. The challenge pass is a same-model self-check, not independent validation.</p>
<p>Recorded new inference: <strong>$${data.usage.cost?.toFixed(4) ?? 'unknown'}</strong>. <a href="output.json">Exact comparison data and receipts</a> · <a href="manifest.json">Frozen design</a> · <a href="evidence-packet.json">Shared evidence packet</a></p></html>`
writeFileSync(`${out}/index.html`, html)
process.stdout.write(`${out}/index.html\n`)
