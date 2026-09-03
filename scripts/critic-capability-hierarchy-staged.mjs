#!/usr/bin/env node

/** Run a two-stage hierarchy critic with model-directed, bounded evidence retrieval. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  requestHierarchyCriticRequestPayload,
} from './lib/capability-hierarchy-critic.mjs'
import {
  buildHierarchyRetrievalPlanRequest,
  buildStagedHierarchyDecisionRequest,
  parseHierarchyRetrievalPlan,
  parseStagedHierarchyDecision,
  requestPromptCharacters,
  stagedHierarchyCriticDocument,
} from './lib/capability-hierarchy-staged-critic.mjs'
import { withRetry } from './lib/retry.mjs'

function usage() {
  return `Usage: npm run critic-capability-hierarchy-staged -- [options]

Options:
  --review <path>                 Hierarchy-review dataset (required)
  --out <path>                    Write the completed staged critic here (required)
  --planner-model <id>            Retrieval planner model (default: decision model)
  --planner-protocol <id>         broker-ranked-v1 (default) or hard-cap-v0 for replay
  --model <id>                    Decision model (default: ${DEFAULT_MODEL})
  --max-evidence-readings <n>     Maximum retrieved readings (default: 32)
  --plan-max-tokens <n>           Maximum planner completion tokens (default: 8000)
  --decision-max-tokens <n>       Maximum decision completion tokens (default: 12000)
  --reasoning-effort <level>      Decision reasoning: none, minimal, low, medium, high
  --plan-response <path>          Replay an already-saved planner response
  --decision-response <path>      Replay an already-saved decision response
  --plan-raw-out <path>           Save live planner response (default: <out>.plan.response.json)
  --decision-raw-out <path>       Save live decision response (default: <out>.decision.response.json)
  --plan-out <path>               Save parsed retrieval plan (default: <out>.plan.json)
  --plan-only                     Stop after validating and saving the retrieval plan
  --dry-run                       Report planner request size and make no request
  --compact                       Emit compact JSON
  --help                          Show this help

Requires ${API_KEY_ENV} when a stage is not replayed from a saved response.
`
}

function parseArguments(argv) {
  const options = {
    reviewPath: null,
    outputPath: null,
    plannerModel: null,
    plannerProtocol: 'broker-ranked-v1',
    model: DEFAULT_MODEL,
    maxEvidenceReadings: 32,
    planMaxTokens: 8000,
    decisionMaxTokens: 12000,
    reasoningEffort: null,
    planResponsePath: null,
    decisionResponsePath: null,
    planRawOutputPath: null,
    decisionRawOutputPath: null,
    planOutputPath: null,
    planOnly: false,
    dryRun: false,
    pretty: true,
  }
  const strings = {
    '--review': 'reviewPath',
    '--out': 'outputPath',
    '--planner-model': 'plannerModel',
    '--planner-protocol': 'plannerProtocol',
    '--model': 'model',
    '--plan-response': 'planResponsePath',
    '--decision-response': 'decisionResponsePath',
    '--plan-raw-out': 'planRawOutputPath',
    '--decision-raw-out': 'decisionRawOutputPath',
    '--plan-out': 'planOutputPath',
    '--reasoning-effort': 'reasoningEffort',
  }
  const integers = {
    '--max-evidence-readings': 'maxEvidenceReadings',
    '--plan-max-tokens': 'planMaxTokens',
    '--decision-max-tokens': 'decisionMaxTokens',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--plan-only') { options.planOnly = true; continue }
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (argument === '--compact') { options.pretty = false; continue }
    if (strings[argument]) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      options[strings[argument]] = value
      continue
    }
    if (integers[argument]) {
      const value = Number.parseInt(argv[++index], 10)
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${argument} must be a positive integer`)
      }
      options[integers[argument]] = value
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }
  if (!options.reviewPath || !options.outputPath) throw new Error('--review and --out are required')
  if (!['broker-ranked-v1', 'hard-cap-v0'].includes(options.plannerProtocol)) {
    throw new Error('--planner-protocol must be broker-ranked-v1 or hard-cap-v0')
  }
  if (options.reasoningEffort &&
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(options.reasoningEffort)) {
    throw new Error('--reasoning-effort is not a supported effort level')
  }
  options.plannerModel ??= options.model
  return options
}

const writeJson = (path, value, pretty = true) => {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8')
  return absolute
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))

async function payloadForStage(responsePath, rawOutputPath, request, apiKey, pretty) {
  if (responsePath) {
    process.stderr.write(`replaying ${resolve(responsePath)}\n`)
    return readJson(responsePath)
  }
  const payload = await withRetry(
    () => requestHierarchyCriticRequestPayload(request, { apiKey }),
    { onNotice: (notice) => process.stderr.write(`${notice}\n`) },
  )
  process.stderr.write(`saved raw response ${writeJson(rawOutputPath, payload, pretty)}\n`)
  return payload
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) { process.stdout.write(usage()); return }
  const dataset = readJson(options.reviewPath)
  const planRequest = buildHierarchyRetrievalPlanRequest(dataset, options)
  process.stderr.write(
    `${dataset.repository}: ${dataset.shape?.hierarchyNodes ?? 0} nodes, ` +
    `${dataset.shape?.gapSignals ?? 0} recurring gaps, ` +
    `${dataset.shape?.boundarySignals ?? 0} boundary comparisons; ` +
    `${requestPromptCharacters(planRequest)} planner prompt characters\n`,
  )
  if (options.dryRun) { process.stderr.write('dry run: no request made\n'); return }

  const anyLiveStage = !options.planResponsePath ||
    (!options.planOnly && !options.decisionResponsePath)
  const apiKey = anyLiveStage ? process.env[API_KEY_ENV] : null
  if (anyLiveStage && !apiKey) throw new Error(`${API_KEY_ENV} is not set`)
  const planRawPath = options.planRawOutputPath ?? `${options.outputPath}.plan.response.json`
  const planPayload = await payloadForStage(
    options.planResponsePath, planRawPath, planRequest, apiKey, options.pretty,
  )
  const plan = parseHierarchyRetrievalPlan(planPayload, dataset, options)
  const planOutputPath = options.planOutputPath ?? `${options.outputPath}.plan.json`
  process.stderr.write(
    `${plan.shape.plannedSignals}/${plan.shape.signals} signals planned; ` +
    `${plan.shape.retrievedEvidenceReadings}/${plan.shape.maxEvidenceReadings} readings retrieved ` +
    `from ${plan.shape.requestedEvidenceReadings} requests; ` +
    `plan ${plan.shape.completePlan ? 'complete' : 'INVALID'}\n` +
    `wrote ${writeJson(planOutputPath, plan, options.pretty)}\n`,
  )
  if (!plan.shape.completePlan) throw new Error('retrieval plan failed validation; decision not requested')
  if (options.planOnly) return

  const decisionRequest = buildStagedHierarchyDecisionRequest(dataset, plan, options)
  process.stderr.write(`${requestPromptCharacters(decisionRequest)} decision prompt characters\n`)
  const decisionRawPath = options.decisionRawOutputPath ??
    `${options.outputPath}.decision.response.json`
  const decisionPayload = await payloadForStage(
    options.decisionResponsePath, decisionRawPath, decisionRequest, apiKey, options.pretty,
  )
  const decision = parseStagedHierarchyDecision(decisionPayload, dataset, plan)
  const document = stagedHierarchyCriticDocument(dataset, plan, decision, {
    ...options, planRequest, decisionRequest,
  })
  const outputPath = writeJson(options.outputPath, document, options.pretty)
  process.stderr.write(
    `${decision.shape.proposals} supported proposals; ` +
    `${decision.shape.accountedSignals}/${decision.shape.signals} signals accounted; ` +
    `review ${decision.shape.completeReview ? 'complete' : 'INCOMPLETE'}; ` +
    `peak prompt ${document.retrieval.promptCharacters.peak} characters\n` +
    `wrote ${outputPath}` +
    `${document.usage.cost ? ` ($${document.usage.cost.toFixed(4)})` : ''}\n`,
  )
}

try { await main() } catch (error) {
  process.stderr.write(
    `Staged capability hierarchy critic failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}
