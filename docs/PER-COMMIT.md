# Per-commit reading

`npm run analyze-commits` reads every substantive commit individually and reports what
each one accomplishes. It exists because whole-corpus interpretation cites 10–12% of a
history and cannot be made to cite more: a single request covering 3,000 commits can
afford a dozen citations per capability, however the prompt is written. A request
covering one commit can afford its diff.

This replaces segmentation as the answer to scale. Epoch and era detection
([Epochs](EPOCHS.md)) was built to divide history so each analysis unit would fit in a
request; measured against per-commit reading it was solving a problem that turned out not
to cost much. See [Why not segmentation](#why-not-segmentation).

## Three tiers

```text
observed atlas ─> tier 0 deterministic filter ─> tier 1 volume read ─┬─> readings document
                                                                     └─> tier 2 blind re-read
```

**Tier 0** (`scripts/lib/triage.mjs`) is deterministic, needs no key, and costs nothing.
It removes 35.3% of the pilot history: merges with nothing of their own, documentation,
lockfile bumps, generated output, tooling configuration, regenerated datasets, and media
assets.

Every classification records a basis, and the distinction is load-bearing because a
commit dropped at tier 0 is never seen again:

- **structural** — provable from the change list. "Changed only `.md` files" is a fact.
- **pattern** — guessed from subject text. "Subject starts with `chore:`" is a convention
  the author may not follow.

Path evidence outranks subject convention throughout. A commit whose subject says
`chore:` but whose diff edits the parser is kept, because the subject is a convention and
the diff is a fact — and a mislabelled commit that touches real source is exactly what
this pipeline exists to find. Reverts are kept for the same reason inverted: undoing work
is a lifecycle event, and the lifecycle pass reports `removed` and `migrated` stages it
currently rarely fills.

**Tier 1** (`scripts/lib/commit-analysis.mjs`) reads what survives with a small model
under a 400-line diff budget. It reports what the change accomplishes, names the
capability it belongs to, and decides whether the commit needs a closer look.

**Tier 2** re-reads whatever tier 1 promoted, with a larger diff budget and a stronger
model.

## Tier 2 never sees tier 1's answer

It did in the first build, framed as "a claim to check". It checked almost nothing:
across 14 promoted commits it revised 3, and those revisions were rhetorical rather than
factual — the first pass had "understated the sophistication" — while its capability names
restated tier 1's with extra adjectives.

This is the same failure the epoch pass is designed around, where the model is never
shown the detector's peaks. A model shown a prior answer ratifies it, and ratification
measured against itself looks like agreement.

Read blind, the two tiers are independent readings of the same commit, so their agreement
is a measurement of tier 1 rather than an echo of it. That matters beyond this pass:
self-reported confidence is known to be unreliable here — one interpreted repository
returned three distinct confidence values, none below 0.7 — and agreement between two
models that never saw each other's answer is a better estimate of whether a reading can
be trusted than either model's opinion of itself.

## The unit is the first-parent chain, not the commit

`git diff-tree --first-parent` emits nothing at all for a merge commit. Every merge in
every generated atlas therefore recorded zero changes and no code area — 691 of the
pilot's 2,693 commits — while `analysis.mergeDiffStrategy` claimed first-parent handling
was in effect. The flag that does what that name promises is
`--diff-merges=first-parent`. Adding `-m` is not the fix: it emits one section per parent,
and with `--no-commit-id` suppressing the separators the second parent's diff arrives
indistinguishable from the first's.

With merges carrying their own diff, the analysis unit has to change too, because a merge
and the branch commits behind it now describe the same changes. The first-parent chain is
the natural unit: it is the history of the branch itself, and commits off it are states
main never had.

```
                        commits   first-parent units   reduction
course-recommender        2,693          739             3.6x     (469 PRs + 270 direct)
zod                       3,094        2,138             1.4x     (143 PRs + 1,995 direct)
```

The gain is workflow-dependent. zod squash-merges, so each pull request is already one
commit on main and first-parent walking finds little to collapse; course-recommender
merges branches, so three quarters of its history is intermediate. First-parent
normalizes both to one unit per landed change. Combined with tier 0 the pilot needs about
**638 requests against 1,777**.

Two supporting measurements: 64.5% of the commits the chain collapses touch a single file,
median one — the "wip" and "address review" increments. And a pull request's net diff is
smaller than the sum of its commits, because intra-PR churn cancels: a line added and then
revised in review lands once.

The observed atlas still covers every commit. Only the analysis unit changes, and
constituent commits remain available as evidence, so the viewer and epoch detection are
unaffected. `--all-commits` opts out.

## What kinds of commit exist

Tier 0's classes were written from inspection, so they were checked against an
open-vocabulary pass: 247 pilot commits, each shown to a model with its subject and paths
and asked to name the kind of work, with no taxonomy offered and no mention of the classes
already in use. Showing it those classes would have measured agreement with them.

It returned **173 distinct labels for 247 commits** — mostly commit-specific descriptions
rather than categories, the same failure to converge on shared wording that two models
show when naming capabilities. The signal is in what recurred, cross-tabulated against
what tier 0 decided for the same commits:

```
theme            count   of those, tier 0 called it "code"
formatting          14        13
content             14        12
data                14        14
infrastructure       7         7
tests                5         5
security             2         2
```

Four became path-provable classes. **Datasets and media assets are filtered** — a
regenerated scrape or a swapped logo is not a capability however many lines it changes.
**Tests and infrastructure are kept and classified**, because a Grafana dashboard is
something the product gained even though nothing under `src/` changed.

Three findings were deliberately not turned into classes:

- **Formatting** is provable from a diff, not from a path list. `git diff -w --numstat`
  against the plain counts would identify a whitespace-only commit exactly, at one extra
  git call. Not built.
- **Security** should raise a commit's priority, not lower it. It is the wrong shape for a
  filter.
- **Content** splits. Media is filtered; copy — an about page, a sitemap — is product work
  and stays.

The most useful result is the one that argues against doing more here. The pass reported
itself **uncertain on 46% of commits**. Subject and path evidence cannot support a richer
taxonomy than the one tier 0 now has, so naming what a change is belongs at tier 1, where
the diff is visible. Tier 0's job is removing the provably worthless, not classifying.

## Situating context is derived, not carried

A commit read in isolation cannot be understood. `fix: handle null in parser` says nothing
about what was being built.

The obvious fix is a rolling summary the model carries forward. It was rejected: it makes
commit N+1 depend on the output for commit N, which forces the whole history through one
sequential chain and changes the prompt prefix on every request, so nothing caches.
Region-owning agents — a "mentor" per subsystem — were the other candidate and have the
same defect in milder form, plus a partition that breaks when paths drift, which the
pilot does twice (`chrome-ext` → `chrome-ext-v2`, `etl` → `etl_pipelines`).

`scripts/lib/commit-context.mjs` instead derives context from the atlas: which areas the
commit touches, how old they are, how many commits they have had, which of its paths are
appearing or disappearing, and what else was recently happening in the same part of the
tree. All of it is observed, all of it is free, and none of it depends on another model
call — so the tier parallelizes.

Neighbours authored after the commit are dropped rather than reported as "earlier".
Commits are indexed in topological order, which is the order they were built in but not
the order they were authored in; 6.8% of adjacent pairs in the pilot run backwards by
date, which is how the epoch pass first produced periods that ended before they began.

## Diff budgets are a fidelity control, not a cost control

Half of zod's commits change 17 lines or fewer, and a 400-line cap removes 77% of total
volume. Most commits can therefore be sent whole for almost nothing, and the cap only
engages on rewrites, lockfiles, and generated output.

When it does engage, the answer is not to truncate mid-patch. A p99 commit is usually a
migration or a rewrite — exactly what lifecycle staging most wants to catch. An oversized
commit is rendered as a per-file summary plus the full text of whichever files fit, with
the smallest admitted first, because in a rewrite the large file is typically generated
output while the small one carries the intent.

Diffs are never written into the atlas. They are read on demand and discarded: they are
large, and they contain source that has no business in a distributable dataset.

## Readings cache by SHA

Whole-corpus analysis is not incremental — one new commit re-pays for all of them, which
is why gallery subjects are pinned to a frozen head and why `--reuse-interpretation`
exists. Per-commit readings are keyed by `sha:tier:model`, so a repository that gained ten
commits costs ten requests.

Measured on this repository after a fix that recovered four failed commits: the cold run
cost $0.0438 and 785 seconds; the re-run cost **$0.0107 and 14 seconds**, with 15 of 19
readings served from cache.

## What was measured

A full run over the pilot repository, `course-recommender` at `ba900d8f`, 2,693 commits.

```
unit      first-parent chain: 739 of 2,693 commits (27.4%)
          608 substantive after tier 0

readings  606 of 739 units read, 2 failed
          82.0% of what landed on the branch; the remainder was filtered at tier 0

cost      $0.4448    elapsed 394s    2,609,214 tokens in, 100,975 out

kinds     refactor 26.6%  fix 26.4%  extend 17.0%  introduce 13.2%
          config 7.9%  remove 3.6%  migrate 3.1%  test 1.7%  unclear 0.5%

promotion 84 of 606 (13.8%)
          because the diff was partial        68
          because the change was consequential 16

agreement 84 units read twice, blind
          capability name overlap   0.31
          same lifecycle kind       67%
          mean significance gap     0.20
```

Whole-corpus interpretation of the same repository cited 12.6% of commits. Per-commit
reading covers 82% of what landed on the branch for **$0.44**, against $1.08 for one
epoch-detection pass at 12% coverage.

### Diffs are what make a commit legible

The first run over this repository accidentally produced a controlled comparison. A stale
`--first-parent` in the diff reader meant merges returned nothing, and the chain is 63%
merges, so 407 of 600 units were read from subject and paths alone.

```
                        units   marked "unclear"
read with a diff          193      0    ( 0.0%)
read without one          407    121    (29.7%)
```

Every `unclear` reading in that run was a diff-less one. With merge diffs restored the
rate over the whole history is **0.5%**. The separate open-vocabulary taxonomy pass, which
also saw only subjects and paths, reported itself uncertain on 46% of commits. Both
measurements say the same thing: subject and path evidence is not enough to say what a
change does, and it is the diff that closes the gap.

### Confidence is no longer inert

```
zod, whole-corpus interpretation      3 distinct values, none below 0.7
course-recommender, per-commit       20 distinct values, 0.20 to 0.99
```

The flat high-confidence band that made the viewer's ranking meaningless on zod does not
appear here. Whether that is the unit, the evidence, or the model remains unseparated.

### The naming hypothesis is not settled

Capability-name overlap between two blind readings measured 0.22 on this project's own
20-commit history and 0.31 on the pilot's PR-sized units. That is the direction predicted
for larger, more coherent units, but the two runs differ in repository, unit, and size at
once, so it is not a controlled result and is recorded here as unsettled. Kind agreement
moved the other way, 82% to 67%.

Grouping readings into capabilities still cannot be done by string matching at 0.31.

### The two models agree on what a commit does and disagree on what to call it

82% agreement on lifecycle kind against 0.22 overlap on capability names is the most
consequential number here. The pairs are usually the same capability in different words:

```
shareable URL state for viewer navigation   ||  URL-based navigation state synchronization
contributor identity resolution and review  ||  Automatic identity matching and merging by confidence
atlas viewer navigation and visual hierarchy||  Progressive exploration interface for evolution analysis
```

The last pair scores zero. Token overlap understates semantic agreement, but lexical
convergence is exactly what a naive bottom-up aggregation would depend on, and it is not
there. **Grouping per-commit readings into capabilities cannot be done by string
matching.** It needs embeddings or a dedicated consolidation pass, and that pass is not
built.

### Promotion fires on "I could not see enough", not "this matters"

Nine of eleven promotions cite a partial diff. Those are not requests for a second
opinion; they are requests for more of the same commit, which a larger tier-1 budget would
answer more cheaply than tier 2 does. The two causes are recorded separately
(`depthCause`) so this stays measurable, but nothing yet acts on the distinction.

This repository's commits are far larger than a typical subject's, so the 58% promotion
rate is an artifact of the test subject and should not be taken as a general rate.

## Provider notes

Inference goes through OpenRouter's native `/v1/chat/completions` with `usage:
{include: true}`, which returns real cost per request.

The default volume model reasons before answering, and reasoning is billed and budgeted as
output. Left at its default it spent 866 of a 900-token budget thinking and was cut off
mid-JSON on 17 of 19 commits. Disabling reasoning outright is rejected — *"Reasoning is
mandatory for this endpoint"* — but `reasoning: {effort: 'low'}` measured zero reasoning
tokens and a clean stop, turning a 1,540-token answer into a 175-token one at the same
price.

Prompt caching is active on this provider: responses report `cached_tokens` above zero
once a run is under way, which is what derived context is designed to preserve.

A timed-out request is re-thrown as HTTP 408 so the shared retry policy treats it as
transient. Left as a bare `AbortError` it carried no status, `isRetryable` returned false,
and the four commits permanently dropped were the largest in the history — the slowest to
answer and the most worth reading.

## Why not segmentation

Epoch detection was built to make analysis affordable by dividing history into units that
fit a request. Priced against per-commit reading, the premise does not hold:

```
course-recommender, 2,693 commits, 100% coverage
   tier 0 deterministic filter   $0.00   (1,026 commits removed)
   tier 1 volume model           $0.41
   tier 2 depth model            $0.58
                          TOTAL  ~$1.01

epoch detection, subjects only, ~12% coverage        $1.08
```

Estimated from measured token shapes, not from a completed run on that repository. Full
per-commit reading at 100% coverage costs about what one segmentation pass cost at 12%.

Segmentation also carries a cost nothing priced. Periods are a hard partition, and a
capability built across a boundary cannot be found by a pass scoped to one side of it.
zod's "String format validators" cites commits from 2020-08-05 to 2024-12-10; under any
epoch scheme that capability is cut into pieces and each piece is read by a pass that
cannot see the others.

The boundary work is not wasted. The focus signals are cheap, deterministic findings about
where a repository's shape changed; the three boundaries only the model found are real
results; and the corroboration pattern — two independent readings, report the disagreement
— is reused directly by blind tier-2 reading. What is retired is periods as the unit that
gates what a later pass may look at.

## Not built yet

- **Grouping readings into capabilities.** The measured 0.22 name overlap says string
  matching will not do it. This is now the load-bearing gap.
- **Acting on `depthCause`.** A `partial` promotion should raise the tier-1 budget and
  re-read, not escalate to a more expensive model.
- **A controlled test of whether unit size drives capability-name convergence.** The two
  measurements available differ in repository, unit, and size simultaneously.
- **Commit bodies.** `ChangeEpisode` still has no field for them, and 708 zod commits
  carry a substantial one. They remain the cheapest unexploited evidence in the corpus.
- **A deterministic baseline and a gold set.** Unchanged from
  [Interpretation findings](INTERPRETATION-FINDINGS.md): without them, no prompt or
  architecture change here is measurable.
