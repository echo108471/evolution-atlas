# Evolution Atlas

Evolution Atlas turns a Git repository's history into an interactive map of
how the codebase grew over time. It identifies candidate features and
meaningful changes, connects them to the contributors and code areas involved,
and visualizes how those relationships evolved from initial implementation
through expansion, hardening, migration, or removal.

The project is an experimental, personal exploration. Its first subject was
`course-recommender`; current work centers on evidence-linked capability maps
across repository revisions.

## Purpose

Repositories contain a detailed record of change, but that record is difficult
to read as a coherent system history. Evolution Atlas aims to make that hidden
story explorable while keeping every meaningful claim connected to inspectable
Git evidence.

The intended user is initially the repository owner or a technically curious
maintainer who wants to understand what was built, who contributed, how
features took shape, and how the system became what it is today.

## Product boundaries

Evolution Atlas should:

- distinguish evidence observed in Git from labels or interpretations inferred
  from that evidence;
- treat detected features and lifecycle stages as candidates with inspectable
  support, not unquestionable facts;
- link visual elements back to relevant commits, paths, diffs, dates, and
  contributors;
- represent change over time, including implementation, expansion, hardening,
  migration, and removal; and
- make uncertainty and incomplete history visible.

Evolution Atlas should not:

- rank developers or turn contribution history into a performance score;
- judge whether historical decisions or contributors were good or bad;
- present inferred intent as repository fact; or
- inherit AGC's implementation or data model by default merely because the two
  projects share an evidence-bounded approach to Git history.

## Initial reversible experiment

The first experiment used `course-recommender` to test a narrow vertical
slice:

1. Extract a small, deterministic history dataset from Git.
2. Propose a limited set of feature and meaningful-change candidates.
3. Preserve the evidence and uncertainty behind every candidate.
4. Render an interactive view of relationships among candidates, contributors,
   code areas, and time.
5. Check the resulting story against the repository before generalizing the
   model or architecture.

## Current decisions

- Evolution Atlas is a separate project and repository from AGC.
- Accuracy, traceability, and an engaging visual experience are all product
  requirements.
- The initial calibration used `course-recommender`; later experiments tested
  other repositories and the consolidated engine.
- The first implementation is a local Node.js analyzer plus a static
  React/TypeScript application built with Vite. D3 supplies temporal scales
  while React owns the chronology, comparison matrix, and evidence inspector.
- Versioned JSON is the initial boundary between analysis and visualization.
- No database, hosted service, or model-generated inference is required for the
  first pilot.
- The project is licensed under Apache-2.0.

## Open questions

- What is the most useful visual unit: feature, change episode, code area, or a
  coordinated combination of them?
- Which lifecycle transitions can be supported deterministically, and which
  should remain explicitly inferred?
- How should tangled commits, renames, merges, reverts, and deleted code appear
  in the map?
- What interaction makes the evidence trail understandable without overwhelming
  the visual narrative?

## Start here

Use Node.js **24.19.0**, npm **11.9.0**, and Git for the pinned development
baseline. The [development guide](docs/DEVELOPMENT.md) covers fresh installation,
deterministic fictional fixtures, offline validation, and an exact-commit clean
checkout check. Routine development needs no private dataset or provider key:

```bash
npm ci --cache scratch/npm-cache --no-audit --no-fund
node scripts/synthetic-fixtures.mjs generate
node scripts/synthetic-fixtures.mjs validate
node scripts/check-offline.mjs
```

Dependency installation may use the package registry. The fixture generator and
validation gate use local synthetic data and reject external requests.

To view the approved observed-only Zod demo, build the application and open the
local preview URL printed by Vite:

```bash
npm run build
npm run preview -- --host 127.0.0.1
```

The [demo inventory](docs/ZOD-DEMO-RELEASE-INVENTORY.md) records its pinned source,
exact four files, license and disclosure limits. No model call or experiment
repository download is needed to view it.

For the current **capability-discovery workflow**, use
[`scripts/repository-engine.mjs`](scripts/repository-engine.mjs) and its
[operating sequence](docs/ARCHITECTURE.md#consolidated-repository-workflow).
It handles repository-neutral snapshot discovery, expansion, saved progress and
a complete candidate-map report. Version 3 connects ancestor-revision maps,
bounded Git history, and explicitly supplied cached readings, with candidate
explanations of capability changes. Model execution is supplied by the host;
the engine does not call a model API. Follow the
[history workflow](docs/HISTORY-WORKFLOW.md) for preparation, worker coordination,
review continuity, and the app's **Candidate map** view. Earlier experiment
runtimes remain frozen for replay.

For a fast current-engine cycle, run the focused mechanics checks, inspect an
existing prepared version 3 run without changing it, and use the complete gate
before finishing. The [verification guide](docs/VERIFICATION.md) explains what
each check establishes.

```bash
npm ci
npm run test:engine
npm run experiment:status -- /path/to/ignored/run
node scripts/check-offline.mjs
```

The original atlas pipeline remains available for historical experiments and
the standalone private viewer. Use [Explicit experiments](docs/EXPERIMENTS.md)
for pinned local sources, separate acquisition and paid-call flags, and saved
output reuse. The legacy viewer reads explicitly prepared local `public/` data;
those files remain ignored and excluded from production:

```bash
npm run analyze -- --repo . --out public/atlas.json
npm run dev
```

Interpretation is a separate, optional two-pass stage. The first pass proposes
candidate features. The second reviews the same complete commit corpus for
evidence-linked lifecycle episodes within those features. Any cited commit or
feature id that does not resolve to the observed dataset is discarded:

```bash
node scripts/interpret.mjs --in public/atlas.json --allow-paid
```

During lifecycle calibration, validated features can be reused so only the
second model pass runs. Local boundary checks can also be reapplied without a
model call:

```bash
node scripts/interpret.mjs --in public/atlas.interpreted.json --reuse-features --allow-paid --out scratch/atlas.lifecycle-next.json
node scripts/interpret.mjs --in public/atlas.interpreted.json --revalidate --out scratch/atlas.revalidated-next.json
```

Model execution needs `--allow-paid` and a model credential; local
revalidation and observed analysis do not. Interpretation writes a new sibling
`*.interpreted.json` or `*.revalidated.json` by default. Existing destinations
and aliases of inputs are refused; preserve saved files and choose a new
`--out` for another experiment. The legacy viewer does not automatically switch
to the new file; prepare its local viewer filename separately while retaining
the saved inputs. Features and semantic lifecycle episodes are separate
`candidate` entities carrying their
method, confidence, and supporting commits. A feature can therefore show a
sequence such as introduced → expanded → hardened instead of receiving one
permanent stage.

Interpretation can use Anthropic or OpenAI. An explicit `--provider` wins;
otherwise Atlas selects OpenAI only when `OPENAI_API_KEY` is set and
`ANTHROPIC_API_KEY` is not. With both keys or neither key it selects Anthropic.
It never changes provider to accommodate a model:

```bash
node scripts/interpret.mjs --in scratch/atlas.json --provider openai --allow-paid    # needs OPENAI_API_KEY
node scripts/interpret.mjs --in scratch/atlas.json --provider anthropic --allow-paid # needs ANTHROPIC_API_KEY, or `ant auth login`
```

OpenAI defaults to `gpt-6-luna:batch`; `--model <id>` overrides that default.
Anthropic retains `claude-opus-5`, and model overrides are accepted only for
OpenAI. These CLIs have no model-selection environment variable; the API-key
variables above affect credentials and provider detection, not the model.
Gallery interpretation uses the same selection rules but its transport remains
live-only; pass `--model gpt-6-luna` explicitly with gallery's `--interpret`.
All OpenAI endpoint, credential, and default-model settings live in
[openai-provider.mjs](scripts/lib/openai-provider.mjs).

In `interpret` and `epochs`, models ending in `:batch` use the OpenAI Batch API
automatically. `:batch` is a local routing marker: it is kept in provenance and
stripped from the model ID sent to OpenAI. Every request uses the
`/v1/chat/completions` shape. Interpretation submits feature discovery, then
submits lifecycle discovery after validating the feature results. Epoch
detection groups proposal windows into one batch and period labels into one
batch per hierarchy level. Other model IDs send live requests; for example,
`--model gpt-6-luna` selects synchronous Chat Completions requests.

Batch results arrive asynchronously, potentially taking the full **24-hour
window per dependent stage**. Both CLIs accept `--batch-poll-ms` (initial
interval, default `30000`) and `--batch-max-wait-ms` (per-stage wait, default
`86400000`); polling backs off. Each run saves the uploaded input file ID, batch
IDs, request fingerprints, and downloaded raw results in
`<output>.batch-state.json`. After a timeout or interruption, rerun the same
command with the same input and output to resume without a second submission.
Wait flags may change; changed inputs or inference options are rejected. Keep
the sidecar with the output. `--batch-replay <sidecar> --out <new-path>`
replays saved completed results offline without credentials or `--allow-paid`,
using the original input and inference options.

The batch model defaults to the selected ID; `--batch-model <id>` overrides it,
and each JSONL request line carries that model without the `:batch` marker.
OpenAI documents Batch API pricing at a discount to synchronous requests; check
the current pricing page before a paid run. See
[batch operation, cost, and replay details](docs/EXPERIMENTS.md#openai-batch-runs).

Each candidate records which provider and model produced it in its `method`
field, so interpretations from different routes stay distinguishable.

The generated `public/atlas.json` is intentionally ignored because repository
history can contain contributor and project metadata. The application remains
useful without it: it explains how to generate a local dataset.

Keep new real experiments in ignored `scratch/`. Production builds include no
local `public/` data by default; publication uses an explicit path/hash manifest.
See [private development and recovery](docs/PRIVATE-DEVELOPMENT.md) for the
preserved outputs, free offline gate, and later snapshot/release approvals.
The [release audit](docs/RELEASE-AUDIT.md),
[three demo source review](docs/DEMO-REVIEW.md), and
[durable preservation proposal](docs/ARTIFACT-PRESERVATION.md) record the remaining
release decisions and their completion criteria.

Epoch detection is a third optional stage, independent of interpretation. It divides the
history into periods during which the work was about roughly the same thing, so later
analysis can proceed period by period rather than needing the whole corpus in one request:

```bash
node scripts/epochs.mjs --in public/atlas.json --allow-paid --save-proposals scratch/proposals-next.json --out scratch/epochs-next.json
```

Epoch detection uses OpenAI and needs `OPENAI_API_KEY` for model requests. It
shares the `gpt-6-luna:batch` default with interpretation; `--model <id>` selects
the model for both proposals and period labels. The shared default lives in
[openai-provider.mjs](scripts/lib/openai-provider.mjs).
New batch work requires `--out` so its resume state has a stable location.

It runs two passes that never see each other: a model reads raw commit windows and marks
where the work changed character, and two deterministic detectors measure where the
distribution of touched paths and of commit-subject vocabulary shifts. Because the two
locate the same transition at slightly different moments, a boundary is stored as the
interval spanning both readings, and the commits inside it belong to no period.

How many levels the hierarchy has is derived from the history, not fixed. A repository
small enough to analyze whole gets no periods at all; a mid-sized one gets epochs; only a
history with too many periods to describe together gets eras above them.

Periods are then named, which doubles as the cheapest check on the boundaries: a period
the model can only call "Mixed feature work" is a cut in the wrong place. `--no-labels`
skips naming but still requests proposals. The free replay path combines
`--proposals` with `--no-labels`; saved proposals must match the repository and
full head revision. New period and proposal files are created exclusively:

```bash
node scripts/epochs.mjs --in public/atlas.json --proposals scratch/saved-proposals.json --no-labels --out scratch/epochs-replayed-next.json
```

Replay keeps the saved proposal model in its provenance and `method`, even
when the current default differs. Historical research scripts keep their
independent model pins so saved requests and replay fingerprints stay stable.

The legacy viewer picks up a separately prepared `public/epochs.json` and adds a
Periods tab; the new scratch output is not automatically served. Like
`public/atlas.json`, it is gitignored and excluded from gallery builds, because it quotes
commit subjects and dates.

General checks:

```bash
node scripts/check-offline.mjs
```

## How we work

This repository uses a native adaptation of [Lauren Tan's pstack](https://github.com/cursor/plugins/tree/9d76bcab133aefcccb16121d7be874e6aa823729/pstack)
for understanding changes, designing boundaries, implementing, debugging,
verifying, and reviewing. The [engineering guide](docs/ENGINEERING.md) describes
the workflow; the [pstack-atlas skill](.agents/skills/pstack-atlas/SKILL.md)
routes broad tasks to focused skills in `.agents/skills/`. In Codex, ask for
`$pstack-debug` to investigate a defect or `$pstack-review` to review a diff.
The project evidence and validation rules remain in [AGENTS.md](AGENTS.md).

Verification includes an isolated browser control CLI and a source-linked
[feature map](.agents/skills/pstack-verify/references/features/README.md).
Use `$pstack-verify` to exercise behavior and
`$pstack-maintain-verification` to update the map and harness from source and
browser evidence. These workflows run with repo-local tools and inherit the
current agent's permissions and model.

```bash
npm run control:atlas -- doctor
npm run control:atlas -- list
npm run control:atlas -- verify --feature candidate-map
npm run check:pstack
```

Follow the [browser setup and evidence guide](docs/VERIFICATION.md#browser-control)
before the first run. Synthetic verification data and screenshots stay in
ignored `scratch/`. A passing browser journey establishes the exercised UI
behavior; it does not establish semantic accuracy of model-authored history.

## Project documents

- [Experiment summary and lessons](docs/EXPERIMENT-SUMMARY.md) — readable synthesis, corrected conclusions, and unresolved questions
- [Engineering workflow](docs/ENGINEERING.md)
- [Verification guide](docs/VERIFICATION.md)
- [Synthetic development and clean checkout](docs/DEVELOPMENT.md)
- [Explicit experiments and saved-output reuse](docs/EXPERIMENTS.md)
- [Capability history workflow](docs/HISTORY-WORKFLOW.md)
- [Concept](docs/CONCEPT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Evidence model](docs/EVIDENCE-MODEL.md)
- [Per-commit reading](docs/PER-COMMIT.md)
- [Capabilities](docs/CAPABILITIES.md)
- [Blind capability induction](docs/CAPABILITY-INDUCTION.md)
- [Epochs](docs/EPOCHS.md)
- [Interpretation findings](docs/INTERPRETATION-FINDINGS.md)
- [Course Recommender pilot](docs/COURSE-RECOMMENDER-PILOT.md)
- [Roadmap](docs/ROADMAP.md)
- [Productization](docs/PRODUCT.md)

## Current implementation boundary

The analyzer keeps an observed layer of commits as change episodes, exact Git
author identities, changed paths, and top-level code areas. A separate,
explicitly candidate identity-matching layer can suggest that two exact
identities belong together. It uses normalized names, non-revealing comparisons
of email handles, GitHub noreply account metadata, and repository `.mailmap`
evidence; email addresses are never emitted.

The same analysis pass proposes candidate structural episodes when one commit
contains a concentrated old-to-new path transition. Git rename records are the
strongest evidence. Repeated delete/add paths with matching suffixes can support
a lower-confidence candidate. The original file operations remain intact, and
the candidate claims only an observable repository reorganization—not its
intent or architectural significance.

Feature candidates come from the separate interpretation stage, which never
writes into that observed layer—it appends candidates alongside it and flips
`analysis.mode` to `interpreted`. Feature discovery and lifecycle discovery are
separate model passes over the same complete commit corpus. Lifecycle stages
belong to semantic episodes, not features; validation resolves every proposed
feature id and commit before serialization. Code-area and contributor
associations are still read from observed commits rather than proposed.

The interpreted viewer now leads with a repository overview, a repository time
machine, and a searchable selected-feature story. The time machine reconstructs
directory snapshots from observed path operations at initial, calendar,
structural-change, and current checkpoints. One adjacent panel explains what
changed and keeps candidate reorganizations linked to their evidence. A focused
lifecycle ribbon coordinates candidate semantic episodes, observed commits, code areas,
contributor associations, and the evidence inspector. Structural transitions
open the supporting commit, prefix mappings, and individual path transitions;
feature signals hand off to the full story instead of duplicating it. Lifecycle bars open
their own rationale and cited commits. Its only relationship graph is scoped to
the selected feature so the layout stays stable and attribution boundaries
remain visible. Identity Review is a data-management utility that makes match
evidence inspectable and lets the user merge, reject, undo, import, and export
decisions without rewriting raw history. Decisions are also retained locally
for the repository. Contributor
Trail then projects one confirmed contributor profile—which may still contain
only one exact Git identity—through the same evidence: authored commits remain
highlighted inside complete feature trails, while observed code-area rows
include authored changes that no candidate feature cites. It is an association
view, not an ownership or performance view.
