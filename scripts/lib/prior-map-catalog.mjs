import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertEvolutionAncestor } from './repository-evolution.mjs'
import { candidateProjection } from './repository-engine-contract.mjs'

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const text = value => typeof value === 'string' && value.trim().length > 0
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const SHA256 = /^[a-f0-9]{64}$/

function candidateGraphShape(graph) {
  const cited = value => value && !Array.isArray(value) && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every(id => typeof id === 'string')
  return graph && !Array.isArray(graph) && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
    && graph.nodes.every(node => cited(node) && typeof node.id === 'string' && Array.isArray(node.claims)
      && node.claims.every(claim => cited(claim) && typeof claim.text === 'string'))
    && graph.edges.every(edge => cited(edge) && typeof edge.from === 'string' && typeof edge.to === 'string')
}

export function readRegularArtifact(path, maxBytes = MAX_OUTPUT_BYTES) {
  const resolved = resolve(path), info = lstatSync(resolved)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Bounded regular artifact required: ' + resolved)
  return readFileSync(resolved)
}

function parseBytes(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) }
  catch { throw new Error(`Invalid JSON artifact: ${label}`) }
}

export function priorMapRecordFromBytes(outputBytes, planBytes, expectedRepo, currentCommitSha, id, expectedDirectory, outputPath = expectedDirectory + '/output.json') {
  const output = parseBytes(Buffer.from(outputBytes), outputPath), plan = parseBytes(Buffer.from(planBytes), expectedDirectory + '/run-plan.json')
  const directory = resolve(expectedDirectory)
  if (!['repository-engine/1', 'repository-engine/2', 'repository-engine/3'].includes(plan.version)
    || output.version !== plan.version || plan.out !== directory || plan.repo !== expectedRepo
    || !text(plan.commitSha) || output.commitSha !== plan.commitSha
    || output.status !== 'candidate-map-produced' || output.interpretationStatus !== 'candidate'
    || output.provenance?.runPlanSha256 !== hash(Buffer.from(planBytes))
    || !candidateGraphShape(output.graph)) {
    throw new Error('Frozen prior map is not a pinned candidate output from the configured repository')
  }
  assertEvolutionAncestor(expectedRepo, plan.commitSha, currentCommitSha, 'Prior map revision is foreign or later than the current revision')
  return priorMapRecord({ output, outputBytes: Buffer.from(outputBytes), plan, planBytes: Buffer.from(planBytes), directory }, id, outputPath)
}

function runIdentity(outputPath, expectedRepo, currentCommitSha) {
  const absoluteOutput = resolve(outputPath), bytes = readRegularArtifact(absoluteOutput)
  const output = parseBytes(bytes, absoluteOutput)
  const directory = realpathSync(dirname(absoluteOutput)), planPath = directory + '/run-plan.json'
  if (!existsSync(planPath)) throw new Error('Pinned map run-plan.json is required beside output.json')
  const planBytes = readRegularArtifact(planPath), plan = parseBytes(planBytes, planPath)
  if (!['repository-engine/1', 'repository-engine/2', 'repository-engine/3'].includes(plan.version)
    || output.version !== plan.version || plan.out !== directory || plan.repo !== expectedRepo
    || !text(plan.commitSha) || output.commitSha !== plan.commitSha
    || output.status !== 'candidate-map-produced' || output.interpretationStatus !== 'candidate'
    || output.provenance?.runPlanSha256 !== hash(planBytes)
    || !output.graph || !Array.isArray(output.graph.nodes) || !Array.isArray(output.graph.edges)) {
    throw new Error('Prior map is not a pinned candidate output from the configured repository')
  }
  const integrationPath = directory + '/integration-input.json'
  if (!existsSync(integrationPath) || output.provenance.integrationPacketSha256 !== hash(readRegularArtifact(integrationPath))) {
    throw new Error('Prior map integration packet does not match its published provenance')
  }
  const fingerprints = output.provenance.outputFingerprints
  if (!fingerprints || typeof fingerprints !== 'object' || Array.isArray(fingerprints)
    || !Object.hasOwn(fingerprints, 'R') || !Object.values(fingerprints).every(digest => typeof digest === 'string' && SHA256.test(digest))
    || !Object.keys(fingerprints).every(agent => /^[A-FR]$/.test(agent))) throw new Error('Prior map lacks safe reconciled output fingerprints')
  const reconciledBytes = readRegularArtifact(directory + '/reconciled.json')
  let reconciled
  try { reconciled = JSON.parse(reconciledBytes.toString('utf8')) } catch { throw new Error('Prior reconciled graph is invalid JSON') }
  if (hash(reconciledBytes) !== fingerprints.R || !isDeepStrictEqual(reconciled, output.graph)) throw new Error('Prior map graph differs from its pinned reconciliation')
  for (const [agent, digest] of Object.entries(fingerprints)) {
    const artifact = agent === 'R' ? directory + '/reconciled.json' : directory + `/proposals/${agent}.json`
    if (hash(readRegularArtifact(artifact)) !== digest) throw new Error('Prior map proposal fingerprint mismatch: ' + agent)
  }
  assertEvolutionAncestor(expectedRepo, plan.commitSha, currentCommitSha, 'Prior map revision is foreign or later than the current revision')
  return { output, outputBytes: bytes, plan, planBytes, directory, runDirectory: directory, outputPath: absoluteOutput }
}

/** Load a published output and its colocated engine plan as an explicit pinned artifact. */
export function loadPinnedMapOutput(outputPath, expectedRepo, currentCommitSha) {
  const identity = runIdentity(outputPath, expectedRepo, currentCommitSha)
  return {
    outputPath: resolve(outputPath),
    runDirectory: identity.directory,
    output: identity.output,
    outputBytes: identity.outputBytes,
    planBytes: identity.planBytes,
    plan: identity.plan,
  }
}

/** Load an additional map by run-directory path for the integration-only catalog. */
export function loadPriorMapDirectory(directory, expectedRepo, currentCommitSha, id) {
  const out = realpathSync(resolve(directory)), outputPath = out + '/output.json'
  const identity = runIdentity(outputPath, expectedRepo, currentCommitSha)
  return priorMapRecord(identity, id, outputPath)
}

export function priorMapRecord(identity, id, outputPath) {
  const candidate = candidateProjection(identity.output.graph)
  for (const node of candidate.nodes) {
    node.evidenceIds = []
    node.claims = node.claims.map(claim => ({ ...claim, evidenceIds: [] }))
  }
  for (const edge of candidate.edges) edge.evidenceIds = []
  return {
    id,
    version: identity.output.version,
    displayName: identity.output.displayName ?? identity.plan.displayName,
    repo: identity.plan.repo,
    commitSha: identity.plan.commitSha,
    artifactSha256: hash(identity.outputBytes),
    outputPath: resolve(outputPath),
    runDirectory: identity.directory,
    graph: candidate,
    candidate: {
      nodes: candidate.nodes.map(({ id: nodeId, name, summary }) => ({ id: nodeId, name, summary })),
      edges: candidate.edges.map(({ from, to, type, reason }) => ({ from, to, type, reason })),
    },
    outputBytes: identity.outputBytes,
    planBytes: identity.planBytes,
    plan: identity.plan,
  }
}

/** Return a bounded, evidence-free page of a prior candidate map. */
export function priorMapPage(map, offset = 0, limit = 20) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error('Prior-map page must use offset >= 0 and limit 1-25')
  const nodes = map.graph.nodes.slice(offset, offset + limit).map(node => structuredClone(node))
  const ids = new Set(nodes.map(node => node.id))
  const edges = map.graph.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)).map(edge => structuredClone(edge))
  return {
    kind: 'prior-map',
    artifactId: map.id,
    artifactSha256: map.artifactSha256,
    commitSha: map.commitSha,
    offset,
    limit,
    totalNodes: map.graph.nodes.length,
    returnedNodes: nodes.length,
    omittedNodes: Math.max(0, map.graph.nodes.length - offset - nodes.length),
    totalEdges: map.graph.edges.length,
    returnedEdges: edges.length,
    omittedEdges: Math.max(0, map.graph.edges.length - edges.length),
    edgeCoverage: 'edges touching a returned node; cross-page endpoint node text may require another page',
    nodes,
    edges,
    interpretationStatus: 'candidate',
    directSourceProof: false,
  }
}

export function verifyPriorMapPage(receipt, map) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Invalid prior-map receipt')
  const { id: _id, ...payload } = receipt
  if (!isDeepStrictEqual(payload, priorMapPage(map, payload.offset, payload.limit))) throw new Error('Prior-map receipt differs from its frozen candidate output')
  return true
}

export function projectBaselineOutput(outputPath, expectedRepo, currentCommitSha) {
  const identity = runIdentity(outputPath, expectedRepo, currentCommitSha)
  const { output } = identity
  const declared = [output.commitSha, output.plan?.commitSha, output.manifest?.commitSha].filter(value => value !== undefined)
  if (!declared.length || declared.some(sha => sha !== identity.plan.commitSha) || !Array.isArray(output.receipts)) {
    throw new Error('Baseline output revision and full receipt bytes are required')
  }
  return { ...identity, declaredCommitSha: identity.plan.commitSha }
}

export function loadPinnedMapFromOutput(outputPath, expectedRepo, currentCommitSha, id) {
  const identity = runIdentity(outputPath, expectedRepo, currentCommitSha)
  return priorMapRecord(identity, id, outputPath)
}

export function assertPinnedMapPayload(record, expectedRepo, currentCommitSha) {
  if (!record || record.repo !== expectedRepo || record.commitSha === currentCommitSha) {
    // Same-revision maps are valid and useful. The special branch below gives them a
    // direct repository binding check without weakening ancestry for any other case.
    if (!record || record.repo !== expectedRepo) throw new Error('Prior map repository binding changed')
  }
  assertEvolutionAncestor(expectedRepo, record.commitSha, currentCommitSha, 'Prior map revision is foreign or later than the current revision')
  if (!candidateGraphShape(record.graph)) throw new Error('Prior map candidate graph changed')
  return true
}
