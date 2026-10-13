import { EngineEntry } from './EngineEntry'
import { formatDate } from './dateFormat'
import type { GallerySubject } from './gallery'

interface GalleryIndexProps {
  subjects: GallerySubject[]
  onSelectSubject: (slug: string) => void
}

const NUMBER = new Intl.NumberFormat()

function spanYears(subject: GallerySubject) {
  const start = new Date(subject.firstAuthoredAt).getTime()
  const end = new Date(subject.lastAuthoredAt).getTime()
  const years = (end - start) / (365.25 * 24 * 60 * 60 * 1000)
  return years >= 10 ? `${Math.round(years)} yr` : `${years.toFixed(1)} yr`
}

/**
 * The gallery's front door. A subject switcher assumes you already know what the set
 * contains, which is true for the person who built it and false for everyone else, so
 * arrival gets its own page. Each card carries both the observed shape and the model that
 * produced the interpretation, because "candidates, not facts" is the project's central
 * claim and it should be legible before anyone opens an atlas rather than only inside the
 * evidence inspector.
 */
export function GalleryIndex({ subjects, onSelectSubject }: GalleryIndexProps) {
  return (
    <main className="gallery-index">
      <header className="gallery-masthead">
        <p className="brand-mark">EVOLUTION ATLAS</p>
        <h1>Understand a codebase through evidence.</h1>
        <p className="gallery-lede">
          Explore candidate capabilities and their evolution, with every interpretation kept
          separate from the Git evidence behind it.
        </p>
      </header>

      <EngineEntry />
      <section className="gallery-demo-heading" aria-label="Prepared atlas demos">
        <p className="map-kicker">Observed-history viewer</p>
        <h2>Explore a prepared atlas</h2>
        <p>These separately prepared demos show commits, paths and renames. Any feature or lifecycle labels are candidate interpretations. Contributor identities may be omitted.</p>
      </section>
      <ul className="gallery-grid">
        {subjects.map((subject) => (
          <li key={subject.slug}>
            <article className="gallery-card">
              <button type="button" onClick={() => onSelectSubject(subject.slug)}>
                <h2>{subject.title}</h2>
                {subject.description && <p className="gallery-card-description">{subject.description}</p>}

                <dl className="gallery-shape">
                  <div>
                    <dt>Commits</dt>
                    <dd>{NUMBER.format(subject.commitCount)}</dd>
                  </div>
                  <div>
                    <dt>Contributors</dt>
                    <dd>{NUMBER.format(subject.contributorCount)}</dd>
                  </div>
                  <div>
                    <dt>Span</dt>
                    <dd>{spanYears(subject)}</dd>
                  </div>
                  <div>
                    <dt>Code areas</dt>
                    <dd>{NUMBER.format(subject.codeAreaCount)}</dd>
                  </div>
                </dl>
              </button>

              {subject.why && <p className="gallery-why">{subject.why}</p>}

              <footer className="gallery-provenance">
                <span>
                  {formatDate(subject.firstAuthoredAt)} – {formatDate(subject.lastAuthoredAt)} ·{' '}
                  <code>{subject.headSha.slice(0, 8)}</code>
                </span>
                <span>
                  {subject.interpretation
                    ? `${subject.interpretation.featureCandidateCount} candidates · ${subject.interpretation.semanticEpisodeCount} episodes · ${subject.interpretation.model}`
                    : 'Observed only — no interpretation pass'}
                </span>
                <span>
                  <a href={subject.url} target="_blank" rel="noreferrer">
                    Source repository
                  </a>
                  {subject.license ? ` · ${subject.license}` : ''}
                </span>
                {subject.notice && <a href={subject.notice}>License notice</a>}
                {subject.provenance && <a href={subject.provenance}>Snapshot provenance</a>}
              </footer>
            </article>
          </li>
        ))}
      </ul>

      <section className="gallery-run-your-own">
        <h2>Prepare a capability map locally</h2>
        <p>The version 3 repository engine prepares pinned source evidence, brokers bounded worker requests, and publishes a complete offline candidate map. A host supplies model execution; the engine does not call a model API.</p>
        <p>Follow the <a href="https://github.com/echo108471/evolution-atlas/blob/main/docs/HISTORY-WORKFLOW.md">history workflow</a> for discovery, descendant-revision expansion, worker coordination and review continuity.</p>
        <details>
          <summary>Legacy observed-atlas workflow</summary>
          <p>For the commit-and-path viewer used by the demos, generate an ignored local dataset and start the development app.</p>
          <code>npm run analyze -- --repo /path/to/your/repo --out public/atlas.json{'\n'}npm run dev</code>
          <p className="gallery-footnote">Observed analysis needs no model credentials. Optional legacy interpretation makes paid provider calls only when explicitly enabled.</p>
        </details>
      </section>
    </main>
  )
}
