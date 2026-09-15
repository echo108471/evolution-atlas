# Capability discovery: experiments and lessons

This is the readable synthesis of the experiment sequence through September 9, 2026.
It owns the cross-experiment conclusions, not the detailed protocols. Follow the linked
experiment notes and local reports for exact requests, responses, evidence and caveats.
Historical measurements below are from saved run records, not newly rerun benchmarks.

## The short version

We moved from **summarizing a repository**, to **reading its changes**, to **discovering
capabilities**, to **testing evidence-backed decisions about their boundaries**.

The model can discover recognizable capabilities without an owner-supplied answer key.
It can build upward, preserve useful detail, propose overlaps and dependencies, and
follow source evidence to implementations that an earlier investigation missed.

The unresolved problem is not whether a model can draw a plausible map. It is whether
the map's meanings stay coherent when evidence, wording, implementation or scope changes.
Repeated labels and valid citations are not sufficient. Ownership tests made bad reasoning
easier to inspect. Synthetic contrasts got every change label right while still explaining
some overlap boundaries incorrectly. The subsequent real-code test improved local facts
after evidence expansion, but retained incompatible comparison scopes and one stale assertion
that the model claimed to have revised. A fresh same-model reviewer catches that stale
assertion, but leaves the scope conflicts and requested-versus-enforced-output distinction
unresolved—even when supplied the relevant isolated execution checks.

The intended architecture remains: **the LLM proposes and revises meanings; deterministic
code governs evidence, accounting, provenance and safe graph changes**. Neither an owner
taxonomy nor a permanent two-layer hierarchy should dictate the answers.

The next phase separates two tracks: **discovery/usefulness** (is an independently
produced map recognizable and informative?) and **evidence/reliability** (which specific
claims are supported, uncertain or revised correctly?). A useful candidate map may exist
before every claim is verified. Claim-local failures qualify the affected claims; they do
not automatically invalidate the entire map. Owner review stays broad, not a source-level
answer key.

**Current direction: history plane on top of decision-scoped integration, then deliver.**
Version 2 `integrate` now freezes a receipt catalog with brokered on-demand fetch and explicit
omissions rather than inlining the cumulative receipt corpus. Historical evolution remains
**in** the consolidation milestone—not snapshot-only. Snapshot maps remain useful
intermediates; milestone success still requires maps that can reason over git history via the
history plane. Raising the 1.5MB packet ceiling is not the scaling strategy. Further semantic
comparisons should be motivated by a concrete delivery failure, not by a desire for more
polished explanations.

## What counts as evidence of progress

- **Software validation:** the mechanism obeys its contract. It does not prove the model
  chose the right capabilities.
- **Recurrence:** repeated runs recover similar decisions or memberships. It does not
  establish correctness; a systematic error can recur.
- **Source support:** the supplied code supports the particular claim at a stated revision.
  A valid citation ID alone is weaker than this.
- **Broad owner approval:** the arrangement looks useful and plausible. It is not a
  commit-level answer key and must not be fed back as discovery labels.
- **Generalization:** the approach works beyond the repository and neighborhood on which
  it was developed. The recent graph experiments have not established this.

## 1. Finding an evidence unit that does not lose the history

| Experiment | What happened | What we learned |
| --- | --- | --- |
| Whole-corpus feature/lifecycle interpretation | Saved atlases cited only 12.6% of course-recommender commits and 10.1% of zod commits; outputs also approached configured feature caps. | Demonstrating that a feature exists is not explaining how it was built. Coverage and imposed limits must be visible. |
| Epoch detection: model proposals plus path/language shifts | The pilot produced 14 clustered model boundaries, nine corroborated by focus shifts. Some apparent disagreement was the same transition dated differently. | Temporal change has duration. Signals and model judgments are complementary, not interchangeable truth sources. |
| Smaller periods as a coherence fix | Splitting 14 periods into 22 left the unnameable rate at 64%. | Parallel work does not become one coherent theme merely by cutting time more finely. Epochs describe when; they should not partition what capabilities may span. |
| Per-commit reading and merge-diff repair | First-parent units represent landed changes. A broken merge-diff reader made 121 of 407 diff-less units unclear; restoring diffs brought the overall unclear rate to 0.5%. | Repository evidence quality mattered more than confident interpretation of subjects and paths. First-parent coverage is not all-commit coverage. |
| Blind depth reads and naming | Independent readings often described similar work using different capability names. | Per-commit names are interpretations, not stable capability identifiers. Discovery and assignment need their own reasoning. |
| Depth-budget and cache audit | Both tiers had shared a byte ceiling: 44% of promoted units exposed the same files despite the higher tier's larger line budget. Byte budgets and cache identity were corrected. | More expensive reasoning is not automatically more evidence. Cache keys must include evidence-affecting settings. |

Sources: [interpretation findings](INTERPRETATION-FINDINGS.md), [epochs](EPOCHS.md),
[per-commit reading](PER-COMMIT.md). Those documents retain historical claims and earlier
next-step lists; this summary does not treat every old recommendation as current.

**Coverage clarification:** the raw pilot contains 2,693 commits. The historical reading
run considered 739 first-parent units and produced 606 readings with two failed substantive
units; subsequent induction used a frozen 605-reading corpus. These are different recorded
artifacts and denominators, not evidence that every raw commit was independently read.
The real-repository boundary tests used only five existing candidates and a fixed 78-item
evidence packet plus seven search receipts—not all 605 readings in every request. The
subsequent synthetic contrast test uses eight constructed pairs from three related families,
not additional repository coverage.

## 2. Discovering capabilities without supplying the owner's taxonomy

| Experiment | What happened | What we learned |
| --- | --- | --- |
| Four flat grouping arms | Path/message, reading, combined and model-based groupings returned 256, 398, 287 and 81 groups. Reading text made groups easier for a judge to name, including groups formed without readings. | Evidence changes both grouping and explanation. Nameability is not correctness. |
| Repeated flat consolidation | Membership agreement was F1 0.717–0.773 despite changing group counts. | The earlier “not reproducible” claim confused unstable counts with substantially recurring membership. |
| Granularity audit | A 17-commit blog was split into 11–13 pieces. A safeguard against groups larger than roughly 10% structurally excluded an owner-recognized capability covering about 28%. | We had designed the wrong task. Flat-group quality rankings cannot be carried forward as capability-quality results. Large umbrellas are not automatically bad groups. |
| Blind two-layer induction | With no owner labels or target count, the first run found 16 umbrellas and 48 supported nodes. Three clean repeats found 11–13 umbrellas and 32–43 total nodes. | Broad autonomous discovery is feasible in this pilot. Fine boundaries and overlapping evidence remain less stable than broad organization. |
| Separate assignment to three discovered maps | A new pass considered every reading against a fixed candidate map. Cross-map overlap agreement improved; broad structure changed little. | “What capabilities exist?” and “Which changes support them?” are distinct semantic decisions. |
| Three assignments to one fixed map | Mean child co-membership F1 was 84.7%, versus 58.3% across separately discovered maps. Exact direct assignments recurred for 489/605 commits. | Hierarchy formation contributes more disagreement than assignment alone. Neither stage is deterministic or independently scored for accuracy. |
| Assignment critic, candidate IDs visible versus hidden | Three runs per condition: exact decisions agreed 85.9% within visible, 71.6% within hidden, and 54.5% across conditions. | Showing earlier alternatives measurably anchors the critic. Keep earlier votes and owner answers out of blind judgment; compare afterward. |
| Full, focused and cheaper hierarchy critics | Changing evidence context changed secondary proposals. Dependency automation recurred, but all three cheap focused critics failed coverage of the full signal set. | Retrieval is part of the semantic method. A recurrent proposal cannot rescue an incomplete review. |
| Planner → evidence broker → decision critic | Staging retained evidence for all 33 signals while reducing decision exposure from 86 readings to 32. Peak input fell 34%, cost 51%, but total input rose 25%. | Let the model choose evidence; let code enforce budgets. This reduced peak context and cost in one pilot, not overall token work or proven semantic error. Novelty still needs checking. |

Sources: [flat grouping](CAPABILITIES.md), [blind induction, assignment and critics](CAPABILITY-INDUCTION.md).

**A wording correction:** the old grouping write-up says the method “barely matters.”
The reported deterministic-reading and model arms had similarly low agreement with the
path baseline; their agreement with *each other* was only 0.143. That does not mean they
produced the same grouping, or prove that the algorithm never matters. The defensible
lesson is that the original comparison confounded method with evidence, and all four
flat formulations later failed the required granularity test.

## 3. From fixed layers to revisable graphs

These are exploratory steps, not successive winners in a common benchmark. Evidence,
prompts, candidate sets and output contracts changed along the way.

| Experiment / full local report | Outcome | Lesson and remaining limitation |
| --- | --- | --- |
| Local and agenda-driven graph pilots | The local loop revised downward but revisited one neighborhood. The agenda pilot reached three levels and proposed dependencies. | Both upward and downward change are representable. An agenda helps coverage; it does not guarantee complete or relevant evidence. |
| [Full graph run](http://127.0.0.1:8880/full-1/index.html) | Nine rounds accounted for 30 final nodes and seven dependencies, but produced no containment. Owner review accepted 28 nodes and seven edges, leaving two nodes unrated. | Broad plausibility was encouraging. Accounting for every node is not verification of every node, and a permitted hierarchy may still remain flat. |
| [Historical alternatives](http://127.0.0.1:8880/alternatives-1/index.html) | Six cases: five kept existing boundaries; one split two comparison experiences. | Some alternatives incorrectly treated keeping a node distinct, placing it under an umbrella, and adding a dependency as mutually exclusive. |
| [Explicit structures, corrected](http://127.0.0.1:8880/structures-2-corrected/index.html) | After fixing pinned-HEAD lookup, all six boundaries were retained; implementations and dependencies were separately proposed. | Explicit patches preserve children and distinguish implementations. The comparison capability reversed from split to retained; changed evidence/protocol prevents attributing this to one cause. |
| [Whole project plus ETL](http://127.0.0.1:8880/whole-project-2-etl/index.html) | Broader coverage and a focused ETL extension produced the accepted 47-node baseline: 17 containment links, 11 dependencies, depth two. | Relevant executable evidence exposed loading and audit responsibilities. Some final additions remained pending follow-up; “accepted” means broadly approved, not fully verified. |
| [Umbrella anchoring](http://127.0.0.1:8880/umbrella-ablation-1/index.html) | Both link-visible runs built a third layer while preserving all 17 original containment links. Hiding links did not produce broader organization and sometimes produced near-duplicates. | The model can build upward without erasing detail. Exact umbrella scope was unstable; one repair changed a semantic decision. |
| [Competing scopes and parent reuse](http://127.0.0.1:8880/umbrella-scopes-1/index.html) | Professor and ETL cases completed; grade planning failed. All eight completed judgments declined to choose one arrangement. | Requiring a uniquely forced taxonomy encourages abstention. Equivalent options and redundant direct links confounded the comparison. Useful revisable choices need not be uniquely correct. |
| [Relationship coexistence](http://127.0.0.1:8880/relationship-coexistence-1-reconciled/index.html) | Claims could independently add containment, support and dependency. The two reviews included five versus seven new links. Only one proposed an independently shared child. | Multiple umbrellas are representable. This was not verified multi-parent discovery: the disputed membership rested on an unproven mounting assumption. A duplicated existing edge was recorded, not counted as novelty. |
| [Conditional relationships](http://127.0.0.1:8880/conditional-relationships-1/index.html) | All four reviews made catalog loading's embedding dependency conditional. Enriched evidence led to professor-page rejections. | Conditions matter: optional embeddings are not required for every load. But absence of a card on one page is not proof against membership in a broader capability. |
| [Consumer tracing](http://127.0.0.1:8880/relationship-tracing-1/index.html) | Searches found the actual Home → SelectedProfessor → summary endpoint/card path, alongside a separate ProfessorPage route. Three of four reviews validated. | Following producers and consumers corrects narrow file-based assumptions. Two interfaces can coexist; that alone settles neither capability identity nor historical replacement. |
| [Description revision](http://127.0.0.1:8880/capability-description-1/index.html) | A renamed profile descriptor was proposed, but its identity review deferred. Revised-description comparison cells did not run. | Present behavioral identity, interface scope and historical continuity had become entangled. No description-revision benefit was measured. |
| [Behavioral boundaries versus summaries](http://127.0.0.1:8880/behavioral-boundaries-1/index.html) | Both conditions repeated all ten pair labels; eight agreed across conditions. The separate quality audits were blocked by a spending limit. | Structured definitions did not establish better explanations. We also found that the prompt explicitly discouraged combined responsibilities—a protocol bias, not an intrinsic model limitation. |
| [Behavior ownership](http://127.0.0.1:8880/behavior-ownership-1/index.html) | Both calls completed for $0.365510; neither passed validation. Composite generation/display remained, but historical citations and exclusive-witness accounting failed. | The representation exposes reasoning errors. It still lets implementation details define the behavioral vocabulary and then justify separation circularly. Repeating all ten raw labels is not success. |
| [Implementation-change challenge](http://127.0.0.1:8880/implementation-invariance-1/index.html) | Four calls cost $0.434548. Both initial answers failed; one correction made the control valid, while treatment retained unsupported revisions. All pair labels stayed unchanged. | Behavior-first wording and hypothetical checks are more inspectable, but did not establish better identity judgments. Our correction feedback also missed the precise location of a revision error. |
| [Fixed executable contrasts](http://127.0.0.1:8880/behavior-contrasts-1/index.html) | Four calls cost $0.078078. Summary and boundary conditions each matched 8/8 expected behavior deltas in both orders; all answers validated. Three answers nevertheless made a falsifiable error about which keyword inputs still agree. | Basic change detection works on these small synthetic units. No representation advantage was measured; correct labels can conceal incorrect overlap boundaries. |
| [Real-code claims and evidence expansion](http://127.0.0.1:8880/real-boundary-claims-1-reconciled/index.html) | Four unique calls cost $0.141500. Both representations identify a missing caller callback after added source, but retain opposite broader/narrower labels. One initial ID failure was explicitly reconciled without changing claims or repurchasing inference. | Better local facts do not guarantee coherent comparison scope or reliable revision. One supposedly revised assertion stayed unchanged and supported. Both descriptions also overstated enforced batch output shape; isolated real-source checks accept arbitrary JSON values. |
| [Separate claim-and-scope review](http://127.0.0.1:8880/claim-scope-review-1/index.html) | Four fresh same-model reviewer calls cost $0.227870; all structurally valid. Both summary-target reviews locate the stale assertion, while all twelve case relations remain unchanged. Added batch checks change no disposition or relation in these samples. | A reviewer can catch an obvious wording contradiction yet endorse inconsistent scopes and unqualified output contracts. Fresh review plus available counterexamples is not a demonstrated semantic acceptance gate. |
| [VS Code snapshot discovery](http://127.0.0.1:8880/vscode-discovery-1/index.html) | Six fresh-context subscription subagents proposed 61 candidates; one fresh reconciler produced 68 nodes and 45 links, with six broader groupings and three shared children. No external model API calls. | Bounded source inspection can produce a detailed, revisable cross-repository candidate map. This is a new orchestration/model/initialization variant, not a controlled transfer of the earlier API baseline. The owner subsequently said it broadly makes sense; independent semantic verification remains unperformed. |
| [VS Code unread-file expansion](http://127.0.0.1:8880/vscode-expansion-1/index.html#changes) | Three blind agents proposed 19 candidates from 28 previously unread files. Fresh integration produced 87 nodes and 70 links, merging one overlapping pair, adding one grouping and explicitly revising six definitions. | Expansion can include consolidation and boundary revisions, not just appended nodes. The merge and new grouping offset: the final count equals naive concatenation. This is one candidate integration, not measured accuracy, stability or exhaustive coverage. |
| [VS Code claim-local source audit](http://127.0.0.1:8880/vscode-evidence-audit-1/index.html) | Two fresh reviewers examined six frozen sampled definitions and 19 explicit claims. They marked 16 claims supported and three qualified; four definitions need qualification, including one contradicted cancellation condition outside the claim list. | Source review can find useful local corrections while preserving map usefulness. A parent cross-check also qualified two reviewer criticisms. These are static judgments, not runtime verification or a representative accuracy estimate. |
| [VS Code revision and fresh recheck](http://127.0.0.1:8880/vscode-revision-recheck-1/index.html) | One proposal made 13 wording edits on four nodes; fresh reviewers supported 18/19 claims and four of six definitions. One cancellation qualification and one missing cross-node boundary remain, and an unchanged marker claim receives a new qualification. | Real assertion changes can be replayed without altering identity or topology. Review catches additional issues, but a second pass is not an oracle and these counts do not isolate a revision effect. |
| [VS Code resumable expansion](http://127.0.0.1:8880/vscode-expansion-2/index.html#changes) | Fifteen blind proposals integrated into a 103-node, 86-link map. Nine definitions revised, all 74 input links retained, one grouping and 12 links added. Saved discovery survived an integration usage failure without rerunning it. | Evidence can refine conditions and connect new responsibilities to old ones. No identities were merged in this pass; growth is not proof of novelty, completeness or stable boundaries. |

Detailed protocols: [iterative graph experiments](CAPABILITY-GRAPH.md). Reports and raw
datasets are ignored local artifacts; loopback links work only while the local report
server is running. Software unit tests, exact replays and schema-correction copies are not
additional independent experiments or new semantic samples.

## Architectural conclusions so far

1. **Separate observations from interpretations.** Git blobs, source windows and search
   coverage are observations. Readings, capability definitions, scope decisions and
   historical continuity are claims. One must not silently become the other.
2. **Separate discovery, assignment and review.** They have different failure modes.
   Keep candidate alternatives out of blind review unless their exposure is the treatment.
3. **Use a revisable graph, not a fixed taxonomy.** Multiple parents and deeper structure
   are useful possibilities. Membership, dependency, support, implementation and historical
   evolution must not be collapsed into a single relation.
4. **Keep broad capability identity concrete.** Actors, inputs, observable results,
   conditions and explicit exclusions can explain scope. Broad purposes may connect
   capabilities without erasing their differences. File or model identity is not enough.
5. **Make evidence gaps actionable.** Missing callers, truncated operations or absent
   historical snapshots should drive bounded retrieval, not be filled by confident prose.
6. **Record changes rather than hiding them.** Save raw responses before validation,
   preserve failed attempts, distinguish correction from new evidence, and replay locally.
7. **Separate map usefulness from claim verification.** Candidate interpretations,
   proposer-assessed support, independent verification, and owner usefulness feedback are
   different records. A source-linked proposal must not inherit a verified label simply
   because its schema and citations validate.

The existing graph can host separate, revisable decision records without a large core
rewrite. Experimental support/condition/identity records are not all implemented in the
production graph schema or main application viewer. The local review reports are real
outputs, but they are not that integration.

## What is not established

- A winning capability taxonomy or an independently measured semantic-accuracy improvement.
- Reliable behavioral identity across multiple interfaces and historical implementations.
- Complete history coverage, exhaustive source retrieval or end-to-end runtime correctness.
- Generalization of the frozen earlier graph protocol beyond course-recommender. Earlier
  atlas audits included zod; the new VS Code run uses a different subscription-subagent
  protocol and bounded public-source sampling, not a controlled baseline transfer or proof
  of performance on code unseen during model training.
- Automatic promotion of proposals into a trustworthy evolving map.

We should not optimize node count, confidence, nameability, agreement or number of new
layers as if any were accuracy. They are diagnostic measurements with different meanings.

## Previous experiment: model-created implementation-only changes

This completed bounded test compared the unchanged ownership instructions against an added
behavior-contract and hypothetical implementation-change challenge, using identical
candidate evidence. Each invalid initial answer received one recorded correction
containing deterministic validation errors—not owner labels or expected pair relations.
The control and treatment initial calls happened before either correction. Corrections
were allowed to change semantic decisions; their effects are recorded separately.

This tests whether behavior-first reasoning helps separate capability identity from its
machinery. It does not execute real refactors, establish invariance independently, or
isolate the schema from extra reasoning.

**Result:** both initial answers failed. Correction removed unsupported history and
incompatible exclusive witnesses in both conditions. Control then passed the structural
contract; treatment still cited two historical revisions in behavior B3 without source
at those revisions. Our feedback located history and witness errors but gave only a
generic message for B3's revision failure, so this is partly a feedback-system limitation.
Neither condition changed any pair label; both produced the same ten labels.

The treatment separated observable inputs/results from some machinery more clearly and
said library/model/engine substitutions need not change identity. But it still justified
overlap through co-location, treated requested output formatting as a guarantee, and
claimed batch writes beyond the cited excerpt. Those errors also show why a structurally
valid control is not a proven semantic winner.

This motivated **independently constructed, matched evidence contrasts**:
implementation-only changes alongside behavior-changing controls, with field-specific
validation feedback. Letting the deciding model invent an easy hypothetical change and
declare its own answer invariant is not enough. The [full report](http://127.0.0.1:8880/implementation-invariance-1/index.html)
preserves every initial and corrected answer. The follow-up is below.

## Previous experiment: fixed executable behavior contrasts

The [full report](http://127.0.0.1:8880/behavior-contrasts-1/index.html) compares summary-style
descriptions with explicit behavioral boundaries on identical, fixed source pairs. The
root agent authored the fixtures and executable probes before inference; the deciding
model did not choose its own changes. This is independent of the deciding model, not an
independent research team. Owner examples and labels were not inputs.

Three source-inspired synthetic families cover badge parsing, feedback availability and
batch selection. Each has one implementation rewrite and one observable change. Two
additional cases omit a necessary helper. The 398 pair-input probes were executed before
inference; the finite probe results and missing-helper expectations stayed hidden from
every model request. These are simplified constructed units, not extracted production
functions, real Git revisions or new end-to-end runtime coverage.

**Result:** all four calls passed validation and matched all eight expected behavior
deltas. Both representations preserved the three rewrites, detected the three changes,
and withheld judgment on both absent helpers. The capability labels were also identical:
same for rewrites, overlapping for changes, unresolved for absent helpers. Those labels
are qualitative proposals—not an executable answer key for capability identity. No
representation advantage or statistical generalization was established.

**The important failure:** three answers incorrectly claimed that keyword-at-the-start
inputs still agree, or would restore agreement, in the prefix-to-substring matching case.
An executed counterexample is `NOT RECOMMENDED`: A returns red; B returns green because
its earlier `includes('recommended')` check wins. Thus the model recognized that behavior
changed while misstating the boundary of shared behavior. The summary reverse run also
returned non-actionable “None” revision triggers for all six complete units, which the
nonempty-string validator accepted.

The offline ownership-feedback repair now locates every ownership-field failure, including
the previous B3 historical revision errors. It does not rewrite historical outcomes or
prove that a future model correction will succeed. The synthetic test used a simpler
output contract, so its validity is not evidence that the ownership-schema problem is solved.

This motivated testing **falsifiable overlap and exclusion claims**, not simply
change labels, in a bounded real-code neighborhood. Ask for concrete shared responsibilities
and distinguishing examples, and check those against executable evidence where practical.
Keep the summary control. Do not force a taxonomy from input-output equality or keep
retuning this small synthetic set until the explanations look perfect. The accepted graph
remains unchanged.

## Previous experiment: real-code claims and evidence expansion

The next test used three real-source comparisons: summary generation versus display,
the reusable insight component versus its actual caller, and historical batch processing
versus the current summary service. Both representation conditions saw the same initial
excerpts, then the same additional source and five isolated executions of the real parser
callback. The added evidence and eight factual audit criteria were frozen before inference.
Owner labels, expected relationships and the audit criteria stayed out of model requests.
Expanded answers saw their own prior answer, so this measures evidence-informed revision,
not blind rediscovery or a schema-only effect.

**Useful result:** both conditions distinguish generating from displaying text, retain an
explicit boundary against inventing historical replacement, and identify that the actual
caller passes `showFeedback` without `onFeedback`. Local evidence can sharpen a claim.

**Major remaining issues:**

- **Comparison scope still drifts.** Both answers describe caller-only fetching and
  component-only optional feedback, yet summary retains `a_broader` and boundary retains
  `b_broader`. A display-only projection may justify a different relation from comparing
  the full responsibilities. Neither answer makes that projection explicit and consistent
  with its definitions. This is not an argument for hard-coding an expected label.
- **Claim revision can be cosmetic.** Summary marks P2-C3 revised and says its old exclusion
  is withdrawn, while leaving that assertion unchanged and supported. Boundary updates
  the assertion. This local difference does not establish a general representation winner.
- **Claims escape the claim list.** Both initial definitions assert batch writes while
  their coverage notes correctly say write logic is missing. Their explicit claims often
  cite easy facts such as model names. A review that checks only those claims misses
  unsupported statements in definitions, examples and relationship reasons.
- **Requested behavior is still confused with enforced behavior.** Both expanded descriptions
  present requested per-class JSON fields and service formatting as output contracts without
  establishing enforcement. A post-response check of the isolated real batch acceptance block
  accepts `{}`, `[]`, `null`, and a JSON string without flagging them; invalid JSON is flagged.
  This confirms a pre-registered concern but is not a new held-out sample. No model, Spark,
  browser, application or file-writing flow was executed by those checks.

The original run stopped after two calls because the boundary answer repeated literal
`CASE-C1/2/3` placeholders instead of case-qualified IDs. Its raw response and invalid status
remain in the [original report](http://127.0.0.1:8880/real-boundary-claims-1/index.html).
A separately recorded reconciliation qualifies nine identifiers using their containing case,
without changing any assertion. The expanded rounds then complete; they are semantic revisions,
not format repairs. The $0.055252 initial cost is included in the $0.141500 total, not added again.
There were four unique provider calls, complete returned usage, and no correction calls.

This motivated a **separate claim-and-scope audit** before graph acceptance:
review the actual relationship-bearing statements, make comparison scopes explicit, and
require revision notes to agree with the assertion that remains active. The LLM should still
choose the responsibilities and relations. Code can enforce stable records and evidence
accounting, but cannot decide semantic truth just by accepting a schema.

This remains a diagnostic in one familiar neighborhood: three related cases, one model,
no order replication and a root-agent audit rather than independent semantic judging.
The accepted graph is unchanged, and these results do not justify a production migration.

## Previous experiment: separate claim-and-scope review

Four fresh reviewer calls examined the full previous and expanded records, not just the
original three claims. Each representation's answer received one review with the original
source/parser evidence and one with the additional isolated batch acceptance probes.
Reviewers did not receive our audit findings, owner taxonomy, preferred relations or
other reviewers' answers. All requests and the qualitative evaluation plan were saved
before inference. This uses the same underlying model, not independent model families.

All four calls validated and returned complete usage: **$0.227870** of new inference.
There were no correction calls. All twelve proposed relations retained the target's label;
ten case dispositions were keep and two were revise. Both revisions identify the same
stale summary P2-C3 assertion and propose a source-supported correction. No proposal
was applied to the original records or accepted graph.

**What failed:** none of the reviewers resolved the P2 scope conflict. Summary reviews
still exclude fetching from A, include it in B, then call A broader. Boundary reviews
still include optional feedback in A while B does not expose it, then call B broader.
One explicitly mentions a projection but leaves the wider scope in the actual record.
The issue is not that a different label must win; the declared comparison must match
the label's rationale.

Both reviewers receiving the batch probes acknowledge their isolated/stubbed nature yet
keep unqualified per-class JSON and two-sentence output descriptions. Those probes do
not measure production output frequency. They do directly show that the actual acceptance
block permits values outside the requested shape. The intended capability may still be
structured summarization; its intent must not be silently promoted to enforced behavior.

The reviewer also misses the under-specified feedback examples and initial batch-write
overclaims, while preserving useful generation/display and historical-evidence distinctions.
The two criticisms it does make are supported. This sample's dominant failure is missed
issues, not invented accusations—but proposed scopes themselves remain problematic.

## Experiment-batch conclusion and remaining issues

The planned sequence is complete: implementation-change challenge, fixed contrasts,
real-code evidence expansion, and the separate claim-and-scope review all have saved
outcomes, full reports and replayable requests. Completing the experiments does **not**
mean solving capability identity or validating the system for automatic graph promotion.
Historical failed cells remain failed; the summary does not silently turn them into successes.

The evidence supports keeping **LLM-discovered, revisable proposals** with deterministic
evidence/provenance controls. It does not establish a winning representation or justify
automatically accepting the same model's review. The main unresolved issues are:

- Coherent full-versus-projected comparison scope across definitions and relations.
- Updating the active assertion itself, not merely a revision note or explanation.
- Reviewing relationship-bearing statements wherever they appear, rather than a convenient
  subset of cited claims.
- Separating intended/requested behavior from observed or enforced behavior, and actually
  using counterexamples when judging those claims.
- Testing a genuinely held-out neighborhood before broader integration or generalization
  claims. The recent studies remain in one familiar course-recommender neighborhood.

The reliability track could compare an **evidence-led, claim-specific audit** against
this fresh-review baseline. The owner instead prioritized discovery usefulness on a new
repository for the next main-thread experiment, with reliability statuses kept separate.
Neither direction is an unfinished provider call in the earlier batch. Repeating the same
prompts until they look right would not establish generalization. Larger graph changes and
main-app integration remain separate work; the accepted 47-node map is still unchanged.

<span id="current-experiment-vs-code-snapshot-discovery-with-subscription-subagents"></span>

## Previous experiment: VS Code snapshot discovery with subscription subagents

The [complete candidate map](http://127.0.0.1:8880/vscode-discovery-1/index.html) is frozen
before owner feedback. The public Code–OSS source is pinned to
`33341eb227ab213b011868c9bc5c5f735aaaf875`; no target code was executed and no history was
analyzed. Source presence is not proof of availability in an installed VS Code build.

The procedure and evidence broker were hashed before discovery. Six agents started without
inherited conversation history or owner labels. Mechanical source assignments distributed
inspection work, not capability ownership. Each could cross those assignments within a
20-window / 72,000-receipt-byte budget. Source windows carry exact commit, blob, path and
line provenance; searches supply navigation locations, not behavioral proof. No prior
course-recommender maps or product feature documentation were discovery inputs.

A temporary thread-limit error prevented a third simultaneous launch. Fresh agents did
launch after earlier agents completed, so the run used waves of two rather than reusing
agent contexts. An initially suggested reuse workaround was withdrawn; the frozen
at-most-three concurrency ceiling and fresh-context requirement were preserved.

**Output:** six first-complete proposals contain 61 candidates and eight links. One fresh
global reconciler produced **68 nodes and 45 links**: 29 containment, 11 dependency and five
support relationships. All 61 originals are accounted for: 59 retained, one split into
text/notebook edit-review responsibilities, and one renamed to identify its declared voice
transcript data contract. No originals were silently discarded, and the original wording
remains in the raw proposal files. There were no structural corrections or later semantic
refinements. The reconciler saved an explicit decision/builder file that mechanically
copies unchanged nodes; artifact regeneration is not a claim of reproducible live inference.

The six broader groupings cover finding/replacing text, language-aware editing, accessible
presentation, notebook work, contextual chat/edit review, and terminal use. Three children
have multiple parents: notebook-edit review spans notebook work and chat; chat announcements
span chat and accessibility; accessible terminal output spans terminals and accessibility.
There are 36 other standalone candidates, 42 roots in total, and two represented levels.
Neither that depth nor the capability count was prescribed. No explicit `overlaps` edges
were proposed in this run; shared membership and overlap judgments are not interchangeable.

**Coverage and limits:** 88 source windows across **71 of 15,528 eligible files**, with
8,694 unique lines and 31 location searches. This is about 0.46% of eligible files, often
only partial excerpts, not the percentage of capabilities discovered. Every raw proposal
retains its uninspected areas and missing implementation links. A single familiar public
repository, a changed model/harness, and unmeasured training familiarity prevent a clean
generalization claim. The exact resolved subagent model identifier was not returned by the
collaboration tool; every agent inherited the parent settings without overrides.

**Two independent tracks remain visible:** all nodes/edges are candidates. The final node
assessments are 49 proposer-supported and 19 partial; these are not accuracy scores.
Independent semantic verification is explicitly not performed. After the output was frozen,
the owner said “this is pretty cool” and then “it broadly makes sense.” This is positive
broad-usefulness feedback on graph `039c7b63a7cb61a85ac364bd59ffe56734a65c9f264994104554a80311112cbe`,
not approval of every capability or relationship and not an answer key for subsequent
discovery. Structural checks found no invalid citations, dangling links, containment
cycles or lineage omissions; every saved source excerpt matches its immutable blob, and all
six originals match the inputs frozen for reconciliation. Those checks do not verify the
capability boundaries or every asserted behavior.

The software checks pass (351 tests, build and whitespace checks). The accepted 47-node
course-recommender graph is unchanged. External model API calls/spend are **zero**; the
seven agents consumed the account's shared subscription allowance, without per-agent
billing receipts. This is a local exploratory workflow, not an unattended production
replacement for the API pipeline or integration into the main application viewer.

<span id="current-experiment-vs-code-unread-file-discovery-and-integration"></span>

## Previous experiment: VS Code unread-file discovery and integration

The [complete expanded map](http://127.0.0.1:8880/vscode-expansion-1/index.html#map) and
[every comparison and change](http://127.0.0.1:8880/vscode-expansion-1/index.html#changes)
complete the next two requested steps. The first map remains unchanged. Its broad owner
approval motivated this test but supplied no capability labels, examples or expected answers.

**Frozen procedure:** three fresh discovery agents used the same source broker, on the same
pinned snapshot, with every previously inspected file excluded. The original six inspection
assignments were mechanically paired into three; this is not a controlled repeat of v1.
Each agent had at most 20 windows, eight searches and 72,000 receipt bytes. Previously unread
files can still belong to familiar subsystems. Discovery agents could not read the old map or
each other's proposals. A separate fresh integration agent then read all 68 old definitions,
all 19 proposals, and all 51 input relationships. It could read more source from the full
inventory, but used only two additional windows. All four agents used the subscription;
external model API calls and spend were zero.

**Result:** 87 candidates and 70 relationships: 38 containment, 20 dependency, ten support,
and two explicit overlap links. The three original multiple-parent children remain. The
model again chose two represented levels; neither depth nor count was prescribed.

- **Consolidation:** the old local-history timeline and new compare/restore proposal share
  a saved-entry/current-file comparison. The reconciler merged them into one interaction
  candidate while keeping saved-history capture and unsaved-working-copy recovery distinct.
- **Organization:** a new stored-edit-session grouping connects file-change transfer,
  optional workspace-state transfer, and inspection/discard. Three existing groupings—
  language assistance, accessibility, and notebooks—have explicitly expanded definitions.
- **Boundary preservation:** linked editing remains separate from rename, and marker-based
  conflict acceptance remains separate from merge-editor selection, with explicit overlap
  links rather than declarations of whole-capability identity.
- **Claim revisions:** the reconciler revised the notebook-version guard qualification,
  resolved a progress-scheduler caller gap, and qualified malformed attachment collision
  handling. These are source-based integration judgments, not independent semantic audit
  results or executed runtime checks.

Of the 68 old nodes, 63 are retained exactly, one participates in the merge, and four are
explicitly revised. Of the 19 proposals, 16 are retained exactly, one participates in that
merge, and two are revised. One new grouping offsets the merged pair, so the final **87 is
also the count simple concatenation would produce**. Counts alone would miss the integration.
All 45 old links remain exact; five new proposal links remain exact and one is revised for
the merged node. Nineteen additional links are proposed. No original is silently dropped.
Twenty-three comparisons cover all 19 new proposals; their labels are 16 distinct and seven
overlapping. This run did not exercise every available comparison label or establish that
these judgments are correct.

**Coverage:** discovery added 45 source windows across 28 previously unread files and 4,624
unique lines. Integration reread one previously inspected file in two new windows, adding
47 inspected lines. Combined coverage is **99 of 15,528 eligible files**, 135 source windows,
and 13,365 unique lines. This is about 0.64% of eligible files, not capability coverage.
The integration review selected source for relevant decisions; retained claims were not
all independently rechecked. Important provider, persistence, wiring and runtime gaps remain
in the full output. After this output was frozen, the owner responded “yeah it does I think.”
This is positive broad-usefulness feedback on graph
`fd7d44ba2c979984dab4fc73f7908f4f341ddf278673f4dae87037eb9a5b3e8a`,
not approval of all 87 definitions or 70 relationships. The subsequent audit keeps that
feedback in a separate record and withholds it from reviewers.

All three first-complete proposals and the first integration output passed structural and
provenance checks without correction. All 87 input nodes and 51 input links have explicit
lineage. One discovery navigation search failed because concurrent requests chose the same
receipt ID; exclusive creation preserved the source receipt and rejected the search save.
The failure is recorded, no missing search result is cited, and subsequent calls were
sequential. A temporary launch limit led to discovery waves of two without context reuse.

Software validation passes **358 tests**, build and whitespace checks. The original VS Code
map and accepted course-recommender map remain unchanged. Raw discovery, source receipts,
explicit integration plan, complete map and revisions are local ignored artifacts. This
completes discovery and integration, not the separately proposed independent audit,
repeatability test, historical-update test or main-app integration.

## Previous experiment: VS Code claim-local source audit

The [complete audit](http://127.0.0.1:8880/vscode-evidence-audit-1/index.html) preserves every
original claim, finding, proposed replacement, source receipt and parent qualification.
The expanded candidate map remains unchanged.

**Frozen procedure:** select one merged, two revised and three retained candidates by a
fixed hash ordering within integration-lineage categories. Two fresh-context subscription
reviewers receive three disjoint candidates each, with definitions and cited source but no
proposer confidence, uncertainty prose, lineage reasons or owner feedback. They examine
all definition fields as well as explicit claims. Each may retrieve six additional source
windows and four searches within 40,000 receipt bytes, using the unchanged snapshot broker.
Together they used seven extra windows and three location searches, with no retrieval
failures. No target code or external model API was executed. This is one bounded diagnostic,
not a random representative accuracy sample or an independent repeatability study.

**Result:** of 19 explicit claims, reviewers marked **16 supported and three qualified**.
Two complete definitions were supported and four qualified. Those totals are source-review
judgments, not independent ground truth. No reviewer proposed removing a sampled capability.

- **Streamed-edit review:** its two explicit claims pass, but its unconditional cancellation
  condition does not. Cancellation is checked inside the stream loop after a chunk arrives;
  the cancellation race is installed only afterward. Canceling the later decision wait does
  not explicitly cancel the response. This is a static control-flow counterexample, not an
  executed failure or a claim about every production stream provider.
- **Completion assembly:** reused items bypass the fresh-result filtering, normalization,
  clipboard inspection and result-container collection. The description needs that boundary.
  This does not establish a bug in VS Code's reuse callers.
- **Local-history restoration:** the recording service may replace a recent same-source
  entry. The explicit claim should distinguish requesting recording from guaranteeing a new
  entry. The composed browse/compare/restore capability remains useful.
- **Linked-editing activation:** either `linkedEditing` or `renameOnType` can enable the
  automatic path. Naming both is more precise than “its option.”

**Reviewers are not an oracle:** a non-blind parent cross-check agrees with these concrete
boundaries but narrows two criticisms. “Its option” is ambiguous, not an unequivocal denial
of the alternative setting. The history outcome already says “requests a new history entry,”
which is not itself a guarantee of creation. Also, reaching the service's no-provider branch
after a successful target clone was not demonstrated. These qualifications remain alongside
the untouched raw reviews rather than silently rewriting them.

**Engine progress:** a separate review sidecar binds findings to the exact graph and reviewed
content. Stale content, missing claim coverage and invalid source citations are rejected;
review status cannot silently transfer to changed wording. All nodes remain candidates,
and runtime verification and automatic promotion remain false. This corroborates the need
to review summaries, outcomes and conditions—not only a convenient explicit claim list.
It does not prove the full graph architecture, edges, historical identity or taxonomy correct.

The initial validator incorrectly rejected indexed field locations such as `outcomes[5]`.
It now accepts existing indexed definition fields and rejects nonexistent or unsafe paths;
raw reviews and verdicts did not change. This was an implementation correction, not a model
semantic correction. Eight added tests cover sampling, blinded packets, accounting, citation
types, exact field locations, stale-review rejection and report escaping.

The next reliability step is a **bounded revision-and-recheck loop**: apply proposed wording
to a new candidate version, require that the active assertion actually changes, and recheck
affected claims without inheriting their old review status. The discovery track still needs a reusable run/resume workflow and a repeat on untouched
input. Snapshot discovery is not historical evolution; history is now locked **in** the
consolidation milestone, with decision-scoped integrate and a history plane as the delivery
path. These audits do not implement that plane. Main-app migration remains separate from
these local experimental reports.

## Previous experiment: VS Code revision and fresh recheck

The [complete report](http://127.0.0.1:8880/vscode-revision-recheck-1/index.html) includes
every decision, before/after wording, remaining finding and fresh review. The
[revised candidate map](http://127.0.0.1:8880/vscode-revision-recheck-1/map.html#map)
is a separate version; neither earlier VS Code map nor the accepted course map was changed.

**Frozen procedure:** a fresh subscription agent received four qualified definitions,
eleven adverse findings, their source evidence and the parent's qualifications. It could
revise, keep or defer, with reasons. It chose eleven revisions expressed as thirteen exact
text patches, including two connected uncertainty updates. An atomic transaction requires
the flagged assertion itself to change; a revision note cannot substitute for that change.
All 87 IDs and names, all 70 relationships and all 83 unaffected definitions remain exact.
Previous integration decisions are archived separately from current revision lineage.
Holding identity fixed isolates this wording test; it is not a permanent graph restriction.

Two fresh agents then reviewed the same six sampled nodes and accumulated source windows,
with previous findings, replacements, confidence, uncertainty prose and owner feedback
withheld. There was no new retrieval, target execution, external model API call or semantic
correction loop. The first complete proposal and both first complete reviews are preserved.
Context isolation is instruction-based, not a hard filesystem boundary.

**Result:** fresh reviewers marked **18 of 19 explicit claims supported**, one qualified;
**four definitions supported**, two qualified. All three previously qualified explicit
claims now receive support, as do the revised linked-editing and streamed-edit conditions.
However, this is not a clean pass:

- Completion assembly still has an unchanged cancellation condition that promises too much:
  cleanup depends on execution reaching the final token check after awaiting snippet work.
- The unchanged marker-decoration control receives a new claim qualification: Hint styling
  has tag exceptions, its overview color/minimap are unset, and Deprecated takes precedence
  over Unnecessary. The prior reviewer supported that same claim.
- The local-history definition receives an overall supported verdict while its allocation
  of automatic capture to B3 is unresolved because B3's definition is absent from the packet.
  Both statuses remain visible. The earlier audit had already supplied the relevant source;
  this is missing neighboring capability context, not evidence that the proposed split is false.

A parent source check agrees with the two concrete code qualifications, without asserting
that exceptional snippet rejection occurs in production or that rendered markers were tested.
The two revised uncertainty entries were excluded from the blind review and are not separately
verified. Fresh review used an expanded packet available at the start, unlike the original
audit, so the before/after totals cannot be attributed solely to wording revision. One changed
control verdict also cautions against treating review outcomes as stable ground truth.

**Software result:** candidate application, graph/claim preconditions, no-op rejection,
review-version binding and restart-safe artifact saving are implemented and tested. Replaying
the proposal reproduces the exact revised candidate. A repeated freeze verifies identical
files and refuses to overwrite different ones. No review approval is inherited by the new
version; this conservative test policy does not imply all unchanged claims are false.

The initial result validator rejected three B-review entries for the real `evidenceIds`
metadata field. The allowlist was extended to existing citation metadata with a regression
test; raw reviews and semantic verdicts were not edited. The original three errors are
preserved in the [execution record](http://127.0.0.1:8880/vscode-revision-recheck-1/execution-record.json).
Citation resolution is counted separately from behavioral support. These are local reports,
not a main-app migration or automatic promotion into a verified map.

**Next milestone:** make discovery and expansion resumable through the same saved-artifact
workflow, then run a frozen repeat on untouched input before tuning it to feedback. Keep
the remaining source qualifications attached to this candidate rather than repeatedly
retuning these six examples until green. A later boundary review needs neighboring definitions
where a claim refers to another capability. Snapshot usefulness, claim support and historical
evolution remain distinct success criteria; this experiment does not settle the history scope.

## Current experiment: resumable discovery on untouched source

The run is complete at `public/graph-reviews/vscode-expansion-2`. It repeats the
three-assignment blind discovery and subsequent integration approach, now through a saved-task,
checkpointed workflow. It excludes all **100 files** with source receipts in the cumulative
baseline, leaving **15,428 eligible files** at the same pinned snapshot. This is new source
for this experiment sequence, not proof that the model has never seen VS Code in training.
Unread files may still implement familiar subsystems. The baseline is the separate revised
87-node candidate, not a human answer key; its review sidecar is not supplied to integration.

Blind discovery has produced **15 candidate nodes and four relationships** from **29 previously
uninspected files**, 42 source windows, seven location searches and 4,641 unique lines. All
three first-complete proposals passed structural and source-provenance checks and are
checkpointed. Examples include terminal environment contributions, resource timeline assembly,
configured domain restrictions, local dictation, configuration suggestions and media previews.
These are candidate responsibilities, not independently verified behavior or evidence of
capability novelty. A fresh integration agent compared them with the baseline.

The [complete blind-proposal collection](http://127.0.0.1:8880/vscode-expansion-2/discovery.html)
is separately saved; it does not perform or replace integration. The
[complete integrated map and change report](http://127.0.0.1:8880/vscode-expansion-2/index.html#changes)
now contains **103 nodes and 86 links**: 44 containment, 24 dependency, 14 support and four
overlap relationships. All 102 input nodes and 74 input relationships have explicit lineage.
The model retained 84 baseline and nine discovery definitions exactly, revised three baseline
and six discovery definitions, and added one broader marker-conflict grouping. No identity
merges, splits or removals occurred. All original relationships remain exact, with 12 new
relationships. Eighteen comparisons record 14 distinct, three overlapping and one narrower
decision; these counts are judgments, not accuracy scores.

Concrete changes include expanding the existing terminal grouping to include environment
contributions, joining marker-conflict decoration/comparison/acceptance while keeping the
merge editor separate, and linking local transcription to an existing filler-cleanup helper.
Additional source establishes a live browser-filter change listener. Other revisions narrow
cache reuse, configuration-array and gist error-handling claims instead of simply making
summaries broader. Image zoom/copy effects remain unresolved, and a metered-connection tooltip
was not promoted into an assertion that background work is actually suspended.

Integration used eight additional source windows and four searches. Cumulative inspection
is **131 files, 192 source windows and 18,865 unique lines**; this is not capability coverage.
All first-complete outputs were preserved and passed structural/provenance validation without
a post-save correction. The complete integrated map was frozen before owner review. This
is not same-input repeatability, a wording-effect experiment, runtime validation or history.

The first integration attempt terminated with a subscription usage-limit error before saving
any result or additional evidence. A live account check then reported no reached limit and
0% consumed, conflicting with that failure. One explicit retry of the same integration task
was started, with the same frozen inputs and original evidence budget. No reset credit was
consumed and no API key was used. The terminal failure and retry are separately recorded;
discovery was not rerun. The retry subsequently completed. A saved handle alone was not treated
as proof of liveness. The integration builder also stopped once before writing because its
guard compared formatted-file bytes to a compact-JSON fingerprint. That mechanical guard was
corrected after verifying the frozen parsed input; the failure record is preserved, and no
semantic decision changed. Output/report regeneration verified byte-identical artifacts.

**Workflow checks completed before reporting a result:** preparation/resume, partial-evidence
budget continuity, saved-handle versus actual-liveness distinction, invalid-output retention,
exact checkpointing, integration input-set pinning, output-only recovery, cumulative exclusion,
broker locking, baseline excerpt provenance, integration instruction/task integrity and
assignment namespaces. An independent read-only code review identified the last three gaps;
they were fixed before freezing this run. All **397 tests** pass, with signing disabled only
for temporary Git fixtures, and the build passes. The original evidence broker is unchanged.
The complete report has no missing local targets or duplicate IDs across 2,238 links and
301 IDs. Desktop and 390-pixel iframe layouts and the rendered summary were inspected.
Standalone browser automation failed to launch, including its escalated retry; native-mobile
emulation and automated overflow checks were not completed. This is a report-QA tooling limit,
not a lost or altered experiment output.

The first workflow-test invocation and its escalated retry failed only in fixture-directory
cleanup with `EPERM`. Tests now create an isolated Git workspace under the system temporary
directory; all thirteen workflow tests pass. Partially cleaned, ignored `workflow-test-*`
fixture directories remain in the report directory from those first two invocations. No paid
experiment output was removed or overwritten. This environment issue is not evidence that
the discovery method failed.

The [architecture](ARCHITECTURE.md#snapshot-workflow-saved-work-and-live-execution-are-separate)
owns the workflow's implementation boundaries. Host tools still dispatch and check live agents;
the wrapper cannot infer liveness from saved handles. It also does not yet provide a generic
repository adapter, production viewer integration or historical capability updates.

### Engineering follow-up: preserve review findings across expansion

The first expansion report correctly withheld reviewer feedback from discovery, but did not
display earlier unresolved findings on retained definitions. A separate
[review-aware view of the same map](http://127.0.0.1:8880/vscode-expansion-2/reviewed-checked.html#old:old:A6)
now links **25 earlier review records across six capabilities** to their exact predecessor
version, claim content and source receipts. All reviewed content matches after one explicit
namespace mapping. Three reviewed capabilities acquired incident relationships: local-history
operations, the language-assistance grouping and completion assembly. Their old reviews are
not reviews of those new relationships or changed context.

The unresolved local-history allocation, completion cancellation qualification and marker
styling qualification remain visible on the relevant capabilities. This neither applies a
new correction nor inherits approval. Earlier supported labels remain available in the raw
history alongside adverse field findings. The map and all discovery/integration inputs stay
unchanged; no model call was needed for this deterministic linkage.

Read-only code review caught a removed-node history-loss edge case and missing split/merge
warnings in the first implementation. Those were fixed and tested; the initial derived report
is preserved separately from the checked view. Ten focused tests cover version/citation
tampering, namespace collisions, changed surrounding definitions, stale claim indices,
split/merge/remove lineage, changed relationships and escaped rendering. All **407 tests**,
the build, whitespace checks and exact regeneration pass. This is an implementation follow-up,
not another independent semantic experiment.

### Temporary engine completion audit

| Requirement established in this work | Current evidence and limit |
| --- | --- |
| Model-led discovery without owner labels | Blind VS Code source assignments and complete candidate maps are saved. Broad owner approval exists for earlier maps, not a low-level answer key. |
| Explicit, revisable behavioral boundaries | Definitions, comparisons and lineage support revisions, merges and broader groupings. This does not establish that every boundary is correct. |
| Multiple relationships and nonfixed depth | The graph supports containment, dependency, support and overlap; earlier runs demonstrate shared children and deeper structure. |
| Preserve evidence and resume safely | Frozen input/receipt checks, checkpoints, real interruption recovery and exact replay pass. Host liveness remains external to saved artifacts. |
| Keep usefulness separate from reliability | Candidate status and version-linked historical review findings now coexist without automatic promotion or discovery feedback. Remaining source qualifications are not erased. |
| Stable decisions as the map grows | Two fresh fixed-evidence integrations share eight of nine group member sets, but disagree on two shared comparison labels and one definition revision. This is limited recurrence evidence, not long-run stability or semantic correctness. |
| Broader engine scope | Generic repository adaptation and main-app delivery are not complete. Historical capability evolution is **in** the consolidation milestone but not yet implemented (history plane + decision-scoped integrate). |

The full engine goal remains open. No count of passing tests or additional candidate nodes
substitutes for the unresolved semantic and scope requirements above.

## Current experiment: fixed-evidence integration stability

[Compare both complete maps](http://127.0.0.1:8880/vscode-integration-stability-1/index.html).
The two fresh integrators received the same 87 baseline definitions, 15 blind proposals,
74 input links and 192 available source receipts. Earlier integration conclusions, owner
feedback and the other arm's output were withheld. Neither could retrieve new evidence.
Supplementary source from the earlier interactive integration was available from the start,
so this is a new controlled pair, not an exact rerun of that integration or of discovery.

**The broad organization recurs more consistently than the boundary labels.** Both first
complete outputs are structurally valid: 104 capabilities, nine containment parents and two
layers (one containment edge from root to leaf). All 102 input identities remain separate;
all 74 input links are retained. A adds 15 links; B adds 16. Eight original-descendant group
member sets recur, including the new conflict-marker grouping and the broadened terminal
and language-assistance groupings. A additionally groups local dictation preparation and
transcript processing; B instead groups media previews. Equal node counts conceal this
different organization. Member-set recurrence is not full hierarchy or identity agreement.

The agents chose 18 versus 17 distinct alternative sets to compare; only eight sets match
exactly. Six shared sets have the same relation-label sets. The two disagreements are:

- Extension terminal-environment contributions versus terminal creation: A calls them
  distinct responsibilities; B calls their launch-preparation facet overlapping.
- Conflict-region decoration versus acceptance and comparison: A distinguishes the visual,
  editing and comparison outcomes; B also counts shared region recognition as overlap.

Both still preserve separate capabilities and connect them under broader groups. This is
not evidence that one map is wholly wrong. It exposes a specific unsettled decision:
whether shared supporting work counts as shared capability behavior. Comparisons against
multiple alternatives can also blur which individual pair the label applies to. The ten
comparison sets unique to A and nine unique to B are neither agreements nor disagreements
on unseen alternatives.

One definition revision differs: B narrows gist-reading error handling, while A retains
the broader claim. The saved `C-008` source puts client acquisition before the `try` block;
only retrieval/content-access failures inside that block are caught. B captures that local
qualification. This is a source-grounded example of revision incompleteness in A, not an
overall accuracy score or runtime test. The 101/102 matching action words are dominated by
95 common retains and should not be a correctness headline.

Evidence availability was held fixed, but selection was not: A reports consulting 74
receipts, B 71, with 67 shared. Those are self-reports, not instrumented token exposure.
No winning structure, merges, corrections to the current map or owner labels were selected
from this pair. Raw outputs are preserved without semantic retry. No external model API
calls or reset credits were used.

The frozen metrics and a separately planned pre-result presentation/checking layer are
saved together. Supplemental checks find no duplicate successors, malformed splits/merges,
empty original-member groupings or decision citations missing from reported reading lists.
The comparison code deliberately does not infer semantic equivalence from matching names.
All **416 tests** and the build pass; these validate software behavior, not model accuracy.

**Follow-up tested below:** require a pair-specific, source-linked witness of shared observable
behavior, separately from shared implementation or supporting work, before choosing an
overlap label. The model should still choose the boundary and explain what would revise
it. Freeze that representation before fresh judgments; do not supply the labels above as
expected answers or repeat until agreement. The full engine goal remains open: historical
evolution is milestone-in-scope but unimplemented here; general adaptation and app delivery
remain separate gaps.

## Current experiment: pair-specific behavioral witnesses

[Read all 32 decisions and their source excerpts](http://127.0.0.1:8880/vscode-boundary-witness-1/index.html).
This controlled follow-up used eight pairs and the same 37 available source receipts
(4,108 excerpt lines, not deduplicated unique-line coverage). Two fresh agents used prose
comparisons; two used an explicit witness record distinguishing each side's behavior,
shared observable behavior, shared implementation, residual responsibilities and a predicted
distinguishing scenario. Both formats required a current disposition, evidence, uncertainty
and what would revise the decision. Source-reading lists remain self-reports: 37/34 receipts
for prose and 34/33 for witnesses. No prior labels or owner examples were supplied.

**The witness format did not improve label recurrence. It made one remaining disagreement
more inspectable.** Prose agreed on 8/8 pairs; witnesses agreed on 7/8. Both prose runs and
the first witness run called every pair distinct. The second witness run called conflict
decoration versus virtual diff comparison overlapping; all other labels matched. All four
first-complete responses passed structural checks without repair. Agreement is not accuracy,
and the unanimity of the prose controls is not a reason to prefer their semantic decisions.

The differing witness is concrete: both presentations let a reader distinguish current
from incoming conflict content without accepting either side. Its source ranges point to
the decorator's current/incoming labels and ranges (`C-002:81–123`, `C-003:197–215`) and
the comparison's separate alternatives and named diff request (`old:C-012:108–118`,
`old:C-012:133–147`). It also preserves residual differences: inline ancestor/marker
decoration versus full-document alternative comparison. The other witness treats those
different presentations as distinct responsibilities despite their common inspection
purpose. Neither explanation depends only on a shared parser. The coordinator inspected
those source ranges: they support the described presentation requests, but do not uniquely
determine which abstraction deserves an overlap label or prove successful runtime rendering.

My interpretation is that the second witness is a defensible candidate for **overlap within
a named behavioral facet**, not evidence that the two capabilities should merge. This fits
the intended architecture: concrete common behavior can connect different interfaces while
their responsibilities remain separately visible. The frozen map is unchanged. No graph
schema migration, automatic approval or independent semantic audit was performed.

The control explanations already separated shared machinery from outcomes and supplied
useful qualifications. Both witness runs supplied concrete, unexecuted distinguishing
scenarios—for example, disabling conflict decorations need not disable acceptance or
comparison. Thus the evidence supports retaining this richer explanation as an optional
record for consequential/disputed boundaries, **not replacing every summary or requiring it
on every comparison**. Model-authored scope remains revisable; code only validates the
packet binding, pair accounting, available citation ranges and saved-output integrity.

Limitations matter here. The sample was selected after the earlier results: all four pairs
from disputed alternative sets, two hash-selected pairs from matching-label sets and two
from unmatched sets. Splitting a multi-alternative judgment into individual pairs does not
give those pairs inherited labels. There is no independently established positive-overlap,
same-identity or containment control, so this cannot establish false-separation performance.
It also narrows the task from global graph integration to pair judgments over selected
definitions and source. The test cannot attribute differences from global integration to
format alone, establish general stability, or settle broader parent scope. Two runs per
format are a small diagnostic, not a winning-method study.

The common 250-word guidance was met by every pair. A whitespace-based count of prose
fields averaged about 182 words per prose decision and 184 per witness decision; witness
JSON is larger because it includes structured fields and line citations. Those counts are
not token usage or cost measurements. No external model API calls or reset credits were
used. Raw results, all citations, first-output hashes and the selection rule remain in the
ignored report directory. All **429 tests**, the build, whitespace checks and exact report
replay pass. Earlier maps and frozen integration reports remain unchanged.

**Next engineering direction:** keep pair-specific evidence available as a review sidecar
without imposing a permanent taxonomy. Prioritize decision-scoped integration and the history
plane over further coverage expansion or label-agreement tuning. Historical evolution is in
milestone scope; current-snapshot success cannot stand in for that capability.

## Current engineering work: one repository workflow

The new `scripts/repository-engine.mjs` consolidates preparation, source retrieval, saved job
states, checkpointing, global integration and a complete generic report. Frozen experiment
scripts remain unchanged for replay. The supporting inventory adapter accepts local
checkouts, linked worktrees and bare repositories without VS Code-specific partitions.
Expansion uses the full pinned tree and cumulatively excludes already inspected files.

This consolidation also closes two mechanical gaps without retuning capability labels:
embedded prior review metadata is explicitly withheld from candidate inputs, and recorded
retains/revisions/merges/splits/removals are checked against actual graph changes. Search
receipts are reconstructed against source, not accepted merely because their IDs exist.

The discovery-to-report and expansion-to-report paths pass synthetic end-to-end tests,
including saved-output replay, interrupted-job handling, metadata tampering and preservation
of baseline history without transferring approval. **These are implementation checks, not
new model-quality experiments.** No new capability-discovery calls or API spending were used for this
consolidation. Model dispatch still belongs to the host, using generated task files; a live
acceptance sequence is now underway on real code, as described below.
Generic review-history projection and app integration remain separate delivery gaps.
Historical evolution is milestone-in-scope via the
[three planes](ARCHITECTURE.md#three-planes-store-decision-session-history) (Store / Decision
session / History); this runner generation still lacks history-plane ops. The
[architecture](ARCHITECTURE.md#consolidated-repository-workflow) owns the operating sequence;
the [roadmap](ROADMAP.md#immediate-next-steps) owns the delivery order.
At the consolidation checkpoint, all **476 tests**, the build and whitespace checks passed. The generic renderer was checked
in the browser against the existing 103-node saved map, including a 390-pixel-wide layout;
that reuse is a presentation check, not a fresh discovery result. Its 2,340 internal links
have no missing targets or duplicate IDs. Preparing the actual pinned VS Code repository
also succeeded (13,325 files pass the new, more conservative eligibility rules), before
discovery agents were launched. Earlier frozen engines and the accepted course map are unchanged.

### Live delivery check, not another method comparison

The unchanged consolidated entry point has now completed initial discovery and integration
on the pinned VS Code snapshot. The [complete first map](http://127.0.0.1:8880/consolidated-engine/prepared/reviewed.html)
has **37 candidates and 26 relationships**, using 54 source windows across 28 files and
4,614 unique inspected lines. All three first discovery outputs and the first integration
output were saved and checkpointed without repair. One worker deliberately stopped after
two source receipts, then resumed with the same byte-identical receipts and remaining
budget. This establishes controlled saved-progress recovery, not arbitrary crash resilience.

The live check exposed operational instructions worth clarifying: argument order for source
windows/searches and scoped navigation to avoid display truncation. These are workflow
issues, not a new hypothesis about how capabilities should be grouped. The integrator was
given explicit command syntax, but no expected labels, prior maps or owner judgments.

A concrete semantic revision failure also remains visible. The integrator disclosed that it
replaced the wrong web-serving condition: its original exact-release assertion remains next
to its intended narrower helper-delegation qualification. The reusable review-note companion
attaches that disclosure to the exact unchanged text, without claiming the runtime behavior
is false or treating the entire map as invalid. This reinforces the need to keep candidate
availability separate from claim-local review and successful correction.

The same unchanged engine has now completed expansion against the remaining eligible files.
Discovery workers did not see the first map or its review notes; integration received the
candidate baseline but not the review notes. The [complete expanded map](http://127.0.0.1:8880/consolidated-engine/expansion/reviewed.html)
has **70 candidates and 49 relationships**, with 33 comparisons covering all 31 new proposals.
All 68 input nodes and 40 input edges are accounted for: seven definitions were revised,
61 retained, and two additional grouping nodes introduced. Every first complete discovery
and integration output passed checkpointing without repair. R used four additional source
windows with no retrieval failures. Cumulative coverage is **101 source windows, 60 files
and 10,034 unique lines**, out of 13,325 eligible files—not exhaustive capability coverage.

The expansion also explicitly removed the earlier overbroad exact-release sentence without
receiving its review note. This is observable wording revision, not independent verification
of the helper behavior. A manually attached, graph-bound historical note preserves that
distinction in the new report; it is not automatic review migration or resolution.

Operational limitations remain part of the result. Discovery hit configured evidence-byte
limits and retained partial claims. The host clarified broker syntax and selective inventory
navigation, corrected R's mistaken progress count of 39 baseline nodes to the packet's actual
37, and handled dispatch/terminal observations. These interventions mean this is a successful
**host-assisted delivery sequence**, not an unattended product. Exact publication and note
replay passed. All **481 tests**, the build and whitespace checks pass. The initial qualified
report was visually checked. After the Mac became available, the expanded report's overview,
multi-parent organization, integration section and historical qualification were also visually
checked. No model API calls or reset credits were used.

The next work prioritizes decision-scoped `integrate` (explicit omissions) and the history
plane before another coverage wave or ceiling raise; host execution adapter, runtime
upgrade/replay policy and generic review continuity remain in the same delivery track. The
owner subsequently found the bounded map interesting
and broadly sensible while explicitly noting they could not understand VS Code as well as
their own repository. After the small coverage fraction was explained, they approved moving
to a larger demonstration. This is qualified broad acceptance, not proof of whole-repository
orientation or claim accuracy; their feedback remains outside discovery inputs.
No superior taxonomy, measured semantic accuracy or fresh generalization result is claimed;
the purpose here was to replace experiment-specific operation with one working procedure.

### Larger coverage-led demonstration: one wave delivered, capacity stop

The next authorized run keeps the pinned VS Code commit and existing engine, adding a
repository-neutral metadata routing supplement. The fixed ceiling is two waves of three
discovery workers and one integration each: at most 152 new source windows, 56 search
receipts and 560,000 serialized new receipt bytes. These are separate hard limits, not a
promise to fill every allowance or achieve exhaustive coverage. Each integration packet is
measured before dispatch; the 1,500,000-byte ceiling stops the run rather than silently
dropping evidence or candidate definitions.

The first route was frozen before discovery. Its regions cover chat browser code, completion
internals, local lint rules, scripts, tests and resources. These are source-directory regions,
not expected capability names. The generic frontier has 731 regions, of which 26 have at
least one earlier inspected file; that denominator differs from earlier ad-hoc directory
counts. Each worker starts in two regions and may follow cross-region evidence. Developer
tooling is in scope alongside end-user behavior; no regions were swapped to produce a
preferred feature list.

The first wave delivered **92 nodes and 73 relationships**, up from 70 and 49. All 18 new
discovery candidates received explicit comparisons to prior alternatives. Four new groupings
organize chat-edit review/checkpoints, code-completion assistance, remote-terminal workbench
requests and unsaved-work continuity without removing their detailed responsibilities.
All 88 input nodes and 55 input edges are accounted for: seven node definitions and one edge
were revised, with the remainder retained. Revisions include narrowing an inherited rename
completion claim and replacing assumed successful opening/recovery with source-bounded
dispatch or unresolved outcomes. These are proposer decisions, not independently verified fixes.

Cumulative source sampling grew from **60 files / 10,034 unique lines** to **90 files /
15,023 lines**. This wave used 45 source windows, nine searches and 233,616 serialized
receipt bytes. Of 731 routing regions, 36 now have at least one inspected file and 695 remain
untouched. A region visit is not complete inspection; 13,235 eligible files remain unread.
Discovery hit evidence-byte limits, one out-of-range request and one generic source-blob
rejection; omitted evidence was not bypassed. Integration added four windows and one search
without failures. All first saved outputs passed checkpoint validation without repair.

The second wave **stopped before model dispatch** under the frozen capacity rule. Wave 1's
integration packet was 1,392,721 bytes. The exact projected baseline for wave 2, even with
empty proposals and fingerprints, requires **1,641,089 bytes**, exceeding 1,500,000. The engine
embeds baseline source receipts twice; R verified the duplicate objects and read each unique
receipt once, but accounting retained original on-disk bytes. No evidence was dropped, ceiling
raised or live engine changed. Deduplicated, versioned evidence packaging is the concrete next
delivery issue; it will remove overhead but not solve unbounded cumulative context growth.

The reusable coverage helper and preparation wrapper pass 12 focused tests; the full suite
passes **493 tests**, including the unchanged engine's workflow tests. Build and whitespace
checks pass. No model API calls or reset credits were used. The original 70-node map remains
unchanged. Its historical web-serving qualification was manually attached after inference to
the exact retained condition; no automatic review resolution or fresh audit is implied.

Local complete result: [larger map with separate review notes](http://127.0.0.1:8880/consolidated-engine/larger-demonstration/wave-1/reviewed.html#map).
This is broader host-assisted delivery with an observed packaging ceiling, not exhaustive
VS Code understanding, semantic accuracy measurement or a winning taxonomy.
The [architecture](ARCHITECTURE.md#coverage-routing) owns the routing contract;
the ignored run plan and coverage supplements retain exact budgets, paths and provenance.

### Versioned evidence packaging and second-wave continuation: delivered

The owner authorized continuing after the capacity stop. The shared entry point now selects
the exact archived version-1 runtime for existing runs and version 2 for new runs. No old run
plans, candidate outputs or evidence were migrated or overwritten. Version 2 references
baseline receipts by ID in the integration packet instead of embedding their content twice.
Its baseline-input bytes are identical to the stopped preparation; semantic protocol,
candidate definitions, source budgets and routing rules are unchanged.

For this same 92-node baseline, the minimum packet falls from **1,641,089 to 966,809 bytes**:
674,280 bytes of duplicate packaging removed, with all 146 source receipts still present.
The 1,500,000-byte ceiling remained fixed and was checked again on the complete packet
before integration. This is packaging capacity, not evidence of improved interpretation.

All **497 tests**, the build, archived-source hash checks, exact publication replay of the
completed map and exact earlier coverage-routing replay passed. Tests exercise version-1
recovery through the shared entry point, version-2 expansion, lossless receipt references,
tamper rejection and unknown-version refusal. The continuation used three discovery workers
and one integration; combined with the first wave's actual use it remained within the
original two-wave receipt budgets. No third wave, owner labels or model API calls are added.
The stopped version-1 preparation remains an accurate historical capacity result. The new
version-2 continuation is in a separate ignored directory; the completed map is linked below.

All three first discovery outputs passed checkpoint validation: 21 new candidates and 14
relationships, using 43 source windows, eight searches and 209,684 serialized receipt bytes.
Cumulative sampling is 117 files / 19,638 lines before integration. The complete frozen
integration packet is **1,265,004 bytes**; embedding the same baseline receipts twice would
make it 1,939,284 bytes. The actual capacity gate passed, and one fresh integrator completed.
No source evidence was omitted to achieve that size.

#### Scope and execution limitations

Host handling remains a limitation. Worker C's read briefly collided with the root's
launch-record lock; the root operation completed and the lock disappeared without deletion.
The same worker resumed its pending read. While diagnosing the collision, a status listing
incidentally exposed completed older task summaries. C disclosed that context exposure and
was instructed to continue only from this run's evidence; no prior artifacts were opened or
replacement run used to erase the incident. **C is not fully blind**, so this continuation
cannot establish fully isolated discovery. That qualifies the evaluation, not automatically
every candidate claim. A's unavailable implementation and B's rejected search blob are also
retained as evidence-access limitations rather than bypassed.

#### Second-wave result

The delivered candidate map has **113 capabilities and 97 relationships**, compared with
92 and 73 before this wave. One two-input merge combines the overlapping follow-up submission
responsibility with the existing queue/steer capability. Four definitions are revised, and a
new grouping organizes inspecting and controlling live agent hosts from the CLI. All 113
input nodes, 87 input edges and 21 new-to-baseline comparisons are accounted for. This is not
a count target or a finding that more nodes means better discovery.

Useful behavioral distinctions remain explicit: transcript Find excludes content that the
accessible view can expose; code-block mapping preserves document/notebook differences;
CLI session inspection, cancellation requests, process termination and endpoint relaying
retain separate target and authentication boundaries. The inspected host's session-list shape
narrows a pagination caveat without establishing that every other host behaves identically.
These are evidence-backed proposer decisions, not independently measured accuracy.

Final cumulative sampling is **118 files / 19,871 unique lines**, with 13,207 eligible files
still unread and 690 of 731 routing regions untouched. This second wave used 45 source
windows, nine searches and 222,413 serialized receipt bytes, including two additional
integration windows and one search without retrieval failures. Both executed larger waves
together used 90 windows, 18 searches and 456,029 receipt bytes, within the original limits.
All first complete outputs checkpointed without post-save repair; in-memory drafting and
technical setup corrections are disclosed separately. The historical web-serving qualification
was manually carried forward onto the exact retained condition, still unresolved.

[Complete second-wave map with separate review notes](http://127.0.0.1:8880/consolidated-engine/larger-demonstration/wave-2-v2/reviewed.html#map).
Earlier 37-, 70- and 92-node maps replayed with exact unchanged output bytes through their
archived runtime. No third wave was launched. Deduplication removed the demonstrated
packaging barrier; integration still reads the accumulated evidence. Decision-scoped
retrieval with explicit omissions, the history plane, and host coordination remain delivery
work—not another taxonomy comparison or ceiling raise.

## Cost and provenance

Do not add every report's total to estimate spending: corrected reports can include reused
responses, extensions can inherit earlier receipts, and replay costs describe original
inference rather than new charges. Some interrupted calls have no returned usage.
Individual protocols retain their own accounting and limits. A reconciled lifetime spend
ledger has not been produced by this summary.

Paid output remains in ignored `public/` paths. Owner judgments remain separate from
discovery inputs. The accepted 47-node map is unchanged by the boundary/ownership tests.
