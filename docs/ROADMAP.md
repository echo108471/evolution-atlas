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
- Name every period, and treat a period the model declines to name as evidence rather
  than a failed request. Implemented. It immediately reported that nine of fourteen
  epochs were unnameable while every scored signal beside them looked healthy.
- Establish whether unnameable periods indicate bad boundaries or a repository without
  phases. **Partly answered, negatively.** Capping period size did not change the rate
  (64% before and after), and imposed cuts were no more nameable than found ones, so the
  pilot's middle history most likely has no single theme to find. A coherence rate looks
  like a property to report rather than a number to optimize.
- Feed periods back into feature and lifecycle discovery so each period can afford more
  evidence per commit. **Not started — this is the point of the exercise.**
- Measure how much boundaries move between runs. The proposal pass is a model request and
  nothing yet quantifies the drift. `groupingStability` in the capability work is the
  instrument: it counts pairs rather than clusters, which matters, because counting
  clusters is what made consolidation look non-reproducible when it was not.
- Re-derive the 250-commit and 120-day period limits on a second repository. Both came
  from one subject, and the coherence argument originally used to justify them did not
  survive testing; they are kept only to bound the analysis unit.
- Test whether feature discovery scoped to a *nameable* period beats whole-history
  discovery by more than it does on an unnameable one. That comparison is what would
  show segmentation paying for itself.

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

**Current priority: decision-scoped integration + history plane, then deliver.** Historical
evolution is **in** the consolidation milestone (not snapshot-only). More VS Code coverage
waves wait until `integrate` is restructured; raising the 1.5MB packet ceiling is not the
scaling strategy. The repository-neutral entry point is `scripts/repository-engine.mjs`; its
contract and operating sequence are in
[the architecture](ARCHITECTURE.md#consolidated-repository-workflow).

1. Landed decision-scoped `integrate` packaging (catalog + brokered receipt fetch + explicit
   omissions) while keeping the complete candidate map available at publish. Next: finish remaining
   history-plane gaps and host hardening before another coverage expansion. The completed second larger
   wave delivered 113 nodes / 97 relationships across excerpts from 118 files; earlier runs
   still replay exactly under their pinned versions. Preserve owner review as broad usefulness
   feedback, not discovery labels or a fixed taxonomy.
2. History plane partially landed: broker ops for commit meta, bounded diffs, and path history
   (ancestors of the pinned revision). Still open: prior-map lookup across engine outputs and
   brokered cached per-commit readings. Snapshot maps remain useful intermediates, not the success bar.
3. Address failures that prevent reliable operation or materially reduce map usefulness.
   Keep claim-local review qualifications separate from candidate-map availability.
4. Consolidate generic review continuity and the host execution adapter, retaining the now
   versioned runtime/replay contract; expose results in the app. Coordinate launch recording
   before broker use, and keep host status checks from exposing prior outputs to blind workers.

### Earlier research backlog — not the current execution plan

The [iterative graph experiment](CAPABILITY-GRAPH.md) now tests growing and revising a graph
without a semantic depth cap, including source inspection and an investigation agenda.
Its next checks are relationship support/novelty and repeatability; the earlier static
and staged conditions below remain separate controls.

1. Add proposal-to-map novelty review and one bounded follow-up retrieval round. Citation
   validity and complete signal accounting are necessary but did not stop proposals whose
   scope overlaps existing node descriptions.
2. Repeat the unchanged staged condition after that gate exists. Compare operation targets,
   cited evidence, retrieval selections, and unresolved signals; do not combine it with the
   differently scoped static-packet pilots.
3. Repeat discovery and assignment on a structurally different repository before treating
   the present hierarchy behavior as general.
4. Expose per-commit readings and candidate hierarchies in the viewer with direct links to
   the underlying Git evidence.
5. Re-read a `partial` promotion at a larger byte budget instead of escalating it to a
   pricier model. The budgets are measured and `--max-bytes` exists; nothing yet acts on
   the promotion cause.

The original induction condition is capped at two generated levels—umbrella plus
children. The newer graph condition permits uneven arbitrary depth and separate dependency
edges. Capability hierarchy describes what the system does; epoch hierarchy
describes when its work changed character. Keep those axes separate until evidence shows a
useful relationship between them.

### Closed since

- **Hierarchy-critic pilot.** Built a deterministic packet with the current 37-node map,
  74 label-independent boundary comparisons, seven unmatched alternative nodes, two
  recurring blind map gaps, and 178 bounded readings. One $0.1710 critic pass proposed a
  high-confidence dependency-automation child and a medium-confidence split of growth from
  analytics, with no invalid citations. The proposals remain unapplied; one run does not
  establish their stability, and the 55.8k-token static packet does not yet scale.

- **Focused hierarchy-critic ablation and cheap-model repeat.** A deterministic focus rule
  reduced the packet to 86 readings and 33 signals. One complete Grok run changed its
  secondary proposals when context selection changed. Three identical Gemini 2.5 Flash Lite
  runs cost $0.0097 but reached only 24.9% mean operation-target F1 and accounted for 2–3
  signals each, so the new completion gate rejects the condition for automatic revision.
  Dependency automation was the sole 3/3 proposal, with identical citations in every run.

- **Staged hierarchy retrieval pilot.** A catalog-only cheap planner covered all 33 signals
  but over-requested 69 of 86 readings. A deterministic broker capped the union at 32 while
  retaining evidence for every signal, and a low-reasoning Grok decision completed all node
  and signal coverage. Peak input fell 34.1% and cost fell 51.2%, but total input rose 25.4%.
  Dependency automation recurred; two of three other additions overlap scope stated by
  current nodes, establishing the need for a separate proposal-novelty gate.

- **Repeated assignment-disagreement critic.** Built a deterministic dataset for all 116 unstable
  commits and a replayable critic with explicit assign, unassigned, ambiguous, and
  map-insufficient outcomes. Across three runs per arm, candidate-visible critics agreed
  exactly within-arm on 85.9% of decisions, blind critics on 71.6%, and cross-arm pairs on
  only 54.5%. Candidate-edge retention averaged 85.0% when visible versus 70.3% when hidden.
  Both Dependabot commits produced `map_insufficient` in every blind run, providing a
  recurring hierarchy-critic input without making either arm a truth set.

- **Fixed-map assignment repeatability.** Three assignments of one unchanged 37-node map
  reached 98.8% mean assigned-commit F1, 89.9% umbrella co-membership, 84.7% child
  co-membership, and 82.9% overlap F1. The equivalent cross-map figures were 98.0%, 79.8%,
  58.3%, and 68.5%, isolating hierarchy formation as the larger source of instability while
  retaining assignment disagreements for evidence review.

- **Discovery versus evidence assignment.** Separated and measured across the three blind
  maps. The assignment pass materially improved multiply assigned commit agreement from
  53.7% to 68.5% mean F1, but child co-membership moved only from 55.6% to 58.3%; the
  result motivated the fixed-map test above rather than attributing that residual to either
  stage prematurely.

- **Blind hierarchy repeatability.** Measured over three fresh, request-fingerprinted runs.
  Assigned-versus-unassigned decisions recur at 98.6% mean F1 and umbrella co-membership at
  79.3%; child co-membership and overlap are materially less stable at 55.6% and 53.7%.
  Labels are excluded from every comparison metric.

- **Grouping on evidence rather than names.** Built. Three arms share one clustering
  routine and differ only in evidence; agreement with the baseline is 0.104 for the
  deterministic reading arm and 0.112 for the model arm, indistinguishable.
- **Consolidation variance.** Measured. Three runs agree at F1 0.717 to 0.773 over commit
  pairs, which *corrects* the earlier claim that the arm does not reproduce: the cluster
  count is unstable, the membership is not.
- **Giving the judge the readings.** Done, along with a paths view and a second pass that
  measures the judge's own noise at up to 7 points.
- **Commit bodies.** Captured. 72.4% of the pilot's first-parent chain carries one. Mixed
  result — see [Capabilities](CAPABILITIES.md).
- **Whitespace-only detection.** Dropped on measurement: 2 of the pilot's 728 first-parent
  commits with a text diff, and 0 of this repository's 31.

Superseded: scoping interpretation to a single period. Per-commit reading covers 100% of
substantive commits for roughly what one segmentation pass cost at 12%, and a hard period
boundary makes a capability built across it unfindable.
