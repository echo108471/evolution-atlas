# Performance work

Use this for a measured slowdown, an optimization request, or a sustained
experiment against a metric. A code inspection can suggest a cause; it cannot
establish a performance win.

For a runtime symptom or supplied trace where the requested result is a
diagnosis, use the debug workflow and stop at the evidence-backed explanation.
Use this playbook's measurement loop when the user asks to improve a metric.

## One-off performance issue

1. Name the user-visible operation, representative workload, metric, and
   direction that counts as better. Reproduce the symptom on the same surface
   before changing code.
2. Capture a baseline with the existing measurement path. Record the source
   revision, workload dimensions, environment, sample count, errors, and
   artifact location. Check that the probe distinguishes the reported case
   from an easier case.
3. Trace the measured bottleneck through the active code with
   [explore](explore.md). Form a specific hypothesis from the evidence.
4. Change one performance factor at a time. Capture the same workload again
   and inspect both the metric and the output. Reject a result that falls
   inside measurement noise or comes from a different workload.
5. Run the relevant correctness checks and the project implementation gate.
   Repeat the affected measurement after later source changes.

For repository-engine work, begin with `npm run test:engine`. Version 3 run
artifacts pin their source, so make a fresh ignored run directory for each
implementation trial. Use `npm run experiment:status -- RUN` to inspect a
prepared run without dispatching work or changing its artifacts. Follow
[Verification](../../../../docs/VERIFICATION.md) for the exact history workflow
and its evidence limits.

## Sustained improvement

Use a sustained loop only when there is a stated metric and target. Keep a
small decision record in an ignored local path with one row per attempt:
hypothesis, change, before, after, checks, and keep or revert. Freeze the
measurement method before iterating. Accept a change only when it moves the
metric beyond noise and keeps the correctness gate green. Stop when the
user's target is met or remaining ideas do not justify their cost.

Do not stack unmeasured changes. Do not infer a speedup from source shape,
test count, repository size, provider latency, or contributor activity. Keep
semantic quality, browser behavior, and engine mechanics as separate claims.

## Report

State the exact workload and metric, baseline and final observations, sample
and error limits, source revisions, checks, and the artifact a reviewer can
inspect. Label estimates and unverified causes as such.
