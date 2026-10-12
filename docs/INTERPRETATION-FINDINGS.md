# Interpretation findings

Measurements of what the interpretation stage actually produces, taken against two
generated datasets. They are recorded here because none of them are visible from the
viewer, several contradict what the pipeline appears to claim, and together they are the
reason epoch detection exists.

Everything below was measured on shipped output, not estimated.

## The atlas covers about a tenth of the history

```
                      commits   cited by a feature   by an episode   union
course-recommender       2,693                212             317     339   (12.6%)
zod                      3,094                212             297     314   (10.1%)
```

Nine of every ten commits appear nowhere in the atlas. The product describes itself as a
map of how a codebase grew; what it contains is a set of capabilities, each illustrated by
a handful of commits.

The cause is visible in the evidence-size distribution. On zod:

```
feature evidence sizes   2:6  3:6  4:4  5:2  6:7  7:4  8:6  9:1  10:2  12:1
episode evidence sizes   1:48  2:41  3:35  4:7  5:5  6:2
```

Nothing above twelve; half the lifecycle episodes cite a single commit. The model is
answering *show me this capability exists* — which a dozen citations do — where the
product asks *show me how this capability was built*, which needs the rest.

A worked example. zod's "String format validators" cites twelve commits, all correct:

```
2020-08-05  Add regexp validation for strings
2021-05-15  feat: String cuid validation
2023-02-16  feat: z.string().emoji()
2024-12-10  feat: Add JWT string validator
…
```

But 121 zod commits mention a string-format term, and the feature cites ten of them. Among
the uncited are `Fixed uuid regex bug`, `Fixed regex bug`, and `Merged .regex
implementation` — not noise, but the capability actually being built.

Nothing in the pipeline reports this number.

## Feature counts are set by the flag, not the repository

`--max-features` defaults to 40. zod returned **39**. Lifecycle episodes returned 138
against a cap of 160.

Saturating the cap means the count of capabilities in a published atlas was decided by a
constant in `scripts/interpret.mjs`. Raising it is the cheapest experiment available and
has not been run.

## Model confidence is repository-dependent, and on one repository it is inert

Same model, same prompts, same two passes:

```
zod                  0.7, 0.8, 0.9 only        3 distinct values, none below 0.7
course-recommender   0.62 … 0.94              22 distinct values
```

Lifecycle stages diverge the same way: course-recommender exercises all five, including
`removed: 12` and `migrated: 17`; zod produced `removed: 0` and `migrated: 6`.

The system prompt tells the model to use the full range and says that below 0.5 means a
maintainer should probably reject the candidate. On zod it never went below 0.7 once. The
viewer ranks and filters on this field.

Two explanations remain open, and two data points cannot separate them. The dull one is
that course-recommender genuinely has more turnover — `chrome-ext` to `chrome-ext-v2`,
`etl` to `etl_pipelines`, the whole `demo/` prefix disappearing — so things really were
removed and migrated. The uncomfortable one is that **zod is a well-known repository and
course-recommender is not**: a model that recognizes zod's documented API can name
capabilities confidently without reading the commits, which is exactly the flat
high-confidence band observed.

This is not idle speculation. The DeepCommit authors name pretraining contamination of
popular repositories as a limitation of their own benchmark
([arXiv 2603.13428](https://arxiv.org/html/2603.13428)). If it holds here, benchmarking on
recognizable open source measures recall rather than analysis, and the private pilot is
the more informative subject rather than merely the more convenient one.

**Recommended check:** compare confidence spread and evidence density across a
better-known and a lesser-known repository of similar size, and inspect whether zod's
feature labels track its published documentation more closely than its commit record.

## The corpus discards the best available evidence

`buildCorpus` sends commit subjects truncated to 160 characters plus up to twelve paths.
Commit **bodies are never captured at all** — `ChangeEpisode` has no field for them.

708 zod commits carry a substantial body. The following adapted example is based
on [Zod commit 21a6f0cbd3bef24d47e488a48cc9cb4d0bf97743](https://github.com/colinhacks/zod/commit/21a6f0cbd3bef24d47e488a48cc9cb4d0bf97743),
not a verbatim full commit body. See the
[source attribution and MIT notice](../THIRD_PARTY_NOTICES.md#historical-zod-example-and-proposed-demo).

> **subject** `feat(v4): let z.nanoid() take a custom length (#4004)`
>
> **body** A nanoid is 21 characters only because that is the generator's default `size`;
> `nanoid(10)` and `nanoid(64)` are ordinary documented calls, so the fixed `{21}` regex
> rejected ids real producers emit. Only the count varies — the default alphabet is
> exactly the 64 characters the existing class already spells — so the length rides on the
> def and the character class is untouched.

The subject says what changed. The body says why, what it relates to, and what was
deliberately left alone. For a pass whose entire job is grouping commits into
capabilities, that is the difference between inferring from filenames and reading the
author's own account.

## A third of the corpus cannot be a capability

Pattern-matching zod's 3,094 subjects:

```
docs / readme / typos       501
releases / version bumps    306
merge commits               269
chore / lint / ci           101
reverts                      21
dependency bumps             15
────────────────────────────────
union                     1,180   (38.1%)
```

Feature discovery reads all of it. More than a third of what it reads is structurally
incapable of being a capability, and the deterministic layer could mark those before the
model ever sees them.

## Deep per-commit analysis is cheaper than it looks

zod's diffs, measured across 2,765 commits that have one:

```
p50           17 lines
p75           72
p90          243
p99        7,956
max      106,221

total changed lines           846,253
total with a 400-line cap     192,597   (−77%)
```

**Half of all commits change seventeen lines or fewer.** Per-commit analysis is therefore
nearly free for most of a history and expensive only for a handful of outliers, and the
cap carries the entire cost argument: a small number of giant commits — lockfiles,
generated output, rewrites — are three quarters of the volume.

The p99 commits are also the interesting ones. A 7,956-line commit is usually a migration
or a rewrite, precisely what lifecycle staging most wants to catch, and precisely what
cannot be sent whole. Depth gating is therefore a fidelity control, not a cost control:
small commits get their whole diff, large ones get a structured summary.

There is also a property the current design cannot have at any price. Whole-corpus
analysis is **not incremental** — one new commit re-pays for all of them, which is why
gallery subjects are pinned to a frozen head and why `--reuse-interpretation` exists.
Per-commit analysis is cacheable by SHA, so a new commit costs one request and an atlas
can be kept current.

## What follows

Epoch detection ([Epochs](EPOCHS.md)) was the first attempt: divide history so each unit
fits a request. Priced against the alternative it turned out to be solving a problem that
does not cost much, and a hard period boundary makes a capability built across it
unfindable.

[Per-commit reading](PER-COMMIT.md) is the answer that replaced it. It reads every
substantive commit rather than sampling the corpus, reaching 95% of history against the
10-12% measured above, for roughly what one segmentation pass cost. It also addresses
items 1 and 5 below directly: coverage is reported by the run itself, and tier 0
pre-classifies non-feature commits deterministically before any request is made.

Still unaddressed, roughly in order of expected value:

1. **Coverage is unmeasured and unreported.** Whatever the pipeline does next, it should
   print what fraction of commits it accounted for.
2. **No baseline exists.** Nobody has compared these features against a deterministic
   clustering of commits by shared paths and subject tokens. Until that number exists, the
   interpretation stage's contribution over a simple script is unknown — and it is the
   most decision-relevant number in the project.
3. **No gold set exists.** Hand-grading the pilot's 37 features is what makes every later
   prompt change measurable rather than a matter of taste. The pilot is the right subject
   because its owner can check the answers.
4. **Self-reported confidence could be replaced with a measured one.** Running feature
   discovery several times and scoring a capability by how often it recurs converts the
   known non-reproducibility from a problem being worked around into the measurement
   itself.
5. **Commit bodies and noise pre-classification** are the two cheapest corpus
   improvements, and neither needs a new architecture.
