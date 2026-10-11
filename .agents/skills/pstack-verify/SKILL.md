---
name: pstack-verify
description: Select and run Evolution Atlas checks that support a specific claim, including evidence lineage, replay, rendered UI, and project validation. Use for verification requests.
---

# Verify Evolution Atlas

Read [AGENTS.md](../../../AGENTS.md), the project's
[verification guide](../../../docs/VERIFICATION.md), and the relevant source.
Follow the shared [verification playbook](../pstack-atlas/references/test-verify.md).

For app-driving work, read the
[feature map](references/features/README.md). Its source map and the driver's
executed coverage are different things: use the driver report and inspect its
artifacts before reporting a feature as verified.

## Launch

For the default `verify` command, the driver starts an isolated Vite server on an ephemeral loopback port and a
fresh headless Chromium profile for each run. It serves only synthetic fixture
data, closes the browser and server after the journey, and removes the owned
runtime directory. It does not need or drive a separately running app or the
user's browser.

## Doctor

Run the driver preflight before a browser journey:

~~~sh
node scripts/control-atlas.mjs doctor
~~~

Doctor checks the repository root, Node version, local Vite and Playwright
dependencies, bundled Chromium, and source fingerprint. If it reports that
Chromium is missing, install it into ignored project scratch:

~~~sh
PLAYWRIGHT_BROWSERS_PATH=scratch/verification-browsers npx playwright install chromium
~~~

If project dependencies are missing, install them with npm before retrying
doctor. Do not drive a run that doctor reports as unhealthy.

## Drive

List stable journeys, then run only the feature being investigated:

~~~sh
node scripts/control-atlas.mjs list
node scripts/control-atlas.mjs verify --feature candidate-map
~~~

To exercise every journey registered by the driver, use:

~~~sh
node scripts/control-atlas.mjs verify --all
~~~

The driver emits JSON by default. Its list and run report identify each
journey's route, assertions, source and test files, limitations, and source
fingerprint. Read the matching feature guide for the user-facing path. A passing
journey proves only the listed interactions over its synthetic fixture; it does
not prove all sub-features in the map.

## Evidence

A run writes to the report's evidence directory under
scratch/control-atlas-evidence/RUN_ID. Inspect report.json, source-manifest.json,
and the feature's viewport.png, rendered.png, dom.txt, page.html, actions.jsonl,
actions.json, and browser-events.json. Inspect viewport.png for the visible
state and rendered.png for the full-page layout; sticky elements can differ
between the two captures. Confirm the screenshots show the
asserted state, the action log records the user path, the browser events contain
no unexplained failures, and the source fingerprint matches the source under
review. Evidence is retained when the owned runtime is cleaned.

## Private production preview

Use only when explicitly asked to inspect a prepared private production build.
Default synthetic journeys remain unchanged. Run doctor first, then supply two
absolute ignored paths from the same Git checkout:

~~~sh
node scripts/control-atlas.mjs verify-preview --directory /absolute/ignored/preview/dist --inventory /absolute/ignored/preview/inventory.json --json
~~~

The inventory lives outside dist and has exactly `version: 1`, a full
caller-declared `sourceRevision` for the code used to build the app, and `files` entries with
`path`, `sha256`, and `bytes`. It enumerates every build file. Sources must be
regular files without symlinks; path, size, hash, and actual-tree mismatches fail
before browser startup. Allowed namespaces are index.html, assets/, gallery/,
approved-snapshots/, and optional epochs.json. The sole gallery subject and
dataset must agree on a full repository revision and observed counts.

The driver serves immutable validated bytes on its own ephemeral loopback
server with no filesystem fallback. A fresh browser opens the sole card and
checks the overview, dataset response hash, full revision, and visible counts.
When the subject supplies license-notice or provenance links, their hrefs must
name inventoried same-origin files; browser GETs must return 200 and exact hashes.
It blocks external requests, WebSockets, service workers, and requests outside
the inventory. Only a missing optional `/epochs.json` GET 404 is tolerated,
when epochs.json is absent from the inventory; response and associated console
messages are explicitly recorded. Other errors fail the journey.

Inspect report.json, source-manifest.json, build-manifest.json,
server-requests.json, the gallery and overview screenshots, action logs, and
browser events under the returned ignored evidence directory. Source and build
fingerprints are checked again at completion. The inventory revision is recorded
as declared provenance; this command does not prove source-to-bundle binding.
The server, browser, and owned
runtime close while evidence remains. The report states
`publicationApproval: false`: inspection does not authorize snapshots, attest publication-plugin
emission, write a publication manifest, or establish semantic or licensing
acceptance. It never opens raw runs or source caches and never runs a model.

The optional offline synthetic exercise builds a private fixture preview and
invokes the same canonical subcommand:

~~~sh
node scripts/verification/test-preview.mjs
~~~

It requires the bundled browser to be installed and retains its synthetic
prepared build under ignored scratch. This exercise is separate from the
default unit-test gate and from verification of a real prepared snapshot.

## Cleanup

Successful and failed journeys close their browser and Vite server and remove
their owned runtime automatically. For an interrupted run, inspect the exact
run ID first, then clean only that owned runtime:

~~~sh
node scripts/control-atlas.mjs cleanup --run-id RUN_ID --dry-run
node scripts/control-atlas.mjs cleanup --run-id RUN_ID --apply
~~~

Cleanup defaults to dry-run and never removes evidence. Confirm the evidence
directory still exists after cleanup. Never kill a process by name.

## Helpers and claim limits

The repository CLI is the only app-driving helper; the commands above show its
invocation. Feature IDs are listed in
[references/features/README.md](references/features/README.md).

The v3 history plane is a manual CLI workflow described in
[history-plane.md](references/features/history-plane.md) and
[docs/HISTORY-WORKFLOW.md](../../../docs/HISTORY-WORKFLOW.md); it has no
control-atlas browser journey. Engine tests and read-only run summaries
establish only their stated mechanics. A model-authored real-revision run and
source-grounded review are needed to assess a live historical claim. Never
treat synthetic fixtures, replay, resolved citations, contributor metadata, or
a recorded review note as proof of semantic accuracy.

Select focused checks from the verification guide. For implementation changes,
complete the repository's required gate and inspect rendered output when the
claim concerns UI or documentation.
