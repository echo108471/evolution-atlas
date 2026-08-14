import type { CSSProperties } from 'react'

import type { AreaMatrixModel } from './story'

interface AreaMatrixProps {
  model: AreaMatrixModel
  selectedId: string | null
  onSelect: (id: string) => void
}

export function AreaMatrix({ model, selectedId, onSelect }: AreaMatrixProps) {
  if (model.rows.length === 0) {
    return <div className="empty-state">No candidate features match the current view.</div>
  }

  const template = `minmax(230px, 1fr) repeat(${model.columns.length}, 36px)`

  return (
    <div className="matrix-wrap">
      <div className="area-matrix" style={{ gridTemplateColumns: template }}>
        <div className="matrix-corner">
          <span>Candidate feature</span>
          <small>Supporting commits by top-level area</small>
        </div>
        {model.columns.map((area) => (
          <button
            key={area.id}
            type="button"
            className="matrix-column"
            title={`${area.label}: ${area.count} supporting-commit associations`}
            onClick={() => onSelect(area.id)}
          >
            <span>{area.label}</span>
          </button>
        ))}

        {model.rows.flatMap((row) => {
          const cells = model.columns.map((area) => {
            const cell = row.cells.get(area.id)
            const intensity = cell ? 0.18 + (cell.count / Math.max(model.maxCount, 1)) * 0.82 : 0
            return (
              <button
                key={`${row.feature.id}:${area.id}`}
                type="button"
                className={`matrix-cell${cell ? ' has-evidence' : ''}`}
                style={{ '--intensity': intensity } as CSSProperties}
                aria-label={
                  cell
                    ? `${row.feature.label}, ${area.label}: ${cell.count} supporting commits`
                    : `${row.feature.label}, ${area.label}: no cited evidence`
                }
                title={cell ? `${cell.count} cited commit${cell.count === 1 ? '' : 's'}` : 'No cited evidence'}
                onClick={() => onSelect(row.feature.id)}
              >
                {cell?.count ?? ''}
              </button>
            )
          })
          return [
            <button
              key={row.feature.id}
              type="button"
              className={`matrix-row-label${selectedId === row.feature.id ? ' is-selected' : ''}`}
              onClick={() => onSelect(row.feature.id)}
            >
              {row.feature.label}
            </button>,
            ...cells,
          ]
        })}
      </div>
      <details className="method-disclosure">
        <summary>How to read the area matrix</summary>
        <p>
          Cell intensity counts cited commits that touched a top-level path. It describes evidence
          location, not architectural ownership or implementation size.
        </p>
      </details>
    </div>
  )
}
