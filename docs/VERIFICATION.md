# Verification

Choose a check for the claim being made, then inspect the resulting artifact.
The required implementation gate is `npm test`, `npm run build`, and
`git diff --check`, as [AGENTS.md](../AGENTS.md) specifies. `npm run check` runs
all three in that order. A focused check helps while changing one area; it does
not replace the final gate. `npm run build` already runs `tsc -b` before Vite.
`npm run typecheck` runs that TypeScript step alone.

For one test file, use `npm test -- test/FILE.test.mjs` (or a `.test.ts` file).
For the current engine, `npm run test:engine` covers the CLI, host, versioned
runtime, history, graph contract, review continuity, and map parser without
running every older experiment test. `npm run experiment:status -- RUN` gives a
read-only summary of a prepared version 3 run, its worker states, validation
issues, and any published map. It checks that a published map still matches the
pinned run and checkpointed graph. A changed engine implementation requires a
new run directory; old run artifacts remain available for comparison.
Many engine and history tests construct temporary Git repositories and synthetic
candidate output. They establish mechanics and rejection behavior, not a model's
semantic accuracy on a real repository.

| Changed area or claim | Focused checks and artifacts | What remains to inspect |
| --- | --- | --- |
| Git extraction, pinned snapshots, source reads | [atlas](../test/atlas.test.mjs), [repository snapshot](../test/repository-snapshot.test.mjs), [source](../test/repository-source.test.mjs), and [history](../test/repository-history.test.mjs) tests | The raw commit, path, blob, rename, or diff evidence for a claim on the named repository and revision |
| Engine lifecycle, host dispatch, versioned replay | [CLI and run status](../test/experiment-status.test.mjs), [engine](../test/repository-engine.test.mjs), [runtime](../test/repository-runtime.test.mjs), and [host](../test/repository-host.test.mjs) tests | Assignment status, actual host completion, immutable receipts, saved source pins, and byte-stable replay of the affected run |
| Cross-revision integration and historical claims | [evolution](../test/repository-evolution.test.mjs), [engine contract](../test/repository-engine-contract.test.mjs), and [review history](../test/repository-review-history.test.mjs) tests | Before/after revisions, explicit omissions, `historyLineage` and `historyEdgeLineage`, and cited post-baseline Git evidence |
| Candidate interpretations and review | The owning [capability](../test/capabilities.test.mjs), [candidate revision](../test/candidate-revision.test.mjs), [report](../test/repository-map-report.test.mjs), or [review history](../test/repository-review-history.test.mjs) test | Whether the proposed label or explanation is actually supported; validation of citations and accounting alone cannot decide that |
| Viewer and interaction | [Map parsing](../test/repositoryMap.test.ts), [URL state](../test/urlState.test.ts), relevant story/model tests, and `npm run control:atlas -- verify --feature candidate-map` or another [mapped feature](../.agents/skills/pstack-verify/references/features/README.md) | Inspect screenshots, action assertions, and the run report. Scripted journeys use synthetic data; import the named real `output.json` or `reviewed-output.json` separately when the claim concerns that artifact. A smoke journey is not exhaustive interaction coverage |
| Generated data and build privacy | `git check-ignore -v PATH` for a specific run path, `git status`, and `npm run build` | Inspect the intended `dist/`, especially `dist/graph-reviews/`, before publication. A gallery build requires Git and keeps tracked files under two approved review roots while stripping local run directories; a personal build without a gallery manifest can still include local data |
| Project documents | Render the changed Markdown and inspect headings, tables, code blocks, and links | A source-text or link check alone does not establish the rendered document is readable |

## Browser control

The [pstack-verify skill](../.agents/skills/pstack-verify/SKILL.md) owns the
launch, doctor, drive, evidence, and teardown instructions. Its
[feature map](../.agents/skills/pstack-verify/references/features/README.md)
describes how users reach each surface, the scripted checks, and remaining
gaps. Consult it before selecting a journey.

After installing the repo's dependencies, install Chromium into the ignored
project cache once:

```bash
PLAYWRIGHT_BROWSERS_PATH=scratch/verification-browsers npx playwright install chromium
```

```bash
npm run control:atlas -- --help
npm run control:atlas -- doctor
npm run control:atlas -- list
npm run control:atlas -- verify --feature candidate-map
npm run control:atlas -- verify --all
```

Doctor is read-only and reports the current source and missing prerequisites,
including the exact Chromium setup command. Each verification invocation
starts its own Vite server and browser against synthetic data, exercises the
real UI, records actions and assertions, and captures screenshots and browser
logs. It uses separate ports and browser contexts so concurrent invocations
do not share state. The run closes the resources it started and retains its
evidence under ignored `scratch/`. Inspect the returned report and screenshots;
the command's exit status alone is insufficient evidence.

These are development-server smoke journeys. They do not check a deployed
site, production performance, every alternate entry path, model quality, or
the real two-revision milestone. Traces are diagnostic artifacts; compare
performance with separately controlled measurements as described in the
[performance workflow](../.agents/skills/pstack-atlas/references/performance.md).

After a skill or map change, run `npm run check:pstack` for native skill
metadata, links, feature wiring, and provenance consistency. To also verify
the recorded upstream source hashes against a downloaded pstack directory:

```bash
npm run check:pstack -- --upstream /path/to/downloaded/pstack
```

The default check is offline. Hash validation checks source identity; it does
not establish that the adaptation makes good decisions. Use
[pstack-maintain-verification](../.agents/skills/pstack-maintain-verification/SKILL.md)
for source review and live feature coverage when the app changes. Maintenance
runs only when requested or needed for the current task; it is not scheduled.

## Real history workflow

For a claim that the history workflow works across revisions, use the
[documented v3 sequence](HISTORY-WORKFLOW.md): prepare a run at a pinned commit,
reserve and bind real worker handles, observe terminal states, checkpoint,
integrate, and publish. Expand at a descendant revision and inspect
`output.json`, `index.html`, receipts, omissions, and any
`reviewed-output.json`/`reviewed.html` companion. Keep runs in an ignored local
directory such as `public/graph-reviews/history-delivery-*`; repository data
may still be sensitive even when ignored.

The automated engine tests call exported functions. If command-line argument
routing changes, exercise the affected `scripts/repository-engine.mjs` command
directly against a disposable local run as well. The focused CLI test now
completes a synthetic prepare-to-publish cycle. The one-off
`scripts/run-pilot-course-recommender.mjs` uses hand-authored responses and a
sample review note; it is a contract exercise, not evidence of model or owner
review.

The [milestone acceptance boundary](HISTORY-WORKFLOW.md#acceptance-boundary)
calls for a descendant-revision expansion with visible omissions and at least
one history-backed capability claim. Synthetic tests check the mechanics and
rejections. A model-authored real-revision run checks integration; it does not
establish exhaustive discovery, correct capability granularity, or independent
verification of semantic history. Source-backed human review can assess individual
claims, but the project has not established overall semantic history accuracy.

## Report the result

Record the tested source, exact command or browser path, observed result, and
artifact inspected. Separate passing checks from missing provider output,
unresolved citations, unreviewed claims, and any UI path not exercised. If the
source changes after a run, repeat the affected checks before attaching their
result to the new source.
