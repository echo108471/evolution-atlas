import type { CalendarChapter } from './story'

interface ChapterStripProps {
  chapters: CalendarChapter[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function ChapterStrip({ chapters, selectedId, onSelect }: ChapterStripProps) {
  return (
    <section className="chapters" aria-labelledby="chapters-heading">
      <div className="section-intro">
        <div>
          <span className="eyebrow">Observed time boundaries</span>
          <h2 id="chapters-heading">Calendar chapters</h2>
        </div>
        <button
          type="button"
          className={`quiet-action${selectedId === null ? ' is-active' : ''}`}
          onClick={() => onSelect(null)}
        >
          Entire history
        </button>
      </div>

      <div className="chapter-strip">
        {chapters.map((chapter) => (
          <button
            key={chapter.id}
            type="button"
            className={`chapter${selectedId === chapter.id ? ' is-selected' : ''}`}
            style={{ flexGrow: Math.max(chapter.widthPercent, 8) }}
            aria-pressed={selectedId === chapter.id}
            onClick={() => onSelect(selectedId === chapter.id ? null : chapter.id)}
          >
            <strong>{chapter.label}</strong>
            <span>{chapter.commitCount.toLocaleString()} commits</span>
            <small>{chapter.featureCount} candidates cite this year</small>
          </button>
        ))}
      </div>
      <p className="method-note">
        Chapters are calendar partitions, not inferred project eras. Semantic chapter names can be
        added later only with their own evidence.
      </p>
    </section>
  )
}
