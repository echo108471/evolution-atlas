# Engineering workflow

This is Evolution Atlas's repository-local adaptation of Lauren Tan's pstack,
applied to normal engineering work without a special command. Use
[pstack-atlas](../.agents/skills/pstack-atlas/SKILL.md) to route nontrivial
work across stages, and use a focused skill for a single workflow. Routine
edits need only the steps that help establish the requested result.
[AGENTS.md](../AGENTS.md) owns the evidence, privacy, milestone, and validation
requirements.

## Project skills

| Work | Skill | Result |
| --- | --- | --- |
| Investigation, context recovery, explanation | [Explore](../.agents/skills/pstack-explore/SKILL.md) | An evidence-linked account of the active path, rationale, and unknowns |
| Architecture | [Architect](../.agents/skills/pstack-architect/SKILL.md) | A caller-facing shape, ownership choice, and migration or verification plan |
| Feature | [Implement](../.agents/skills/pstack-implement/SKILL.md) | Requested behavior exercised through its real boundary |
| Structure | [Refactor](../.agents/skills/pstack-refactor/SKILL.md) | Simpler ownership with established behavior preserved |
| Defect | [Debug](../.agents/skills/pstack-debug/SKILL.md) | The reproduced symptom resolved at its supported cause |
| Evidence and acceptance | [Verify](../.agents/skills/pstack-verify/SKILL.md) | Checks and artifacts matched to the claim they support |
| Verification-system maintenance | [Maintain verification](../.agents/skills/pstack-maintain-verification/SKILL.md) | The feature inventory, guide, and harness reconciled against source and live behavior |
| Review | [Review](../.agents/skills/pstack-review/SKILL.md) | Actionable findings from the actual diff and affected contracts |

The focused skills link to shared playbooks under
[pstack-atlas](../.agents/skills/pstack-atlas/SKILL.md). Performance work,
prototyping, and multi-phase coordination use the linked references there.
These files are a native Codex adaptation, not a full upstream plugin port.
The verification harness uses the project's Playwright tooling and declared
development dependency. This adaptation adds no upstream plugin runtime,
hook, model configuration, cloud environment, scheduler, or automatic
pull-request behavior. See
[attribution](../.agents/skills/pstack-atlas/ATTRIBUTION.md) for the upstream
pin, local mapping, and exclusions.

## Frame and ground the work

For a noisy or ambiguous report, restate the observed symptom, intended result,
and unknowns in plain language before changing code. Use the restatement to
check understanding while continuing with a reasonable, reversible assumption
when the request is actionable.

Check the working tree and preserve existing edits. Name the behavior or claim
at issue, the affected boundary, and the evidence that would settle it. Trace a
representative path through active source, callers, runtime, tests, and saved
outputs as relevant. The [architecture](ARCHITECTURE.md) and
[history workflow](HISTORY-WORKFLOW.md) identify active operations.
Historical source describes its own version; it does not establish the active
path.

For a “why” question, begin with relevant Git history, code, and project
documents. Treat commit subjects and old summaries as leads. State when a
rationale is inferred or unknown. Use issue or review records only when they
are available and directly relevant. For a pickup, use the current
conversation and named prior artifacts as pointers, then verify decisions
against the active source and working tree.

Keep raw Git observations, candidate interpretations, and human review
decisions distinct. Every derived claim needs a resolvable evidence trail.
Feature or lifecycle labels remain candidates unless cited repository evidence
establishes them. Contributor history supports association and inspection,
never ranking or performance judgment.

## Design from a real caller

For a consequential boundary change, sketch the caller's inputs, expected
outputs, evidence references, and serialized effects before moving internals.
Compare materially different designs when a real choice exists. Use a small
[prototype](../.agents/skills/pstack-atlas/references/prototype.md) when an
observation could change the decision. Settle empirical questions through an
observable sketch instead of expanding an abstract plan. Ask the user about a
product preference only when evidence cannot settle it.

The current consolidation target is decision-scoped `integrate` with a history
plane. Preserve the [Store / Decision session / History](ARCHITECTURE.md#three-planes-store--decision-session--history)
distinction and the [roadmap priority](ROADMAP.md#immediate-next-steps). Do not
treat a higher packet ceiling or another coverage wave as the design answer.
For new operations, locate the owner of Git access, immutable receipts, the
bounded decision packet, and candidate-map publication before adding a
parallel path. Preserve versioned replay and serialized contracts where
current consumers require them.

## Implement in verifiable slices

Use the [verification guide](VERIFICATION.md) to choose a check that matches
the claim. A defect needs a reproduction on the affected surface; a refactor
needs a behavior baseline; an implementation needs an assertion or inspection
of its actual output. Keep each substantial slice observable before proceeding.
When a repeated manual operation or check creates avoidable work, build or
improve a small reproducible lever such as a CLI command, fixture, or focused
agent procedure.

Run small deterministic checks during the change. For completed implementation
changes, run `npm test`, `npm run build`, and `git diff --check` as
[AGENTS.md](../AGENTS.md) requires. Inspect rendered UI for visual changes and
rendered Markdown for document changes. Tests of synthetic repositories,
schema validity, browser behavior, and live model quality establish different
claims; state which was checked.

Use the repository control harness and its feature registry as described in
[pstack-verify](../.agents/skills/pstack-verify/SKILL.md). Inspect the emitted
JSON evidence for the actual journey. An inventory is not coverage, and a
browser journey does not establish history-plane coverage. Use
[maintain verification](../.agents/skills/pstack-maintain-verification/SKILL.md)
when maintaining the verification system.

Generated analysis can contain contributor or repository metadata. Keep it in
ignored local paths unless Eugene explicitly approves a fixture for version
control. Use isolated synthetic data for verification where it can exercise the
behavior. A missing provider result, incomplete history receipt, or unresolved
evidence link remains an explicit gap, not a successful outcome.

For the current repository engine, start with `npm run test:engine` while
editing. Use `npm run experiment:status -- RUN` to inspect a prepared version 3
run and its saved output without dispatching a worker or changing artifacts.
Keep each implementation trial in a new ignored run directory because the run
pins its engine source. Compare saved outputs and reports against the stated
claim, then run `npm run check` for the complete local gate. Synthetic test
runs live in ignored `scratch/`, outside app `public/` assets. Gallery builds
publish only tracked files under the review roots allowed by the build
configuration; inspect the resulting `dist/` before deployment.

## Measure performance

Start performance work with a representative workload and a baseline on the
affected surface. Make one change per measurement cycle, inspect the output,
and account for sample variation, errors, and workload differences. Do not
claim a win from source inspection alone. Use the
[performance playbook](../.agents/skills/pstack-atlas/references/performance.md)
for a one-off slowdown or a sustained metric improvement. Keep engine
mechanics, browser behavior, and live model quality as separate claims.

## Coordinate substantial work

For work spanning phases, settle open design questions before writing a
temporary execution checklist. Each slice should name its owner, boundary,
dependencies, and evidence. Delegate bounded, disjoint investigations or
changes only when doing so helps; the coordinator reviews integrated source
and artifacts. Use the
[coordination playbook](../.agents/skills/pstack-atlas/references/coordinated-work.md)
for skill evaluation and session pickup. Keep plans in the conversation or
ignored scratch storage unless durable coordination is useful and requested.

## Review and finish

Review the diff against the requested behavior, active callers, serialized
data, versioned replay, evidence lineage, privacy, and documentation. For
substantial cross-boundary work, an independent review of the actual artifacts
and contract can help find gaps. A review-only request remains read-only.

Report what changed, which checks ran on the final source, the evidence those
checks produced, and what remains unverified. As this adaptation sees real
use, retain examples where it caught a defect, clarified ownership, reduced
code or review effort, or added avoidable ceremony. Adjust the playbooks from
those observations; a single success does not establish a productivity result.
