# Iterative capability graph experiment

For the readable cross-experiment synthesis, see [Experiment summary and lessons](EXPERIMENT-SUMMARY.md).

The September 6 experiment replaces a fixed semantic depth with a bounded investigation
loop: choose evidence, inspect it, revise a candidate graph, and investigate again. It is
an experimental successor to [two-level induction](CAPABILITY-INDUCTION.md), not a new
canonical map or a viewer integration.

## What the model controls

The model may create broader parents, split or merge existing nodes, rename them while
preserving identity, remove unsupported nodes, and reparent children. Containment can have
multiple parents and uneven depth. Dependency is a separate directed relationship, not an
implicit parent. The first relationship vocabulary is `contains` and `depends_on`; this
does not claim to enumerate every relationship in software.

There is no capability count, maximum semantic depth, or maximum share of the repository
that a capability can cover. Round and retrieval budgets constrain work, not meaning.
An additional parent must explain a shared outcome; another round does not require another
layer. Earlier interpretations remain open to revision from above and below.

## Evidence and state boundaries

The seed is the 29 leaves of an earlier blind induction, alphabetically reidentified with
the old parent labels and positional IDs removed. This tests growth and revision from
existing local interpretations. It does **not** independently rediscover those leaves
from raw source, and their original grouping and summaries may still bias the result.

Each round has three steps:

1. A planner sees the current graph, a catalog of all 605 cached reading subjects, and safe
   paths at the pinned head. It requests readings, text searches, and exact source windows.
2. A deterministic broker retrieves up to 12 readings and six source windows, within
   24,000 serialized evidence bytes. Source gets reserved capacity. Search matches cached
   reading text and paths; newly found paths can be requested in the next round.
3. A decision model sees the graph and retrieved evidence, without planner prose. It
   produces an atomic patch with citations, reviewed-node IDs, uncertainty, and a local
   continuation decision. A bounded correction call is allowed after validation rejection.

Source inspection uses immutable Git blobs at the seed's head or a cached reading's
historical revision. A source citation includes commit SHA, blob SHA, path, line interval,
and truncation. Windows are at most 79 lines and 5,000 text bytes; blobs above 1 MiB are
omitted. Sensitive paths, symlinks, and binary content are excluded. No working-tree file
contents are sent. Source content is recorded as observed; summaries and graph claims are
candidate interpretations.

The parser rejects unknown citations, duplicate IDs/relationships, dangling endpoints,
self-edges, and containment cycles. Dependencies require a retrieved source citation.
Those checks establish reference integrity, **not semantic correctness**: a source file
can be cited without proving the particular relationship. New claims can cite only the
current round's retrieved evidence. Unmodified seed claims retain their original provenance.

Every round saves its requests, raw provider responses, retrieval results, rejected
attempts, patch, and resulting snapshot. The seed is untouched. Exact-request fingerprints
protect resume/replay; existing artifacts cannot be overwritten with different content.
The final artifact carries the full reading registry and explicit unreviewed node IDs.
Generated artifacts must live in ignored local paths.

## Investigation agenda

`local-v1` let a local decision stop the entire loop. It stayed in one neighborhood and
stopped after reconfirming the same source. `agenda-v2` additionally exposes previously
reviewed nodes, unreviewed nodes, and prior investigation questions. The planner can compare
roots, challenge a relationship, or move to an unreviewed area. A local stop does not stop
the session while unreviewed nodes and a round budget remain.

The agenda does not force coverage within a small budget or force a deeper graph. A
budget stop leaves outstanding work explicit. A reviewed ID is the model's accounting
statement, not an independent finding that its boundary is correct.

`full-v3` adds a coverage queue of up to four unreviewed nodes per round, including newly
created nodes. Queue membership is not a grouping suggestion. The broker reserves one
available cached reading per queued node before the remaining model-ranked requests.
The model must account for each queued node, including explicit deferral where evidence
is insufficient. Once coverage is complete, two whole-map reconciliation rounds investigate
broader parents and redundant or misplaced relationships. Newly added nodes still require
coverage before completion. A 24-round ceiling bounds this full run; it is not a depth target.

The current evaluation is Eugene's yes/no judgment of the frozen output, as requested.
The local review report exposes every node and edge with separate unrated ballots, notes,
evidence links, and a JSON export pinned to the graph fingerprint. These judgments are not
inputs to this discovery run. Full coverage means the queue was accounted for, not that
every claim was confirmed in source or that all 605 reading texts were reread.

## Running and replaying

```bash
npm run discover-capability-graph -- \
  --seed public/capabilities.cr.induced.clean-1.json \
  --repo ../course-recommender \
  --out public/capabilities.cr.graph-agenda-1.json \
  --planner-model google/gemini-2.5-flash-lite --rounds 3

npm run discover-capability-graph -- \
  --seed public/capabilities.cr.induced.clean-1.json \
  --repo ../course-recommender \
  --out public/capabilities.cr.graph-agenda-1-replay.json \
  --planner-model google/gemini-2.5-flash-lite --rounds 3 \
  --replay-from public/capabilities.cr.graph-agenda-1.json
```

Use `--dry-run` for request-size preflight. The default decision model is the existing
Grok configuration. Replaying the original condition requires `--protocol local-v1`.
No automatic transport retries occur; a successful raw response is persisted before parsing.

For the full condition and its human-review output:

```bash
npm run discover-capability-graph -- \
  --seed public/capabilities.cr.induced.clean-1.json \
  --repo ../course-recommender --out public/capabilities.cr.graph-full-1.json \
  --planner-model google/gemini-2.5-flash-lite \
  --protocol full-v3 --rounds 24 --max-prompt-chars 160000

node scripts/render-capability-graph-review.mjs \
  --in public/capabilities.cr.graph-full-1.json \
  --out public/graph-reviews/full-1
```

An incomplete or malformed provider response now permits one saved recovery request with
a shorter-output instruction. This is separate from the one structural correction attempt.
The original failure, its cost, and the recovery are retained. The full condition exercises
this path when the cheap planner repeats search terms until exhausting its completion cap.

## September 6 pilot results

Both conditions used the same 29 seed leaves, 605 cached readings, and 524 permitted paths
at `course-recommender` head `ba900d8f`. The planner was Gemini 2.5 Flash Lite; the decision
model was Grok 4.6 with low reasoning. No owner categories or expected parent names were
supplied. The agenda condition was developed after observing the local condition; this is
one exploratory run per condition, not a controlled repeatability comparison.

| Measurement | Local loop | Agenda loop |
| --- | ---: | ---: |
| Completed rounds / budget | 2 / 3 | 3 / 3 |
| Final nodes | 30 | 31 |
| Maximum containment depth | 2 | 3 |
| Containment edges | 2 | 6 |
| Dependency edges | 0 | 3 |
| Paid cost, including correction calls | $0.0991 | $0.1175 |

The local loop split the old embeddings/derived-metrics node into catalog embeddings and
precomputed ratings/tags, showing downward revision. It then reconfirmed the same source
neighborhood and stopped with other areas unreviewed. One correction caught copied but
unretrieved citations. Another exposed a validator bug: carrying an existing split lineage
into a later revision was rejected as an attempt to retire its predecessor again. The
validator now preserves that lineage; saved responses were revalidated without another
provider call. The original paid artifact is retained separately from the corrected replay.

The agenda loop introduced a browsing parent, then nested existing review browsing under
professor pages in the third round:

```text
Browse courses and professors
├── Catalog, professor, and search services
├── Course list and detail views
├── Search, filtering, and sorting
└── Professor search and profile pages
    └── Review browsing
```

This structure was model-proposed, not supplied as an example or depth target. The three
dependencies were catalog services → API contracts, ETL orchestration → source collection,
and professor pages → API contracts. All patches passed structural validation without a
correction call in this condition. There were 34 distinct retrieved readings and 16 source
windows across the three rounds. Nineteen final nodes were never explicitly reviewed.
The first agenda plan greatly exceeded its request allowance; the broker still delivered
only 12 readings and six source windows. Complete requests do not imply complete evidence.

Source spot-checks support a narrower observation behind the third layer: professor service
code collects RMP and Cattlelog reviews into per-course payloads, and the professor-detail
schema contains those review lists. This supports the proposed connection, but does not
independently prove the entire user-facing browsing boundary. The ETL dependency is weaker:
cited loader code consumes transformed rows, but these windows do not trace the complete
producer-to-consumer execution path. The new ingest umbrella contains only source collection
while its description also includes loading, so its novelty and membership need review.

The combined paid cost was $0.2166. The agenda artifact replayed byte-for-byte with no new
inference. Synthetic tests exercised growth to five levels, multiple parents, downward
revision, cycle rejection, lineage preservation, citation failures, and immutable historical
source retrieval. These checks establish mechanism behavior, not semantic accuracy.

## September 6 full-run results

The `full-v3` run completed seven coverage rounds and two whole-map reconciliation rounds
against the same seed and pinned repository. All 30 final nodes were accounted for, with
no remaining queue entries. It retained the 29 starting capabilities, revised some
descriptions, and added **Automated dependency updates**. It produced seven dependency
edges and **no containment edges**: maximum containment depth was one.

This is substantially flatter than the agenda pilot. The output is preserved as generated;
the experiment does not establish that the repository lacks useful umbrellas or that the
model will discover them reliably. Coverage accounting includes deferrals and reading-only
judgments, and must not be reported as verification of every capability boundary.

Total paid cost was **$0.2957457**, including three truncated-planner recovery calls and
one structural correction. All nine rounds replayed byte-for-byte without new inference.
The full project suite passed 231 tests and the production build passed. These are
implementation checks, not a semantic accuracy score; human judgments remain unrated.

The ignored local report at `public/graph-reviews/full-1/index.html` contains all 30 nodes,
seven relationships, exact descriptions and rationales, referenced evidence, and every
round's patch. Its companion `review.md` and `output.json` preserve readable and structured
copies. Each node and relationship has a yes/no ballot with an optional note; exported
judgments are pinned to this frozen graph and remain separate from discovery input.

## Alternative comparison and historical evidence

The follow-up `alternatives-history-v1` condition compares proposals without modifying the
frozen full-run graph. Eugene's supplied judgments are saved separately in the ignored
full-run review directory: 28 accepted nodes, two unrated nodes, and seven accepted edges.
Neither those verdicts nor their notes are loaded by the comparison runner.

Four targeted cases use the annotated node IDs only. Two other IDs are selected by sorting
SHA256(node ID), excluding the annotated IDs. They are called **blind-selection** cases,
not a held-out repository: the existing map, prompts, and earlier investigations still
carry repository knowledge. Each case starts independently from the same frozen graph;
no prior case's answer or cohort label is included in its prompts.

Each case uses three stages:

1. Select cached readings to challenge the focus boundary and relevant neighboring nodes.
2. Inspect a historical path index, then select up to six source windows. The index exposes
   changed paths present at selected commits and their first parents, including deleted
   implementations absent from the pinned head. It caps each revision at 70 candidate paths
   and records omissions. First-parent inspection is explicit and opt-in; it does not trace
   all merge parents, rename lineage, or the complete history.
3. Compare two to four alternatives, choose one, and name its strongest rival. Alternatives
   can retain separate nodes, propose an umbrella or split, identify a dependency, describe
   implementation history, or remain uncertain. Exact proposed members/relations are prose
   at this milestone, not automatically applied graph edges.

A selected dependency needs retrieved source. Selected implementation history needs source
at two distinct revisions, but this only establishes reference coverage, not replacement
order or semantic continuity. No stage requires a new layer. Calls and raw responses are
persisted before validation, with at most one repair per stage and exact-request replay.
Retrieval remains bounded to 12 readings, six source windows, and 24,000 serialized bytes
per case. The report displays the chosen interpretation, alternatives, weaknesses,
unresolved questions, and exact retrieved evidence; no new judgments are prefilled.

```bash
node scripts/compare-capability-alternatives.mjs \
  --in public/capabilities.cr.graph-full-1.json \
  --repo ../course-recommender --out public/graph-reviews/alternatives-1 \
  --annotated N3,N4,N8,N25
node scripts/render-capability-alternatives.mjs \
  public/graph-reviews/alternatives-1/output.json
```

Repeat with a new ignored output directory and `--replay-from` pointing to the original
directory to verify without new inference. This is a bounded diagnostic experiment,
not evidence that arbitrary-depth discovery generalizes or improves on the earlier method.

### Six-case result

The saved run completed all six cases for **$0.2271735**, including one format/schema
repair for a missing `support` field. Five choices retained the current boundaries; N8
proposed splitting friend-schedule comparison from the course-grid comparison tool.
Neither a new umbrella nor implementation history was selected. All choices remain
unrated proposals; the accepted baseline was not patched.

| Case | Cohort | Chosen interpretation | Strongest rival |
| --- | --- | --- | --- |
| N3: Branding/navigation/layout | Targeted | Keep shared app frame distinct | Landing/about depends on frame |
| N4: Caching/compressed delivery | Targeted | Keep backend delivery distinct from frontend loading | Split compression from TTL/invalidation |
| N8: Course/schedule comparison | Targeted | Split friend-schedule and course-grid tools | Keep one comparison capability |
| N25: Search/filter/sort | Targeted | Keep home-list filtering distinct | Depend on search services |
| N9: Course list/detail views | Blind-selection | Keep coupled list/detail UI | Split list rows from detail pane |
| N20: Review browsing | Blind-selection | Keep review display distinct | Fold into professor profiles |

The run exposes limitations rather than establishing a grouping improvement:

- The caching planner requested 12 source windows despite the six-window instruction.
  A large Neptune dataset was rejected by the existing 1 MiB cap; the later requested
  Neptune implementation window was omitted after the source budget was consumed.
  The selected answer explicitly lacks current TTL/invalidation source. Historical
  retrieval is now available, but availability did not ensure decisive evidence selection.
- Several model alternatives confuse a non-destructive parent with merging away children.
  For example, the N20 umbrella alternative says review browsing would cease to be a
  separate node. That does not test retaining N20 as a child of N19.
- A dependency can coexist with keeping two nodes distinct. Treating these as mutually
  competing choices (N3 and N25) is a weakness of this comparison framing.
- The N8 split cites different pages/data models but acknowledges they may serve one
  comparison outcome. This is a proposal to review, not evidence that finer is better.

The next protocol should compare explicit membership changes separately from optional
dependency and historical links, and reserve evidence capacity for the revisions needed
to distinguish the leading alternatives. These changes were not retrofitted into this run.

## Explicit structures and broad human review

`structures-v2` keeps the same six case IDs and frozen baseline, but represents each
structural alternative with explicit new nodes, retired nodes/edges, and parent-to-child
containment links. Each alternative is validated against a separate candidate snapshot.
An umbrella may use an existing parent or add one, but cannot delete any existing child.
Splits and merges must identify their replacements. Cycle, dangling-edge, and citation
checks remain structural safeguards, not semantic acceptance.

Dependencies and `implemented_by` observations are proposed separately from the structural
choice. A capability can remain distinct, belong to a parent, and depend on another node.
Implementation links record only source-supported existence at specified revisions;
they cannot claim an exclusive era or replacement order. They are not automatically
applied to the baseline graph or combined across independently generated cases.

The broker protects two current and two historical source slots, then fills up to six
total windows from remaining ranked requests. Known current source anchors on the focus
node are available as fallbacks. Current paths that are missing or wrong do not count as
retrieved evidence. Reading text receives at most 9,000 serialized bytes and each source
window at most 1,800 text bytes, with a 24,000-byte overall ceiling. This trades excerpt
depth for coverage across periods; it does not guarantee the right historical mechanism
was selected. Omissions and absent-period gaps are preserved.

A fourth, separate model call audits the selected structure and optional links against
the same retrieved evidence, reporting supported, partial, or unsupported with concrete
issues. It is not independent ground truth and cannot compensate for missing source.
The user-facing report leads with the proposed arrangement and brief model checks;
alternatives and evidence are optional details. Eugene's feedback is broad plausibility,
not a requirement to approve individual citations or supply a target taxonomy.

Run the same comparison command with a new ignored output directory and
`--protocol structures-v2`. Each of four stages permits at most one saved repair request.
Replay requires the same protocol and arguments.

The initial six-case run cost $0.3370388 including one structural repair. Inspection
found that three source plans used uppercase `HEAD`, which the broker rejected even
though the requested paths existed. `structures-v2.1` normalizes that spelling to the
same pinned-head token; it never resolves the working checkout's moving HEAD. The raw
original plans and completed run are preserved. `--reuse-from` reuses only exact-matching
saved requests, copies their receipts into the corrected run, and records reused versus
new inference costs. Only comparisons and audits whose evidence changes need new calls.

The corrected six-case output kept all six structural boundaries and proposed three
dependency plus seven implementation-at-revision links. N8 now retains course/schedule
comparison as one capability with separately named CookedClass and Comparison-grid
implementations, instead of the split chosen by `alternatives-history-v1`. No containment
change was selected. This is one exploratory condition, not a stability or quality score.

The alias correction reused 19 stage responses and purchased seven new calls, including
one repair for a dependency lacking source citations. Incremental correction cost was
$0.174726; the original run plus correction cost **$0.5117648**. The corrected condition's
accounted request cost is $0.3806408 because it includes reused responses but excludes
superseded decisions from the original run. Current source reached four of six cases;
N8 and N20 still had only historical windows. All six had historical source.

The model audits returned five partial and one supported verdict. The N9 supported verdict
is suspect: its own explanation says retrieved evidence concerns professor insights, not
course list/detail, then treats absence of contrary evidence as support for keeping N9.
That is a relevance/abstention failure, not verified coverage. The audits remain advisory;
the next retrieval loop should follow gaps and test relevance before claiming support.
Human feedback remains broad plausibility rather than adjudication of individual sources.

## Whole-project and data-lifecycle coverage

The whole-project condition starts from the frozen 30-node full-run graph, not the six
case reports. All existing nodes enter a coverage queue; new nodes also require accounting.
The first investigation prioritizes source collection, ETL, embeddings, identity/schema,
backend catalog services, delivery/cache, and frontend catalog loading. This is an explicit
coverage priority requested by Eugene, not a target group or supplied taxonomy. The run
then covers the remaining nodes and requires two combined-map reconciliation rounds,
within a 14-round safety budget. A budget stop leaves unreviewed IDs explicit.

Each round selects readings, refines retrieval using pinned current/historical path indexes,
then produces a cited atomic patch against the combined candidate graph. Per-node model
assessments distinguish supported, partial, and unresolved; supported requires retrieved
source but still needs a semantic relevance judgment. Unrelated evidence is explicitly
not support for retaining a node. The broker allows 12 readings and eight source windows
within 46,000 serialized bytes, retaining the 79-line/5,000-byte per-window limits.

The preliminary `whole-project-v1` run exposed attention drift: the full graph's first
professor-insights node dominated retrieval even when data/ETL IDs were queued. Relevant
baseline source anchors were appended after other requests and could be starved. Its
partial artifacts are retained separately. `whole-project-v2` puts the queued node objects
first in planner context, reduces the remaining graph to a navigation catalog, prioritizes
known current anchors in the broker, and adds one bounded follow-up for weak priority-area
assessments after the first round. The decision model still sees the full combined graph.

The broad report displays the entire candidate map as expandable capabilities, with the
priority areas linked for navigation but not presented as an invented group. It asks only
for overall plausibility; individual ballots are omitted. Exact evidence and every patch
remain available in optional detail. Neither coverage nor a richer display establishes
semantic completeness or guarantees the model will propose an umbrella.

```bash
node scripts/discover-whole-project.mjs \
  --in public/capabilities.cr.graph-full-1.json \
  --repo ../course-recommender --out public/graph-reviews/whole-project-2 \
  --priority N28,N12,N11,N15,N6,N4,N5 --rounds 14 --protocol whole-project-v2
node scripts/render-capability-graph-review.mjs \
  --in public/graph-reviews/whole-project-2/output.json \
  --out public/graph-reviews/whole-project-2 --mode broad
```

The completed v2 pass took 13 rounds and $0.5511182, producing 42 nodes, 12 containment
links, and 11 dependencies. All 42 nodes were accounted for, including explicit deferrals;
this is not a claim that all 42 were supported. Two final reconciliation rounds made no
new containment proposals. The 30 starting roots remained roots, and maximum depth was
two: this condition demonstrated finer responsibilities, not higher-order umbrellas.

ETL initially received a supported assessment based on bookkeeping models alone. That
overstates support for the full orchestration capability. A bounded three-round extension
therefore investigated executable ETL code, not a user-supplied set of desired children:

```bash
node scripts/discover-whole-project.mjs \
  --in public/graph-reviews/whole-project-2/output.json \
  --repo ../course-recommender --out public/graph-reviews/whole-project-2-etl \
  --priority N12,N28,N11,N15 --rounds 3 --protocol whole-project-v2 \
  --source-prefix etl/src/cattlelog_etl
node scripts/render-capability-graph-review.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --out public/graph-reviews/whole-project-2-etl --mode broad
```

This extension preserves the full graph, inherited investigation history and request
receipts, revisits the priority scope even after prior coverage completion, and queues
newly discovered nodes before revisiting existing ones. It exposes the pinned source
subtree as navigation, prioritizes up to six model-requested windows in that subtree,
and asks the model to follow executable producers/consumers rather than reconfirm schema
citations. It does not supply a parent name, child membership, or target depth. Its final
round is a combined-map reconciliation; earlier reconciliation receipts remain historical,
not proof that every later addition has been reconciled.

The extension added warehouse derived-metric post-processing, ETL run/file audit recording,
catalog course loading, and Schedule Builder course loading under ETL, plus a required
review/professor-association rule under identity/schema. The final candidate has **47 nodes,
17 containment links and 11 dependencies**, still depth two and 30 roots. The last three
ETL children were proposed in the final round and remain explicitly pending a follow-up
pass. Bootstrap/quarterly-refresh entry points and current RMP collection remain evidence
gaps; no end-to-end loading lifecycle has been established.

The corrected pass plus extension accounts for $0.6858387 of inference, of which $0.1347205
was the extension. The interrupted preliminary v1 condition has 21 saved responses totaling
$0.2524178; a final interrupted request has no saved usage receipt. Total recorded cost
for this experiment is $0.9382565, not necessarily the final provider bill. Exact cached
replays of both completed conditions reproduce their output byte-for-byte without new
inference. Raw outputs and partial-run artifacts stay in ignored local storage.

Remaining mechanism problems are visible rather than solved: source plans can exceed the
requested eight windows, repeated known anchors compete with missing entry points, and
support assessments can be overbroad. One reconciliation replaced an edge explanation with
`...`, which passes structural validation but is not a usable rationale. Existing graph
labels can also anchor the model toward adding children instead of discovering broader
parents. No hand correction of the model graph conceals these issues. Follow-up evaluation
should test retrieval that prioritizes unresolved omissions and meaningful reconciliation,
not merely count additional nodes or require the owner to validate each citation.

## Matched-evidence umbrella anchoring experiment

`umbrella-ablation-v1` isolates the presence of starting containment links. Both
conditions receive the same 47 capability IDs, names, summaries, evidence IDs and
11 dependencies from the frozen whole-project ETL output. The linked condition
also sees the 17 existing containment links; the unlinked condition does not.
Both strip old rationale, origin and round metadata. The model receives neither
the condition label nor owner judgments. Names and descriptions remain potential
anchors: this is not de novo discovery or an ablation of all prior interpretation.

Evidence selection happens once before inference, independent of condition:
one directly cited source excerpt per node (prefer pinned head, otherwise history)
and one directly cited reading when available, deduplicated without shortening
the saved text. The resulting packet has 40 items, 87,915 serialized bytes, and
source excerpts for 39 of 47 capabilities. It is the same packet in every pass;
this tests formation under matched evidence, not adaptive retrieval or complete
coverage of all 605 cached readings. No fresh source request is made.

Two repeats use counterbalanced condition order. Each trajectory has a discovery
pass followed by a challenge/reconsideration pass. The same prompt invites broader
outcomes and allows abstention, existing-parent reuse, parents above parents and
multiple parents, with no target depth, count, or size. Seed nodes and dependencies
are held fixed for this preservation test; containment can change. New nodes must
be parents with at least two seed descendants. This intentionally restricts the
editing vocabulary to test upward organization, not the full discovery architecture.
It cannot establish that an unrestricted model spontaneously prefers umbrellas.

Each response is saved before validation, with exact request fingerprints and at
most one structural repair. A 190,000-character input preflight, 9,000-token output
cap and $1.50 recorded-cost stop before the next request bound the run. The cost
guard is not an absolute billing cap: a final in-flight request or a request with
no returned usage can incur additional cost. No accepted baseline is patched.

Structural measures include preserved seed details, original links retained or
recovered, depth, parents spanning at least two original roots, and label-independent
co-umbrella pair overlap. Compare within-condition variation with cross-condition
variation. Neither counts nor overlap score semantic quality; broad human plausibility
remains a held-out evaluation. Two repeats on one repository are diagnostic only.

```bash
node scripts/compare-umbrella-anchoring.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --out public/graph-reviews/umbrella-ablation-1
node scripts/render-umbrella-comparison.mjs \
  public/graph-reviews/umbrella-ablation-1/output.json \
  public/graph-reviews/whole-project-2-etl/output.json
```

Each nested output is renderable with `render-capability-graph-review.mjs --mode broad`.
Use the same input, a new ignored output directory and `--replay-from` pointing to
the saved run for a no-inference replay. Raw responses remain private local artifacts.

### Completed result and scoring correction

All four trajectories completed for **$0.610016** (nine responses, including one
repair). All 47 seed descriptions and all 11 dependencies were preserved. The
linked trajectories retained all 17 original containment links and reached depth
three; the unlinked trajectories recovered zero and two original links respectively
and remained depth two. No multiple-parent structure was proposed.

The initial descendant-only breadth metric missed an allowed operation: reusing
an existing root as an umbrella over another root. For example, N19 containing N20
should count as organizing their shared scope, even without adding a new parent.
The separate `analysis.json` therefore includes the parent itself when computing
scope membership. This is an explicit post-run scoring correction, not a change to
model output. Frozen `output.json` retains the original metric; its complete replay,
including the four nested outputs, is byte-identical. Tests cover both definitions.

| Condition | Final nodes | Depth | Broader scopes, root-inclusive | Original containment retained/recovered |
| --- | --- | --- | --- | --- |
| Linked, repeat 1 | 50 | 3 | 3 | 17/17 |
| Linked, repeat 2 | 49 | 3 | 2 | 17/17 |
| Unlinked, repeat 1 | 53 | 2 | 1 | 0/17 |
| Unlinked, repeat 2 | 51 | 2 | 1 | 2/17 |

All four relate professor pages and review browsing. Linked repeat 2 includes AI
professor insights in a broader instructor-evaluation outcome, retaining its three
implementation children beneath it. Its other parent combines catalog exploration
with course/schedule comparison. Linked repeat 1 instead groups grade access with
grade-distribution insight, and catalog loading with course-list/detail browsing.
Unlinked proposals mostly reconstruct existing narrower scopes under new names;
one explicitly acknowledges overlap with the retained AI-insights seed. That is
redundancy, not automatically useful discovery. The full reports preserve it.

Root-inclusive co-umbrella pair overlap is 3.7% between linked repeats, 100% between
unlinked repeats, and 6.3–8.3% across conditions. The unlinked 100% represents exactly
one pair (N19/N20), not stable organization of the whole project. The linked runs
disagree substantially about scope despite identical initial requests. This does not
support the hypothesis that removing containment links unlocks broader organization;
it does demonstrate possible upward composition when explicitly investigated. It
does not establish a reliable causal effect or a winning taxonomy.

One linked-repeat-1 challenge tried to delete U2 without a required removal receipt.
The correction regenerated a different patch, retaining U2 and adding another parent.
The prompt inherited an incomplete description of pure-removal receipts, and the repair
did not include the failed response for a minimal correction. This is a semantic repair
confound. Both responses remain saved; future protocols should specify the full removal
contract and separate format correction from substantive reconsideration. No paid rerun
was used to conceal or replace this result.

The next bounded test should distinguish reusing an existing scope from inventing a
near-duplicate parent, then retrieve evidence that discriminates the recurring scope
alternatives. A same-model challenge pass sometimes revises a link but is not independent
semantic validation. Frozen descriptions also preserve earlier overgeneralizations;
this experiment does not repair them or establish a complete ETL lifecycle.

## Competing scopes and parent reuse (`umbrella-scopes-v1`)

The follow-up freezes a model-proposed set of alternatives before retrieving extra
evidence. It tests whether that evidence changes boundary judgments, whether existing
parents can express the outcome without a duplicate node, and whether decisions remain
similar when alternative order is reversed. Owner judgments remain held out.

Case selection is mechanical, not a new owner taxonomy: form connected components of
overlapping seed-descendant sets in every prior new-parent proposal. Select the two
components with the most distinct memberships (hash-ID tie break), then the remaining
component whose closest existing covering parent has the most additional responsibilities.
This selects professor evaluation, grade insight, and ETL loading from six neighborhoods.
It is a selected-disagreement pilot, not a representative repository sample.

For each case, one call receives the compact baseline graph, prior scope hypotheses
without run counts or verdicts, the neighborhood's existing evidence, pinned-head paths,
and the cached reading title catalog. It proposes three to five alternatives, including
unchanged structure, existing-parent reuse, and a new parent. It also requests up to six
source windows and four readings that could discriminate among those hypotheses. The
deterministic broker uses the pinned Git revision and a 28,000-byte retrieval allowance.
Exact-ID duplicates of the old packet are excluded from enrichment; different windows
can still overlap in source content. Omitted requests are retained as explicit gaps.

Each frozen alternative set is judged four times: existing versus enriched evidence,
each in forward and reverse order. Condition execution order is counterbalanced. The
judge sees no earlier verdict, planner weakness, or run provenance. Alternative labels
and descriptions still carry framing. Each judgment must assess every alternative and
compare every proposed parent with an existing seed; abstention and a missing-alternative
description are allowed. A same-model judge is not independent ground truth. One call
per evidence/order cell cannot separate order effects from sampling variability.

This preservation test freezes seed descriptions and all original links. Alternatives
only add containment or broader parents. No graph is automatically applied. Existing
parent reuse can be interpretive only, with the same topology as the unchanged baseline;
such choices are not independent structural alternatives. A model wanting to revise a
seed description or remove an old edge must defer that change. These constraints can
themselves affect the scope decision and are not the intended unrestricted architecture.

There are **no automatic repairs or transport retries**. Every provider response is
saved before validation, and a rejected response remains a failed cell rather than a
regenerated semantic decision. A saved request without a response stops continuation
until its provider outcome is reconciled. The input preflight is 190,000 characters;
output limits are 6,000 tokens for planning and 4,300 for judgment. Recorded usage of
$1.50 stops the next request, not an in-flight charge. Raw observations, model hypotheses,
and model judgments remain separate in ignored local outputs.

```bash
node scripts/compare-umbrella-scopes.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/umbrella-ablation-1 \
  --repo /Users/echo/Projects/course-recommender \
  --out public/graph-reviews/umbrella-scopes-1
node scripts/render-umbrella-scopes.mjs \
  public/graph-reviews/umbrella-scopes-1/output.json
```

Use a new ignored output directory and `--replay-from` pointing to the saved run
for exact no-inference replay. The broad-review report shows every alternative's
neighborhood, every assessment, missing evidence, and the full saved responses.

### Completed pilot: two evaluated cases, one provider failure

Recorded cost was **$0.432968** across eleven returned responses. Professor and ETL
planning plus all eight judgments passed structural validation without repairs. Grade
planning returned `finish_reason=error` with repetitive incomplete text and was retained
as a failed case; its four judgments were not attempted. The provider receipt reports
zero cost for that failed response. This is not a completed three-case semantic comparison.

Both completed cases retrieved six additional source windows and four additional
readings relative to their old packets, with no omitted requests. ETL retrieval reached
bootstrap, quarterly refresh, the shared runner, a separate post-process workflow, and
continuation windows in the catalog loader and post-processing module. These are real
evidence additions, but not complete lifecycle coverage.

All eight judgments abstained from selecting a single alternative. That is not a
100%-stable taxonomy: their individual assessments varied, and unchanged structure
versus interpretive reuse sometimes represented the same topology. Professor profile
containment of review browsing was supported in both enriched calls and one of two
old-evidence calls. The broader professor-evaluation parent was consistently classified
as broader than AI insights, not a duplicate, but remained only partially supported.

ETL novelty classifications were identical in all four calls: the unique-course-loading
subgroup is narrower than existing ETL; the proposed warehouse-materialization parent
duplicates its existing four-child scope. However, the loading subgroup's support changed
from partial to supported with reversed order in both evidence conditions. The proposed
audit/metric quality grouping also shifted from unsupported to partial. This run cannot
attribute those changes specifically to ordering rather than sampling variability.

Two protocol limitations constrain the conclusion. First, preserving every direct edge
forces redundant transitive paths when inserting a parent. Some judge reasons explicitly
penalize those paths, so this is partly a representation test rather than a fair comparison
of scopes. A follow-up should preserve descendant relationships and evidence while allowing
direct-edge rewiring, with removed-edge provenance retained. Second, judges repeatedly ask
whether evidence *forces* a unique arrangement. Taxonomy may be underdetermined even when
several useful arrangements are well supported. Future selection should distinguish a
revisable working preference from proof of a unique ontology, without requiring the owner
to supply the taxonomy. Deduplicate topology-equivalent options before that comparison.

Some reasons also overreach: one enriched professor judgment says a narrower proposal
“drops” the batch seed, although every seed remains in its candidate graph. This is a
semantic error, not a parser failure; other statements mix scope coherence with runtime
coupling despite instructions separating them. The report preserves these explanations
and does not treat the model as an independent evaluator or ground truth.

The complete output, including the failed case, replays byte-identically without new
inference. The accepted 47-node ETL baseline remains unchanged. No output from this pilot
is integrated into the main application viewer.

## Relationship coexistence pilot (`relationship-coexistence-v1.1`)

This pilot replaces mutually competing umbrella arrangements with independently
reviewable relationship claims. A capability can participate in several outcomes;
shared membership is not automatically a conflict or duplicate. The experimental
vocabulary is `contains` (broader outcome to constituent), `supports` (enabler to
enabled outcome, without asserting necessity or membership), and `depends_on`
(consumer to required provider). Support and dependency are not transitive. Only
containment must be acyclic; reciprocal support/dependency may coexist. This is a
provisional vocabulary, not a claim to enumerate all codebase relationships.

The main graph schema remains unchanged: `supports` is confined to this experiment's
library and serialized outputs. No production viewer integration or accepted-map
mutation occurs. Inherited nodes, descriptions, and relationships are preserved but
are not revalidated merely by appearing in a composed candidate.

One proposal call sees the full compact baseline, the eleven focus IDs from the two
previously completed professor/ETL cases, and sixty saved evidence items (125,448
serialized bytes). No previous alternatives, verdicts, planner reasons, or owner
judgments enter inference. Evidence combines the original matched packet with the
two enriched packets; there is no new source retrieval. The failed grade case is not
recovered by this pilot. The proposal bounds are six new nodes and eighteen edges,
not target counts. Empty proposal arrays are valid.

Two fresh calls review every proposed node and edge in forward/reverse order, with
identical evidence. Proposer reasons are omitted, but claim endpoints, types, and
citations remain. Each item receives include/defer/reject; no single winner is selected.
Reviewers may report actual conflicts, but sharing a child is not a conflict. New
endpoints must be included before their edges are included. Implementation-support
and dependency claims require source citations, which still do not prove their meaning.

Composition independently builds each review's candidate. If included containment
edges jointly form a cycle, all new edges participating in that cycle are withheld
instead of arbitrarily selecting an array-order winner. Raw claims and provenance remain
saved. The containment display removes only transitive shortcuts while checking that
all containment reachability survives. Shared-parent counts use that reduced display,
so an ancestor shortcut does not masquerade as membership in independent umbrellas.
Non-containment relationships remain separate from the hierarchy display.

### Duplicate-claim reconciliation and saved results

The initial v1 proposal cost $0.097818 and returned eight edges with no new nodes.
One edge (L5) repeated inherited E11, even identifying it as a duplicate in its own
reason. Strict duplicate validation rejected the pool. That failed run is retained.
The explicit v1.1 reconciliation reuses the exact proposal request and response,
without a new generation or semantic rewrite. Identical typed endpoints are now
recorded as existing claims, independently reviewed but never counted or inserted
as new edges. Duplicate proposal IDs, duplicate claims within a pool, invalid endpoints,
and missing source citations still fail validation. Original v1 behavior remains
available and its failed output replays exactly.

Both reviews passed without repair. Additional review cost was $0.191620; total unique
recorded inference was **$0.289438**, including the reused original proposal once.
Forward included five new links and reaffirmed the existing dependency; reverse
included seven new links and reaffirmed it. Both composed candidates preserve all
47 seed nodes and original links. No new outcome node was proposed. Both include
review browsing under professor pages, Gemini summarization supporting the insight
card, professor pages depending on API contracts, catalog loading depending on
embeddings, and derived-metric processing supporting professor pages.

The two disputed links concern Cory Insights membership in professor pages and AI
insights supporting those pages. Forward defers them because the excerpt does not
show the card mounted; reverse includes them and then explicitly admits that assumption.
Only reverse therefore has an independently shared child: Cory Insights under both
AI professor insights and professor pages. This demonstrates representability and
claim-local disagreement, **not verified multi-umbrella discovery**. No conflict or
composition cycle was reported. Six of eight raw include/defer decisions agree, but
one of those six concerns an already-existing link; agreement is not accuracy.

Source spot-checking also challenges a shared decision: catalog loading has a
`generate_embeddings` flag and commits course rows before the optional embedding
branch. A partial-load exception explicitly allows successful course loading with
failed embedding generation. Both reviewers nevertheless include an unqualified
dependency. This likely needs a condition on the relationship, not a claim that
every catalog load requires embeddings. Separate ignored `audit.json` notes flag
this and the unsupported mounting assumption without rewriting either output.

Thus the pilot advances composition beyond all-or-nothing abstention, while exposing
remaining semantic problems: conditional relationships, evidence thresholds, and
distinguishing outcome containment from implementation wiring. Its changed prompt,
candidate pool, and vocabulary prevent a causal quality comparison with the previous
umbrella test. One proposal and two same-model reviews on one repository do not establish
stability or generalization. A focused next retrieval could resolve card mounting and
conditional ETL execution; the baseline descriptions also still need revisable handling.

```bash
node scripts/discover-capability-relationships.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/umbrella-scopes-1 \
  --out public/graph-reviews/relationship-coexistence-1-reconciled \
  --reuse-proposal-from public/graph-reviews/relationship-coexistence-1
node scripts/render-capability-relationships.mjs \
  public/graph-reviews/relationship-coexistence-1-reconciled/output.json
```

Replay uses the same inputs and reuse option, a new ignored output directory, and
`--replay-from` pointing to the reconciled directory. Both the original failed output
and reconciled output replay byte-identically. Requests/responses are immutable, no
automatic repair or transport retry occurs, and a request without its response requires
provider-outcome reconciliation. A 190,000-character preflight, 7,500-token output cap,
and $1 recorded-cost stop before the next request bound inference, not in-flight billing.

## Conditional relationship follow-up (experimental v1)

`scripts/review-conditional-relationships.mjs` examines three claims from the
coexistence pilot without composing changes into any graph. One model retrieval plan
requests additional pinned source windows. A deterministic broker executes bounded,
safe requests. Original and enriched evidence are each reviewed in forward and reverse
claim order, with identical instructions. Earlier reasons, verdicts, and owner judgments
are excluded. The planner sees the safe pinned path index and original evidence.

An included relationship carries a type, pinned revision, and either `condition: null`
or a descriptive condition with its own observed-source citations. Conditions are
candidate predicates, not executable logic. Endpoints remain fixed; scope or direction
changes must be deferred. These records are not passed through the older composition
or transitive-reduction code: conditional reachability must not silently replace an
unconditional relationship. This is an isolated experiment, not production schema support.

### Saved results and limitations

`public/graph-reviews/conditional-relationships-1/` preserves all five provider calls,
the plan, retrieval receipts, both evidence packets, four reviews, and a comparison page.
The model requested five source windows, with no omissions, adding five evidence items.
These include the rest of ProfessorPage, its API client, the loader's opening window,
and a further CoryInsights window. All five responses passed structural validation
without repair. Total recorded inference cost was **$0.496816**.

| Claim | Original forward / reverse | Enriched forward / reverse |
| --- | --- | --- |
| Professor pages contains Cory Insights | defer / defer | reject / reject |
| Catalog loading depends on embeddings | conditional / conditional | conditional / conditional |
| AI insights supports professor pages | include / defer | reject / reject |

All four reviews express the embedding dependency conditionally. Both enriched reviews
and original-reverse require the enabled flag and remaining NULL-embedding candidates;
original-forward omits the nonempty-candidate guard from its condition. The decisive
branch was already present in the original evidence. Thus representational support and
new instructions can account for the basic correction; retrieval alone cannot take credit.
The planner did not request loader callers or execution tests, so actual invocation
configuration and runtime behavior remain untested.

The professor-page rejections are **not established broader-capability negatives**.
The enriched packet completes ProfessorPage, but not ProfessorView. A separate assistant
check completed ProfessorView and found no card mounting there either; it was not model
input. Neither exercise exhaustively traces other consumers or historical inclusion.
More importantly, the reviewers still conflate absence of current page wiring with absence
of outcome containment in the broader search-and-profile capability. The prompt permits
outcome containment, yet they demand mounting. Separate `audit.json` notes expose this
without changing raw verdicts. Stable decisions can still rest on an overly narrow test.

The next useful distinction is **outcome membership versus implementation wiring**, with
bounded consumer tracing and explicit temporal scope. Do not automatically apply these
rejections or declare multi-parent relationships disproven. One repository, three selected
claims, two samples per packet, and a changed schema cannot establish general accuracy.

```bash
node scripts/review-conditional-relationships.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/relationship-coexistence-1-reconciled \
  --repo /Users/echo/Projects/course-recommender \
  --out public/graph-reviews/conditional-relationships-1
node scripts/render-conditional-relationships.mjs \
  public/graph-reviews/conditional-relationships-1/output.json
```

Exact replay uses the same inputs, a fresh ignored output directory, and
`--replay-from public/graph-reviews/conditional-relationships-1`. Saved output replayed
byte-identically. Limits are 12 source windows, 52 KB of new retrieval, 230,000 prompt
characters, 5,500 output tokens, and a $1 recorded-cost stop before the next call—not a
guarantee on in-flight billing. Requests without responses block automatic resubmission.
All 47 accepted nodes and original links remain unchanged.

## Outcome meaning versus implementation tracing (experimental v1)

The next bounded test keeps L2 and L7 but separately records outcome membership,
current source wiring, and historical observations. Each outcome has its own temporal
scope; current and historical source citations cannot be interchanged. Missing wiring
is not automatically rejection of a broader outcome. No accepted graph is composed.

Two model-directed retrieval rounds can request exact windows and case-sensitive literal
searches over safe code files at the pinned head or registered historical revisions.
The broker records every eligible, scanned, incomplete, and unscanned path. Each query
has a prefix, revision, matching line numbers, retained source IDs, and explicit limits.
These observations are not a symbol resolver, call graph, execution test, or general
proof of absence. Source uses the existing immutable-blob safety boundary.

Original evidence is the previous conditional experiment's enriched 65-item packet.
Two original and two enriched reviews use identical dual-axis instructions with reversed
claim order. No prior verdicts, planner rationale, audit notes, or owner judgment enter
the review prompts. Fixed node descriptions still carry earlier interpretation.

### Completed result: actual consumer found, scope still unstable

`public/graph-reviews/relationship-tracing-1/` retains six provider responses costing
**$0.920396**. Both plans passed; three reviews passed and enriched-reverse failed
temporal validation. It claimed current scope for L2 but omitted the required revision.
That complete response remains invalid and was neither repaired nor silently salvaged.

Seven literal searches each scanned all 101 eligible code files in `frontend/src` at
the pinned revision, with no incomplete files. Thirteen new evidence items survive
cross-round deduplication (65 → 78). One matching Home source window was omitted by
the second round's source-byte budget. Neither plan requested a historical revision:
temporal representation is exercised, but no new historical tracing was performed.

The discovered source chain is materially different from the earlier page-only assumption:

```text
/professors and /professors/:professorSlug
  -> Home (professor mode)
     -> SelectedProfessor
        -> POST summarize_professor
        -> CorysInsights (when summary exists and loading has finished)

/professor/:professor_id
  -> ProfessorPage (a different route at the same snapshot)
```

Pinned App.tsx establishes the distinct routes. Home renders SelectedProfessor, and
SelectedProfessor imports the card, requests a summary, and renders the card. These
are inspected source observations, not a live-service or deployment verification.

Both original-evidence reviews defer both outcome relationships with unknown wiring.
The valid enriched review includes Cory Insights within the professor browsing/profile
outcome and AI insights supporting it, citing the actual consumer. The invalid enriched
response's raw prose agrees on support but rejects containment by narrowing N19 to the
standalone page. This is diagnostic disagreement, not two valid reviews or a stable
membership result. Its raw response remains accessible beside the failed cell.

N19's name is broad, but its frozen summary describes a historical route and review
rendering. The next scope question is whether to revise that description or distinguish
its implementations, with cited identity continuity. Repeating edge judgments while
silently letting N19 mean different things would not test the same claim. The valid
review also leaves its wiring condition null despite the card's render guard; source
discovery does not prove exact conditional or temporal interpretation. Separate ignored
audit notes record these limits without modifying inference.

```bash
node scripts/review-relationship-tracing.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/conditional-relationships-1 \
  --repo /Users/echo/Projects/course-recommender \
  --out public/graph-reviews/relationship-tracing-1
node scripts/render-relationship-tracing.mjs \
  public/graph-reviews/relationship-tracing-1/output.json
```

Replay uses a fresh ignored output directory and
`--replay-from public/graph-reviews/relationship-tracing-1`; exact requests, search
receipts, and the output including the failed review are reproduced without inference.
There are no automatic repairs or transport retries. Per-round bounds are four searches,
eight exact windows, and 42 KB of returned source. Each search scans at most 140 files
and 20 windows per file, retaining at most eight matching windows. Search receipts have
separate coverage accounting. The request preflight is 340,000 characters, output cap
6,000 tokens, and recorded-cost guard $1.25 before a further request, not an in-flight
billing guarantee. All accepted nodes and edges remain unchanged.

## Capability description revision v1

This test freezes the tracing experiment's enriched packet: 78 evidence items and
seven search receipts. A model proposes an identity-preserving N19 description or
abstains (`requires_split` / `uncertain`). A separate same-model review receives the
original and candidate descriptor, but not proposal rationale or prior relationship
verdicts. Only an approving review permits the revised-description relationship cells.
Neither stage receives the two target relationship proposals. Existing graph context
is still supplied; this is not taxonomy-free rediscovery.

The planned comparison crosses original/revised descriptions with forward/reverse
claim order. Evidence, search receipts, and relationship instructions are identical
across cells. Only N19's name, summary and descriptor citations may change; IDs,
other nodes and all edges remain fixed. Proposal rationale and identity-review verdict
are withheld from relationship reviewers. A temporal-format and guard-reporting
reminder applies equally to all cells, so this is not an exact repeat of the prior
experiment's instructions. Raw responses precede validation; no repair or retry runs.

### Completed result: identity deferred; no revision-effect measurement

`public/graph-reviews/capability-description-1/` retains four valid responses costing
**$0.668390**. The model proposes **Professor profile pages**, describes the dedicated
`/professor/:professor_id` page, and mentions related selection under
`/professors/:professorSlug`. It drops search from the title but does not clearly settle
whether the separate surfaces share the same outcome.

The identity review **defers**, questioning both shared scope and historical route
continuity. The two revised-description cells therefore remain **not run**, not failed,
rejected edges, or evidence of improvement. The two original-description controls
both include L2 containment and L7 support with observed SelectedProfessor wiring.
That agreement is obtained without using the proposed rewrite. Forward reports
source-observed render/request guards; reverse leaves both condition fields null.
Exact conditional description remains inconsistent.

The original descriptor's `Sc773deec16dfe4f1` reference is not in the fixed packet;
the report labels it unavailable rather than creating a dead link. No observation
was added to fill that gap during this controlled comparison, so original identity
evidence remains partial.

App.tsx proves coexisting routes at the pinned head. Old ProfessorPage snippets prove
earlier profile fetch/render behavior, not a complete transition to either current
surface. The identity review's defer is itself a candidate judgment: separate routes
do not prove separate outcomes, and present shared responsibility need not imply a
historical replacement. A future test should distinguish outcome scope, implementation
surfaces, and historical lineage rather than require one identity claim to answer all
three. No winning representation or revision benefit is established here.

The accepted map is unchanged. Descriptor lineage records old/new hashes and the fixed
packet hash without applying a patch. Ignored audit notes are separate from model input.
Request preflight is 340,000 characters; proposal/gate output caps are 3,500 tokens and
relationship caps 6,000. At most six requests are permitted, with a $1.25 recorded-cost
guard before further requests (not an in-flight cost guarantee). One proposal and one
same-model gate cannot establish description stability or independent accuracy.

```bash
node scripts/review-capability-description.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/relationship-tracing-1 \
  --out public/graph-reviews/capability-description-1
node scripts/render-capability-description.mjs \
  public/graph-reviews/capability-description-1/output.json
```

Exact replay uses a fresh ignored output directory with
`--replay-from public/graph-reviews/capability-description-1`. Both output and fixed
packets reproduce byte-for-byte without inference, including the skipped comparison.

## Behavioral-boundary comparison v1

This is an experimental representation comparison, not a production schema migration.
The existing graph keeps its nodes, edges, and lineage untouched. Pairwise behavioral
identity (`same`, `overlapping`, `a_broader`, `b_broader`, `distinct`) is deliberately
separate from graph `contains`: a part of an implementation need not be a subtype of
its consumer's behavior. `distinct` does not prohibit composition or a shared purpose.

The deterministic sample is the preceding tracing claims' endpoints plus their direct
containment children: five existing capabilities and all ten unordered pairs. Selection
is inherited from prior investigation, not blind rediscovery. Graph edges are withheld
from inference after selection; names and original summaries remain prior interpretations.
Owner examples, judgments and expected answers are not supplied.

All stages receive the same frozen 78-item evidence packet and seven search receipts.
One model pass produces cited responsibilities, inputs/triggers, observable results,
conditions, affirmative exclusions, separate revision-pinned implementation observations,
historical observations, and unknowns. Missing evidence is not an exclusion. Candidate
IDs/names remain fixed for matching; disputed meanings are exposed, not silently applied.

Current summaries and generated behavioral definitions are then each reviewed twice,
with forward/reverse pair order and identical instructions. Reviewers retain direct source
access in both conditions. They must justify shared behavior and meaningful differences,
make a working relation decision or name a concrete unresolved gap, and give revision
criteria. There is no semantic approval gate that silently removes the treatment. Invalid
responses remain invalid, with no correction calls or automatic transport retries.

Two same-model explanation audits compare both repeats per condition as X/Y, with the
condition mapping swapped and pair order reversed. They see source evidence and names,
not input definitions, condition labels, earlier audits or owner judgments. They assess
grounding, preserved distinctions, unsupported exclusions, and revision criteria. Masking
cannot hide every stylistic clue. Audit preference and recurrence are not independent
accuracy measurements, and no winning taxonomy is predeclared.

The intervention combines extra reasoning, structured fields, changed wording and length.
It cannot establish an advantage of schema alone over equally informed prose. Limits are
seven requests, 430,000 prompt characters, 10,000 output tokens for definition/pair stages,
6,500 for audits, and a $1.75 recorded-cost guard before further calls (not a guarantee
about an in-flight bill). No runtime tests of the analyzed application or new historical
retrieval are part of this comparison.

```bash
node scripts/compare-behavioral-boundaries.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/relationship-tracing-1 \
  --out public/graph-reviews/behavioral-boundaries-1
node scripts/render-behavioral-boundaries.mjs \
  public/graph-reviews/behavioral-boundaries-1/output.json
```

Replay uses a fresh ignored output directory with
`--replay-from public/graph-reviews/behavioral-boundaries-1`. Raw responses and exact
requests persist in ignored storage. Structural/citation checks do not validate semantics.

### Completed pair comparison; quality audits blocked

`public/graph-reviews/behavioral-boundaries-1/` retains one valid definition response
and four valid pair-review responses: 40 pair decisions and **$0.845940** in reported
successful-call cost. The first masked audit received HTTP 403 for the provider monthly
key spending limit. It produced no model verdict; the second audit was not attempted.
Rejected-call usage was not returned. A sanitized failure receipt was added from the
observed error, and the runner now preserves provider failures without exposing account
URLs or retrying requests. Reconstructing output reuses all five responses and that
receipt; it does not make another provider call.

Both conditions repeat **10/10** relation labels; neither produces unresolved labels.
Eight pairs agree across conditions. The two differences are:

| Pair | Current summaries, both repeats | Behavioral definitions, both repeats |
| --- | --- | --- |
| AI professor insights / Professor search and profile pages | distinct | overlapping |
| AI professor insights / Batch Spark Gemini professor summaries | overlapping | distinct |

There is **no demonstrated quality improvement**. Separate assistant spot-checks—not
the blocked model audits—identify problems in the behavioral treatment:

- Its first changed decision leans on a shared SelectedProfessor interface without
  establishing that ordinary profile-review presentation belongs to the AI capability.
- Its second denies shared summarization behavior while also saying N0 is broader than
  N31 and N31 overlaps N41 through that behavior. A scope/revision distinction would be
  needed to reconcile those decisions; this is not a general transitivity rule for overlap.
- The definition pass treats combining generation and display as a disputed identity,
  although source does not establish that broader, multi-responsibility capabilities
  are invalid. The two disputed definitions leave implementations and several other
  fields empty while retaining implementation-specific responsibility prose.
- The card definition omits the feedback callback and viewport requirements. Batch JSON
  writes are asserted from a source window ending before the write operations. The latter
  overstatement also appears in summaries and decisions from both conditions.

Some output-format and historical-replacement assertions also overstate what a model
prompt or cached reading proves. Neither condition's revision criteria are uniformly
behavior-grounded. Ignored audit notes retain these limitations and the two missing
original descriptor references; no original inference result is edited. This incomplete
quality comparison does not justify production adoption. The next useful question is
behavior ownership and consistency across related pair decisions, not simply more fields
or more agreement. No accepted nodes, edges, or application behavior changed.

## Behavior ownership and consistency: prepared, not run

`public/graph-reviews/behavior-ownership-1-prepared/` contains a **zero-call preparation**,
not a new semantic experiment result. The provider spending limit blocked the preceding
quality audits; no retry, alternate provider or new paid request was made here.

Reviewing the preceding protocol revealed an experiment-design error: its definition
prompt explicitly instructed the model to mark mixed responsibilities disputed. This
biased against composite capabilities. The new request explicitly permits a coherent
capability to combine responsibilities. Any eventual difference therefore combines a
prompt correction with a representation change, not a clean schema-only treatment.

Preparation reuses the same five candidates, ten pairs, and frozen 78-item packet with
seven search receipts. Two planned requests reverse pair order. The model will discover
up to twelve concrete behavior witnesses itself and state, for each candidate/witness,
whether it includes, uses, hosts, excludes, or has unknown responsibility for that behavior.
These roles are not exclusive ownership: multiple candidates may include one behavior.
Implementation observations and history have separate fields and source-pinned revisions.
Prior generated definitions, decisions, local diagnostics, owner examples and expected
answers are withheld from the planned requests.

Pair decisions reference shared witness IDs, explain alternative relations and supply
revision criteria. A shared witness requires includes on both sides. An exclusive witness
requires affirmative exclusion on the other side; unknown/uses/hosts is not automatically
absence. The finite vocabulary is **not** a closed-world or exhaustive behavior catalog,
so code does not derive the complete taxonomy from membership sets. Citations and shared
IDs improve auditability but do not validate whether the model chose the right behaviors.

A narrow local diagnostic flags broader → included capability → overlapping behavior,
when the broader capability is then labeled distinct from the overlap partner. This is
only a potential tension **if the scopes, revisions and behavior align**; it is not general
transitivity of overlap. Applied to saved results, it finds one such tension in each
behavioral repeat and none in the two summary repeats. Absence of a flag is not correctness.
New outputs must account for any such tension with an explanation or an explicit unresolved
note. No semantic decision is automatically repaired or inferred from the diagnostic.

The preparation script contains no provider-call code. It writes immutable planned
requests, input hashes, zero-call status and a readable report. The output validator and
synthetic tests are ready; **a live executor and live results remain outstanding** until
provider availability is confirmed. No accepted map or production schema changes.

```bash
node scripts/prepare-behavior-ownership.mjs \
  --in public/graph-reviews/whole-project-2-etl/output.json \
  --prior public/graph-reviews/behavioral-boundaries-1 \
  --out public/graph-reviews/behavior-ownership-1-prepared
```

Running preparation again checks the same immutable artifacts without inference. The
request cap is 430,000 characters and planned output cap 12,000 tokens per request. These
are preflight limits, not evidence of cost or semantic success for an unexecuted test.

## Completed ownership and implementation-change follow-ups

### Ownership live follow-up

After the provider key limit was removed, the prepared ownership test ran both exact
requests. The full local report is `public/graph-reviews/behavior-ownership-1/index.html`.
Cost was $0.365510, with both usage receipts returned. Neither response passed validation:
history used candidate readings instead of observed source at the claimed revisions.
Additional inspection found eight exclusive-witness role mismatches in forward and two
in reverse. Both raw answers repeated all ten labels, but valid-answer agreement is not
reported. No repairs or paid retries occurred, and exact replay preserved both failures.

The representation made reasoning inspectable but did not establish better semantics.
It preserved composite generation/display while separating producer and presentation,
yet used implementation differences to define live-versus-batch behavioral identity.
The [summary](EXPERIMENT-SUMMARY.md) records the next controlled instruction test. The
preparation section above is the historical pre-run status, not the current run status.

### Implementation-change test

The implementation-invariance follow-up runs with `scripts/compare-implementation-invariance.mjs`
and renders with `scripts/render-implementation-invariance.mjs`. It reuses the prepared
ownership-forward request as control and appends behavior contracts plus hypothetical
implementation-change checks for treatment. Inputs are `--in` the accepted baseline,
`--prior` the behavioral-boundaries run, `--prepared` the ownership preparation, and a
fresh ignored `--out`; `--replay-from` forbids live fallback. Four calls maximum include
one deterministic-feedback correction for each invalid initial answer. All versions are
immutable, and pair-label changes are separately recorded. The cost guard is $1.50 before
another call, not an in-flight guarantee.

The saved run `public/graph-reviews/implementation-invariance-1/` cost $0.434548. Both
initial answers failed; corrected control passed while corrected treatment retained
unsupported historical revisions in a behavior record. Neither correction changed pair
labels. The treatment's behavior vocabulary is clearer but still conflates composition
with overlap and makes unsupported source claims. The error collector localized history
and exclusive-witness failures, but not the remaining behavior-level revision error;
that feedback limitation prevents treating the failed correction as a pure model failure.
The summary and local audit preserve the result; no graph change was applied.

## Generalization limits (all conditions)

The planner still receives the whole compact catalog and current graph. Request-size
preflight prevents an oversized call, but paginated indexes and graph neighborhoods are
still needed for much larger repositories. Search is lexical; there is no symbol resolver
or call-graph traversal. The original graph loop's path search lists the pinned head only;
the alternative comparator adds bounded historical changed-path indexes, not exhaustive
historical source search. Filtered-out historical commits still lack
cached readings. Source windows can miss decisive code beyond their bounds.

These are bounded pilots on one repository. They cannot establish recurrence, superiority
to two-level induction, correctness of dependency direction or containment, or generalization.
The next semantic checks should compare alternatives against actual call sites and tests,
especially when a new parent might only rename an existing node.
