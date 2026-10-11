#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = '.agents/skills/pstack-atlas/upstream.json'

function inside(parent, path) {
  const child = relative(parent, path)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function slug(text) {
  return text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : []
  }))
  return files.flat()
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/check-pstack.mjs [--upstream PATH]\nChecks skill inventory, native frontmatter, local Markdown links, feature-map wiring, and pinned provenance.\n--upstream verifies the recorded hashes against an already downloaded pstack directory; no network access.')
    return
  }
  if (args.length && (args.length !== 2 || args[0] !== '--upstream' || !args[1])) {
    throw new Error('Use --help or --upstream PATH.')
  }
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.repository !== 'https://github.com/cursor/plugins' || !/^[a-f0-9]{40}$/.test(manifest.commit) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('The upstream manifest needs its schema version, repository, immutable commit, and version.')
  }
  const skillsRoot = resolve(root, '.agents/skills')
  const inventory = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('pstack-'))
    .map((entry) => entry.name).sort()
  const expected = [...manifest.skills].sort()
  if (JSON.stringify(inventory) !== JSON.stringify(expected) || new Set(expected).size !== expected.length) {
    throw new Error(`Skill inventory differs from ${manifestPath}: ${inventory.join(', ')}`)
  }
  for (const name of inventory) {
    const path = resolve(skillsRoot, name, 'SKILL.md')
    const contents = await readFile(path, 'utf8')
    const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!frontmatter || !new RegExp(`^name: ${name}$`, 'm').test(frontmatter[1]) || !/^description: .+$/m.test(frontmatter[1])) {
      throw new Error(`Missing or incorrect name/description in ${relative(root, path)}.`)
    }
    if (/^(?:disable-model-invocation|mode|icon|color|reminder):/m.test(frontmatter[1])) {
      throw new Error(`Cursor-only frontmatter remains in ${relative(root, path)}.`)
    }
  }
  const files = new Set([
    ...await markdownFiles(skillsRoot),
    ...manifest.documents.map((path) => resolve(root, path)),
  ])
  let links = 0
  for (const path of files) {
    const contents = (await readFile(path, 'utf8')).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
    for (const match of contents.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '')
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue
      const [file, fragment] = target.split('#')
      const absolute = file ? resolve(dirname(path), decodeURIComponent(file)) : path
      if (!inside(root, absolute)) throw new Error(`Link leaves the repository: ${relative(root, path)} -> ${target}`)
      try { await stat(absolute) } catch { throw new Error(`Broken link: ${relative(root, path)} -> ${target}`) }
      if (fragment && absolute.endsWith('.md')) {
        const destination = await readFile(absolute, 'utf8')
        const headings = [...destination.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((heading) => slug(heading[1]))
        if (!headings.includes(decodeURIComponent(fragment))) throw new Error(`Broken heading link: ${relative(root, path)} -> ${target}`)
      }
      links += 1
    }
  }
  const attribution = await readFile(resolve(root, '.agents/skills/pstack-atlas/ATTRIBUTION.md'), 'utf8')
  if (!attribution.includes(manifest.commit) || !attribution.includes(manifest.version)) {
    throw new Error('Attribution and the upstream manifest must name the same commit and version.')
  }
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error('Missing upstream source mapping.')
  for (const entry of manifest.sources) {
    if (isAbsolute(entry.path) || !inside(root, resolve(root, entry.path)) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.adaptedTo?.length) {
      throw new Error(`Invalid upstream mapping: ${entry.path}`)
    }
    for (const target of entry.adaptedTo) {
      const absolute = resolve(root, target)
      if (!inside(root, absolute)) throw new Error(`Adaptation leaves the repository: ${target}`)
      await stat(absolute)
    }
    if (args[0] === '--upstream') {
      const upstream = resolve(args[1])
      const source = resolve(upstream, entry.path)
      if (!inside(upstream, source)) throw new Error(`Upstream path leaves the supplied directory: ${entry.path}`)
      const actual = createHash('sha256').update(await readFile(source)).digest('hex')
      if (actual !== entry.sha256) throw new Error(`Upstream hash mismatch: ${entry.path}`)
    }
  }
  const licenseSource = manifest.sources.find((entry) => entry.path === 'LICENSE')
  const license = await readFile(resolve(skillsRoot, 'pstack-atlas/LICENSE'))
  if (!licenseSource || createHash('sha256').update(license).digest('hex') !== licenseSource.sha256) {
    throw new Error('The upstream MIT license must be retained byte for byte.')
  }
  if (args[0] === '--upstream') {
    const plugin = JSON.parse(await readFile(resolve(args[1], '.cursor-plugin/plugin.json'), 'utf8'))
    if (plugin.version !== manifest.version) throw new Error('The supplied upstream version differs from the pinned manifest.')
  }
  const { FEATURE_REGISTRY } = await import('./verification/features.mjs')
  const featureNames = FEATURE_REGISTRY.map(({ id }) => id)
  const featureDirectory = resolve(skillsRoot, 'pstack-verify/references/features')
  const index = await readFile(resolve(featureDirectory, 'README.md'), 'utf8')
  for (const feature of featureNames) {
    if (typeof feature !== 'string' || !/^[a-z-]+$/.test(feature)) throw new Error('Invalid control-atlas feature ID.')
    await stat(resolve(featureDirectory, `${feature}.md`))
    if (!index.includes(`(${feature}.md)`)) throw new Error(`Feature index is missing ${feature}.md.`)
  }
  console.log(JSON.stringify({ ok: true, upstream: { commit: manifest.commit, version: manifest.version, hashesVerified: args[0] === '--upstream' }, skills: inventory.length, markdownFiles: files.size, localLinks: links, scriptedFeatures: featureNames.length }, null, 2))
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }))
  process.exitCode = 1
})
