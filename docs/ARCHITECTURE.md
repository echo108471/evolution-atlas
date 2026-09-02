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
- **deterministic code governs the decision** by resolving citations, rejecting unsupported
  claims, preserving observed facts, recording provenance, and measuring recurrence;
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

Stable candidate identity belongs to reconciliation, not to the model's label. A renamed
candidate should retain lineage; a split or merge should cite its predecessors. User edits
remain useful review evidence, but the system must be able to run without them and they
must not be smuggled into later blind evaluations.

### Current two-layer boundary

Capability induction currently permits one umbrella layer and one optional child layer.
That keeps the first stability experiment interpretable. The serialized shape is recursive
so a later decision session may propose broader umbrellas or deeper children without a
schema migration. The viewer can continue projecting two levels even if the underlying
candidate graph later becomes deeper.

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
