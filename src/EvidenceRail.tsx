import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface EvidenceRailProps {
  selectedId: string | null
  children: ReactNode
}

/**
 * Right column: whatever the current selection rests on. The panel is handed in
 * already rendered — the rail's own job is the pinning, the overflow, and returning
 * to the top when the selection changes, so the reader is not left partway down the
 * previous claim's evidence.
 */
export function EvidenceRail({ selectedId, children }: EvidenceRailProps) {
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (railRef.current) railRef.current.scrollTop = 0
  }, [selectedId])

  return (
    <div className="explorer-inspector">
      <div
        ref={railRef}
        className="explorer-rail"
        role="region"
        aria-label="Evidence inspector"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  )
}
