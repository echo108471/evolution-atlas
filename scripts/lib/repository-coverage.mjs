import { safeRepositoryPath } from './repository-snapshot.mjs'

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const count = (x, name, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(x) || x < min || x > max) throw new Error(`Invalid ${name}`)
  return x
}
const sum = values => count(values.reduce((a, b) => a + b, 0), 'aggregate count')

/** Pure metadata routing. File inspection means at least one source receipt,
 * not complete file reading or semantic coverage. Callers verify receipt bytes
 * and snapshot provenance separately with the source broker. */
export function planRepositoryCoverage(inventory, receipts, options = {}) {
  if (!object(inventory) || !Array.isArray(inventory.files)) throw new Error('Invalid inventory')
  if (!Array.isArray(receipts)) throw new Error('Invalid receipts')
  if (!object(options)) throw new Error('Invalid options')
  const settings = { maxRegionFiles: 200, maxDepth: 6, assignmentCount: 3, regionsPerAssignment: 2, ...options }
  for (const key of Object.keys(options)) if (!['maxRegionFiles', 'maxDepth', 'assignmentCount', 'regionsPerAssignment'].includes(key)) throw new Error(`Unknown option: ${key}`)
  count(settings.maxRegionFiles, 'maxRegionFiles', 1)
  count(settings.maxDepth, 'maxDepth', 1, 64)
  count(settings.assignmentCount, 'assignmentCount', 1, 6)
  count(settings.regionsPerAssignment, 'regionsPerAssignment', 1, 100)
  if (inventory.commitSha !== undefined && (typeof inventory.commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(inventory.commitSha))) throw new Error('Invalid commitSha')
  if (inventory.eligibleFiles !== undefined && inventory.eligibleFiles !== inventory.files.length) throw new Error('Invalid eligibleFiles')
  if (inventory.allTrackedEntries !== undefined) count(inventory.allTrackedEntries, 'allTrackedEntries', inventory.files.length)

  const files = new Map(), ranges = new Map(), inspected = new Set(), totalLines = new Map()
  for (const file of inventory.files) {
    if (!object(file) || !safeRepositoryPath(file.path)) throw new Error('Invalid inventory file path')
    if (files.has(file.path)) throw new Error('Duplicate inventory file path')
    count(file.size, 'file size')
    if (file.totalLines !== undefined) totalLines.set(file.path, count(file.totalLines, 'file totalLines'))
    files.set(file.path, { path: file.path, size: file.size })
  }
  // A path cannot simultaneously describe a file and an ancestor directory.
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) throw new Error('Conflicting file and directory paths')
  }
  for (const receipt of receipts) {
    if (!object(receipt) || !['source', 'search'].includes(receipt.kind)) throw new Error('Invalid receipt kind')
    if (receipt.kind === 'search') continue
    if (!safeRepositoryPath(receipt.path) || !files.has(receipt.path)) throw new Error('Unknown or unsafe source receipt path')
    if (receipt.commitSha !== undefined && inventory.commitSha !== undefined && receipt.commitSha !== inventory.commitSha) throw new Error('Source receipt snapshot mismatch')
    inspected.add(receipt.path)
    if (receipt.totalLines !== undefined) {
      count(receipt.totalLines, 'receipt totalLines')
      if (totalLines.has(receipt.path) && totalLines.get(receipt.path) !== receipt.totalLines) throw new Error('Conflicting totalLines')
      totalLines.set(receipt.path, receipt.totalLines)
    }
    if (receipt.startLine !== undefined || receipt.endLine !== undefined) {
      count(receipt.startLine, 'startLine', 1)
      count(receipt.endLine, 'endLine', receipt.startLine)
      if (!ranges.has(receipt.path)) ranges.set(receipt.path, [])
      ranges.get(receipt.path).push([receipt.startLine, receipt.endLine])
    }
  }
  const uniqueLines = new Map()
  for (const [path, windows] of ranges) {
    windows.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const merged = []
    for (const [start, end] of windows) {
      if (totalLines.has(path) && end > totalLines.get(path)) throw new Error('Source range exceeds totalLines')
      const last = merged.at(-1)
      if (last && start - 1 <= last[1]) last[1] = Math.max(last[1], end)
      else merged.push([start, end])
    }
    uniqueLines.set(path, sum(merged.map(([start, end]) => end - start + 1)))
  }
  const ordered = [...files.values()].sort((a, b) => compare(a.path, b.path))
  function summarize(list) {
    return { fileCount: list.length, byteCount: sum(list.map(f => f.size)),
      inspectedFileCount: list.filter(f => inspected.has(f.path)).length,
      unreadFileCount: list.filter(f => !inspected.has(f.path)).length,
      uniqueInspectedLineCount: sum(list.map(f => uniqueLines.get(f.path) ?? 0)),
      inspectedFilesWithoutRanges: list.filter(f => inspected.has(f.path) && !ranges.has(f.path)).length,
      filesWithKnownLineCount: list.filter(f => totalLines.has(f.path)).length,
      knownTotalLineCount: sum(list.map(f => totalLines.get(f.path) ?? 0)) }
  }
  const regions = []
  function add(list, prefix, kind, depth) {
    regions.push({ pathPrefix: prefix, kind, depth, topLevelSubtree: list[0].path.includes('/') ? list[0].path.split('/')[0] : null,
      assignedFilePaths: list.map(f => f.path), unreadFilePaths: list.filter(f => !inspected.has(f.path)).map(f => f.path),
      oversized: list.length > settings.maxRegionFiles, ...summarize(list) })
  }
  function partition(list, prefix = '', depth = 0) {
    if (prefix && (list.length <= settings.maxRegionFiles || depth >= settings.maxDepth)) {
      add(list, prefix, 'directory', depth); return
    }
    const direct = [], directories = new Map()
    for (const file of list) {
      const parts = file.path.split('/')
      if (parts.length === depth + 1) direct.push(file)
      else {
        const child = parts[depth]
        if (!directories.has(child)) directories.set(child, [])
        directories.get(child).push(file)
      }
    }
    if (prefix && direct.length) add(direct, prefix, 'direct-files', depth)
    else for (const file of direct) add([file], file.path, 'file', 0)
    for (const [child, children] of directories) partition(children, prefix + child + '/', depth + 1)
  }
  partition(ordered)
  regions.sort((a, b) => compare(a.pathPrefix, b.pathPrefix) || compare(a.kind, b.kind))
  regions.forEach((region, index) => { region.id = `region-${String(index + 1).padStart(4, '0')}` })
  const rank = (a, b) => Number(a.inspectedFileCount > 0) - Number(b.inspectedFileCount > 0)
    || b.unreadFileCount - a.unreadFileCount || compare(a.id, b.id)
  const available = regions.filter(r => r.unreadFileCount > 0).sort(rank), selected = [], represented = new Set()
  const slots = settings.assignmentCount * settings.regionsPerAssignment
  while (available.length && selected.length < slots) {
    // First cover distinct top-level subtrees, then use the normal priority.
    const diverse = available.findIndex(r => !represented.has(r.topLevelSubtree))
    const [region] = available.splice(diverse < 0 ? 0 : diverse, 1)
    selected.push(region); represented.add(region.topLevelSubtree)
  }
  const assignments = Array.from({ length: settings.assignmentCount }, (_, i) => ({
    agent: String.fromCharCode(65 + i), regions: selected.filter((_, index) => index % settings.assignmentCount === i),
  }))
  return { version: 'repository-coverage/1', commitSha: inventory.commitSha ?? null, options: settings,
    routing: {
      priority: 'Untouched regions first, then descending unread file count, then stable region ID; regions with no unread files are not assigned.',
      diversity: 'Before repeating a top-level subtree, select the highest-priority region from an unrepresented top-level subtree when one exists. This takes precedence over untouched priority. Root direct files share a null subtree. Assign selected regions round-robin to agents.',
      membership: 'assignedFilePaths is the exclusive full region membership; unreadFilePaths is the subset with no source receipt, for fresh inspection assignments. pathPrefix is exact navigation scope and may also match child regions for direct-files buckets.',
      evidenceFollowing: 'Regions route initial inspection, not semantic ownership. Follow cross-region evidence through the source broker when needed.',
      accounting: 'Inspected files have at least one source receipt; unread files have none. Search receipts do not count. Line counts union supplied inclusive ranges per file; missing ranges and unknown file lengths are not inferred. Metadata accounting does not establish semantic coverage or verify receipt provenance.',
      partitioning: 'Split oversized directory groups at actual child directories up to maxDepth. Direct sibling files remain together; root direct files are individual regions. Depth-limited or indivisible groups may exceed maxRegionFiles.',
    },
    inventory: { ...summarize(ordered), exhausted: inspected.size === ordered.length,
      regionCount: regions.length, untouchedRegionCount: regions.filter(r => r.inspectedFileCount === 0).length,
      regionsWithUnreadFiles: regions.filter(r => r.unreadFileCount > 0).length },
    batch: { selectedRegionCount: selected.length, selectedFileCount: sum(selected.map(r => r.fileCount)),
      selectedUnreadFileCount: sum(selected.map(r => r.unreadFileCount)), unfilledRegionSlots: slots - selected.length,
      remainingRegionCount: available.length, selectionPoolExhausted: available.length === 0 }, regions, assignments }
}
