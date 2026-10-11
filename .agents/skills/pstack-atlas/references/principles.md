# Selected engineering principles

Use these principles when their trigger fits the task. They guide choices; they
are not a checklist for every edit.

## Start from the outcome

Name the user-visible behavior, caller, or claim before choosing the
implementation. Model the domain and its boundaries so the owner makes the
decision once. Prefer the smallest complete change and remove obsolete paths
when their callers have moved.

## Build a lever for repeated work

When a nontrivial operation or check is likely to recur, make it reproducible
with an existing command, a small script, a fixture, or an agent-facing
procedure. The artifact should make its inputs and outputs inspectable. Use
dry-run for commands with destructive effects and machine-readable output when
another tool must consume it.

## Prove the behavior

Exercise the real caller or surface and inspect the resulting artifact.
Compilation and schema validation establish their own claims; they do not prove
that a user journey works or a candidate interpretation is correct. Match the
check to the claim and state what remains unknown.

## Fix the cause and question repeated assumptions

Reproduce a defect before changing code. Trace the state and the owning path to
the supported cause. When repeated attempts fail for the same reason, inspect
the assumption that connects them before trying another variation.

## Sequence work into verifiable units

For migrations and multi-step work, make each slice end in evidence that can be
inspected before the next slice begins. Keep ownership and file boundaries
clear when work is delegated. The coordinator reviews integrated source and
artifacts.

## Explain measured numbers

Before reporting a performance or quality number, identify the workload,
measurement method, errors, sample count, and relevant variation. Compare
like with like. Do not turn contributor history into rankings or performance
judgments.

## Encode a repeated lesson

When a review or verification finds the same avoidable mistake more than once,
consider whether a type, boundary check, command, validator, or focused skill
can prevent it. Add structure only when it removes real repeated work.

See [prototype](prototype.md) for decisions that can be settled by an
experiment, [performance](performance.md) for measured optimization, and
[coordinated work](coordinated-work.md) for multi-phase execution and skill
evaluation.
