import {
  forceCollide,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  scaleTime,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3'
import { useMemo } from 'react'

import type { AtlasDataset, Relationship } from './model'

type GraphNodeKind = 'contributor' | 'episode' | 'feature' | 'area'

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  kind: GraphNodeKind
  targetX: number
  targetY: number
  fx?: number | null
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  relationship: Relationship
}

interface AtlasGraphProps {
  dataset: AtlasDataset
  cutoffIndex: number
  selectedId: string | null
  onSelect: (id: string) => void
}

const WIDTH = 1120
const HEIGHT = 620
const HORIZONTAL_PADDING = 80
const NODE_COLORS: Record<GraphNodeKind, string> = {
  contributor: '#f5c96a',
  episode: '#f7f1df',
  feature: '#ef8354',
  area: '#6fc6b4',
}

function dateExtent(dates: Date[]) {
  const first = dates[0]
  const last = dates.at(-1) ?? first
  if (first.getTime() !== last.getTime()) return [first, last] as const
  const day = 24 * 60 * 60 * 1000
  return [new Date(first.getTime() - day), new Date(last.getTime() + day)] as const
}

function connectedDate(
  nodeId: string,
  visibleRelationships: Relationship[],
  dateByCommit: Map<string, Date>,
  fallback: number,
) {
  const timestamps = visibleRelationships
    .filter((relationship) => relationship.sourceId === nodeId || relationship.targetId === nodeId)
    .flatMap((relationship) => relationship.evidence)
    .map((evidence) => dateByCommit.get(evidence.commitSha)?.getTime())
    .filter((timestamp): timestamp is number => timestamp !== undefined)

  if (timestamps.length === 0) return fallback
  return timestamps.reduce((total, timestamp) => total + timestamp, 0) / timestamps.length
}

function resolveNode(linkEnd: string | number | GraphNode, nodesById: Map<string, GraphNode>) {
  if (typeof linkEnd === 'object') return linkEnd
  return nodesById.get(String(linkEnd))
}

export function AtlasGraph({ dataset, cutoffIndex, selectedId, onSelect }: AtlasGraphProps) {
  const graph = useMemo(() => {
    const visibleEpisodes = dataset.episodes.slice(0, cutoffIndex + 1)
    if (visibleEpisodes.length === 0) return null

    const visibleCommitShas = new Set(visibleEpisodes.map((episode) => episode.commitSha))
    const visibleRelationships = dataset.relationships.filter((relationship) =>
      relationship.evidence.some((evidence) => visibleCommitShas.has(evidence.commitSha)),
    )
    const connectedIds = new Set(
      visibleRelationships.flatMap((relationship) => [relationship.sourceId, relationship.targetId]),
    )
    const dates = visibleEpisodes.map((episode) => new Date(episode.authoredAt))
    const [firstDate, lastDate] = dateExtent(dates)
    const timeScale = scaleTime()
      .domain([firstDate, lastDate])
      .range([HORIZONTAL_PADDING, WIDTH - HORIZONTAL_PADDING])
    const dateByCommit = new Map(
      visibleEpisodes.map((episode) => [episode.commitSha, new Date(episode.authoredAt)]),
    )
    const fallbackTimestamp = dates.reduce((total, date) => total + date.getTime(), 0) / dates.length

    const nodes: GraphNode[] = []
    for (const contributor of dataset.contributors) {
      if (!connectedIds.has(contributor.id)) continue
      nodes.push({
        id: contributor.id,
        label: contributor.displayName,
        kind: 'contributor',
        targetX: timeScale(
          new Date(
            connectedDate(contributor.id, visibleRelationships, dateByCommit, fallbackTimestamp),
          ),
        ),
        targetY: 125,
      })
    }
    for (const episode of visibleEpisodes) {
      const x = timeScale(new Date(episode.authoredAt))
      nodes.push({
        id: episode.id,
        label: episode.subject,
        kind: 'episode',
        targetX: x,
        targetY: 300,
        fx: x,
      })
    }
    for (const feature of dataset.featureCandidates) {
      if (!connectedIds.has(feature.id)) continue
      nodes.push({
        id: feature.id,
        label: feature.label,
        kind: 'feature',
        targetX: timeScale(
          new Date(connectedDate(feature.id, visibleRelationships, dateByCommit, fallbackTimestamp)),
        ),
        targetY: 420,
      })
    }
    for (const area of dataset.codeAreas) {
      if (!connectedIds.has(area.id)) continue
      nodes.push({
        id: area.id,
        label: area.label,
        kind: 'area',
        targetX: timeScale(
          new Date(connectedDate(area.id, visibleRelationships, dateByCommit, fallbackTimestamp)),
        ),
        targetY: 525,
      })
    }

    const nodeIds = new Set(nodes.map((node) => node.id))
    const links: GraphLink[] = visibleRelationships
      .filter(
        (relationship) =>
          nodeIds.has(relationship.sourceId) && nodeIds.has(relationship.targetId),
      )
      .map((relationship) => ({
        id: relationship.id,
        source: relationship.sourceId,
        target: relationship.targetId,
        relationship,
      }))

    const simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(74)
          .strength(0.45),
      )
      .force(
        'x',
        forceX<GraphNode>((node) => node.targetX).strength((node) =>
          node.kind === 'episode' ? 1 : 0.34,
        ),
      )
      .force('y', forceY<GraphNode>((node) => node.targetY).strength(0.72))
      .force('collide', forceCollide<GraphNode>().radius(24).iterations(2))
      .stop()

    for (let tick = 0; tick < 180; tick += 1) simulation.tick()
    simulation.stop()

    return {
      nodes,
      links,
      nodesById: new Map(nodes.map((node) => [node.id, node])),
      firstDate,
      lastDate,
    }
  }, [cutoffIndex, dataset])

  if (!graph) return <div className="graph-empty">No committed change episodes to map yet.</div>

  return (
    <div className="graph-frame">
      <svg
        className="atlas-graph"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Temporal relationship graph of contributors, commits, and code areas"
      >
        <defs>
          <linearGradient id="time-glow" x1="0" x2="1">
            <stop offset="0" stopColor="#6fc6b4" stopOpacity="0.25" />
            <stop offset="1" stopColor="#ef8354" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        <g className="time-axis">
          <line
            x1={HORIZONTAL_PADDING}
            x2={WIDTH - HORIZONTAL_PADDING}
            y1="45"
            y2="45"
          />
          <text x={HORIZONTAL_PADDING} y="30">
            {graph.firstDate.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </text>
          <text x={WIDTH - HORIZONTAL_PADDING} y="30" textAnchor="end">
            {graph.lastDate.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </text>
        </g>

        <g className="lane-labels" aria-hidden="true">
          <text x="22" y="128">AUTHORS</text>
          <text x="22" y="303">CHANGES</text>
          <text x="22" y="528">AREAS</text>
        </g>

        <g className="relationships">
          {graph.links.map((link) => {
            const source = resolveNode(link.source, graph.nodesById)
            const target = resolveNode(link.target, graph.nodesById)
            if (!source || !target) return null
            return (
              <line
                key={link.id}
                x1={source.x ?? source.targetX}
                y1={source.y ?? source.targetY}
                x2={target.x ?? target.targetX}
                y2={target.y ?? target.targetY}
                className={`relationship relationship--${link.relationship.kind}`}
              />
            )
          })}
        </g>

        <g className="nodes">
          {graph.nodes.map((node) => {
            const x = node.x ?? node.targetX
            const y = node.y ?? node.targetY
            const isSelected = selectedId === node.id
            return (
              <g
                key={node.id}
                className={`node node--${node.kind}${isSelected ? ' node--selected' : ''}`}
                transform={`translate(${x}, ${y})`}
                role="button"
                tabIndex={0}
                aria-label={`${node.kind}: ${node.label}`}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(node.id)
                }}
              >
                <circle r={node.kind === 'episode' ? 9 : 12} fill={NODE_COLORS[node.kind]} />
                <text y={node.kind === 'contributor' ? -19 : 26}>{node.label}</text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
