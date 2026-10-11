---
name: pstack-atlas
description: Route nontrivial Evolution Atlas engineering work through evidence-grounded exploration, design, implementation, verification, and review. Use a focused skill for a single workflow.
---

# Pstack for Evolution Atlas

Use this as the router for work that spans stages or needs a choice about how
to proceed. A focused skill is enough for a clear single-stage request. Routine
edits follow the relevant parts of [Engineering](../../../docs/ENGINEERING.md).
This is a local Codex skill adaptation; it adds no runtime, hook, model,
automation, or publishing behavior.

[AGENTS.md](../../../AGENTS.md) owns project evidence, privacy, milestone, and
validation requirements. [Architecture](../../../docs/ARCHITECTURE.md),
[History workflow](../../../docs/HISTORY-WORKFLOW.md), and
[Roadmap](../../../docs/ROADMAP.md) define current operations and constraints.
Read the [attribution](ATTRIBUTION.md) for the source and adaptation boundary.

## Route by the work

- Read-only question, subsystem walkthrough, design rationale, or context
  pickup: [explore](../pstack-explore/SKILL.md) and the
  [exploration playbook](references/explore.md).
- Consequential boundary or ownership choice:
  [architect](../pstack-architect/SKILL.md) and
  [design](references/design.md).
- A design question that a small observable sketch can answer:
  [prototype](references/prototype.md).
- New or changed behavior: [implement](../pstack-implement/SKILL.md) and
  [implementation](references/implementation-refactor.md#implementation).
- Behavior-preserving structural change:
  [refactor](../pstack-refactor/SKILL.md) and
  [refactoring](references/implementation-refactor.md#refactoring).
- Reported defect: [debug](../pstack-debug/SKILL.md) and
  [debugging](references/debug.md).
- Live runtime symptom or captured profile with a diagnosis request:
  [debug](../pstack-debug/SKILL.md) and the relevant
  [performance](references/performance.md) guidance; keep diagnosis separate
  from an optimization unless one is requested.
- Measured slowdown or sustained metric improvement:
  [performance](references/performance.md). Use debug when a reproduced
  failure is the issue.
- Evidence, acceptance, or verification question:
  [verify](../pstack-verify/SKILL.md) and
  [test and verify](references/test-verify.md).
- Verification guide, registry, or harness maintenance:
  [maintain verification](../pstack-maintain-verification/SKILL.md).
- Review request: [review](../pstack-review/SKILL.md) and
  [review](references/review.md).
- Multi-phase execution, bounded delegation, skill change/evaluation, or
  session pickup: [coordinated work](references/coordinated-work.md).

## Ground and explain

For an ambiguous report, state the observed symptom, the intended result, and
the unknowns in plain language before changing code. Treat this as an
understanding check; continue with a reasonable, reversible assumption when the
request is actionable.

Trace current callers, runtime behavior, and outputs. For “why” questions, start
with relevant repository history and design documents. Use issue or review
records only when they are available and directly relevant. A commit subject or
old summary is a lead, not proof of intent. For context recovery, use the
current conversation, canonical project documents, and saved run artifacts as
pointers, then verify the active source. Do not imply that unavailable
transcripts or external systems were searched.

When the user asks to be taught, explain the active path and evidenced
rationale in plain language. Separate direct observations from hypotheses and
state the useful tradeoffs and unknowns.

## Preserve the project boundary

Keep raw Git observations, candidate interpretations, and human review
decisions distinct. Link derived claims to resolvable evidence. Feature and
lifecycle labels remain candidates unless repository evidence supports them.
Contributor history supports association and inspection, never ranking or
performance judgment.

The current consolidation target is decision-scoped `integrate` with a history
plane. Preserve the
[Store / Decision session / History](../../../docs/ARCHITECTURE.md#three-planes-store--decision-session--history)
contracts. Do not treat a higher packet ceiling or another coverage wave as
the scaling strategy.

## Work and finish

Use independently checkable slices for substantial changes. Prototype an open
empirical choice when the observation could change the design; do not expand a
prototype into a production feature. Use selected
[engineering principles](references/principles.md) only when their triggers
fit.

Verify the actual output on the affected surface. Keep synthetic repository
mechanics, saved replay, browser behavior, and live model quality as separate
claims. Keep generated analysis in ignored local paths unless Eugene explicitly
approves a fixture for version control. For a substantial cross-boundary
change, review the integrated artifacts and contracts independently where
useful.

Report what changed, the evidence collected, what remains unverified, and any
open user decision. See [attribution](ATTRIBUTION.md) for the upstream mapping
and explicit exclusions.
