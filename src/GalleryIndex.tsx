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
        <h1>How a codebase grew, read from its commits.</h1>
        <p className="gallery-lede">
          Each atlas below was prepared from a public repository's Git history. The observed
          layer records commits, paths and renames. Contributor identities may be omitted from
          an exported demo. When features or lifecycle episodes are present, they are candidate
          interpretations linked to supporting commits.
        </p>
      </header>

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
              </footer>
            </article>
          </li>
        ))}
      </ul>

      <section className="gallery-run-your-own">
        <h2>Run it on your own repository</h2>
        <p>
          This gallery is a set of pre-generated artifacts. The hosted site never reads a
          repository — it only serves datasets that were built ahead of time. To map a repository
          of your own, clone the project and analyze it locally; nothing leaves your machine.
        </p>
        <code>
          git clone &lt;your-evolution-atlas-url&gt; evolution-atlas{'\n'}
          cd evolution-atlas{'\n'}
          npm ci{'\n'}
          npm run analyze -- --repo /path/to/your/repo --out public/atlas.json{'\n'}
          npm run dev
        </code>
        <p className="gallery-footnote">
          The observed atlas needs no credentials. The optional interpretation pass calls a model
          provider and requires your own API key.
        </p>
        <p className="gallery-map-entry">
          Already have an engine artifact? <a href="?view=map">Open a candidate capability map</a> from a local JSON file.
        </p>
      </section>
    </main>
  )
}
