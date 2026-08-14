# Roadmap

The roadmap is organized around reversible learning milestones rather than a
promise to productize Evolution Atlas.

## Milestone 0 — observed-history vertical slice

Status: in progress.

- Define the versioned evidence model.
- Extract commits, Git author associations, changed paths, renames, and
  provisional top-level code areas.
- Render the time-bounded evidence chronology and an evidence inspector.
- Keep feature candidates empty by default.
- Validate the extractor with a synthetic temporary repository.

Exit signal: the local viewer can explore a real repository's committed
history without making semantic claims.

## Milestone 1 — Course Recommender calibration

- Authorize access to the pilot repository under the workspace policy.
- Produce and manually review the raw dataset.
- Build a five-to-ten-item candidate feature set.
- Test the lifecycle vocabulary and record counterexamples.
- Review deterministic structural episodes, starting with the observed
  `demo/... -> repository root` reorganization, and record false positives.
- Calibrate the implemented identity matcher against manually reviewed aliases;
  measure false merges, missed matches, and abstentions before adding signals.
- Review bots, merges, and generated paths that distort the first model.

Exit signal: a repository owner recognizes useful trails and can explain or
reject every candidate.

## Milestone 2 — interpretation layer

- Keep multi-commit semantic lifecycle episodes separate from raw commits and
  from persistent feature candidates. Implemented for the first model-assisted
  pass; pilot calibration remains.
- Add explicit inference records, confidence, alternatives, and corrections.
- Implement the smallest heuristics justified by the pilot.
- Decide whether optional model-assisted labeling adds enough value to keep.

Exit signal: candidate features improve the map without weakening evidence
traceability.

## Milestone 3 — visual language

- Lead with a progressive Overview / Explore / People hierarchy. Make one
  selected feature story the default detailed view, with complete evidence lanes
  and the feature-by-area matrix retained as power tools.
- Show candidate structural reorganizations as a separate timeline layer with
  path-prefix mappings and commit-level drill-down.
- Keep contributor associations in selected-feature detail rather than making
  contributor color the organizing principle of the entire history.
- Provide a contributor-trail mode as a repository-centric projection: retain
  whole-feature context around person-authored evidence, include observed work
  outside candidate features, and keep bots and recorded identities explicit.
- Provide Identity Review with evidence-bearing suggestions, reversible
  merge/keep-separate decisions, conflict constraints, and JSON import/export.
- Calibrate the first-class semantic lifecycle episode model, especially
  hardened-versus-expanded and migrated-versus-structural boundaries.
- Keep relationship graphs scoped to one selected feature and deterministic.
- Extend structural detection from same-commit renames to carefully bounded
  cross-commit moves; add merge, revert, migration, and removal treatments.
- Test DOM/SVG limits and move dense layers to Canvas only if measurements
  require it.
- Create a sanitized visual demo.

Exit signal: the visualization communicates both repository evolution and
uncertainty at a glance.

## Milestone 4 — generalization decision

- Run the pipeline on one structurally different repository.
- Measure extraction time, graph size, and manual correction cost.
- Decide whether to add incremental storage, language-aware analysis, a local
  service, or repository adapters.
- Reassess whether the project should remain a personal artifact or become a
  reusable tool.

Exit signal: evidence from two repositories supports the next architecture
choice—or supports stopping with a successful experiment.

## Immediate next steps

1. Complete and verify Milestone 0 in this repository.
2. Authorize and inspect `course-recommender` under the workspace boundary.
3. Generate its raw dataset before writing feature heuristics.
4. Review a small set of candidate trails together.
