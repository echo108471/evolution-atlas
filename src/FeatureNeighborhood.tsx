import type { AtlasDataset, FeatureCandidate } from './model'
import { deriveFeatureAssociations } from './story'

interface FeatureNeighborhoodProps {
  dataset: AtlasDataset
  feature: FeatureCandidate
  onSelect: (id: string) => void
}

function truncate(value: string, length = 23) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

export function FeatureNeighborhood({ dataset, feature, onSelect }: FeatureNeighborhoodProps) {
  const associations = deriveFeatureAssociations(dataset, feature)
  const contributors = associations.contributors.slice(0, 5)
  const areas = associations.areas.slice(0, 7)
  const rows = Math.max(contributors.length, areas.length, 1)
  const height = Math.max(210, rows * 46 + 46)
  const yFor = (index: number, total: number) =>
    height / 2 - ((total - 1) * 42) / 2 + index * 42

  return (
    <div className="neighborhood">
      <div className="neighborhood__heading">
        <span>Selected-feature neighborhood</span>
        <small>Scoped, deterministic, evidence-linked</small>
      </div>
      <svg
        viewBox={`0 0 720 ${height}`}
        role="img"
        aria-label={`Contributors and code areas associated with ${feature.label}`}
      >
        <g className="neighborhood__links" aria-hidden="true">
          {contributors.map((entry, index) => (
            <line key={entry.id} x1="178" y1={yFor(index, contributors.length)} x2="300" y2={height / 2} />
          ))}
          {areas.map((entry, index) => (
            <line key={entry.id} x1="420" y1={height / 2} x2="542" y2={yFor(index, areas.length)} />
          ))}
        </g>

        <g className="neighborhood__center" transform={`translate(360 ${height / 2})`}>
          <rect x="-64" y="-31" width="128" height="62" rx="4" />
          <text textAnchor="middle" y="-5">candidate feature</text>
          <text textAnchor="middle" y="14">{truncate(feature.label, 20)}</text>
        </g>

        {contributors.map((entry, index) => (
          <g
            key={entry.id}
            className="neighborhood__node neighborhood__node--contributor"
            transform={`translate(92 ${yFor(index, contributors.length)})`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(entry.id)
            }}
          >
            <circle r="7" />
            <text x="13" y="4">{truncate(entry.displayName)}</text>
            <title>{`${entry.displayName}: authored ${entry.count} cited commit${entry.count === 1 ? '' : 's'}`}</title>
          </g>
        ))}

        {areas.map((entry, index) => (
          <g
            key={entry.id}
            className="neighborhood__node neighborhood__node--area"
            transform={`translate(548 ${yFor(index, areas.length)})`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(entry.id)
            }}
          >
            <circle r="7" />
            <text x="13" y="4">{truncate(entry.label)}</text>
            <title>{`${entry.label}: touched by ${entry.count} cited commit${entry.count === 1 ? '' : 's'}`}</title>
          </g>
        ))}
      </svg>
      <p>
        Left: Git author associations. Right: observed top-level paths. Neither side implies feature
        ownership.
      </p>
    </div>
  )
}
