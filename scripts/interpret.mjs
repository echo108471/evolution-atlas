#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { PROVIDERS, createClient, detectProvider, interpretAtlas } from './lib/interpret.mjs'

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
  --out <path>          Write the interpreted dataset here (default: overwrite --in)
  --provider <name>     Where to send the request (default: auto-detected from env)
  --model <id>          Override the provider's default model (gateways only)
  --max-features <n>    Cap on proposed features (default: 40)
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
    pretty: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (argument === '--compact') {
      options.pretty = false
      continue
    }
    if (
      argument === '--in' ||
      argument === '--out' ||
      argument === '--provider' ||
      argument === '--model' ||
      argument === '--max-features'
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
      } else {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--max-features requires a positive integer')
        }
        options.maxFeatures = parsed
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

  const inputPath = resolve(options.inputPath)
  const outputPath = resolve(options.outputPath ?? options.inputPath)
  const dataset = JSON.parse(readFileSync(inputPath, 'utf8'))

  if (dataset.analysis?.mode === 'interpreted') {
    process.stderr.write(
      'Input is already interpreted; re-running replaces its feature candidates.\n',
    )
  }

  const provider = options.provider ?? detectProvider()

  const { dataset: interpreted, validated, usage: tokenUsage } = await interpretAtlas(dataset, {
    client: createClient(Anthropic, provider),
    provider,
    model: options.model,
    maxFeatures: options.maxFeatures,
    onProgress: (message) => process.stderr.write(`${message}\n`),
  })

  const serialized = `${JSON.stringify(interpreted, null, options.pretty ? 2 : 0)}\n`
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, serialized, 'utf8')

  process.stderr.write(
    `Kept ${validated.featureCandidates.length} candidate features -> ${outputPath}\n`,
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
