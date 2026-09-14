#!/usr/bin/env node
/** Offline presentation overlay. Notes record review assertions, not verification. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { renderRepositoryMap } from './render-repository-map.mjs'

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
// Match the generic renderer's injective JavaScript-code-unit encoding.
const anchor = (kind, id) => `${kind}-${Buffer.from(id, 'utf16le').toString('hex')}`
const nonempty = value => typeof value === 'string' && value.trim().length > 0
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Invalid review notes schema')
}

export function reviewRepositoryMap(output, notes) {
  if (!output?.graph || !Array.isArray(output.graph.nodes)) throw new Error('Candidate graph required')
  shape(notes, ['graphSha256', 'notes'])
  const graphSha256 = createHash('sha256').update(JSON.stringify(output.graph)).digest('hex')
  if (notes.graphSha256 !== graphSha256) throw new Error('Review graph SHA-256 mismatch')
  if (!Array.isArray(notes.notes)) throw new Error('Review notes must be an array')
  if (output.independentVerification !== undefined && output.independentVerification !== 'not-performed') throw new Error('Expected independentVerification: not-performed')
  if (Object.hasOwn(output, 'reviewNotes') && !isDeepStrictEqual(output.reviewNotes, notes)) throw new Error('Existing review notes mismatch')
  const nodes = new Map(output.graph.nodes.map(node => [node.id, node]))
  const sources = new Set((output.receipts ?? []).filter(receipt => receipt.kind === 'source').map(receipt => receipt.id))
  const targets = new Set(), byNode = new Map()
  for (const note of notes.notes) {
    shape(note, ['nodeId', 'field', 'expectedText', 'status', 'basis', 'message', 'evidenceIds'], ['index'])
    if (![note.nodeId, note.expectedText, note.message].every(nonempty)) throw new Error('Review text and node ID must be nonempty strings')
    if (!['summary', 'conditions', 'claims'].includes(note.field) || !['qualified', 'disputed', 'unresolved'].includes(note.status) || !['proposer-disclosed', 'source-review', 'owner-feedback'].includes(note.basis)) throw new Error('Invalid review field, status or basis')
    const indexed = note.field !== 'summary'
    if (indexed ? !Number.isSafeInteger(note.index) || note.index < 0 : Object.hasOwn(note, 'index')) throw new Error('Review index required only for conditions or claims')
    const node = nodes.get(note.nodeId)
    if (!node) throw new Error('Review target node absent: ' + note.nodeId)
    const target = note.field === 'summary' ? node.summary : note.field === 'conditions' ? node.conditions?.[note.index] : node.claims?.[note.index]?.text
    if (target !== note.expectedText) throw new Error('Review target text mismatch: ' + note.nodeId + '.' + note.field)
    const key = JSON.stringify([note.nodeId, note.field, indexed ? note.index : null])
    if (targets.has(key)) throw new Error('Duplicate review target')
    targets.add(key)
    if (!Array.isArray(note.evidenceIds) || !note.evidenceIds.length || !note.evidenceIds.every(id => nonempty(id) && sources.has(id)) || new Set(note.evidenceIds).size !== note.evidenceIds.length) throw new Error('Review evidence requires unique known source receipt IDs')
    if (!byNode.has(note.nodeId)) byNode.set(note.nodeId, [])
    byNode.get(note.nodeId).push(note)
  }
  const annotated = structuredClone(output)
  annotated.independentVerification ??= 'not-performed'
  annotated.reviewNotes = structuredClone(notes)
  let html = renderRepositoryMap(annotated)
  const top = '<body><main>'
  if (!html.includes(top)) throw new Error('Review top notice attachment target absent')
  html = html.replace(top, `${top}<aside class="notice" aria-label="Review notes"><strong>Review notes companion</strong><p>${notes.notes.length} claim-local annotations accompany the unchanged candidate graph. These notes record review assertions, including proposer disclosures where indicated. This mechanical overlay performs no source or independent verification and does not change candidate assessments.</p><p><a href="reviewed-output.json">Output with separate review notes</a> · <a href="output.json">Original output</a></p></aside>`)
  for (const [nodeId, localNotes] of byNode) {
    const article = `<article class="capability" id="${anchor('node', nodeId)}">`
    if (html.split(article).length !== 2) throw new Error('Review article attachment target absent or ambiguous: ' + nodeId)
    const notices = localNotes.map(note => `<aside class="notice" aria-label="Claim-local review note"><strong>Review note: ${esc(note.status)}</strong><p>Target: ${esc(note.field)}${note.index === undefined ? '' : `[${note.index}]`} · basis: ${esc(note.basis)}</p><blockquote>${esc(note.expectedText)}</blockquote><p>${esc(note.message)}</p><p>Recorded source references: ${note.evidenceIds.map(id => `<a href="#${anchor('source', id)}">${esc(id)}</a>`).join(', ')}. These references are not independently verified by this overlay.</p></aside>`).join('')
    html = html.replace(article, () => article + notices)
  }
  return { output: annotated, html }
}

function readRegular(path) {
  if (!lstatSync(path).isFile()) throw new Error('Regular artifact required: ' + path)
  return readFileSync(path)
}
function existing(path) {
  try { return readRegular(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, notesPath, ...extra] = process.argv.slice(2)
    if (!directory || !notesPath || extra.length) throw new Error('Usage: review-repository-map.mjs RUN NOTES.json')
    const run = resolve(directory)
    if (!lstatSync(run).isDirectory()) throw new Error('Regular run directory required')
    const result = reviewRepositoryMap(JSON.parse(readRegular(resolve(run, 'output.json'))), JSON.parse(readRegular(resolve(notesPath))))
    const artifacts = [['reviewed-output.json', JSON.stringify(result.output, null, 2) + '\n'], ['reviewed.html', result.html]].map(([name, content]) => ({ path: resolve(run, name), bytes: Buffer.from(content) }))
    // Check both companions before any write, including an incomplete earlier attempt.
    for (const artifact of artifacts) {
      artifact.previous = existing(artifact.path)
      if (artifact.previous && !artifact.previous.equals(artifact.bytes)) throw new Error('Refusing changed review artifact: ' + artifact.path)
    }
    for (const artifact of artifacts) if (artifact.previous === null) writeFileSync(artifact.path, artifact.bytes, { flag: 'wx' })
    console.log(JSON.stringify({ output: artifacts[0].path, report: artifacts[1].path }))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
