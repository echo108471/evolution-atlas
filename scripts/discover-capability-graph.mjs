#!/usr/bin/env node
/** Replayable exploration -> retrieval -> revision loop over a provisional graph. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { API_KEY_ENV, DEFAULT_MODEL, requestHierarchyCriticRequestPayload } from './lib/capability-hierarchy-critic.mjs'
import { seedGraph, graphShape, hash, parseResponse, buildGraphRequest, applyGraphProposal, investigationCoverage, validateInvestigationCoverage } from './lib/capability-graph.mjs'
import { sourceReader, retrieveGraphEvidence } from './lib/capability-graph-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => {
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`refusing to overwrite different artifact: ${path}`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body, { flag: 'wx' })
}
const usage = `Usage: npm run discover-capability-graph -- --seed <induction.json> --repo <path> --out <ignored.json>
  --rounds <n>          Investigation budget, not hierarchy depth (default: 3)
  --model <id>          Decision model (default: ${DEFAULT_MODEL})
  --planner-model <id>  Planner model (default: decision model)
  --max-tokens <n>      Completion cap per call (default: 4500)
  --max-prompt-chars <n> Hard preflight cap per request (default: 100000)
  --protocol <id>      agenda-v2 (default), full-v3, or local-v1
  --replay-from <path>  Replay a saved output prefix without provider calls
  --dry-run            Build first planner request, make no calls or writes

Existing raw stages are resumed only when their exact saved request matches. Outputs must
be ignored by this repository. Source is read from the seed's Git revision, never the working
tree. All outputs are experimental candidates; the seed hierarchy is not modified.
`

function optionsFor(argv) {
  const options = { rounds: 3, model: DEFAULT_MODEL, maxTokens: 4500, maxPromptChars: 100000, protocol: 'agenda-v2' }
  const keys = { '--seed': 'seed', '--repo': 'repo', '--out': 'out', '--rounds': 'rounds',
    '--model': 'model', '--planner-model': 'plannerModel', '--max-tokens': 'maxTokens',
    '--max-prompt-chars': 'maxPromptChars', '--replay-from': 'replayFrom', '--protocol': 'protocol' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') return { help: true }
    if (arg === '--dry-run') { options.dryRun = true; continue }
    if (!keys[arg] || !argv[i + 1]) throw new Error(`invalid argument ${arg}`)
    options[keys[arg]] = argv[++i]
  }
  for (const key of ['rounds', 'maxTokens', 'maxPromptChars']) {
    options[key] = Number(options[key])
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`invalid ${key}`)
  }
  for (const key of ['seed', 'repo', 'out']) if (!options[key]) throw new Error(`--${key} required`)
  options.plannerModel ??= options.model
  if (!['agenda-v2', 'local-v1', 'full-v3'].includes(options.protocol)) throw new Error('invalid protocol')
  options.out = resolve(options.out)
  // Keep repository/source evidence out of tracked fixtures and rendered distributions.
  execFileSync('git', ['-C', root, 'check-ignore', '-q', options.out])
  return options
}

async function main() {
  const options = optionsFor(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage); return }
  const input = read(options.seed)
  const seeded = seedGraph(input)
  const source = sourceReader(resolve(options.repo), input.headSha, seeded.readings)
  let graph = seeded.graph
  const history = [], registry = new Map()
  // Initial IDs remain available through seed nodes. All reading text is searchable.
  // The catalog avoids re-sending every cached interpretation just to choose evidence.
  const catalog = seeded.readings.map((r) => [r.id, r.subject?.slice(0, 85) ?? ''])
  const config = { model: options.model, plannerModel: options.plannerModel,
    rounds: options.rounds, maxTokens: options.maxTokens, maxPromptChars: options.maxPromptChars }
  const metadata = { schemaVersion: '0.1.0', method: 'iterative-capability-graph',
    repository: input.repository, headSha: input.headSha,
    interpretationStatus: 'candidate', seedSha256: hash(input), seedLineage: seeded.lineage,
    protocol: { ...config, semanticDepthLimit: null, version: options.protocol, validatorVersion: 2,
      seedMode: 'prior-induction-leaves-without-parent-labels',
      relationshipTypes: ['contains', 'depends_on'] },
    sourceCatalogSha256: hash(source.paths), readingCount: seeded.readings.length,
    sourcePathCount: source.paths.length, initialShape: graphShape(graph) }
  const preflight = (request) => {
    const chars = request.messages.reduce((n, m) => n + m.content.length, 0)
    if (chars > options.maxPromptChars) throw new Error(`prompt exceeds preflight cap: ${chars}/${options.maxPromptChars}`)
    return chars
  }
  async function stage(round, phase, request) {
    const chars = preflight(request)
    const suffix = `.round-${round}.${phase}`
    const prefix = options.replayFrom ? resolve(options.replayFrom) : options.out
    const requestPath = `${prefix}${suffix}.request.json`
    const rawPath = `${prefix}${suffix}.response.json`
    const fingerprint = hash(request)
    let payload
    if (existsSync(rawPath)) {
      if (!existsSync(requestPath) || hash(read(requestPath)) !== fingerprint) throw new Error(`replay request mismatch: ${suffix}`)
      payload = read(rawPath)
    } else {
      if (options.replayFrom) throw new Error(`missing replay stage: ${suffix}`)
      if (!process.env[API_KEY_ENV]) throw new Error(`${API_KEY_ENV} is not set`)
      write(requestPath, request)
      process.stderr.write(`round ${round} ${phase}: ${chars} prompt characters\n`)
      // No automatic paid retries. A saved raw response always precedes parsing.
      payload = await requestHierarchyCriticRequestPayload(request, { apiKey: process.env[API_KEY_ENV] })
      write(rawPath, payload)
    }
    try {
      return { raw: parseResponse(payload), requestSha256: fingerprint, promptCharacters: chars,
        usage: payload.usage ?? {}, providerModel: payload.model ?? null }
    } catch (error) {
      if (phase.endsWith('-recovery')) throw error
      const recoveryRequest = structuredClone(request)
      recoveryRequest.messages.push({ role: 'user', content: 'The previous response was incomplete or invalid JSON. ' +
        'Return one short complete JSON object, with no repeated list entries. For retrieval use at most 12 readingIds, ' +
        '6 unique searches, and 6 sources. For revisions use a small patch and defer additional work. Do not repeat search terms.' })
      const recovered = await stage(round, `${phase}-recovery`, recoveryRequest)
      return { ...recovered, formatFailures: [{ requestSha256: fingerprint, usage: payload.usage ?? {}, reason: error.message }] }
    }
  }
  for (let round = 1; round <= options.rounds; round++) {
    const coverage = investigationCoverage(graph, history)
    const fullRun = options.protocol === 'full-v3'
    if (fullRun && coverage.complete) break
    const requiredNodeIds = fullRun ? coverage.pending.slice(0, 4) : []
    const investigationMode = fullRun ? (requiredNodeIds.length ? 'coverage' : 'reconcile') : 'local'
    const reviewed = new Set(history.flatMap((h) => h.result.reviewedNodeIds))
    const agenda = options.protocol !== 'local-v1' ? {
      reviewedNodeIds: [...reviewed],
      unreviewedNodeIds: graph.nodes.filter((n) => !reviewed.has(n.id)).map((n) => n.id),
      previousQuestions: history.map((h) => h.plan.raw.question),
      policy: 'Choose between testing broader relations among current roots, challenging an existing relationship, ' +
        'and investigating an unreviewed area. Use prior uncertainty to ask for different evidence, not just reconfirm it. ' +
        'A completed local investigation is not a completed map. No obligation to create a parent or reach any depth.',
      ...(fullRun ? { mode: investigationMode, requiredNodeIds,
        scope: requiredNodeIds.length ? 'Examine every required node this round. This list is a coverage queue, NOT a proposed group. ' +
          'Retrieve relevant evidence for each, then decide independently to retain, revise, connect, or defer it. ' +
          'Report each in reviewedNodeIds even if its disposition is explicitly unresolved; never claim support absent evidence.' :
          'Reconcile the entire map: investigate possible broader parents, redundant nodes, misplaced children, and dependencies. ' +
          'Prefer a few well-evidenced corrections. Keep independent roots when no meaningful common outcome exists.',
        reconciliationRoundsCompleted: coverage.reconciliationRounds } : {}),
    } : null
    const planRequest = buildGraphRequest('plan', {
      round, roundsRemaining: options.rounds - round, graph, headSha: input.headSha,
      readingCatalog: catalog, sourcePaths: source.paths,
      priorSearchResults: history.at(-1)?.retrieval.searchResults ?? [],
      priorUnresolved: history.at(-1)?.result.unresolved ?? [],
      ...(agenda ? { investigationAgenda: agenda } : {}),
    }, { model: options.plannerModel, maxTokens: options.maxTokens })
    if (options.dryRun) {
      process.stdout.write(`${JSON.stringify({ ...metadata, firstPromptCharacters: preflight(planRequest) }, null, 2)}\n`)
      return
    }
    const plan = await stage(round, 'plan', planRequest)
    const retrievalPlan = structuredClone(plan.raw)
    if (fullRun) {
      // Reserve an available reading per queued node before remaining ranked requests.
      // This is evidence access, not a membership or correctness judgment.
      const readingIds = new Set(seeded.readings.map((reading) => reading.id))
      const anchors = requiredNodeIds.flatMap((id) => {
        const candidates = graph.nodes.find((node) => node.id === id).evidenceIds.filter((ref) => readingIds.has(ref))
        const preferred = candidates.find((ref) => plan.raw.readingIds.includes(ref)) ?? candidates[0]
        return preferred ? [preferred] : []
      })
      retrievalPlan.readingIds = [...new Set([...anchors, ...plan.raw.readingIds])]
    }
    const retrieval = retrieveGraphEvidence(retrievalPlan, seeded.readings, source)
    for (const entry of retrieval.evidence) registry.set(entry.id, entry)
    // Only this round's evidence is exposed and accepted for changed claims. Prior
    // citations on untouched nodes remain provenance, not fresh review evidence.
    const decisionRequest = buildGraphRequest('decision', { round, roundsRemaining: options.rounds - round,
      graph, retrievedEvidence: retrieval.evidence, omitted: retrieval.omitted,
      priorUnresolved: history.at(-1)?.result.unresolved ?? [],
      ...(agenda ? { investigationAgenda: agenda,
        patchRules: 'For a removed node with no successor, supply removalEvidence: [{nodeId,evidenceIds,reason}]. ' +
          'A retained node keeps its prior supersedes lineage. Each relationship endpoint counts as reviewed. ' +
          'Consider whether broader relationships explain these behaviors better than the current roots. ' +
          'continue describes this investigation; unrelated unreviewed areas may still need later rounds.' } : {}),
    }, { model: options.model, maxTokens: options.maxTokens })
    if (options.model.startsWith('x-ai/')) decisionRequest.reasoning = { effort: 'low' }
    let decision = await stage(round, 'decision', decisionRequest)
    let result
    const rejectedAttempts = []
    try {
      result = validateInvestigationCoverage(applyGraphProposal(graph, decision.raw, retrieval.evidence, round), requiredNodeIds)
    } catch (error) {
      rejectedAttempts.push({ decision, validationError: error.message })
      const repairRequest = structuredClone(decisionRequest)
      repairRequest.messages.push({ role: 'assistant', content: JSON.stringify(decision.raw) },
        { role: 'user', content: `The entire patch was rejected: ${error.message}. Return a corrected complete patch. ` +
          'Every citation on a changed node or edge must be in retrievedEvidence above; old node citations are not retrieved evidence. ' +
          'Remove unsupported claims or leave them unresolved. Do not invent supporting evidence. This is the only correction attempt.' })
      decision = await stage(round, 'repair', repairRequest)
      result = validateInvestigationCoverage(applyGraphProposal(graph, decision.raw, retrieval.evidence, round), requiredNodeIds)
    }
    graph = result.graph
    history.push({ round, plan, retrieval, decision, rejectedAttempts, result,
      ...(fullRun ? { investigationMode, requiredNodeIds } : {}) })
    write(`${options.out}.round-${round}.json`, history.at(-1))
    process.stderr.write(`round ${round}: ${result.shape.nodes} nodes, depth ${result.shape.maxDepth}, ` +
      `${result.shape.dependencies} dependencies; ${retrieval.readingCount} readings, ${retrieval.sourceCount} source windows; ` +
      `${result.reviewedNodeIds.length} reviewed / ${result.unreviewedNodeIds.length} unreviewed\n`)
    if (!fullRun && !result.continue && (options.protocol === 'local-v1' ||
      graph.nodes.every((node) => reviewed.has(node.id) || result.reviewedNodeIds.includes(node.id)))) break
  }
  const usage = history.flatMap((h) => [h.plan, h.decision, ...h.rejectedAttempts.map((attempt) => attempt.decision)])
    .flatMap((stage) => [stage.usage, ...(stage.formatFailures ?? []).map((failure) => failure.usage)])
  const output = { ...metadata, graph, shape: graphShape(graph),
    stopReason: options.protocol === 'full-v3' && investigationCoverage(graph, history).complete ? 'coverage-and-reconciliation-complete' :
      history.length === options.rounds ? 'round-budget' : 'model-stopped',
    ...(options.protocol === 'full-v3' ? { coverage: investigationCoverage(graph, history) } : {}),
    unreviewedNodeIds: graph.nodes.filter((node) => !history.some((h) => h.result.reviewedNodeIds.includes(node.id))).map((node) => node.id),
    readingRegistry: seeded.readings, evidence: [...registry.values()], history,
    usage: { cost: usage.every((u) => typeof u.cost === 'number') ? usage.reduce((n, u) => n + u.cost, 0) : null,
      promptTokens: usage.reduce((n, u) => n + (u.prompt_tokens ?? 0), 0),
      completionTokens: usage.reduce((n, u) => n + (u.completion_tokens ?? 0), 0) } }
  write(options.out, output)
  process.stdout.write(`${JSON.stringify({ output: options.out, shape: output.shape, stopReason: output.stopReason, usage: output.usage })}\n`)
}

try { await main() } catch (error) {
  process.stderr.write(`Capability graph experiment failed: ${error.message}\n`)
  process.exitCode = 1
}
