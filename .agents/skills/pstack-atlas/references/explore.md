# Explore

Use for read-only investigation or grounding before a change.

1. Frame the question and find the active entry point in [Architecture](../../../../docs/ARCHITECTURE.md) or [History workflow](../../../../docs/HISTORY-WORKFLOW.md). For an ambiguous report, restate the observed symptom, intended result, and unknowns in plain language before changing code. Check whether a similarly named path in [scripts/versions/](../../../../scripts/versions/), a test fixture, or a retained report is historical.
2. Trace one real caller through Git observations, model/worker input, candidate output, serialization, and the visible result as relevant. Read tests as evidence of their specific coverage.
3. Distinguish observed Git facts from candidate feature, lifecycle, identity, or relationship claims. Follow derived claims back to resolvable commits, paths, diffs, or receipts. Mark any missing link or unknown explicitly.
4. Report the active owners, data flow, contract, and uncertainty with source pointers. Preserve read-only scope.

## “Why,” context recovery, and teaching

For a “why” question, inspect relevant Git history, design documents, tests,
comments, and saved experiment artifacts. Treat commit subjects and old
summaries as pointers; distinguish recorded rationale from inference. Consult
an issue or review record only when it is available and directly relevant to
the question. Do not imply that external systems or transcripts were searched
when they were not.

For a pickup or recall, start from the current conversation and the named
project record or prior task when available. Verify any remembered decision
against active source, the current working tree, and retained artifacts before
using it as a constraint.

When asked to teach a subsystem or design, lead with a plain-language account
of what it does. Explain the active path, then the evidence-backed reason for
its shape and the important tradeoffs. Keep direct observations, inferences,
and unknowns distinguishable. Use a small diagram when it makes a multi-step
flow easier to follow.

If a change is requested, continue through [design](design.md) when ownership is unsettled and then the relevant implementation, refactoring, or debugging playbook.
