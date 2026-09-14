#!/usr/bin/env node
/** Frozen expansion setup. Reuses the unchanged v1 evidence broker. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readJson, saveNew, sha } from './vscode-snapshot-evidence.mjs'

export function unseenInventory(inventory, receipts) {
  const seen = new Set(receipts.filter(r => r.kind === 'source').map(r => r.path))
  const pair = { A: 'A', D: 'A', B: 'B', E: 'B', C: 'C', F: 'C' }
  const files = inventory.files.filter(f => !seen.has(f.path)).map(f => ({ ...f, originalPartition: f.partition, partition: pair[f.partition] }))
  return { ...inventory, eligibleFiles: files.length, files,
    omitted: [...inventory.omitted, ...inventory.files.filter(f => seen.has(f.path)).map(f => ({ path: f.path, reason: 'previously inspected in frozen v1; excluded from fresh discovery' }))] }
}
export function prefixBaseline(graph, receipts) {
  const refs = x => ({ ...x, evidenceIds: x.evidenceIds.map(id => 'old:' + id) })
  return {
    graph: { ...graph, nodes: graph.nodes.map(n => ({ ...refs(n), id: 'old:' + n.id, claims: n.claims.map(refs) })),
      edges: graph.edges.map(e => ({ ...refs(e), from: 'old:' + e.from, to: 'old:' + e.to })) },
    receipts: receipts.map(r => ({ ...r, id: 'old:' + r.id }))
  }
}
export function prepareExpansion(base, out) {
  base = resolve(base); out = resolve(out)
  const baseline = readJson(base + '/output.json'), inventory = readJson(base + '/inventory.json')
  const discovery = unseenInventory(inventory, baseline.receipts)
  const brokerSha256 = sha(readFileSync(new URL('./vscode-snapshot-evidence.mjs', import.meta.url), 'utf8'))
  if (brokerSha256 !== baseline.manifest.brokerSha256) throw new Error('original frozen broker changed')
  const manifest = { ...baseline.manifest, protocol: 'vscode-unseen-expansion-v1', frozenAt: new Date().toISOString(),
    initialization: 'fresh discovery contexts; previous source files excluded; no previous maps, proposals, or owner labels',
    partitions: ['A', 'B', 'C'], maxConcurrentDiscoveryAgents: 3,
    inventorySha256: sha(discovery), instructionSha256: sha(readFileSync(out + '/protocol.md', 'utf8')),
    baseDirectory: base, baseOutputSha256: sha(readFileSync(base + '/output.json', 'utf8')),
    baseGraphSha256: sha(baseline.graph), baseInventorySha256: sha(inventory),
    setupSha256: sha(readFileSync(new URL(import.meta.url), 'utf8')),
    stages: ['three blind discoveries over previously unread files', 'one evidence-backed integration with frozen baseline', 'complete map and change report'],
    budgets: { perAgent: { windows: 20, searches: 8, evidenceBytes: 72000, linesPerWindow: 160, bytesPerWindow: 16000 },
      reconciler: { windows: 16, searches: 4, evidenceBytes: 64000, linesPerWindow: 160, bytesPerWindow: 16000 } },
    discoveryPairing: { A: ['A', 'D'], B: ['B', 'E'], C: ['C', 'F'] },
    limitations: [...baseline.limitations, 'Unread files need not be unfamiliar subsystems', 'Three paired assignments, not a controlled repeat of six-agent v1', 'No independent semantic audit in these two steps', 'Human broad-usefulness feedback on v1 is not a claim-level answer key'] }
  saveNew(out + '/inventory.json', discovery)
  saveNew(out + '/manifest.json', manifest)
  // Reconciler can inspect any eligible file, but discovery agents must not read this directory.
  saveNew(out + '/reconciliation-evidence/inventory.json', inventory)
  saveNew(out + '/reconciliation-evidence/manifest.json', { ...manifest, inventorySha256: sha(inventory) })
  saveNew(out + '/baseline-input.json', prefixBaseline(baseline.graph, baseline.receipts))
  return { eligibleUnreadFiles: discovery.eligibleFiles, excludedPreviouslyRead: inventory.eligibleFiles - discovery.eligibleFiles,
    assignments: manifest.partitions.map(agent => ({ agent, files: discovery.files.filter(f => f.partition === agent).length })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(prepareExpansion(process.argv[2], process.argv[3]), null, 2))
}
