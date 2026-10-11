#!/usr/bin/env node
/** Offline synthetic exercise of the canonical private production-preview subcommand. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { build } from 'vite'
import { syntheticAtlas, syntheticGallery } from './fixtures.mjs'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const doctor = spawnSync(process.execPath, ['scripts/control-atlas.mjs', 'doctor', '--json'], { cwd: root, encoding: 'utf8' })
if (doctor.status !== 0) throw new Error('Canonical doctor must pass before the synthetic preview browser exercise.')
mkdirSync(join(root, 'scratch'), { recursive: true })
const run = mkdtempSync(join(root, 'scratch', 'preview-driver-fixture-')), directory = join(run, 'dist'), inventory = join(run, 'inventory.json')
await build({ root, configFile: false, envFile: false, envDir: false, publicDir: false, plugins: [react()], logLevel: 'silent', build: { outDir: directory, emptyOutDir: true, copyPublicDir: false } })
mkdirSync(join(directory, 'gallery'))
const data = syntheticAtlas()
writeFileSync(join(directory, 'gallery', 'manifest.json'), JSON.stringify(syntheticGallery(data)))
writeFileSync(join(directory, 'gallery', 'synthetic-atlas.json'), JSON.stringify(data))
const files = []
function visit(base, prefix = '') {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) visit(join(base, entry.name), path)
    else { const bytes = readFileSync(join(base, entry.name)); files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }) }
  }
}
visit(directory)
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
writeFileSync(inventory, JSON.stringify({ version: 1, sourceRevision, files }))
const result = spawnSync(process.execPath, ['scripts/control-atlas.mjs', 'verify-preview', '--directory', directory, '--inventory', inventory, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
writeFileSync(join(run, 'result.json'), result.stdout || result.stderr)
process.stdout.write(result.stdout || result.stderr)
process.exitCode = result.status ?? 1
