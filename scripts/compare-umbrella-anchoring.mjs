#!/usr/bin/env node
/** Matched-evidence containment ablation. No owner judgments enter inference. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { hash, parseResponse, graphShape } from './lib/capability-graph.mjs'
import { umbrellaSeed, umbrellaPacket, umbrellaRequest, validateUmbrella, umbrellaMetrics, pairAgreement } from './lib/umbrella-experiment.mjs'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => {
  const body = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing overwrite ${path}`)
    return
  }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { flag: 'wx' })
}
async function main() {
  const args = process.argv.slice(2), opts = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--in', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments')
    opts[args[i].slice(2)] = args[i + 1]
  }
  if (!opts.in || !opts.out) throw new Error('--in and --out required')
  const baseline = read(opts.in), out = resolve(opts.out), packet = umbrellaPacket(baseline)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  const manifest = { protocol: 'umbrella-ablation-v1', baselineSha256: hash(baseline), evidenceSha256: packet.sha256,
    model: DEFAULT_MODEL, conditions: ['linked', 'unlinked'], repeats: 2, rounds: 2,
    maxTokensPerCall: 9000, maxPromptCharacters: 190000, costStopBeforeNextRequest: 1.5,
    design: 'Same nodes, dependencies, prompt and frozen evidence. Only starting contains edges differ. Counterbalanced condition order across two repeats; both use discovery then challenge.',
    limits: 'Not de novo discovery: seed labels and summaries remain. Evidence is one directly cited source and one reading per seed when available; no new retrieval. No owner judgments. Structural metrics are not semantic accuracy. Two repeats cannot estimate generalization or establish a reliable effect size.' }
  write(`${out}/manifest.json`, manifest); write(`${out}/evidence-packet.json`, packet)
  const runs = [], stages = []
  async function stage(runId, round, request, validator, repair = false) {
    const prefix = resolve(opts['replay-from'] ?? out), stem = `${prefix}/${runId}/round-${round}${repair ? '-repair' : ''}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.maxPromptCharacters) throw new Error('prompt preflight exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) {
      if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact replay request mismatch')
      payload = read(`${stem}.response.json`)
    } else {
      if (opts['replay-from']) throw new Error(`missing replay ${stem}`)
      if (stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((sum, s) => sum + s.usage.cost, 0) >= manifest.costStopBeforeNextRequest) throw new Error('cost guard: review saved receipts before more inference')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key missing')
      write(`${stem}.request.json`, request)
      process.stderr.write(`${runId} round ${round}${repair ? ' repair' : ''}: requesting model decision\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(`${stem}.response.json`, payload)
    }
    const receipt = { runId, round, repair, requestSha256: hash(request), usage: payload.usage ?? {}, model: payload.model }
    stages.push(receipt)
    try { const raw = parseResponse(payload); return { raw, result: validator(raw) } }
    catch (error) {
      receipt.validationError = error.message
      if (repair) throw error
      const next = structuredClone(request)
      next.messages.push({ role: 'user', content: `The previous response failed structural validation: ${error.message}. Return a complete corrected JSON patch. Retain seed details, cite only supplied evidence, and return an empty patch if no changes are supported. This is the only correction attempt.` })
      return stage(runId, round, next, validator, true)
    }
  }
  for (let repeat = 1; repeat <= 2; repeat++) {
    for (const condition of repeat === 1 ? ['linked', 'unlinked'] : ['unlinked', 'linked']) {
      const runId = `${condition}-${repeat}`, seed = umbrellaSeed(baseline.graph, condition), history = []
      let graph = seed
      for (let round = 1; round <= 2; round++) {
        const request = umbrellaRequest(graph, packet, round, DEFAULT_MODEL, history.at(-1)?.result)
        const decision = await stage(runId, round, request, (raw) => validateUmbrella(raw, graph, seed, packet, round))
        graph = decision.result.graph
        const entry = { round, investigationMode: round === 1 ? 'umbrella-discovery' : 'umbrella-challenge',
          plan: { raw: { question: round === 1 ? 'Which broader outcomes are justified?' : 'Which broader relationships survive challenge?' } },
          decision: { raw: decision.raw }, result: decision.result }
        history.push(entry); write(`${out}/${runId}/round-${round}.json`, entry)
        process.stderr.write(`${runId} round ${round}: ${graph.nodes.length} nodes, depth ${graphShape(graph).maxDepth}\n`)
      }
      const receipts = stages.filter((s) => s.runId === runId), reviewed = new Set(history.flatMap((h) => h.result.reviewedNodeIds))
      const output = { schemaVersion: '0.1.0', method: 'umbrella-containment-ablation', repository: baseline.repository,
        headSha: baseline.headSha, baselineSha256: hash(baseline), interpretationStatus: 'candidate',
        protocol: { ...manifest, condition, repeat }, graph, shape: graphShape(graph), history,
        evidence: baseline.evidence, readingRegistry: baseline.readingRegistry,
        unreviewedNodeIds: graph.nodes.filter((n) => !reviewed.has(n.id)).map((n) => n.id),
        stopReason: 'bounded-umbrella-test-complete-not-exhaustive', stages: receipts,
        usage: { cost: receipts.every((s) => typeof s.usage.cost === 'number') ? receipts.reduce((n, s) => n + s.usage.cost, 0) : null },
        metrics: umbrellaMetrics(graph, baseline.graph) }
      write(`${out}/${runId}/output.json`, output)
      runs.push({ runId, condition, repeat, metrics: output.metrics, usage: output.usage,
        rounds: history.map((h) => ({ round: h.round, metrics: umbrellaMetrics(h.result.graph, baseline.graph) })) })
    }
  }
  const comparisons = runs.flatMap((a, i) => runs.slice(i + 1).map((b) => ({ a: a.runId, b: b.runId,
    kind: a.condition === b.condition ? 'within-condition' : 'cross-condition', ...pairAgreement(a.metrics, b.metrics) })))
  const output = { manifest, packet: { sha256: packet.sha256, bytes: packet.bytes, coverage: packet.coverage }, runs, comparisons,
    usage: { cost: stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null }, stages }
  write(`${out}/output.json`, output)
  process.stdout.write(JSON.stringify({ out, cost: output.usage.cost, comparisons }) + '\n')
}
try { await main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
