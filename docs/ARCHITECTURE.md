# Architecture

## Decision

Start with a local evidence pipeline and an optional interpretation boundary:

```text
Git repository -> Node analyzer -> observed atlas JSON -> optional two-pass interpretation -> React + D3 viewer
                                          ├-> optional epoch detection    -> epoch document ---┤
                                          └-> optional per-commit reading -> readings document ┘
```

Per-commit reading ([Per-commit reading](PER-COMMIT.md)) is the successor to whole-corpus
interpretation rather than a companion to it: it covers every substantive commit instead
of the 10-12% the corpus pass cites, and its readings cache by commit SHA, so a repository
that gains ten commits pays for ten requests. Epoch detection remains for the boundaries
it finds, not as the unit that scopes later analysis.

This boundary is intentionally boring. It makes analysis reproducible, lets the
visual design evolve without rerunning Git, and keeps an inspectable artifact
between evidence extraction and interpretation.

## Target: an evidence-backed semantic decision loop

The long-term architecture should not encode the pilot owner's understanding of one
repository as a permanent taxonomy or a growing collection of repository-specific
heuristics. It should give a model enough inspectable evidence to make semantic decisions
on repositories their users do not already understand.

The division of responsibility is:

- **the model decides** whether work constitutes a capability, which narrower capabilities
  belong beneath an umbrella, whether one commit supports several candidates, where a
  lifecycle event sits, and where the work changes temporal character;
- **the evidence system supplies context** at the needed resolution and lets the model ask
  for more rather than forcing a decision from one underspecified slice;
- **deterministic code governs the decision** by resolving citations, rejecting invalid
  evidence references, preserving observed facts, recording provenance, and measuring
  recurrence; semantic support still requires examination of the claim and evidence;
- **the candidate graph preserves change** so a later run can add, merge, split, rename, or
  reparent an interpretation without silently rewriting the earlier one.

```text
Git objects and diffs
        │
        ▼
observed atlas ──> deterministic indexes and evidence tools
        │                         │
        │                         ▼
        └──────────────> model decision session
                           │  inspect / search / request depth
                           │  propose / cite / abstain
                           ▼
                    validated candidate graph
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
        capabilities   lifecycle       epochs / eras
             │             │              │
             └─────────────┴──────────────┘
                           ▼
                    viewer projections
```

Capabilities, lifecycle events, and periods share the decision infrastructure but remain
different projections. Capability hierarchy describes **what** the system does and may
overlap. Lifecycle describes **how a capability changed**. Epochs and eras describe
**when the repository's work changed character** and partition time. A capability may
cross several epochs, and one epoch may contain work on several capabilities.

### Evidence available to a decision session

The current blind induction run sends all saved readings in one request. That is a useful
control for the pilot, not the scaling strategy. A larger repository needs a model-facing
evidence interface over the same local artifacts. Its smallest useful operations are:

- inspect the repository tree, entry points, source, tests, and configuration at the
  current revision or a cited historical revision;
- retrieve a commit's observed metadata, paths, and bounded diff;
- retrieve its cached per-commit reading and the exact input that produced it;
- find related commits by paths, semantic reading, time, rename continuity, or explicit
  issue and merge relationships;
- inspect the history of a path, candidate capability, or proposed parent-child relation;
- follow symbol, dependency, route, schema, and test relationships when a language-aware
  adapter can establish them;
- compare two candidates' supporting and contradicting evidence; and
- request deeper evidence for a partial or ambiguous reading.

Each model decision records which operations and evidence it used. Retrieval is context
selection, not proof: a claim is publishable only when its cited Git evidence resolves
locally. The model may abstain when the available information does not support a decision.
Repository documentation and commit messages are evidence of what authors claimed; source,
tests, schemas, routes, and observed behavior are evidence of what was implemented. The
decision session must keep those bases distinct rather than letting confident prose stand
in for code.

### From proposal to durable candidate

One model response must not become canonical merely because it parsed. The intended flow
is:

1. **Propose:** infer candidates without a maintainer taxonomy or target count.
2. **Assign:** revisit evidence against the proposed map, allowing multiple capabilities
   per commit and explicit unassigned work.
3. **Critique:** independently propose merges, splits, nesting changes, contradictions, and
   missing evidence.
4. **Stabilize:** repeat the run and align candidates by cited evidence and relationships,
   not by label wording or list position.
5. **Publish:** materialize a versioned candidate graph pinned to repository head, model,
   prompt, evidence inputs, and validation method.

Assignment disagreements are extracted deterministically before critique. The review dataset
may preserve competing assignments for measurement, but the critic should not see their run
identity, frequency, or candidate-ID union by default. Those fields anchor the critic toward
ratifying or combining earlier answers. Instead it sees the fixed hierarchy, disputed commit
readings, and explicitly provisional exemplars drawn from recurring assignments. Competing
answers are compared only after the critic has responded.

Three repeated samples per condition support this boundary: exact decision agreement was
85.9% within candidate-visible runs, 71.6% within blind runs, and 54.5% across conditions.
This measures candidate-ID anchoring in the fixed pilot; it does not make the blind critic a
ground-truth judge.

Hierarchy critique uses a separate proposal-only interface. A deterministic builder matches
blind maps by cited evidence, extracts recurring blind map gaps, samples bounded readings,
and fingerprints the complete packet. The model may propose additions, merges, splits,
reparenting, or removals, but every proposal must cite packet readings and is serialized as
a candidate interpretation rather than applied. The first implementation preloads the
bounded packet; its 55.8k-token pilot demonstrates the contract but also establishes the need
for on-demand retrieval before substantially larger histories.

The first focused-packet ablation confirmed that context selection affects the structural
answer: the same capable model retained the strongest missing-node proposal but changed its
secondary merge/split proposals when shown fewer boundary signals. Three cheap-model repeats
then reached only 24.9% mean operation-target F1 and failed to account for most selected
signals. Proposal recurrence and review completeness are therefore separate gates. The
comparison layer matches operation targets without using proposed labels, compares cited
evidence independently, and marks every proposal ineligible for automatic revision when any
run in its condition is incomplete.

The first staged-retrieval pilot makes the retrieval boundary concrete. A cheap planner sees
signal metadata and an evidence catalog without reading interpretations. A deterministic
broker—not the model—enforces the global reading budget, while preserving the planner's
requested order and recording truncation. The decision model receives only selected readings
and not the planner's prose. This reduced peak input and model cost, but increased total input
across both calls and produced several additions that overlap existing node descriptions.
Retrieval therefore needs a second semantic gate: proposal-to-map novelty review plus a
bounded follow-up evidence round. Citation validity, coverage, and novelty are distinct.

Stable candidate identity belongs to reconciliation, not to the model's label. A renamed
candidate should retain lineage; a split or merge should cite its predecessors. User edits
remain useful review evidence, but the system must be able to run without them and they
must not be smuggled into later blind evaluations.

### From two-layer induction to iterative graphs

Capability induction currently permits one umbrella layer and one optional child layer.
That keeps the first stability experiment interpretable. The serialized shape is recursive
so a later decision session may propose broader umbrellas or deeper children without a
schema migration. The viewer can continue projecting two levels even if the underlying
candidate graph later becomes deeper.

The [iterative graph experiment](CAPABILITY-GRAPH.md) now tests that extension separately:
start from prior leaf discoveries without their old parents, retrieve bounded readings and
revision-pinned source, and apply versioned candidate patches. Containment forms a DAG with
no fixed depth; dependencies are separate edges. A later round may revise earlier nodes,
not only stack parents above them. The agenda records reviewed and outstanding areas so
finishing a local investigation does not imply finishing discovery. Evidence budgets and
round limits bound computation without imposing a semantic size or depth limit. This remains
an experimental projection, with existing induction and the viewer unchanged.

### Snapshot workflow: saved work and live execution are separate

The subscription-agent snapshot experiments now have a resumable wrapper in
`scripts/snapshot-workflow.mjs`. It supports initial discovery and unread-file expansion,
then an evidence-backed integration and complete local report. It reuses the frozen source
broker and graph validators rather than changing the model's capability-selection policy.
That frozen wrapper's source inventory and mechanical partitions remain VS Code-specific.
The consolidated repository-neutral entry point below supersedes it for new workflow work;
the old implementation remains intact for exact experiment replay.

The wrapper freezes source inputs, instructions, budgets and relevant implementation hashes
before dispatch. Discovery receives saved assignment packets without previous definitions;
integration receives the checkpointed proposals, baseline and source evidence. Every raw
response is saved before acceptance, and graph validation is distinct from semantic support.
Completed assignments pin both the response bytes and full receipt set. Baseline excerpts
are also checked against immutable source blobs. Namespace collisions cannot silently replace
an original during lineage accounting.

Artifact states distinguish ready work, partial evidence, a saved response, invalid output,
checkpointed output and complete report. A recorded agent handle with no result means
**check the host**, not “running” and not “rerun.” The parent still dispatches subscription
agents through host tools; the wrapper does not purchase API inference or infer live status.
An explicitly resumed interrupted assignment retains all earlier receipts and the remaining
budget. A per-assignment exclusive lock serializes wrapper broker requests with host
`launch`/`terminal` recording for that assignment. When another live process holds the lock,
callers wait for release rather than failing immediately with `EEXIST`. An abandoned lock
(dead recorded pid) still requires checking the recorded process before recovery; it is never
expired or deleted solely because time passed. Hosts should record `launch` before dispatching
a worker that will call the broker, so the two operations share the lock in a defined order.
Direct use of the older broker can bypass wrapper locking, so agent access discipline remains
instruction-enforced rather than a sandbox.

Once discovery is checkpointed, integration pins the complete input set—not just files that
existed at an earlier check. Added receipts, changed instructions or changed task packets are
rejected. Once a valid graph is checkpointed, report creation can resume from saved inference.
Repeated creation verifies exact bytes and refuses conflicting files. Corrupt partial files
remain failures requiring explicit recovery; writes are create-only, not crash-atomic.

The companion wording-revision transaction requires exact old text and graph preconditions,
applies a proposal atomically in memory and records changed assertions. Source-review records
bind to exact reviewed content in a separate sidecar; neither schema success nor proposer
confidence grants independent verification. Main-app integration remains separate delivery work. Historical evolution is **in**
the consolidation milestone (see [three planes](#three-planes-store-decision-session-history)
below); snapshot maps are intermediates, not the success bar. Current experimental outcomes
and limitations are owned by [the experiment summary](EXPERIMENT-SUMMARY.md).

### Consolidated repository workflow

New runs use **`scripts/repository-engine.mjs`**, not another experiment-specific runner.
Its commands are `prepare`, `status`, `broker`, `launch`, `terminal`, `checkpoint`,
`integrate` and `publish`. It combines repository-neutral inventory, bounded immutable-source
retrieval, saved responses, global integration, explicit lineage and a complete local report.
It does **not** launch models itself: the host dispatches fresh-context workers from the saved
task files and records their handles. This is one artifact workflow with external model
execution, not a standalone one-command model service.

An initial configuration contains `mode: "discovery"`, an absolute local `repo` path,
`displayName`, optional `revision` (default `HEAD`), `partitionCount` (1–6, default 3) and
`maxFileBytes` (at most 1 MiB). Expansion uses `mode: "expansion"` and `baseline`, the path
to a previous `output.json`, on the **same pinned commit**. The discovery inventory is
reconstructed from the complete commit tree, then excludes every cumulatively inspected
baseline file. It never substitutes a previous reduced inventory for the full one.
Assignments balance source-directory groups; they impose no capability count or depth.

Operational sequence, with `RUN` an ignored local output directory:

```text
node scripts/repository-engine.mjs prepare RUN CONFIG.json
node scripts/repository-engine.mjs status RUN
# Host records launch, then dispatches fresh workers using RUN/tasks/A.json, B.json, ...
node scripts/repository-engine.mjs launch RUN A HOST_HANDLE
# Workers use: broker RUN A list|read|search ...
# Workers save their first complete raw JSON once to the task's output path.
# After the host observes that the worker has completed:
node scripts/repository-engine.mjs terminal RUN A HOST_HANDLE completed
node scripts/repository-engine.mjs checkpoint RUN A
# Repeat checkpoint for each assignment, without rerunning completed work.
node scripts/repository-engine.mjs integrate RUN
# Host dispatches RUN/tasks/R.json and records its actual handle.
node scripts/repository-engine.mjs launch RUN R HOST_HANDLE
# After the host observes completion:
node scripts/repository-engine.mjs terminal RUN R HOST_HANDLE completed
node scripts/repository-engine.mjs checkpoint RUN R
node scripts/repository-engine.mjs publish RUN
```

Broker argument order is explicit: `broker RUN AGENT read PATH START_LINE LINE_COUNT`
(the final number is a count, **not an end line**),
`broker RUN AGENT search PATH_PREFIX LITERAL`,
`broker RUN AGENT list PREFIX OFFSET`, history-plane
`broker RUN AGENT commit-meta SHA`,
`broker RUN AGENT diff SHA [PATH] [MAX_LINES] [MAX_BYTES]`,
`broker RUN AGENT path-history PATH [LIMIT] [SKIP]`, and for integration only
`broker RUN R receipt RECEIPT_ID` (loads a cataloged store receipt without consuming fresh
read/search/history budgets). Omitted read range arguments default to line 1 and 120 lines; list
defaults to the worker's assignment and offset 0. An explicit list prefix can navigate across
assignments. Search locations alone do not support claims. History ops may only target commits
that are ancestors of (or equal to) the run's pinned revision.

The host must observe a terminal state before recording
`terminal RUN AGENT HOST_HANDLE completed|interrupted|failed`. A saved handle is not proof
that a process is live or dead. On interruption, inspect status and resume the original job
with remaining receipts/budget; do not automatically start over. Invalid raw output is kept
and blocks automatic semantic retry. Status reads never recreate missing files. Explicit
preparation may reconstruct missing deterministic setup files but rejects conflicting bytes.
Writes are create-only, not crash-atomic; abandoned locks require a real process check.

Host-facing `status` (and the `statusEngine` helper) returns assignment state metadata only:
agent, state, handle, and schema validation issues. It deliberately omits proposal/result
semantic bodies (`jobs[].value`), output paths, and receipt pins so a status/list view cannot
leak other agents' completed task summaries into a blind discovery worker context. Privileged
`inspectEngine` still loads full saved outputs for checkpoint/integrate/publish; hosts must
not paste that privileged inspect into worker context.

Run plans pin the workflow's source-file bytes as well as their inputs. The stable entry point
selects the runtime from an existing run's declared version; new directories use
`repository-engine/2`. Version 1's six exact source files are retained, unmodified, under
`scripts/versions/repository-engine-v1/`. Version 2 lives in `scripts/repository-engine-v2.mjs`
and pins itself, the dispatcher and its source dependencies. Unknown versions or mismatched
pins fail closed. Existing directories are never migrated automatically; upgrading means
preparing a new directory against the same previous output, which is independently rebound
to its pinned source tree. The archive is for original-version replay/recovery, not a second
experiment-specific inference method. Changes to any pinned version require another explicit
version and preservation policy; this is not arbitrary historical-version compatibility.

The metadata adapter accepts worktrees, linked worktrees and bare repositories, pins a real
commit, and excludes unsafe/sensitive/instruction paths, generated/dependency directories,
non-regular entries, oversized blobs and unsupported extensions. It does not execute target
code or fetch missing objects. Source retrieval validates path/blob membership against that
tree, checks blob digests, enforces line and byte caps, and screens complete blobs before
reads or searches. Receipt verification reconstructs search locations as well as source
bytes and metadata. Path/content screening is conservative and heuristic, not a guarantee
that all secrets or adversarial instructions have been excluded. Worker access discipline
outside the broker remains instruction-enforced.

Baseline history is retained verbatim in `history/baseline-output.json`, withheld from blind
discovery. Integration receives an explicit candidate-field projection and source-only
receipt aliases, not embedded prior review labels. Source aliases bind exact path, commit,
blob, range and bytes. Fresh model graph fields reject independent-verification labels.
The consolidated validator checks malformed values, citation membership, acyclic multi-parent
containment, exact retention and actual revision, distinct split successors, shared explicit
merge predecessors, removal cardinality and every original relationship disposition. These
checks establish accounting, **not semantic correctness**. Source-based comparison decisions
remain model-authored and revisable. Compound split-and-merge transactions require separate
versions under this contract.

`output.json` and `index.html` contain the complete candidate map, definitions, relationships,
evidence, integration decisions, retained/changed/removed inputs and coverage limits. All
independent verification starts as `not-performed`; earlier review histories are preserved
but are not yet automatically projected onto new generic runs. The full discovery–expansion
workflow is tested with synthetic local Git repositories and has completed a host-assisted
VS Code delivery run through the same unchanged entry point, including controlled stop/resume,
expansion and exact report replay. This establishes working delivery mechanics, not
exhaustive discovery, usefulness or unattended reliability on an unfamiliar real repository.
The live run's outputs, interventions and remaining review gaps are recorded in
[the experiment summary](EXPERIMENT-SUMMARY.md#live-delivery-check-not-another-method-comparison).

Claim-local notes use the reusable companion `scripts/review-repository-map.mjs`:
`node scripts/review-repository-map.mjs RUN NOTES.json`. The note packet binds the exact
serialized graph hash, node, field (`summary`, `conditions`, or individual claim text),
optional index and expected old text. It records `qualified`, `disputed` or `unresolved`
assertions with an explicit basis (`proposer-disclosed`, `source-review` or `owner-feedback`)
and source IDs. It creates separate `reviewed-output.json` and `reviewed.html`, attaching
notes to the affected capability without changing its candidate graph or granting independent
verification. Stale targets and conflicting companion files fail closed. This is a mechanical
presentation layer, not an automatic audit, correction, or cross-version review migration.


### Three planes: Store / Decision session / History

The consolidated engine currently couples three concerns that must separate for milestone
success:

1. **Store (unbounded growth OK)** — immutable receipt files, graph checkpoints, and indexes
   by path / node / claim / revision. Partly exists today as `receipts/{agent}/*.json` and
   related run artifacts. Publish keeps the **full candidate map** available offline.
2. **Decision session (bounded)** — discovery, integration, and later history workers retrieve
   *only* what the current decision needs via brokered inspect / search / request-depth, with
   **explicit omissions** recorded. The model never needs the full corpus in one prompt.
3. **History plane (milestone work)** — commit metadata, bounded diffs, path history, prior
   maps across revisions, and cached per-commit readings. Snapshot protocol and runners must
   state remaining gaps honestly; they must not redefine milestone success as snapshot-only.

Version 2 `integrate` freezes a **decision-scoped** packet: baseline graph, proposals,
a `receiptCatalog` of store ids/fingerprints, and explicit `omissions`. Full receipt bodies
remain in Store (`receipts/{agent}/*.json` and projected baseline) and are loaded on demand
with `broker RUN R receipt <id>`; fresh inspection still uses `list|read|search` under
integration budgets. Raising the run packet ceiling is not the scaling strategy.

History-plane broker ops now available on version 2 (ancestors of the pinned revision only,
bounded payloads, explicit omissions, immutable receipts):

- `broker RUN AGENT commit-meta SHA`
- `broker RUN AGENT diff SHA [PATH] [MAX_LINES] [MAX_BYTES]`
- `broker RUN AGENT path-history PATH [LIMIT] [SKIP]`

Honest gaps still open: prior-map lookup across engine outputs, and brokered access to cached
per-commit model readings from `analyze-commits`. Contributor fields on `commit-meta` are
observed Git metadata only—not ranking or performance judgment input.

#### Coverage routing

Coverage-led runs may first call `node scripts/plan-repository-coverage.mjs RUN`. This
host-side supplement uses the verified full inventory and cumulative baseline receipts to
freeze metadata-only directory regions and per-worker unread file lists. Its pure helper
splits oversized directory groups (default 200 files, maximum directory depth six), preserves
direct sibling groups, and prioritizes untouched regions subject to top-level subtree
diversity. Region depth is a retrieval parameter, not a semantic graph-depth restriction.
Oversized indivisible regions and remaining unread counts stay explicit.

`coverage-routing.json` pins the engine run plan, candidate baseline projection and coverage
planner source bytes. `coverage-tasks/` supplies additional host-authorized navigation inputs;
the original engine tasks and semantic protocol remain unchanged. The supplement must be
created before discovery starts; exact replay can restore missing companions but refuses
changed files. Workers may follow cross-region evidence using the ordinary broker. Routing
is instruction-enforced, not a broker access restriction or a claim of region completeness.
These regions are not capability categories, and file/line counts are not semantic coverage.

The larger demonstration exposed a separate integration packaging limit in version 1:
baseline source receipts appeared inside both `baseline.receipts` and top-level `receipts`.
Version 2 first gave integration `baseline: { graph, receiptIds }` against a single receipts
collection, then replaced inlined receipt bodies with a decision-scoped `receiptCatalog` plus
brokered `receipt` fetch and explicit omissions. Exact receipt identity, content, source
provenance, candidate definitions, semantic protocol and fresh-retrieval budgets remain
unchanged; only packaging and access path changed. Historical baseline files remain complete
and withheld from discovery. Packet validation recomputes the complete expected bytes,
including the catalog fingerprints, so removed or changed store evidence fails closed.

Publish still materializes the full candidate map and complete receipt set offline. Decision
sessions stay bounded by catalog + on-demand fetch rather than by raising the former 1.5MB
accumulate-and-feed-all ceiling. History-plane broker ops for commit meta, bounded diffs, and
path history are available on this split; prior-map lookup across engine outputs remains open
milestone work.

### Review history survives graph changes without transferring approval

Historical source reviews now have a separate post-discovery projection in
`scripts/snapshot-review-history.mjs` and `scripts/lib/review-continuity.mjs`. It verifies the
exact reviewed graph, regenerates the prior review sidecar from its frozen packets/reviews,
and checks explicit node lineage and byte-equivalent source-receipt aliases. It never guesses
identity from a name or strips all namespace prefixes. Definition/claim content matching and
changes to incident relationships are reported separately. A matched earlier assertion is
still only an earlier review, not approval of the current graph context.

Removed nodes retain archived findings; split or merged successors keep their predecessor
histories with explicit correspondence warnings. Changed wording does not automatically resolve
an earlier qualification. This layer creates a separate review-aware report after inference;
it leaves frozen candidate outputs, discovery inputs and model decisions unchanged. The current
adapter joins one verified wording-recheck sidecar to its immediate snapshot expansion, not an
arbitrary multi-version review database or semantic review-transfer policy.

## Initial stack

| Layer | Choice | Why now |
| --- | --- | --- |
| History access | Installed Git CLI | Git itself handles revisions, merges, renames, and worktrees; no second object-model implementation is introduced. |
| Analyzer | Node.js ES modules | Shares the web project's runtime, needs no analyzer dependency, and is sufficient for the pilot repository. |
| Data contract | Versioned JSON | Portable, inspectable, diffable, and easy to fixture or validate. |
| Interface | React + TypeScript | Strong fit for filters, selection, evidence panels, and coordinated views. |
| Build tool | Vite | Small static-app setup with fast development and a straightforward production build. |
| Visualization | React + D3 time scales | React renders the chronology, matrix, and scoped neighborhood; D3 supplies stable temporal placement without owning the DOM. |
| Tests | Node's built-in test runner | Covers the dependency-free analyzer without introducing a second test framework yet. |

Node.js 22.12 or newer is the working baseline. The initial app is static and
local-first; it has no server, account system, or database.

## Runtime boundaries

### Analyzer

The analyzer accepts an explicit repository path, invokes Git without a shell,
and emits deterministic JSON. Its first version records:

- commits as raw change episodes;
- author identities as Git associations;
- parent relationships and timestamps;
- changed paths and rename/copy metadata;
- top-level directories as provisional code areas.
- candidate same-commit repository reorganizations backed by concentrated path
  transitions.

It does not infer features, lifecycle stages, intent, ownership, or quality.
Structural candidates are deterministic, separately labeled interpretations;
the underlying add/delete/rename records remain unchanged.

### Interpretation

Interpretation is a separate optional stage. Its first model pass proposes
feature candidates; its second pass reviews the same complete subject/path
corpus for semantic lifecycle episodes tied to those features. Validation
resolves every proposed feature id and commit SHA before a claim reaches the
dataset. A feature has no permanent lifecycle label: introduced, expanded,
hardened, migrated, and removed belong to individual candidate episodes.
Feature candidates can be reused while calibrating the lifecycle pass, and
deterministic boundary validation can be rerun without a model request.

This two-pass whole-corpus interpreter is the first implementation, not the target decision
architecture. Per-commit reading plus blind capability induction now tests the replacement:
cache local semantic evidence by commit, then let a global decision session infer an
evidence-linked hierarchy without a supplied taxonomy. See
[Blind capability induction](CAPABILITY-INDUCTION.md).

The current corpus contains commit subjects and at most twelve touched paths
per commit, not patch contents. This is sufficient for a first candidate pass,
not confirmation. Deterministic analysis remains fully usable without a model,
and model output never alters observed Git records.

### Epoch detection

Epoch detection is a second optional stage, independent of interpretation. It divides the
history into periods during which the work was about roughly the same thing, so that later
analysis can proceed period by period instead of needing the whole corpus in one request.

It runs two passes that never see each other. A model reads raw commit windows and marks
where the work changed character; two deterministic detectors measure where the
distribution of touched paths, and of commit-subject vocabulary, shifts. Showing the model
the detectors' output would let it only ratify or rank within a hypothesis space already
fixed for it, which measures agreement rather than reading.

Because the two passes locate the same transition at slightly different moments, a
boundary is stored as the interval spanning both readings rather than as one commit, and
the commits inside that interval belong to no period. Hierarchy depth is derived from the
history rather than fixed: a small repository gets no periods at all, a mid-sized one gets
epochs, and only a history with too many periods to describe together gets a level above
them. Periods are named by a further pass, lowest level first, with each coarse period
named from its children's labels rather than from raw commits.

Its output is a separate document, not a field inside the atlas dataset. The atlas needs no
credential and epoch detection does, so a viewer that opens a repository without one keeps
working. See [Epochs](EPOCHS.md).

### Viewer

The browser loads `public/atlas.json` and derives a repository overview, a
directory lifespan chart with checkpoint drill-down, a searchable feature index,
and selected-feature lifecycle ribbons. Both repository views replay serialized
add, delete, copy, and rename operations in commit order: the lifespan chart
samples each directory's observed file count across the range, and the
checkpoint panel reconstructs one directory snapshot and the change summary for
its interval. Both are scoped by the same selected path, and neither reads the
repository directly or adds inferred state to the JSON contract. React owns selection and filtering; D3 supplies the time scale used
to place observed commit dates. For older local datasets, the same deterministic
structural detector runs over already serialized path changes in the browser.
Older feature-level lifecycle claims are shown only as explicit compatibility
projections until the interpretation is regenerated.

The global force-directed graph is intentionally absent from the primary
experience. Relationship browsing is limited to a deterministic neighborhood
around the selected feature. This preserves spatial meaning and avoids turning
the repository into an unstable node-link hairball.

## Why not yet

- **No database:** one pilot dataset is small enough for JSON. Add SQLite only
  when incremental analysis or query latency establishes the need.
- **No web backend:** local file generation plus a static viewer gives the
  shortest evidence-to-interface loop. Identity decisions use repository-scoped
  browser storage plus explicit JSON import/export until a local service is
  justified.
- **No graph database:** the graph is a domain model, not a requirement to adopt
  graph storage.
- **No generic graph UI library:** the product needs stable chronology and
  comparison more than a universal relationship canvas. D3 remains useful for
  scales without owning the rendered DOM.
- **No required model API:** observed and deterministic structural history works
  without credentials. Optional feature and lifecycle interpretation, and optional
  epoch detection, remain reviewable layers rather than prerequisites.
- **No epoch storage inside the dataset:** periods are a separate document keyed to a
  head commit. Folding them into the atlas would make a credential-requiring stage part
  of the credential-free contract.

## Expected pressure points

- Per-commit Git calls favor clarity over throughput and will need batching for
  large repositories.
- The pilot's one-request capability induction needs roughly 58,000 input tokens for 605
  readings. Larger repositories require evidence retrieval and multi-resolution summaries;
  naive batching would recreate the fragmentation the hierarchy is meant to solve.
- Candidate ids produced from one response's list positions are not durable identities.
  Cross-run reconciliation must establish identity from evidence and lineage before an
  induced map can be updated incrementally.
- First-parent merge diffs are a provisional representation, not the only valid
  view of merge effects.
- Top-level directories are only code-area candidates.
- Structural detection currently groups only changes inside one commit. Git
  rename evidence is strongest; delete/add pairs require repeated matching path
  suffixes and receive lower confidence. Cross-commit moves and content-based
  pairing remain future work.
- Lifecycle discovery currently sees subjects and bounded path lists rather than
  diffs. Hardened and migrated candidates require pilot review, and a future
  repository adapter may add bounded patch evidence where subjects are weak.
- SVG should remain comfortable for the pilot; Canvas or WebGL becomes relevant
  if visible node and edge counts make interaction sluggish.
- Epoch boundaries are not reproducible. The proposal pass is a model request, so a
  second run moves the boundaries, and nothing yet measures by how much. Saving proposals
  pins a run; it does not make the pass stable.
- Period size limits are calibrated on one repository. The 250-commit and 120-day caps
  came from comparing periods a labeling model would name against ones it refused, and
  both numbers should be re-derived on a second subject.
- Commits are analyzed in topological order, which is not date order — 6.8% of adjacent
  pairs in the pilot move backwards in time. Period spans are computed as true minima and
  maxima for that reason, but index-based windows still interleave parallel branches.
- Identity consolidation now preserves raw identities beneath reversible
  profiles and handles names, email-handle comparisons, GitHub noreply
  metadata, `.mailmap`, bot boundaries, and human decisions. Co-author trailers,
  pair work, squash merges, signed identities, and host-account verification
  remain future evidence sources.

## Privacy posture

Generated atlas files can contain repository history and contributor names, and epoch
documents quote commit subjects and dates. `public/atlas.json` and `public/epochs.json`
are ignored by default, and gallery builds strip both from `dist/`. A sanitized, explicitly approved
fixture should be used for screenshots, demos, or publication.
