# Version 3 history plane

The v3 engine prepares and expands capability maps at pinned revisions, coordinates host-run workers, integrates candidate changes with bounded history evidence, and publishes an offline artifact for review.

Source basis: [scripts/repository-engine.mjs](../../../../../scripts/repository-engine.mjs), [scripts/repository-engine-v3.mjs](../../../../../scripts/repository-engine-v3.mjs), [docs/HISTORY-WORKFLOW.md](../../../../../docs/HISTORY-WORKFLOW.md), and [docs/ARCHITECTURE.md](../../../../../docs/ARCHITECTURE.md).

## Sub-features

- **history-prepare** pins an initial discovery or descendant-revision expansion.
- **history-host** reserves assignments, binds actual worker handles, observes terminal states, and checkpoints worker output.
- **history-broker** retrieves bounded source and ancestor-history evidence within an assignment's scope.
- **history-integrate** freezes a decision-scoped packet for candidate-map consolidation.
- **history-publish** publishes the completed map and exposes history lineage and omissions in Candidate map.
- **history-review-continuity** projects earlier review notes while keeping prior approvals from silently transferring.

## How to get to it (user POV)

- Follow [Capability history workflow](../../../../../docs/HISTORY-WORKFLOW.md) to prepare a pinned v3 run.
- Use the host's worker lifecycle to reserve, spawn, bind, observe, record terminal state, and checkpoint.
- Integrate the candidate graph, run the integrator through the same host-observed lifecycle, and publish.
- Open **Candidate map** and select the run's output or reviewed output.
- Inspect the read-only run summary with the experiment-status command.

## Driving it with the v3 engine CLI

Preconditions:

- Use a disposable run path ignored by Git, a repository path, and a full commit SHA.
- Provide a run config with mode, repo, revision, displayName, and partitionCount; expansion also needs a baseline output from a prior run.
- A host capable of executing and observing actual workers is required for a live model-authored run. The engine records host observations but does not spawn or call a model API itself.

~~~sh
node scripts/repository-engine.mjs prepare RUN CONFIG.json
npm run experiment:status -- RUN
~~~

The status output should identify version 3, the pinned revision, mode, eligible discovery files, and worker states. Continue a live sequence from the docs:

~~~sh
node scripts/repository-engine.mjs reserve RUN A
node scripts/repository-engine.mjs bind RUN A RESERVATION_ID HOST_HANDLE
node scripts/repository-engine.mjs status RUN A
node scripts/repository-engine.mjs terminal RUN A HOST_HANDLE completed
node scripts/repository-engine.mjs checkpoint RUN A
node scripts/repository-engine.mjs integrate RUN
~~~

Reserve and bind the integrator assignment as R, use its scoped broker for receipts and prior-map/reading lookup, then record the host-observed terminal state, checkpoint, and publish:

~~~sh
node scripts/repository-engine.mjs publish RUN
node scripts/repository-review-history.mjs PREVIOUS_REVIEWED_OUTPUT.json CURRENT_RUN
~~~

Inspect the published output and, when produced, reviewed-output.json and reviewed.html in Candidate map. The status command is read-only. The engine test command covers synthetic mechanics and rejection behavior; neither is a live model-authored integration run.

## Gotchas

- The experiment-status command only summarizes a prepared v3 run whose pinned engine source matches this checkout.
- A reservation does not prove a worker is running. Bind the actual returned handle and record terminal state only after the host observes it.
- Broker search is navigation evidence; a search result alone does not support a behavior claim. Historical claims need observed ancestor-history receipts.
- Integration packet validation, source citations, and replay do not establish the truth or completeness of candidate capability explanations.
- The milestone acceptance boundary requires a descendant-revision expansion, visible omissions, and at least one history-backed capability claim. Synthetic tests are mechanics evidence only.
- Run artifacts can include repository history and contributor metadata. Keep them in ignored local paths and inspect the intended output before publication.
