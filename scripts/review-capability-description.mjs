#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { hash, parseResponse } from './lib/capability-graph.mjs'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { traceRequest, validateTraceReview } from './lib/relationship-tracing.mjs'
import { descriptionRequest, validateDescription, validateDescriptionGate, replaceDescription, descriptorLineage } from './lib/capability-description.mjs'
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const write = (p, v) => { const text = JSON.stringify(v, null, 2) + '\n'; if (existsSync(p)) { if (readFileSync(p, 'utf8') !== text) throw new Error(`refusing overwrite ${p}`); return } mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, { flag: 'wx' }) }
async function main() {
  const args = process.argv.slice(2), o = {}
  for (let i = 0; i < args.length; i += 2) { if (!['--in', '--prior', '--out', '--replay-from'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments'); o[args[i].slice(2)] = args[i + 1] }
  for (const k of ['in', 'prior', 'out']) if (!o[k]) throw new Error(`missing ${k}`)
  const baseline = read(o.in), prior = read(`${o.prior}/output.json`), packet = read(`${o.prior}/packets.json`).enriched, out = resolve(o.out)
  execFileSync('git', ['check-ignore', '-q', `${out}/output.json`])
  if (hash(baseline) !== prior.manifest.baselineSha256 || !prior.reviews.some((r) => r.condition === 'enriched') || prior.reviews.filter((r) => r.condition === 'enriched').some((r) => r.packetSha256 !== hash(packet))) throw new Error('input fingerprint mismatch')
  const graph = prior.graph, claims = prior.claims, original = graph.nodes.find((n) => n.id === 'N19')
  if (!original || claims.length !== 2) throw new Error('unexpected focused inputs')
  const manifest = { protocol: 'capability-description-v1', baselineSha256: hash(baseline), priorSha256: hash(prior), packetSha256: hash(packet), headSha: baseline.headSha, model: DEFAULT_MODEL,
    limits: { maxRequests: 6, maxPromptCharacters: 340000, costStopBeforeNextRequest: 1.25 },
    design: 'One blind descriptor proposal, one separate identity review, then original/revised descriptions crossed with forward/reverse claim order. Revised cells run only after preserve proposal and approving identity review. Evidence and search receipts fixed. Same relationship instructions across all cells, with explicit temporal formatting reminder. No owner labels, prior verdicts, proposal rationale or gate verdict in relationship prompts. No repairs or automatic retry.',
    limitations: 'One selected capability in one repository, one description proposal, one same-model identity review and two samples per condition. Scope stability is not accuracy. Wording, length and selected descriptor citations change together. No new retrieval, runtime verification, history tracing or applied graph changes. Revised wording can anchor reviewers too.' }
  write(`${out}/manifest.json`, manifest); write(`${out}/packets.json`, { original: packet, enriched: packet })
  const stages = []
  async function stage(name, request, validate) {
    const stem = `${resolve(o['replay-from'] ?? out)}/${name}`
    if (request.messages.reduce((n, m) => n + m.content.length, 0) > manifest.limits.maxPromptCharacters) throw new Error('prompt budget exceeded')
    let payload
    if (existsSync(`${stem}.response.json`)) { if (hash(read(`${stem}.request.json`)) !== hash(request)) throw new Error('exact request mismatch'); payload = read(`${stem}.response.json`) }
    else {
      if (o['replay-from'] || existsSync(`${stem}.request.json`)) throw new Error('missing response; reconcile provider outcome before retry')
      if (stages.length >= 6 || stages.some((s) => typeof s.usage.cost !== 'number') || stages.reduce((n, s) => n + s.usage.cost, 0) >= 1.25) throw new Error('recorded cost guard')
      if (!process.env[API_KEY_ENV]) throw new Error('provider key unavailable')
      write(`${stem}.request.json`, request); process.stderr.write(`${name}: requesting\n`)
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] }); write(`${stem}.response.json`, payload)
    }
    let result
    try { result = { status: 'valid', value: validate(parseResponse(payload)) } } catch (e) { result = { status: 'invalid', error: e.message } }
    stages.push({ name, requestSha256: hash(request), model: payload.model, usage: payload.usage ?? {}, status: result.status, ...(result.error ? { error: result.error } : {}) })
    write(`${out}/${name}.result.json`, result); write(`${out}/receipts-${stages.length}.json`, stages)
    process.stderr.write(`${name}: ${result.status}${result.error ? ` (${result.error})` : ''}\n`); return result
  }
  const common = { graph, targetNodeId: original.id, headSha: baseline.headSha, retrievedEvidence: packet.evidence, searchReceipts: packet.searches }
  const proposal = await stage('proposal', descriptionRequest('propose', common, DEFAULT_MODEL), (r) => validateDescription(r, original, packet.evidence, baseline.headSha))
  const candidate = proposal.status === 'valid' && proposal.value.identityDecision === 'preserve' ? proposal.value.descriptor : null
  const gate = candidate ? await stage('identity-review', descriptionRequest('gate', { ...common, candidateDescriptor: candidate }, DEFAULT_MODEL), (r) => validateDescriptionGate(r, packet.evidence, baseline.headSha)) : null
  const approved = gate?.status === 'valid' && gate.value.decision === 'approve'
  const reviews = []
  for (const [condition, order] of [['original', 'forward'], ['revised', 'forward'], ['revised', 'reverse'], ['original', 'reverse']]) {
    if (condition === 'revised' && !approved) continue
    const reviewGraph = condition === 'original' ? graph : replaceDescription(graph, candidate)
    const request = traceRequest('review', { graph: reviewGraph, claims: order === 'reverse' ? [...claims].reverse() : claims, headSha: baseline.headSha, retrievedEvidence: packet.evidence, searchReceipts: packet.searches }, DEFAULT_MODEL)
    request.messages[0].content += '\nFormatting reminder applying to ALL outcome decisions, including reject and defer: current timeScope requires atCommits=[the pinned head SHA] and a cited head source; otherwise choose unspecified with atCommits=[]. Report any source-observed render or execution guard in wiring.condition, but do not invent a condition from a missing excerpt.'
    const result = await stage(`${condition}-${order}`, request, (r) => validateTraceReview(r, claims, packet.evidence, packet.searches, baseline.headSha))
    reviews.push({ condition, order, packetSha256: hash(packet), graphSha256: hash(reviewGraph), ...result })
  }
  const cost = stages.every((s) => typeof s.usage.cost === 'number') ? stages.reduce((n, s) => n + s.usage.cost, 0) : null
  write(`${out}/output.json`, { manifest, graph, claims, originalDescriptor: original, proposal, gate, lineage: candidate ? descriptorLineage(original, candidate, packet) : null, reviews, stages, cost, applicationStatus: 'not-applied' })
  process.stdout.write(JSON.stringify({ out, cost, approved, failures: stages.filter((s) => s.status === 'invalid').length }) + '\n')
}
try { await main() } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1 }
