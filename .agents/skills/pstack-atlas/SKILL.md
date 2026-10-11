---
name: pstack-atlas
description: Coordinate broad pstack work in Evolution Atlas across investigation, design, implementation, verification, and review. Use a focused pstack skill for a single workflow.
---

# Pstack for Evolution Atlas

This is a repo-local adaptation of Lauren Tan's pstack. Use it for broad tasks or
work spanning several workflows. It adds no permissions or automatic execution.

[AGENTS.md](../../../AGENTS.md) owns the evidence and validation rules.
[Engineering](../../../docs/ENGINEERING.md) owns the shared workflow. Consult
the relevant parts of [Architecture](../../../docs/ARCHITECTURE.md),
[History workflow](../../../docs/HISTORY-WORKFLOW.md), and
[Roadmap](../../../docs/ROADMAP.md) for the operation at issue.

## Route by task

- Read-only behavior or subsystem question: [explore](../pstack-explore/SKILL.md).
- Consequential boundary or ownership choice: [architect](../pstack-architect/SKILL.md).
- New or changed behavior: [implement](../pstack-implement/SKILL.md).
- Behavior-preserving structural change: [refactor](../pstack-refactor/SKILL.md).
- Reported defect: [debug](../pstack-debug/SKILL.md).
- Evidence, tests, or acceptance question: [verify](../pstack-verify/SKILL.md).
- Review request: [review](../pstack-review/SKILL.md).

Use only the relevant playbook for a focused task. A broad request to use
pstack calls for the applicable path from grounding through review, with
independently checkable slices for a substantial change. Delegate bounded,
disjoint work when it helps; the coordinator checks the integrated artifacts.
Routine edits need no extra ceremony.

See [attribution](ATTRIBUTION.md) and the included [MIT license](LICENSE).
