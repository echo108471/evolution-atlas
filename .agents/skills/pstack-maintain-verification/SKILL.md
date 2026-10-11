---
name: pstack-maintain-verification
description: Reconcile Evolution Atlas verification guidance, feature inventory, and control harness with current source and live behavior. Use for verification-system maintenance, not ordinary product changes.
---

# Maintain Evolution Atlas verification

Keep the verification guide and harness aligned with current user-visible
behavior. The feature inventory is a map for selecting checks; it does not
prove that a feature works or that coverage is complete.

Read [AGENTS.md](../../../AGENTS.md),
[Verification](../../../docs/VERIFICATION.md), and
[pstack-verify](../pstack-verify/SKILL.md). Use its feature guides under
`../pstack-verify/references/features/` and the FEATURE_REGISTRY export from
`scripts/verification/features.mjs`. Do not create a second feature list.

## Establish the state

Check the working tree and preserve existing edits. Read the active feature
registry, its linked user-facing guide, and relevant current source. Use
source-backed entry points, routes, prerequisites, and gotchas. Treat prior
summaries as pointers to verify.

Run the control harness doctor command and list the registered features:

- `node scripts/control-atlas.mjs doctor --json`
- `node scripts/control-atlas.mjs list --json`

If the doctor check fails, record the exact failure and follow the documented
readiness procedure. Resume only after doctor passes; otherwise report the live
pass as incomplete. After an unexpected drive failure, run doctor again and
reset or relaunch the affected session before continuing.

## Read source in parallel, drive the live pass serially

For a full maintenance pass, inspect each mapped feature against active source.
When delegation is available, assign read-only source reviews in parallel,
bounded by available capacity. Each reader returns the feature, active source
entry points, user route, prerequisites or gotchas, likely drift, and one live
verification recipe. The coordinator reconciles overlaps and checks the cited
source before editing.

The coordinator owns live driving. Keep app interactions serial in one
health-checked instance, and use isolated synthetic repository data. Run:

- `node scripts/control-atlas.mjs verify --all --json`

Inspect the emitted JSON evidence for each registered feature and confirm the
artifact exists at the reported ignored scratch path. Use
`node scripts/control-atlas.mjs verify --feature NAME --json` to investigate
or repeat an individual route. Capture an optional trace only when it helps
explain a concrete failure or runtime behavior.

Drive every mapped feature during a full maintenance pass. A feature whose
route or prerequisite prevents a live check remains explicitly incomplete
unless the exact prerequisite and attempted route support a
verified-unreachable result. Recheck a route after any harness correction.
Clean only run state created by this pass. First inspect
`node scripts/control-atlas.mjs cleanup --run-id ID --dry-run`. Dry-run is the
default. Before applying cleanup, preserve any required evidence outside the
runtime directory and confirm the copy exists. Use `--apply` only to remove
the exact validated verifier-owned run directory, then confirm retained
evidence still exists.

The repository history plane has no browser journey in the current registry.
Assess its CLI, source, receipts, and replay using the project verification
guide. Do not report browser coverage for it.

## Reconcile and change

Compare the source findings and live evidence with the guide, registry, and
harness. A source change establishes likely documentation drift; it does not
establish that the new behavior works. A registry entry establishes intended
coverage; it does not establish that the route was driven.

Keep edits inside the verification skill and its feature guides, the registry,
the control harness, or their direct wiring. Update a feature description only
when current source or live behavior supports the correction. Add a missing
feature only when a concrete user-facing source path exists.

Classify discrepancies by cause:

- Guide or registry drift: correct the source-backed description or route, then
  repeat its live check.
- Harness defect: repair the harness or its direct wiring, then repeat the
  affected check and verify evidence retention and cleanup.
- Product regression: preserve the reproduction, report the exact route,
  observed state, and evidence, and leave product behavior for a separate fix.

Keep generated data, traces, screenshots, and JSON evidence in ignored local
paths unless Eugene explicitly approves a fixture for version control. Use
cleanup only for artifacts created by this pass.

## Report

Report the source revision, features checked, and counts marked verified,
verified-unreachable, and incomplete. Link the saved evidence and describe
confirmed guide or harness changes. List product regressions separately.
State any missing prerequisite or check that prevents a coverage claim. A
static feature map, passing CLI validator, or synthetic test alone does not
establish live product behavior.
