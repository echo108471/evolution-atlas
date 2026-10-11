# Engineering workflow

This is a repository-local adaptation of [Lauren Tan's pstack](../.agents/skills/pstack-atlas/ATTRIBUTION.md).
It applies to normal engineering work without a special command. Use the
[project skills](#project-skills) for task-specific playbooks; routine edits need
only the steps that help establish the requested result. [AGENTS.md](../AGENTS.md)
owns the project evidence, privacy, milestone, and validation requirements.

## Project skills

The broad [pstack-atlas](../.agents/skills/pstack-atlas/SKILL.md) skill routes a
task that spans workflows. In Codex, invoke a focused skill by name, such as
`$pstack-explore`, `$pstack-architect`, `$pstack-implement`, `$pstack-refactor`,
`$pstack-debug`, `$pstack-verify`, or `$pstack-review`, when that is the work you
need. The skills live in `.agents/skills/` and point to short shared playbooks.

| Work | Skill | Result |
| --- | --- | --- |
| Investigation | [Explore](../.agents/skills/pstack-explore/SKILL.md) | An evidence-linked account of the active path and unknowns |
| Architecture | [Architect](../.agents/skills/pstack-architect/SKILL.md) | A caller-facing shape, ownership choice, and migration/verification plan |
| Feature | [Implement](../.agents/skills/pstack-implement/SKILL.md) | The requested behavior exercised through its real boundary |
| Structure | [Refactor](../.agents/skills/pstack-refactor/SKILL.md) | Simpler ownership with the established behavior preserved |
| Defect | [Debug](../.agents/skills/pstack-debug/SKILL.md) | The reproduced symptom resolved at its cause |
| Evidence | [Verify](../.agents/skills/pstack-verify/SKILL.md) | Checks and artifacts matched to the claim they support |
| Review | [Review](../.agents/skills/pstack-review/SKILL.md) | Actionable findings from the actual diff and affected contracts |

These are local adaptations, not an installation of Cursor's complete pstack
plugin. The [attribution](../.agents/skills/pstack-atlas/ATTRIBUTION.md) records
the pinned upstream source and the local mapping. There is no hook, package,
model configuration, or automation dependency.

## Ground the work

Check the working tree and preserve existing edits. Name the behavior or claim
at issue, the affected boundary, and the evidence that would settle it. Trace a
representative path through current source and tests before changing it. The
[architecture](ARCHITECTURE.md) and [history workflow](HISTORY-WORKFLOW.md)
identify active operations; `scripts/versions/` and retained experiment outputs
serve replay and comparison purposes. Historical source is evidence about its
own version, not proof of the active path.

Keep raw Git observations, candidate interpretations, and human review
decisions distinct. Every derived claim needs a resolvable evidence trail.
Feature or lifecycle labels remain candidates unless the cited repository
evidence establishes them. Contributor history supports association and
inspection, never ranking or performance judgment.

## Design from a real caller

For a consequential boundary change, sketch the caller's input and expected
output before moving internals. Compare materially different designs when a
real choice exists. Prefer an owner that hides the decision it makes, and
remove obsolete internal routes when their callers have migrated. Preserve
versioned replay and serialized contracts where actual consumers require them.

The current consolidation target is decision-scoped `integrate` with a history
plane. Keep the [Store / Decision session / History](ARCHITECTURE.md#three-planes-store-decision-session-history)
distinction and the [roadmap priority](ROADMAP.md#immediate-next-steps) in view.
Do not treat a higher packet ceiling or another coverage wave as the design
answer. For new operations, locate the owner of Git access, immutable receipts,
the bounded decision packet, and candidate-map publication before adding a
parallel path.

## Implement and verify

Use the [verification guide](VERIFICATION.md) to choose the check that matches
the claim. Work in slices that end in an observable result. A defect should have a
reproduction on the affected surface; a refactor needs a behavior baseline;
an implementation needs an assertion or inspection of its actual output. Use
small deterministic checks during the change, then run `npm test`,
`npm run build`, and `git diff --check` for completed implementation changes.
Inspect the rendered view for UI changes and rendered Markdown for document
changes. Tests of synthetic repositories, schema validity, browser behavior,
and live model quality establish different claims; state which was checked.

Generated analysis can contain contributor or repository metadata. Keep it in
ignored local paths unless Eugene explicitly approves a fixture for version
control. A missing provider result, incomplete history receipt, or unresolved
evidence link remains an explicit gap, not a successful outcome.

For the current repository engine, start with `npm run test:engine` while editing.
Use `npm run experiment:status -- RUN` to inspect a prepared version 3 run and
its saved output without dispatching a worker or changing artifacts. Keep each
implementation trial in a new ignored run directory because the run pins its
engine source. Compare the saved outputs and reports against the stated claim,
then run `npm run check` for the complete local gate. Synthetic test runs live in
ignored `scratch/`, outside the app's `public/` assets. Gallery builds publish
only tracked files under the review roots allowed by the build configuration; inspect
the resulting `dist/` before deploying it.

## Review and finish

Review the diff against the requested behavior, active callers, serialized
data, versioned replay, evidence lineage, and documentation. For substantial
cross-boundary work, ask an independent reviewer to examine the actual
artifacts and contract, then resolve supported findings. A review-only request
remains read-only. Report what changed, what checks ran on the final source,
and what remains unverified.

As this pstack adaptation sees real use, retain examples where it caught a
defect, clarified ownership, reduced code or review effort, or added avoidable
ceremony. Adjust the local playbooks from those observations; a successful
single change does not establish a productivity result.
