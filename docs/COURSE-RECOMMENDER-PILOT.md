# Course Recommender pilot

## Purpose

Use `course-recommender` to test whether Evolution Atlas can create a coherent,
evidence-linked system history before generalizing the analyzer or investing in
large-scale rendering.

The pilot repository is not currently on the workspace cross-project mining
allowlist. Analysis should begin only after the user explicitly adds or
authorizes that workspace access; no assumptions about its current contents are
made in this plan.

## Pilot questions

1. Can a maintainer recognize meaningful change episodes from Git evidence?
2. Do candidate feature trails group the right commits and code areas?
3. Are introduced, expanded, hardened, migrated, and removed useful lifecycle
   labels for this repository?
4. Does the contributor projection add context without implying ownership or
   performance?
5. Can every surprising claim be inspected and corrected quickly?

## Procedure

### 1. Establish the evidence baseline

- Generate the raw `0.1.0` atlas dataset.
- Record repository size, date span, merges, contributor aliases, bots,
  generated paths, and obvious repository eras.
- Select a bounded commit range if the full history makes manual review
  impractical.

### 2. Create a small review set

- Manually identify roughly five to ten recognizable capabilities or system
  changes.
- For each, record supporting commits and paths without forcing a lifecycle
  story.
- Mark ambiguous, tangled, or counterexample commits explicitly.

This review set is calibration material, not unquestionable ground truth.

### 3. Try the weakest useful inference

- Begin with path continuity, commit adjacency, rename evidence, and explicit
  issue or feature language.
- Keep raw commit episodes visible beneath any cluster.
- Record why candidates were merged, split, or rejected during review.
- Add model assistance only if deterministic evidence leaves a clearly defined
  semantic labeling gap.

### 4. Evaluate the visual story

Ask the repository owner to explore without a guided tour. Observe whether the
time slider, graph, filters, and evidence panel answer the pilot questions.
Capture incorrect or misleading interpretations before polishing the design.

## Acceptance criteria

- The raw analyzer completes deterministically for the selected history range.
- Every visible node and edge can reach commit/path evidence.
- Feature and lifecycle labels are visually distinguishable from observations.
- At least several candidate trails are recognizable to the repository owner.
- Rejected candidates remain explainable rather than silently disappearing.
- Contributor views contain no ranking, score, or ownership language.
- The pilot yields a specific next decision about inference, interaction, or
  scaling.

## Deliverables

- a local ignored raw atlas dataset;
- a small reviewed candidate-feature annotation file;
- screenshots or a short capture of the interactive map using sanitized data;
- a list of false joins, false splits, attribution hazards, and missing
  evidence; and
- a brief pilot conclusion that either narrows, revises, or validates the next
  milestone.
