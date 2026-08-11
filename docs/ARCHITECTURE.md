# Architecture

## Decision

Start with a local, two-stage pipeline:

```text
Git repository -> Node analyzer -> versioned atlas JSON -> React + D3 viewer
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
| Visualization | D3 modules + React SVG | D3 supplies time scales and graph layout; React remains responsible for interface state and rendered elements. |
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
- changed paths and rename/copy metadata; and
- top-level directories as provisional code areas.

It does not infer features, lifecycle stages, intent, ownership, or quality.

### Interpretation

Interpretation will become a separate stage after the pilot vocabulary is
tested. It should consume observed data and append claims with method,
confidence, and evidence references. Deterministic heuristics should remain
usable without an LLM. Any later model-assisted interpretation must preserve
the same contract and be optional.

### Viewer

The browser loads `public/atlas.json`, filters the graph by time, lays out
visible nodes, and exposes an evidence inspector. It does not read a repository
directly. React owns selection and filtering; D3 currently performs temporal
scaling and constrained force layout without owning the DOM.

## Why not yet

- **No database:** one pilot dataset is small enough for JSON. Add SQLite only
  when incremental analysis or query latency establishes the need.
- **No web backend:** local file generation plus a static viewer gives the
  shortest evidence-to-interface loop.
- **No graph database:** the graph is a domain model, not a requirement to adopt
  graph storage.
- **No generic graph UI library:** the visual grammar is still a product
  question. D3 gives enough control to discover it.
- **No model API:** feature inference should first be evaluated against a
  manually reviewed pilot set.

## Expected pressure points

- Per-commit Git calls favor clarity over throughput and will need batching for
  large repositories.
- First-parent merge diffs are a provisional representation, not the only valid
  view of merge effects.
- Top-level directories are only code-area candidates.
- SVG should remain comfortable for the pilot; Canvas or WebGL becomes relevant
  if visible node and edge counts make interaction sluggish.
- Identity consolidation will need explicit aliases, co-author trailers, bots,
  pair work, squash merges, and cherry-pick handling.

## Privacy posture

Generated atlas files can contain repository history and contributor names.
`public/atlas.json` is ignored by default. A sanitized, explicitly approved
fixture should be used for screenshots, demos, or publication.
