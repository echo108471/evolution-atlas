#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
  PROVIDERS,
  createClient,
  detectProvider,
  interpretAtlas,
  mergeInterpretation,
  validateSemanticEpisodes,
} from './lib/interpret.mjs'
import { requireNewOutput, requirePaidPermission, requireSeparateOutput } from './lib/experiment-permissions.mjs'

function usage() {
  const providers = Object.entries(PROVIDERS)
    .map(([name, provider]) => `    ${name.padEnd(12)} ${provider.model} (${provider.apiKeyEnv})`)
    .join('\n')

  return `Usage: npm run interpret -- [options]

Proposes candidate features for an observed atlas dataset. Every proposed feature is
a candidate interpretation; commits the model cites but that do not exist in the
dataset are discarded rather than trusted.

Options:
  --in <path>           Observed dataset to read (default: public/atlas.json)
  --out <path>          New output file (default: <input-stem>.interpreted.json;
                        local revalidation uses <input-stem>.revalidated.json)
  --provider <name>     Where to send the request (default: auto-detected from env)
  --model <id>          Override the provider's default model (gateways only)
  --max-features <n>    Cap on proposed features (default: 40)
  --max-lifecycle-episodes <n>
                        Cap on proposed lifecycle episodes (default: 160)
  --reuse-features      Keep validated input features and rerun only lifecycle discovery
  --revalidate          Reapply local evidence and boundary checks without a model call
  --allow-paid          Explicitly permit model requests; SDK retries are disabled
  --compact             Emit compact JSON instead of indented JSON
  --help                Show this help

Providers:
${providers}

OpenRouter serves the Anthropic Messages API, so both paths send an identical request.
Anthropic also accepts an 'ant auth login' profile instead of an API key.
`
}

function parseArguments(argv) {
  const options = {
    inputPath: 'public/atlas.json',
    outputPath: null,
    provider: null,
    model: null,
    maxFeatures: 40,
    maxLifecycleEpisodes: 160,
    reuseFeatures: false,
    revalidate: false,
    allowPaid: false,
    pretty: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') {
      options.pretty = false
      continue
    }
    if (argument === '--reuse-features') {
      options.reuseFeatures = true
      continue
    }
    if (argument === '--revalidate') {
      options.revalidate = true
      continue
    }
    if (argument === '--allow-paid') {
      options.allowPaid = true
      continue
    }
    if (
      argument === '--in' ||
      argument === '--out' ||
      argument === '--provider' ||
      argument === '--model' ||
      argument === '--max-features' ||
      argument === '--max-lifecycle-episodes'
    ) {
      const value = argv[++index]
      if (!value) throw new Error(`${argument} requires a value`)
      if (argument === '--in') options.inputPath = value
      else if (argument === '--out') options.outputPath = value
      else if (argument === '--model') options.model = value
      else if (argument === '--provider') {
        if (!PROVIDERS[value]) {
          throw new Error(
            `Unknown provider "${value}". Expected one of: ${Object.keys(PROVIDERS).join(', ')}`,
          )
        }
        options.provider = value
      } else if (argument === '--max-features') {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--max-features requires a positive integer')
        }
        options.maxFeatures = parsed
      } else {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--max-lifecycle-episodes requires a positive integer')
        }
        options.maxLifecycleEpisodes = parsed
      }
      continue
    }
    throw new Error(`Unknown option: ${argument}`)
  }

  return options
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  if (options.revalidate && options.reuseFeatures) {
    throw new Error('--revalidate and --reuse-features are mutually exclusive')
  }
  if (!options.revalidate) requirePaidPermission(options.allowPaid, 'Interpretation')

  const inputPath = resolve(options.inputPath)
  const input = parse(inputPath)
  const outputPath = resolve(options.outputPath ?? `${input.dir}/${input.name}.${options.revalidate ? 'revalidated' : 'interpreted'}.json`)
  requireSeparateOutput(outputPath, [inputPath])
  requireNewOutput(outputPath)
  const dataset = JSON.parse(readFileSync(inputPath, 'utf8'))

  if (options.reuseFeatures && (dataset.featureCandidates?.length ?? 0) === 0) {
    throw new Error('--reuse-features requires an input dataset with feature candidates')
  }
  if (options.revalidate && (dataset.semanticEpisodes?.length ?? 0) === 0) {
    throw new Error('--revalidate requires an input dataset with semantic lifecycle episodes')
  }

  if (dataset.analysis?.mode === 'interpreted' && !options.revalidate) {
    process.stderr.write(
      'Input is already interpreted; the new output will replace its feature candidates.\n',
    )
  }

  let interpreted
  let validated
  let tokenUsage
  if (options.revalidate) {
    const lifecycle = validateSemanticEpisodes(
      dataset.semanticEpisodes.map((episode) => ({
        ...episode,
        commitShas: episode.evidence.map((reference) => reference.commitSha),
      })),
      dataset,
      dataset.featureCandidates,
      'local-revalidation',
    )
    const featureValidation = {
      featureCandidates: dataset.featureCandidates,
      relationships: dataset.relationships.filter((relationship) =>
        ['supports-feature', 'affects-area'].includes(relationship.kind),
      ),
      unresolvedShas: [],
      discardedFeatures: [],
    }
    interpreted = mergeInterpretation(dataset, featureValidation, lifecycle)
    validated = {
      ...featureValidation,
      semanticEpisodes: lifecycle.semanticEpisodes,
      lifecycle,
    }
    tokenUsage = null
  } else {
    const provider = options.provider ?? detectProvider()
    const result = await interpretAtlas(dataset, {
      client: createClient(Anthropic, provider, process.env, { maxRetries: 0 }),
      provider,
      model: options.model,
      maxFeatures: options.maxFeatures,
      maxLifecycleEpisodes: options.maxLifecycleEpisodes,
      reuseFeatures: options.reuseFeatures,
      onProgress: (message) => process.stderr.write(`${message}\n`),
    })
    interpreted = result.dataset
    validated = result.validated
    tokenUsage = result.usage
  }

  const serialized = `${JSON.stringify(interpreted, null, options.pretty ? 2 : 0)}\n`
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, serialized, { encoding: 'utf8', flag: 'wx' })

  process.stderr.write(
    `Kept ${validated.featureCandidates.length} candidate features and ${validated.semanticEpisodes.length} lifecycle episodes -> ${outputPath}\n`,
  )
  if (validated.discardedFeatures.length > 0) {
    process.stderr.write(
      `Discarded ${validated.discardedFeatures.length} feature(s) with no resolvable evidence: ${validated.discardedFeatures.join(', ')}\n`,
    )
  }
  if (validated.unresolvedShas.length > 0) {
    process.stderr.write(
      `Dropped ${validated.unresolvedShas.length} cited commit(s) not present in the dataset\n`,
    )
  }
  if (validated.lifecycle.unresolvedShas.length > 0) {
    process.stderr.write(
      `Dropped ${validated.lifecycle.unresolvedShas.length} lifecycle citation(s) not present in the dataset\n`,
    )
  }
  if (validated.lifecycle.unresolvedFeatureIds.length > 0) {
    process.stderr.write(
      `Dropped ${validated.lifecycle.unresolvedFeatureIds.length} lifecycle episode(s) with unknown feature ids\n`,
    )
  }
  if (validated.lifecycle.discardedEpisodeDetails.length > 0) {
    const reasons = validated.lifecycle.discardedEpisodeDetails.reduce((counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
      return counts
    }, {})
    process.stderr.write(
      `Discarded lifecycle candidates by boundary: ${Object.entries(reasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}\n`,
    )
  }
  if (tokenUsage) {
    process.stderr.write(
      `Tokens: ${tokenUsage.input_tokens} in (${tokenUsage.cache_read_input_tokens ?? 0} cached), ${tokenUsage.output_tokens} out\n`,
    )
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Evolution Atlas interpretation failed: ${message}\n`)
  process.exitCode = 1
}
