# Explore

Use for read-only investigation or grounding before a change.

1. Frame the question and find the active entry point in [Architecture](../../../../docs/ARCHITECTURE.md) or [History workflow](../../../../docs/HISTORY-WORKFLOW.md). Check whether a similarly named path in `scripts/versions/`, a test fixture, or a retained report is historical.
2. Trace one real caller through Git observations, model/worker input, candidate output, serialization, and the visible result as relevant. Read tests as evidence of their specific coverage.
3. Distinguish observed Git facts from candidate feature, lifecycle, identity, or relationship claims. Follow derived claims back to resolvable commits, paths, diffs, or receipts. Mark any missing link or unknown explicitly.
4. Report the active owners, data flow, contract, and uncertainty with source pointers. Preserve read-only scope.

If a change is requested, continue through [design](design.md) when ownership is unsettled and then the relevant implementation, refactoring, or debugging playbook.
