import {
  forceCollide,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  scaleTime,
  select,
  zoom as d3Zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ScaleTime,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'

import { featureEpisodes, meanTimestamp, type ViewControls, type VisibleModel } from './derive'
import type { AtlasDataset } from './model'

type GraphNodeKind = 'contributor' | 'episode' | 'feature' | 'area'

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  kind: GraphNodeKind
  radius: number
  /** 0–1 for features; 1 for observed nodes, which are not confidence-weighted. */
  confidence: number
  targetX: number
  fx?: number | null
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  kind: 'contributed' | 'affects-area' | 'supports-feature'
  weight: number
}

interface Band {
  center: number
  min: number
  max: number
}

interface AtlasGraphProps {
  dataset: AtlasDataset
  visible: VisibleModel
  controls: ViewControls
  selectedId: string | null
  onSelect: (id: string) => void
}

const GUTTER = 96
const AXIS_TOP = 52
const BOTTOM_PADDING = 18
const MIN_WIDTH = 640
const LABEL_FONT = 10.5
const LANE_ORDER: Record<GraphNodeKind, string> = {
  contributor: 'AUTHORS',
  feature: 'FEATURES',
  episode: 'COMMITS',
  area: 'AREAS',
}
const NODE_COLORS: Record<GraphNodeKind, string> = {
  contributor: '#f5c96a',
  episode: '#f7f1df',
  feature: '#ef8354',
  area: '#6fc6b4',
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Vertical bands, one per node kind. Nodes are clamped inside their own band, so a
 * lane can never bleed into its neighbour no matter how crowded the history gets.
 */
function computeBands(height: number, showCommits: boolean): Record<GraphNodeKind, Band> {
  const kinds: GraphNodeKind[] = showCommits
    ? ['contributor', 'feature', 'episode', 'area']
    : ['contributor', 'feature', 'area']
  const weights = showCommits ? [0.2, 0.34, 0.24, 0.22] : [0.24, 0.48, 0.28]
  const gap = 12
  const usable = height - AXIS_TOP - BOTTOM_PADDING - gap * (kinds.length - 1)

  const bands = {} as Record<GraphNodeKind, Band>
  let cursor = AXIS_TOP
  kinds.forEach((kind, index) => {
    const span = usable * weights[index]
    bands[kind] = { min: cursor, max: cursor + span, center: cursor + span / 2 }
    cursor += span + gap
  })
  // Commits are hidden in feature mode, but the band still needs to exist for typing.
  if (!showCommits) bands.episode = bands.feature
  return bands
}

function truncate(label: string, limit: number) {
  if (label.length <= limit) return label
  return `${label.slice(0, limit - 1).trimEnd()}…`
}

function linkPath(source: GraphNode, target: GraphNode) {
  const x1 = source.x ?? source.targetX
  const y1 = source.y ?? 0
  const x2 = target.x ?? target.targetX
  const y2 = target.y ?? 0
  const midY = (y1 + y2) / 2
  return `M${x1},${y1}C${x1},${midY} ${x2},${midY} ${x2},${y2}`
}

function endpointId(end: string | number | GraphNode) {
  return typeof end === 'object' ? end.id : String(end)
}

function useMeasuredWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      // Snap to 12px steps so a drag-resize does not rebuild the layout every pixel.
      setWidth(Math.round(measured / 12) * 12)
    })
    observer.observe(element)
    setWidth(Math.round(element.getBoundingClientRect().width / 12) * 12)
    return () => observer.disconnect()
  }, [ref])
  return width
}

interface Layout {
  nodes: GraphNode[]
  links: GraphLink[]
  nodesById: Map<string, GraphNode>
  bands: Record<GraphNodeKind, Band>
  timeScale: ScaleTime<number, number>
  ticks: Date[]
  width: number
  height: number
  showCommits: boolean
}

export function AtlasGraph({ dataset, visible, controls, selectedId, onSelect }: AtlasGraphProps) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  // Positions survive a filter change so nodes glide to their new place instead of
  // teleporting, which is what made the previous layout read as a jump cut.
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())
  const [, setFrame] = useState(0)
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const measuredWidth = useMeasuredWidth(frameRef)
  const width = Math.max(measuredWidth || MIN_WIDTH, MIN_WIDTH)
  const height = Math.round(Math.min(Math.max(width * 0.56, 520), 760))

  const layout = useMemo<Layout | null>(() => {
    if (visible.features.length === 0 && visible.episodes.length === 0) return null

    const showCommits = controls.detail === 'commits'
    const bands = computeBands(height, showCommits)
    const episodeBySha = new Map(dataset.episodes.map((episode) => [episode.commitSha, episode]))
    const contributorById = new Map(dataset.contributors.map((entry) => [entry.id, entry]))
    const areaById = new Map(dataset.codeAreas.map((area) => [area.id, area]))

    const featureTimes = new Map<string, number>()
    const featureAreas = new Map<string, Set<string>>()
    for (const feature of visible.features) {
      const episodes = featureEpisodes(feature, episodeBySha)
      const mean = meanTimestamp(episodes)
      if (mean !== null) featureTimes.set(feature.id, mean)
      featureAreas.set(feature.id, new Set(episodes.flatMap((episode) => episode.codeAreaIds)))
    }

    const times = [
      ...featureTimes.values(),
      ...visible.episodes.map((episode) => new Date(episode.authoredAt).getTime()),
    ]
    if (times.length === 0) return null

    const day = 24 * 60 * 60 * 1000
    const first = Math.min(...times)
    const last = Math.max(...times)
    const timeScale = scaleTime()
      .domain(first === last ? [new Date(first - day), new Date(last + day)] : [new Date(first), new Date(last)])
      .range([GUTTER, width - GUTTER / 2])

    const nodes: GraphNode[] = []
    const links: GraphLink[] = []

    const push = (node: Omit<GraphNode, 'x' | 'y'>) => {
      const previous = positionsRef.current.get(node.id)
      nodes.push({
        ...node,
        // New nodes enter at their true time position on the band centre line.
        x: previous?.x ?? node.targetX,
        y: previous?.y ?? bands[node.kind].center,
      })
    }

    for (const feature of visible.features) {
      const time = featureTimes.get(feature.id)
      if (time === undefined) continue
      const x = timeScale(new Date(time))
      push({
        id: feature.id,
        label: feature.label,
        kind: 'feature',
        // Weight by how much evidence stands behind the claim, not by importance.
        radius: 6 + Math.min(feature.evidence.length, 16) * 0.7,
        confidence: feature.confidence,
        targetX: x,
        fx: x,
      })
    }

    const contributorTimes = new Map<string, number[]>()
    for (const feature of visible.features) {
      const time = featureTimes.get(feature.id)
      if (time === undefined) continue
      for (const [contributorId, count] of visible.contributions.get(feature.id) ?? []) {
        if (!visible.contributorIds.has(contributorId)) continue
        const collected = contributorTimes.get(contributorId) ?? []
        collected.push(time)
        contributorTimes.set(contributorId, collected)
        links.push({
          id: `contributed:${contributorId}:${feature.id}`,
          source: contributorId,
          target: feature.id,
          kind: 'contributed',
          weight: count,
        })
      }
    }

    for (const [contributorId, collected] of contributorTimes) {
      const contributor = contributorById.get(contributorId)
      if (!contributor) continue
      const mean = collected.reduce((sum, value) => sum + value, 0) / collected.length
      push({
        id: contributorId,
        label: contributor.displayName,
        kind: 'contributor',
        radius: 6 + Math.min(collected.length, 14) * 0.55,
        confidence: 1,
        targetX: timeScale(new Date(mean)),
      })
    }

    const areaTimes = new Map<string, number[]>()
    for (const feature of visible.features) {
      const time = featureTimes.get(feature.id)
      if (time === undefined) continue
      for (const areaId of featureAreas.get(feature.id) ?? []) {
        const collected = areaTimes.get(areaId) ?? []
        collected.push(time)
        areaTimes.set(areaId, collected)
        links.push({
          id: `affects-area:${feature.id}:${areaId}`,
          source: feature.id,
          target: areaId,
          kind: 'affects-area',
          weight: 1,
        })
      }
    }

    for (const [areaId, collected] of areaTimes) {
      const area = areaById.get(areaId)
      if (!area) continue
      const mean = collected.reduce((sum, value) => sum + value, 0) / collected.length
      push({
        id: areaId,
        label: area.label,
        kind: 'area',
        radius: 6 + Math.min(collected.length, 14) * 0.55,
        confidence: 1,
        targetX: timeScale(new Date(mean)),
      })
    }

    if (showCommits) {
      const featureBySha = new Map<string, string>()
      for (const feature of visible.features) {
        for (const reference of feature.evidence) featureBySha.set(reference.commitSha, feature.id)
      }
      for (const episode of visible.episodes) {
        const x = timeScale(new Date(episode.authoredAt))
        push({
          id: episode.id,
          label: episode.subject,
          kind: 'episode',
          radius: 3.2,
          confidence: 1,
          targetX: x,
          fx: x,
        })
        const featureId = featureBySha.get(episode.commitSha)
        if (featureId) {
          links.push({
            id: `supports-feature:${episode.commitSha}:${featureId}`,
            source: episode.id,
            target: featureId,
            kind: 'supports-feature',
            weight: 1,
          })
        }
      }
    }

    const nodeIds = new Set(nodes.map((node) => node.id))
    const drawableLinks = links.filter(
      (link) => nodeIds.has(endpointId(link.source)) && nodeIds.has(endpointId(link.target)),
    )
    const tickCount = Math.max(3, Math.round((width - GUTTER * 1.5) / 150))

    return {
      nodes,
      links: drawableLinks,
      nodesById: new Map(nodes.map((node) => [node.id, node])),
      bands,
      timeScale,
      ticks: timeScale.ticks(tickCount),
      width,
      height,
      showCommits,
    }
  }, [controls.detail, dataset, height, visible, width])

  useEffect(() => {
    if (!layout) return
    const { nodes, links, bands, width: layoutWidth } = layout

    // Keep every node inside its own band and inside the drawn time range. Features and
    // commits stay pinned to their true date in x; crowding is resolved vertically so
    // the horizontal axis never lies.
    const constrain = () => {
      for (const node of nodes) {
        const band = bands[node.kind]
        const top = band.min + node.radius
        const bottom = band.max - node.radius
        if ((node.y ?? 0) < top) {
          node.y = top
          node.vy = 0
        } else if ((node.y ?? 0) > bottom) {
          node.y = bottom
          node.vy = 0
        }
        const left = GUTTER - 40
        const right = layoutWidth - 12
        if ((node.x ?? 0) < left) {
          node.x = left
          node.vx = 0
        } else if ((node.x ?? 0) > right) {
          node.x = right
          node.vx = 0
        }
      }
    }

    const simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(70)
          .strength(0.12),
      )
      .force(
        'x',
        forceX<GraphNode>((node) => node.targetX).strength((node) =>
          node.kind === 'feature' || node.kind === 'episode' ? 1 : 0.2,
        ),
      )
      .force(
        'y',
        forceY<GraphNode>((node) => bands[node.kind].center).strength((node) =>
          node.kind === 'feature' ? 0.06 : 0.45,
        ),
      )
      .force(
        'collide',
        forceCollide<GraphNode>()
          .radius((node) => node.radius + (node.kind === 'episode' ? 1.5 : 9))
          .strength(0.9)
          .iterations(2),
      )
      .force('constrain', constrain)
      .alphaDecay(0.035)
      .velocityDecay(0.35)

    const persist = () => {
      for (const node of nodes) {
        positionsRef.current.set(node.id, { x: node.x ?? node.targetX, y: node.y ?? 0 })
      }
    }

    if (prefersReducedMotion()) {
      simulation.stop()
      for (let tick = 0; tick < 240; tick += 1) simulation.tick()
      persist()
      setFrame((value) => value + 1)
      return () => simulation.stop()
    }

    simulation.on('tick', () => {
      persist()
      setFrame((value) => value + 1)
    })
    simulation.alpha(0.85).restart()

    return () => {
      simulation.on('tick', null)
      simulation.stop()
      persist()
    }
  }, [layout])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const behavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.75, 8])
      // Wheel alone still scrolls the page; zooming asks for a modifier so the graph
      // never swallows an ordinary scroll past it.
      .filter((event: Event) => {
        if (event.type === 'wheel') {
          const wheel = event as WheelEvent
          return wheel.metaKey || wheel.ctrlKey
        }
        return !(event as MouseEvent).button
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => setTransform(event.transform))

    zoomRef.current = behavior
    select(svg).call(behavior)
    return () => {
      select(svg).on('.zoom', null)
      zoomRef.current = null
    }
  }, [])

  function scaleBy(factor: number) {
    const svg = svgRef.current
    const behavior = zoomRef.current
    if (!svg || !behavior) return
    select(svg).transition().duration(240).call(behavior.scaleBy, factor)
  }

  function resetZoom() {
    const svg = svgRef.current
    const behavior = zoomRef.current
    if (!svg || !behavior) return
    select(svg).transition().duration(280).call(behavior.transform, zoomIdentity)
  }

  if (!layout) {
    return (
      <div className="graph-frame" ref={frameRef}>
        <div className="graph-empty">
          Nothing matches the current filters. Lower the confidence floor or clear the contributor
          filter.
        </div>
      </div>
    )
  }

  const focusId = hoveredId ?? selectedId
  const neighbours = new Set<string>()
  if (focusId) {
    for (const link of layout.links) {
      const source = endpointId(link.source)
      const target = endpointId(link.target)
      if (source === focusId) neighbours.add(target)
      if (target === focusId) neighbours.add(source)
    }
  }

  // Greedy label placement: the biggest nodes claim their box first, and anything that
  // would overlap stays silent. Boxes are measured in screen pixels, so zooming in
  // reveals more labels instead of just magnifying the same collisions.
  const scale = transform.k
  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  const labelled = new Set<string>()
  const forced = layout.nodes.filter(
    (node) => node.id === focusId || node.id === selectedId || neighbours.has(node.id),
  )
  const ranked = [...layout.nodes]
    .filter((node) => node.kind !== 'episode')
    .sort((left, right) => right.radius - left.radius)

  for (const node of [...forced, ...ranked]) {
    if (labelled.has(node.id)) continue
    const text = truncate(node.label, node.kind === 'feature' ? 34 : 22)
    const halfWidth = (text.length * LABEL_FONT * 0.28) / scale
    const lineHeight = (LABEL_FONT + 5) / scale
    const above = node.kind === 'contributor'
    const x = node.x ?? node.targetX
    const y = node.y ?? 0
    const top = above ? y - node.radius - lineHeight - 2 / scale : y + node.radius + 2 / scale
    const box = { x1: x - halfWidth, y1: top, x2: x + halfWidth, y2: top + lineHeight }
    const isForced = forced.includes(node)
    const collides =
      !isForced &&
      placed.some((other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1)
    if (collides) continue
    placed.push(box)
    labelled.add(node.id)
  }

  return (
    <div className="graph-frame" ref={frameRef}>
      <div className="graph-toolbar">
        <button type="button" onClick={() => scaleBy(1.45)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => scaleBy(1 / 1.45)} aria-label="Zoom out">−</button>
        <button type="button" onClick={resetZoom} disabled={transform.k === 1 && transform.x === 0 && transform.y === 0}>
          reset
        </button>
      </div>

      <svg
        ref={svgRef}
        className="atlas-graph"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="Temporal graph of contributors, candidate features, and code areas"
      >
        <defs>
          <linearGradient id="time-glow" x1="0" x2="1">
            <stop offset="0" stopColor="#6fc6b4" stopOpacity="0.3" />
            <stop offset="1" stopColor="#ef8354" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <g transform={transform.toString()}>
          <g className="lane-bands" aria-hidden="true">
            {(Object.keys(LANE_ORDER) as GraphNodeKind[])
              .filter((kind) => kind !== 'episode' || layout.showCommits)
              .map((kind) => {
                const band = layout.bands[kind]
                return (
                  <g key={kind} className={`lane lane--${kind}`}>
                    <rect
                      x={GUTTER - 46}
                      y={band.min}
                      width={layout.width - GUTTER + 34}
                      height={band.max - band.min}
                      rx={4}
                    />
                    <text x={GUTTER - 56} y={band.center} fontSize={9.5 / scale} textAnchor="end">
                      {LANE_ORDER[kind]}
                    </text>
                  </g>
                )
              })}
          </g>

          <g className="time-grid" aria-hidden="true">
            {layout.ticks.map((tick) => {
              const x = layout.timeScale(tick)
              return (
                <g key={tick.toISOString()}>
                  <line x1={x} x2={x} y1={AXIS_TOP - 6} y2={layout.height - BOTTOM_PADDING} />
                  <text x={x} y={AXIS_TOP - 14} fontSize={9.5 / scale} textAnchor="middle">
                    {tick.toLocaleDateString(undefined, {
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </text>
                </g>
              )
            })}
            <line
              className="time-axis-rule"
              x1={GUTTER - 46}
              x2={layout.width - 12}
              y1={AXIS_TOP - 6}
              y2={AXIS_TOP - 6}
              strokeWidth={2 / scale}
            />
          </g>

          <g className="relationships">
            {layout.links.map((link) => {
              const source = layout.nodesById.get(endpointId(link.source))
              const target = layout.nodesById.get(endpointId(link.target))
              if (!source || !target) return null
              const active =
                focusId !== null && (source.id === focusId || target.id === focusId)
              const dimmed = focusId !== null && !active
              return (
                <path
                  key={link.id}
                  d={linkPath(source, target)}
                  className={`relationship relationship--${link.kind}${active ? ' relationship--active' : ''}${dimmed ? ' relationship--dimmed' : ''}`}
                  strokeWidth={Math.min(0.9 + link.weight * 0.3, 3) / scale}
                />
              )
            })}
          </g>

          <g className="nodes">
            {layout.nodes.map((node) => {
              const x = node.x ?? node.targetX
              const y = node.y ?? layout.bands[node.kind].center
              const isSelected = selectedId === node.id
              const isFocused = focusId === node.id
              const dimmed = focusId !== null && !isFocused && !neighbours.has(node.id)
              return (
                <g
                  key={node.id}
                  className={`node node--${node.kind}${isSelected ? ' node--selected' : ''}${dimmed ? ' node--dimmed' : ''}`}
                  transform={`translate(${x}, ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.kind}: ${node.label}`}
                  onClick={() => onSelect(node.id)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId((current) => (current === node.id ? null : current))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(node.id)
                    }
                  }}
                >
                  {(isFocused || isSelected) && (
                    <circle className="node-halo" r={node.radius + 7} strokeWidth={1.5 / scale} />
                  )}
                  <circle
                    r={node.radius}
                    fill={NODE_COLORS[node.kind]}
                    // Candidate features fade with the model's stated confidence; observed
                    // nodes are drawn solid because nothing about them is proposed.
                    fillOpacity={node.kind === 'feature' ? 0.45 + node.confidence * 0.55 : 1}
                    strokeWidth={3 / scale}
                  />
                </g>
              )
            })}
          </g>

          <g className="node-labels" aria-hidden="true">
            {layout.nodes.map((node) => {
              if (!labelled.has(node.id)) return null
              const x = node.x ?? node.targetX
              const y = node.y ?? layout.bands[node.kind].center
              const above = node.kind === 'contributor'
              const dimmed = focusId !== null && focusId !== node.id && !neighbours.has(node.id)
              if (dimmed) return null
              return (
                <text
                  key={node.id}
                  x={x}
                  y={above ? y - node.radius - 6 / scale : y + node.radius + LABEL_FONT / scale}
                  fontSize={LABEL_FONT / scale}
                  strokeWidth={3 / scale}
                  textAnchor="middle"
                  className={`node-label node-label--${node.kind}${focusId === node.id ? ' node-label--focus' : ''}`}
                >
                  {truncate(node.label, node.kind === 'feature' ? 34 : 22)}
                </text>
              )
            })}
          </g>
        </g>
      </svg>

      <p className="graph-hint">
        Drag to pan · ⌘/Ctrl + scroll to zoom · hover to isolate a node’s links
      </p>
    </div>
  )
}
