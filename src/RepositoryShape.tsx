import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  childScopePath,
  type RepositoryShapeModel,
  type ShapeTransition,
} from './directoryLifespans'

/** A checkpoint a click can land on, used to preview the landing spot on hover. */
export interface ShapeCheckpoint {
  percent: number
  label: string
}

interface RepositoryShapeProps {
  model: RepositoryShapeModel
  selectedId: string | null
  /** Percent position of the checkpoint the detail panel is showing. */
  playheadPercent: number
  playheadLabel: string
  /** Ordered checkpoints the chart snaps to, so hover previews what a click selects. */
  checkpoints: ShapeCheckpoint[]
  onSelectPercent: (percent: number) => void
  onSelectStructural: (id: string) => void
  onScopeChange: (scopePath: string) => void
  /** False when the dataset publishes no structural candidates, so the legend omits them. */
  showStructureLegend?: boolean
}

/**
 * Anchor a date flag proportionally to its position: left-aligned at the start, centred
 * mid-track, right-aligned at the end, so a checkpoint at either edge is never clipped.
 */
function flagStyle(percent: number) {
  const clamped = Math.min(Math.max(percent, 0), 100)
  return { left: `${clamped}%`, transform: `translateX(-${clamped}%)` }
}

const ROW_HEIGHT = 34
const BAND_MAX = 24
const AXIS_HEIGHT = 26
const MARKER_RAIL = 18

function formatMonth(time: number) {
  return new Date(time).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(880)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) setWidth(next)
    })
    observer.observe(element)
    setWidth(element.clientWidth || 880)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/** Contiguous runs of columns where the directory held files. */
function lifespanRuns(samples: number[]) {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index] > 0) {
      if (start === -1) start = index
    } else if (start !== -1) {
      runs.push([start, index - 1])
      start = -1
    }
  }
  if (start !== -1) runs.push([start, samples.length - 1])
  return runs
}

function bandPath(
  samples: number[],
  columns: number,
  width: number,
  centerY: number,
  peak: number,
) {
  const x = (column: number) => (columns <= 1 ? 0 : (column / (columns - 1)) * width)
  const half = (value: number) => {
    if (value <= 0) return 0
    // Square root keeps a five-file directory legible next to a two-hundred-file one
    // without claiming they are comparable in size.
    const scaled = Math.sqrt(value / Math.max(peak, 1)) * (BAND_MAX / 2)
    return Math.max(1.25, scaled)
  }

  return lifespanRuns(samples)
    .map(([start, end]) => {
      const top: string[] = []
      const bottom: string[] = []
      for (let column = start; column <= end; column += 1) {
        const px = x(column).toFixed(2)
        top.push(`${px},${(centerY - half(samples[column])).toFixed(2)}`)
        bottom.unshift(`${px},${(centerY + half(samples[column])).toFixed(2)}`)
      }
      return `M${top.join('L')}L${bottom.join('L')}Z`
    })
    .join(' ')
}

function transitionPath(x: number, fromY: number, toY: number) {
  const bulge = Math.max(16, Math.min(48, Math.abs(toY - fromY) * 0.55))
  const direction = toY > fromY ? 1 : -1
  return [
    `M${(x - 5).toFixed(2)},${fromY.toFixed(2)}`,
    `C${(x + bulge).toFixed(2)},${(fromY + direction * 4).toFixed(2)}`,
    `${(x - bulge).toFixed(2)},${(toY - direction * 4).toFixed(2)}`,
    `${(x + 5).toFixed(2)},${toY.toFixed(2)}`,
  ].join(' ')
}

/** The checkpoint a click at this position would select, or null when there are none. */
function nearestCheckpoint(checkpoints: ShapeCheckpoint[], percent: number) {
  let nearest: ShapeCheckpoint | null = null
  let smallest = Number.POSITIVE_INFINITY
  for (const checkpoint of checkpoints) {
    const distance = Math.abs(checkpoint.percent - percent)
    if (distance < smallest) {
      smallest = distance
      nearest = checkpoint
    }
  }
  return nearest
}

export function RepositoryShape({
  model,
  selectedId,
  playheadPercent,
  playheadLabel,
  checkpoints,
  onSelectPercent,
  onSelectStructural,
  onScopeChange,
  showStructureLegend = true,
}: RepositoryShapeProps) {
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [hoveredCheckpoint, setHoveredCheckpoint] = useState<ShapeCheckpoint | null>(null)

  if (model.tracks.length === 0) {
    return (
      <div className="empty-state">
        No observed directories fall inside {model.scopePath || 'the repository root'}.
      </div>
    )
  }

  const chartHeight = model.tracks.length * ROW_HEIGHT
  const rowCenter = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2
  const percentToX = (percent: number) => (percent / 100) * chartWidth
  const rowIndexByKey = new Map(model.tracks.map((track, index) => [track.key, index]))

  const visibleTransitions = model.transitions
    .map((transition) => {
      const fromRow = rowIndexByKey.get(transition.fromKey)
      const toRow = rowIndexByKey.get(transition.toKey)
      if (fromRow === undefined || toRow === undefined) return null
      return { transition, fromRow, toRow }
    })
    .filter((entry): entry is { transition: ShapeTransition; fromRow: number; toRow: number } =>
      entry !== null,
    )

  const handleChartClick = (event: MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0) return
    onSelectPercent(((event.clientX - bounds.left) / bounds.width) * 100)
  }

  const handleChartHover = (event: MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const row = Math.floor((event.clientY - bounds.top) / ROW_HEIGHT)
    setHoveredKey(model.tracks[row]?.key ?? null)
    if (bounds.width === 0) return
    const percent = ((event.clientX - bounds.left) / bounds.width) * 100
    setHoveredCheckpoint(nearestCheckpoint(checkpoints, percent))
  }

  const clearChartHover = () => {
    setHoveredKey(null)
    setHoveredCheckpoint(null)
  }

  const handleTransitionKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelectStructural(id)
  }

  // The preview is redundant once it lands on the checkpoint already selected.
  const previewCheckpoint =
    hoveredCheckpoint && hoveredCheckpoint.percent !== playheadPercent
      ? hoveredCheckpoint
      : null

  const axisTicks = [0, 25, 50, 75, 100].map((percent) => ({
    percent,
    label: formatMonth(
      model.rangeStart + (percent / 100) * (model.rangeEnd - model.rangeStart),
    ),
  }))

  return (
    <div className="shape-chart">
      <div className="shape-chart__grid">
        <div className="shape-chart__labels" style={{ paddingTop: MARKER_RAIL }}>
          {model.tracks.map((track) => {
            const drillPath = childScopePath(model.scopePath, track)
            return (
              <div
                key={track.key}
                className={`shape-label${hoveredKey === track.key ? ' is-hovered' : ''}${
                  track.isActive ? '' : ' is-retired'
                }`}
                style={{ height: ROW_HEIGHT }}
                title={`${track.label} · peak ${track.peakFileCount} observed files${
                  track.isActive
                    ? ` · ${track.currentFileCount} at the end of the range`
                    : ' · no files at the end of the range'
                }`}
                onMouseEnter={() => setHoveredKey(track.key)}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <button
                  type="button"
                  className="shape-label__name"
                  disabled={!drillPath}
                  aria-label={
                    drillPath
                      ? `Open ${track.path} structure`
                      : `${track.label}, ${track.currentFileCount} observed files`
                  }
                  onClick={() => drillPath && onScopeChange(drillPath)}
                >
                  <span>{track.label}</span>
                  {drillPath && <i aria-hidden="true">›</i>}
                </button>
                <small title={`${track.currentFileCount} observed files at the end of the range`}>
                  {track.isActive ? track.currentFileCount : 'gone'}
                </small>
              </div>
            )
          })}
        </div>

        <div className="shape-chart__canvas" ref={chartRef}>
          <svg
            width="100%"
            height={chartHeight + AXIS_HEIGHT + MARKER_RAIL}
            role="img"
            aria-label={`Directory lifespans inside ${
              model.scopePath || 'the repository root'
            }: ${model.tracks.length} directories, ${
              model.transitions.length
            } candidate path transitions`}
          >
            <defs>
              <marker
                id="shape-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" className="shape-arrow" />
              </marker>
            </defs>

            <g transform={`translate(0, ${MARKER_RAIL})`}>
              {/* Rendered first so bands, transitions and markers stay clickable above it. */}
              <rect
                className="shape-chart__hit"
                x={0}
                y={0}
                width={chartWidth}
                height={chartHeight}
                onClick={handleChartClick}
                onMouseMove={handleChartHover}
                onMouseLeave={clearChartHover}
              />

              {model.tracks.map((track, index) => (
                <g
                  key={track.key}
                  className={`shape-row${hoveredKey === track.key ? ' is-hovered' : ''}`}
                >
                  <line
                    className="shape-row__ground"
                    x1={0}
                    x2={chartWidth}
                    y1={rowCenter(index)}
                    y2={rowCenter(index)}
                  />
                  <path
                    className={`shape-band${track.isActive ? '' : ' shape-band--retired'}`}
                    d={bandPath(
                      track.samples,
                      model.columns,
                      chartWidth,
                      rowCenter(index),
                      model.peakFileCount,
                    )}
                  />
                </g>
              ))}

              {visibleTransitions.map(({ transition, fromRow, toRow }) => (
                <g
                  key={transition.id}
                  className={`shape-transition${
                    selectedId === transition.episodeId ? ' is-selected' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Candidate transition: ${transition.fromLabel} to ${transition.toLabel}, ${transition.fileCount} files, ${Math.round(transition.confidence * 100)}% confidence, commit ${transition.shortSha}`}
                  onClick={() => onSelectStructural(transition.episodeId)}
                  onKeyDown={(event) => handleTransitionKey(event, transition.episodeId)}
                >
                  <path
                    className="shape-transition__hit"
                    d={transitionPath(
                      percentToX(transition.percent),
                      rowCenter(fromRow),
                      rowCenter(toRow),
                    )}
                  />
                  <path
                    className="shape-transition__line"
                    markerEnd="url(#shape-arrow)"
                    d={transitionPath(
                      percentToX(transition.percent),
                      rowCenter(fromRow),
                      rowCenter(toRow),
                    )}
                  />
                  <title>
                    {`${transition.label} · ${transition.fromLabel} → ${transition.toLabel} · ${transition.fileCount} files · candidate`}
                  </title>
                </g>
              ))}

              {/* Hover previews where a click would land; the solid playhead stays the
                  selected checkpoint. */}
              {previewCheckpoint && (
                <line
                  className="shape-playhead shape-playhead--preview"
                  x1={percentToX(previewCheckpoint.percent)}
                  x2={percentToX(previewCheckpoint.percent)}
                  y1={-MARKER_RAIL + 4}
                  y2={chartHeight}
                />
              )}

              <line
                className="shape-playhead"
                x1={percentToX(playheadPercent)}
                x2={percentToX(playheadPercent)}
                y1={-MARKER_RAIL + 4}
                y2={chartHeight}
              />
            </g>

            <g className="shape-markers">
              {model.markers.map((marker) => (
                <polygon
                  key={marker.id}
                  className={`shape-marker${marker.withinScope ? '' : ' shape-marker--outside'}${
                    selectedId === marker.id ? ' is-selected' : ''
                  }`}
                  points="0,-5 5,0 0,5 -5,0"
                  transform={`translate(${percentToX(marker.percent).toFixed(2)}, 8)`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Candidate reorganization: ${marker.label}, commit ${marker.shortSha}`}
                  onClick={() => onSelectStructural(marker.id)}
                  onKeyDown={(event) => handleTransitionKey(event, marker.id)}
                >
                  <title>
                    {`${marker.label} · ${Math.round(marker.confidence * 100)}% confidence · ${marker.shortSha}`}
                  </title>
                </polygon>
              ))}
            </g>

            <g transform={`translate(0, ${chartHeight + MARKER_RAIL})`} className="shape-axis">
              {axisTicks.map((tick) => (
                <text
                  key={tick.percent}
                  x={percentToX(tick.percent)}
                  y={16}
                  textAnchor={
                    tick.percent === 0 ? 'start' : tick.percent === 100 ? 'end' : 'middle'
                  }
                >
                  {tick.label}
                </text>
              ))}
            </g>
          </svg>

          {/* Painted before the selected flag so the two never fight when they sit close. */}
          {previewCheckpoint && (
            <span
              className="shape-playhead__flag shape-playhead__flag--preview"
              style={flagStyle(previewCheckpoint.percent)}
              aria-hidden="true"
            >
              {previewCheckpoint.label}
            </span>
          )}

          <span className="shape-playhead__flag" style={flagStyle(playheadPercent)}>
            {playheadLabel}
          </span>
        </div>
      </div>

      <div className="visual-legend visual-legend--shape" aria-label="Repository shape legend">
        <span>
          <i className="legend-mark legend-mark--band" />
          observed file count over time
        </span>
        <span>
          <i className="legend-mark legend-mark--transition" />
          candidate path transition
        </span>
        {showStructureLegend && (
          <span>
            <i className="legend-mark legend-mark--structure" />
            candidate reorganization
          </span>
        )}
        <span>
          <i className="legend-mark legend-mark--playhead" />
          selected checkpoint
        </span>
      </div>
    </div>
  )
}
