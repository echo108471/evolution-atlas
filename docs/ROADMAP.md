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

- Lead with a progressive Overview / Repository / Features / People hierarchy.
  Make Repository a checkpoint-based time machine; keep the full feature
  lifecycle exclusively in the selected-feature view in Features.
- Reconstruct observed directory snapshots from serialized path operations and
  explain candidate reorganizations between checkpoints with commit-level
  drill-down.
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

## Milestone 3.5 — segmentation

Status: first pass implemented and measured on the pilot; not yet validated on a second
repository.

Interpretation reads the whole history in one request, which caps the analyzable
repository size and forces every compression in the corpus format. Segmentation replaces
that ceiling with a rate.

- Divide history into periods using two passes that never see each other: a model reading
  raw commit windows, and deterministic path- and vocabulary-divergence detectors.
  Implemented.
- Record each boundary as the interval spanning both readings rather than one commit, and
  leave the commits inside it in no period. Implemented.
- Derive hierarchy depth from the history rather than fixing it, so a small repository
  gets no periods and only a large one grows a level above epochs. Implemented.
- Name every period, and treat a period the model declines to name as evidence about the
  boundaries rather than a failed request. Implemented; it immediately found that nine of
  fourteen first-pass epochs were incoherent, which produced the size limits.
- Feed periods back into feature and lifecycle discovery so each period can afford more
  evidence per commit. **Not started — this is the point of the exercise.**
- Measure how much boundaries move between runs. The proposal pass is a model request and
  is not reproducible; nothing yet quantifies the drift.
- Re-derive the 250-commit and 120-day period limits on a second repository. Both came
  from one subject.

Exit signal: an interpretation run scoped to a period produces better-evidenced
candidates than the same run over the whole history, measurably rather than apparently.

## Milestone 4 — generalization decision

- Run the pipeline on one structurally different repository.
- Measure extraction time, graph size, and manual correction cost.
- Decide whether to add incremental storage, language-aware analysis, a local
  service, or repository adapters.
- Reassess whether the project should remain a personal artifact or become a
  reusable tool.

Exit signal: evidence from two repositories supports the next architecture
choice—or supports stopping with a successful experiment.

## Measurement debt

[Interpretation findings](INTERPRETATION-FINDINGS.md) records what the interpretation
stage actually produces. Three results change what the roadmap should prioritize:

- **Coverage is about 10-13%.** Roughly nine in ten commits appear in no feature or
  episode, on both measured repositories. The model cites exemplars where the product
  promises a history.
- **Feature counts saturate the `--max-features` flag.** zod returned 39 against a cap of
  40, so the number of capabilities in a published atlas was set by a constant.
- **Confidence is inert on one repository and informative on the other.** zod produced
  three distinct values and never went below 0.7; the pilot produced twenty-two across
  the full range. Contamination of a well-known repository is one live explanation.

## Immediate next steps

1. Hand-grade the pilot's feature candidates into a gold set. Every later prompt or
   architecture change is unmeasurable without one, and the pilot is the only subject
   whose owner can check the answers.
2. Write a deterministic baseline that clusters commits by shared paths and subject
   tokens. Until that number exists, the interpretation stage's contribution over a
   simple script is unknown.
3. Report coverage from the interpretation run itself.
4. Run interpretation scoped to a single period and compare it against the whole-history
   run over the same commits.
5. Capture commit bodies in the analyzer and pre-classify non-feature commits — the two
   cheapest corpus improvements, neither needing a new architecture.
