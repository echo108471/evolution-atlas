# Architecture

## Decision

Start with a local evidence pipeline and an optional interpretation boundary:

```text
Git repository -> Node analyzer -> observed atlas JSON -> optional two-pass interpretation -> React + D3 viewer
```

This boundary is intentionally boring. It makes analysis reproducible, lets the
visual design evolve without rerunning Git, and keeps an inspectable artifact
between evidence extraction and interpretation.

## Initial stack

| Layer | Choice | Why now |
| --- | --- | --- |
| History access | Installed Git CLI | Git itself handles revisions, merges, renames, and worktrees; no second object-model implementation is introduced. |
| Analyzer | Node.js ES modules | Shares the web project's runtime, needs no analyzer dependency, and is sufficient for the pilot repository. |
| Data contract | Versioned JSON | Portable, inspectable, diffable, and easy to fixture or validate. |
| Interface | React + TypeScript | Strong fit for filters, selection, evidence panels, and coordinated views. |
| Build tool | Vite | Small static-app setup with fast development and a straightforward production build. |
| Visualization | React + D3 time scales | React renders the chronology, matrix, and scoped neighborhood; D3 supplies stable temporal placement without owning the DOM. |
| Tests | Node's built-in test runner | Covers the dependency-free analyzer without introducing a second test framework yet. |

Node.js 22.12 or newer is the working baseline. The initial app is static and
local-first; it has no server, account system, or database.

## Runtime boundaries

### Analyzer

The analyzer accepts an explicit repository path, invokes Git without a shell,
and emits deterministic JSON. Its first version records:

- commits as raw change episodes;
- author identities as Git associations;
- parent relationships and timestamps;
- changed paths and rename/copy metadata;
- top-level directories as provisional code areas.
- candidate same-commit repository reorganizations backed by concentrated path
  transitions.

It does not infer features, lifecycle stages, intent, ownership, or quality.
Structural candidates are deterministic, separately labeled interpretations;
the underlying add/delete/rename records remain unchanged.

### Interpretation

Interpretation is a separate optional stage. Its first model pass proposes
feature candidates; its second pass reviews the same complete subject/path
corpus for semantic lifecycle episodes tied to those features. Validation
resolves every proposed feature id and commit SHA before a claim reaches the
dataset. A feature has no permanent lifecycle label: introduced, expanded,
hardened, migrated, and removed belong to individual candidate episodes.
Feature candidates can be reused while calibrating the lifecycle pass, and
deterministic boundary validation can be rerun without a model request.

The current corpus contains commit subjects and at most twelve touched paths
per commit, not patch contents. This is sufficient for a first candidate pass,
not confirmation. Deterministic analysis remains fully usable without a model,
and model output never alters observed Git records.

### Viewer

The browser loads `public/atlas.json` and derives a repository overview, a
directory lifespan chart with checkpoint drill-down, a searchable feature index,
and selected-feature lifecycle ribbons. Both repository views replay serialized
add, delete, copy, and rename operations in commit order: the lifespan chart
samples each directory's observed file count across the range, and the
checkpoint panel reconstructs one directory snapshot and the change summary for
its interval. Both are scoped by the same selected path, and neither reads the
repository directly or adds inferred state to the JSON contract. React owns selection and filtering; D3 supplies the time scale used
to place observed commit dates. For older local datasets, the same deterministic
structural detector runs over already serialized path changes in the browser.
Older feature-level lifecycle claims are shown only as explicit compatibility
projections until the interpretation is regenerated.

The global force-directed graph is intentionally absent from the primary
experience. Relationship browsing is limited to a deterministic neighborhood
around the selected feature. This preserves spatial meaning and avoids turning
the repository into an unstable node-link hairball.

## Why not yet

- **No database:** one pilot dataset is small enough for JSON. Add SQLite only
  when incremental analysis or query latency establishes the need.
- **No web backend:** local file generation plus a static viewer gives the
  shortest evidence-to-interface loop. Identity decisions use repository-scoped
  browser storage plus explicit JSON import/export until a local service is
  justified.
- **No graph database:** the graph is a domain model, not a requirement to adopt
  graph storage.
- **No generic graph UI library:** the product needs stable chronology and
  comparison more than a universal relationship canvas. D3 remains useful for
  scales without owning the rendered DOM.
- **No required model API:** observed and deterministic structural history works
  without credentials. Optional feature and lifecycle interpretation remains a
  reviewable layer rather than a prerequisite.

## Expected pressure points

- Per-commit Git calls favor clarity over throughput and will need batching for
  large repositories.
- First-parent merge diffs are a provisional representation, not the only valid
  view of merge effects.
- Top-level directories are only code-area candidates.
- Structural detection currently groups only changes inside one commit. Git
  rename evidence is strongest; delete/add pairs require repeated matching path
  suffixes and receive lower confidence. Cross-commit moves and content-based
  pairing remain future work.
- Lifecycle discovery currently sees subjects and bounded path lists rather than
  diffs. Hardened and migrated candidates require pilot review, and a future
  repository adapter may add bounded patch evidence where subjects are weak.
- SVG should remain comfortable for the pilot; Canvas or WebGL becomes relevant
  if visible node and edge counts make interaction sluggish.
- Identity consolidation now preserves raw identities beneath reversible
  profiles and handles names, email-handle comparisons, GitHub noreply
  metadata, `.mailmap`, bot boundaries, and human decisions. Co-author trailers,
  pair work, squash merges, signed identities, and host-account verification
  remain future evidence sources.

## Privacy posture

Generated atlas files can contain repository history and contributor names.
`public/atlas.json` is ignored by default. A sanitized, explicitly approved
fixture should be used for screenshots, demos, or publication.
