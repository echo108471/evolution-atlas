#!/usr/bin/env node
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preservePrivateArtifacts, verifyPrivateArtifactBackup } from './lib/private-artifacts.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function runPreservation(args = process.argv.slice(2)) {
  const verify = args[0] === '--verify'
  const options = verify ? args.slice(1) : args
  if (options.length !== 2 || options[0] !== '--destination' || !options[1]) throw new Error('Usage: node scripts/preserve-private-artifacts.mjs [--verify] --destination ABSOLUTE_BACKUP_DIRECTORY')
  if (!isAbsolute(options[1])) throw new Error('Provide an absolute backup destination outside the repository.')
  return verify ? verifyPrivateArtifactBackup(options[1]) : preservePrivateArtifacts({ repositoryRoot, destination: options[1] })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.stdout.write(`${JSON.stringify(runPreservation(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
