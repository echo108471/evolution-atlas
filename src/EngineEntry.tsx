/** The current engine's public entry point; it never dispatches workers or uploads data. */
export function EngineEntry() {
  return (
    <section className="engine-entry" aria-labelledby="engine-entry-title">
      <div className="engine-entry-heading">
        <div>
          <p className="map-kicker">Current workflow · repository engine v3</p>
          <h2 id="engine-entry-title">Explore capabilities across revisions.</h2>
          <p>Open an engine output to follow candidate capabilities, their Git evidence, and how their explanations changed.</p>
        </div>
        <a className="map-primary-action" href="?view=map">Open a candidate capability map</a>
      </div>
      <ol className="engine-planes">
        <li><span>01 / Store</span><strong>Inspect the evidence</strong><p>Saved source, commits and bounded diffs remain separate from interpretations.</p></li>
        <li><span>02 / Decision session</span><strong>Read the candidate map</strong><p>Capabilities and relationships cite evidence. Coverage and omissions show the limits of each decision.</p></li>
        <li><span>03 / History</span><strong>Trace change over time</strong><p>Compare revisions and candidate lineage. Earlier review notes keep their original context.</p></li>
      </ol>
      <p className="engine-entry-note">Choose output.json or reviewed-output.json. Files stay in browser memory and are never uploaded. Analysis and worker coordination run separately through the local engine.</p>
    </section>
  )
}
