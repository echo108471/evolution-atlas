# Epochs

## What this is

Epoch detection divides a repository's history into periods during which the
work was about roughly the same thing, and marks the transitions between them.

It exists because the interpretation stage reads the entire history in a single
request. That imposes a hard ceiling — the whole corpus must fit — and forces
every compression in the corpus format: truncated subjects, no commit bodies, no
diffs, at most twelve paths per commit. Epochs replace the ceiling with a rate.
Analysis can then proceed period by period, and each period can afford far more
evidence per commit than the whole history ever could.

Epochs are also the unit at which semantic state can be carried forward. A
commit is easier to understand when you know what the codebase already was and
what the project was already trying to do. Recomputing that per commit is
sequential and slow; recomputing it per epoch is a few dozen steps.

## Decision

Run two independent passes over the same history and keep the disagreement.

```text
observed atlas JSON
  ├── model pass    : raw commit windows -> proposed phase changes   (candidate)
  └── focus signals : path + subject-vocabulary divergence           (observed)
                              ↓
                   paired into boundary intervals
                              ↓
              periods, size-capped, then named per level
                              ↓
                 epoch document -> viewer "Periods"
```

The two passes never see each other. This is the load-bearing constraint. A
model shown a detector's peaks and asked "which of these are real" can only
ratify, reject, or rank within a hypothesis space that has already been fixed
for it — it can never propose a boundary the detector missed. That measures
agreement, not reading. The deterministic signals are therefore compared against
the model's output afterwards, never fed into it.

`test/epochs.test.mjs` asserts this directly: a rendered window must contain
commits and nothing matching `divergence|z-score|boundary|peak`.

## The two passes

### Model pass — `scripts/lib/phase-model.mjs`

Overlapping windows of 200 commits at a stride of 100, so most commits are read
twice by requests that saw different surrounding history. Each window carries
short SHA, date, subject, and up to six changed paths per commit. Nothing else.

The prompt asks where the work changed character and explicitly licenses an
empty answer:

> You may mark zero boundaries. Many slices of history are one continuous phase,
> and reporting a boundary that is not there is worse than reporting none.

That licence matters. On the pilot repository ten of twenty-six windows returned
nothing, which is the main evidence that the pass is reading rather than
producing one boundary per request because it was asked for boundaries.

Each proposal carries a `before` description, an `after` description, a reason,
and a confidence. Every cited SHA is resolved against the observed dataset;
unresolvable citations are dropped rather than trusted, as in the interpretation
stage.

Requests go to `https://openrouter.ai/api/v1/chat/completions`. This differs
from `scripts/lib/interpret.mjs`, which still routes through the Anthropic SDK
pointed at an OpenRouter base URL; new model-facing code in this project should
use the native endpoint.

The default is `openai/gpt-6-luna:batch`, shared with OpenRouter interpretation
through `scripts/lib/model-defaults.mjs`. `--model` overrides it for both
proposal discovery and period labeling. This is an OpenRouter-only path;
`OPENROUTER_API_KEY` supplies credentials, and there is no environment model
override. This default cannot run through the current synchronous transports.
An operator's Atlas-shaped Messages request on **2026-10-14** returned HTTP 404:
`openai/gpt-6-luna:batch cannot be used with the chat/completions endpoint (adapter OpenAIBatchAdapter).`
The operator-reported [model page](https://openrouter.ai/openai/gpt-6-luna:batch)
requires Batch API submission, which Atlas does not implement. Atlas now
rejects `:batch` model IDs before sending a synchronous request; without that
guard, the default would encounter the provider's 404. Use
`--model openai/gpt-6-luna` explicitly for synchronous proposals and labels.
See [request formats and preserved experiment
pins](EXPERIMENTS.md#model-defaults-and-request-formats) for the observed error
and Batch API requirements.

### Focus signals — `scripts/lib/epochs.mjs`

Two deterministic detectors, both observations about the recorded history:

- **Path focus** — for each interior position, the Jensen–Shannon divergence
  between the distribution of two-level path prefixes in the 60 commits before
  and the 60 after.
- **Language focus** — the same measure over commit-subject vocabulary, with
  common commit words removed so the signal tracks what changed rather than how
  the team writes messages.

Divergence is reported in bits: 0 when the two halves touch the same things in
the same proportions, 1 when their supports are disjoint. Scores are then
standardized across the repository, because what counts as a sharp shift depends
on how varied that repository's work normally is.

The two detectors are not redundant. Measured on the pilot repository their
standardized scores correlate at **r = 0.468** — they share about a fifth of
their variance. Each sees transitions the other does not.

## Boundary intervals

Peaks and proposals are paired, and the pair is recorded as an **interval**
rather than a single commit.

This is not a tie-break mechanism. Measured on the pilot, the two passes find
the *same* transition at *different* moments — usually within a few days, and in
either order. A model reading commit messages notices that the team's intent
changed; the path detector notices when the file layout finished catching up.
Neither is wrong, and picking one discards real information.

So a boundary spans both readings, and the commits inside that span belong to no
epoch. They are the transition. For downstream analysis this is strictly better
than forcing them to one side: those are precisely the ambiguous commits, and
knowing they are ambiguous is more useful than a confident wrong answer.

Two rules keep corroboration meaningful:

- **A peak must be above average.** `detectFocusPeaks` requires a standardized
  score of at least 1. Taking the top *N* always returns *N*, and on a history
  with only a few real shifts the tail of that list sits at or below the
  repository's own baseline. An early version of this code reported a boundary
  as corroborated by a peak scoring **z = −0.24**.
- **A peak corroborates at most one boundary.** Pairing is exclusive and
  nearest-first. Letting one focus shift vouch for two separate proposals counts
  one observation twice and overstates agreement. Before this rule, commit 269
  corroborated boundaries at both 184 and 288.

Together these two rules moved the reported agreement on the pilot from a
flattering 14/14 to an honest 9/14.

## Measured results — course-recommender, 2,693 commits

Run with `x-ai/grok-4.6`, 26 windows, $1.08, ~40 minutes.

```
26/26 windows completed, 0 failures
0 citations naming a commit outside the dataset
10/26 windows returned no boundary at all
22 proposals -> 14 clustered boundaries
confidence 0.60 – 0.86 across 12 distinct values
```

Pairing outcome:

```
corroborated by a focus shift  9/14
proposal only                  5/14
focus peaks with no proposal   2
```

Interval spans, where both passes saw the same transition:

```
proposed → settled   span
   288  →   269      19 commits, 12 days
   884  →   865      19 commits,  4 days
  1750  →  1699      51 commits,  4 days
  2182  →  2170      12 commits,  4 days
  2443  →  2487      44 commits,  4 days
```

Median span roughly 24 commits and 4 days.

### What only the model found

Three boundaries had no focus peak within reach. They are the argument for
keeping the model pass primary:

- **A shift from shipping to stabilizing.** After a month-long pause following a
  demo, work became JSX-to-TypeScript conversion and formatting. *Both* signals
  were below their own averages here (z = −0.90 path, −1.02 language) — the
  files and the vocabulary barely moved. Only the intent did. Two independent
  windows proposed it.
- **A subproject ramping up.** A new `chrome-ext-v2` directory began absorbing
  most commits. Both signals sat at the mean, because a gradual ramp produces no
  spike.
- **A backend and ETL rewrite**, carrying the run's highest confidence (0.86).

### What only the detectors found

Two focus peaks had no proposal near them. Both were path-structural, which is
the cheap signal to keep running regardless.

A caution for anyone re-running this comparison: an early analysis reported
thirteen "detector-only" peaks, including the two strongest structural events in
the history, and read that as the model missing the obvious. Measuring the
distance to the nearest proposal showed eight of the thirteen were within 100
commits and several within four days — the same transition, dated differently.
The match window was too tight, not the model too blind. Set `reach` from
measurement rather than intuition.

## How deep the hierarchy goes

Depth is derived from the history rather than fixed, because segmentation exists to make
later analysis fit in a request. What has to fit is the periods' summaries, so that is
what decides the depth.

| history | depth | result |
| --- | --- | --- |
| up to ~400 commits | 0 | no periods; the history is analyzed whole |
| roughly 400–4,500 | 1 | epochs |
| larger | 2 | epochs grouped into eras |
| very large | 3 | a third level, then capped |

`planHierarchy` reports its reasoning in the document, and the viewer prints it. The
pilot derives **depth 1**: 2,693 commits divide into about eighteen periods, and eighteen
summaries fit one request, so an era level would add a lossy layer and buy nothing.

Depth is capped at three deliberately. At depth three an early commit is already
understood through two intermediate summaries; each further level compounds the loss
while moving the reader further from the evidence.

Levels are generic rather than hardcoded — `epoch`, `era`, `age`, then `level-N` — so
"more than eras" needed no new concept. Grouping cuts at the *strongest* boundaries
available rather than at even intervals: a corroborated boundary outranks an
uncorroborated one, and confidence breaks ties.

## Period size is capped

A boundary pass finds the transitions it can see. It does not promise that what lies
between them is small enough to be useful, and segmentation exists to bound the unit that
later analysis runs over — a 351-commit period spanning most of a year defeats that
purpose whatever it contains. Periods are therefore subdivided past **250 commits or 120
days**, cutting at the most divergent interior position, or halving when no usable signal
exists inside.

A size split is not evidence of anything and says so: it carries no `closedBy` boundary
and is marked `splitReason: "size"`, so a reader can always tell a cut the passes found
from a cut the code imposed.

**This cap was built as a coherence fix and it is not one.** See the next section: the
correlation it was based on did not survive being acted on. It is kept for the bounding
reason above, which stands on its own.

## Naming, and why it is also the evaluation

Each period gets one model request. Epochs are named from an even sample of their commits
plus their most-touched areas; eras are named from the labels and summaries of the epochs
inside them, never from raw history. That is what keeps a coarse period's request bounded
however long the repository is.

The prompt allows the model to refuse:

> If the commits have no common thread, say so: set coherent to false [...] A period that
> cannot be named is useful information about where the boundaries were drawn.

That refusal is the cheapest evaluation signal the system has, and on the pilot it
immediately reported a problem nothing else did. **Nine of fourteen epochs came back
incoherent** — "Mixed demo feature work" repeated across four consecutive periods — while
every scored signal beside them looked healthy: confidence values, vote counts,
corroborating focus shifts.

### The size hypothesis, and why it was wrong

The refused periods were the long ones and the named ones were not:

```
named confidently   85–253 commits   13–47 days
refused              up to 351       up to 277 days
```

That is a real correlation, and acting on it produced the size cap above. Re-running the
labeling against the newly subdivided periods falsified it:

```
                 periods   unnameable
before the cap        14      9  (64%)
after the cap         22     14  (64%)
```

Identical rate. And cuts the size rule imposed were no more nameable (5 of 8 refused) than
cuts the two passes found (9 of 14). Splitting a long period produced two shorter periods
that were still unnameable.

The likelier explanation is that **much of this repository's history has no single theme.**
It is a multi-contributor project with parallel workstreams, and "mixed frontend product
work" is an accurate description of a stretch where several unrelated things were built at
once — not a symptom of a misplaced boundary. Some histories have phases; this one has
them at the start and end and much less in the middle.

Span still separates the two groups imperfectly — every coherent period runs 47 days or
fewer, while refused ones reach 138 — but short does not imply coherent: a 41-commit,
13-day period was also refused.

What this means for the roadmap is that **a coherence rate is a property to report, not a
number to optimize.** A repository where most periods cannot be named is telling you
something true about how it was built, and forcing nameable periods onto it would be
manufacturing a story. The open question is whether feature discovery scoped to a
*nameable* period beats whole-history discovery by more than it does on an unnameable one.

## Running it

```bash
node scripts/epochs.mjs --in scratch/atlas.json --model openai/gpt-6-luna --allow-paid \
  --save-proposals scratch/proposals-next.json --out scratch/epochs-next.json
```

Needs `--allow-paid` and `OPENROUTER_API_KEY`. Requests run one at a time, with
one further request per period for naming. The historical runs took
**40–180 seconds per window** for boundary detection; those timings do not
describe Luna. The example overrides the configured batch default, which
cannot use the current synchronous transport.

`--no-labels` skips naming entirely and needs no further requests. `--depth <n>` forces a
hierarchy depth instead of deriving one, which is mostly useful for exercising the era
path on a repository that does not need it.

Iterate on the deterministic half without paying again:

```bash
node scripts/epochs.mjs --in scratch/atlas.json \
  --proposals scratch/proposals-next.json --no-labels \
  --out scratch/epochs-replayed-next.json
```

This replay runs no model request at all, mirroring
`npm run interpret -- --revalidate`. Saved proposals record the repository they
came from and are refused against a different repository or full head SHA.
The saved proposal model remains in the replay document's provenance and
`method`, even if the default or `--model` differs. With labeling enabled,
`--allow-paid` and credentials are required; newly requested labels record
their selected model separately. Output files must be new paths.

Other options: `--model`, `--window`, `--stride`, `--peaks`, `--compact`.

The viewer reads `public/epochs.json` if it is present and adds a **Periods** tab. The
file is optional: producing it needs a model credential, the atlas does not, and the
viewer works unchanged without it. A document generated against a different head commit
is ignored rather than rendered, because boundaries are commit indices and a stale
document would point at the wrong commits.

`public/epochs*.json` is gitignored, and gallery builds strip it from `dist/` exactly as
they strip local datasets — an epoch document quotes commit subjects and dates, so it
carries the same history.

## Output

A separate document, not part of `AtlasDataset`. Viewer integration is not
built.

```jsonc
{
  "schemaVersion": "0.1.0",
  "repository": "course-recommender",
  "headSha": "…",
  "method": "epoch-boundaries:openrouter:x-ai/grok-4.6",
  "boundaries": [{
    "status": "candidate",
    "confidence": 0.78,
    "votes": 2,                  // overlapping windows that proposed it
    "proposedIndex": 2182,       // where a reader saw the change
    "settledIndex": 2170,        // where the history measurably changed shape
    "startIndex": 2170,
    "endIndex": 2182,
    "spanCommits": 12,
    "spanDays": 4,
    "corroborated": true,
    "before": "…", "after": "…",
    "signals": [
      { "kind": "phase-proposal",      "basis": "candidate", "weight": 0.78 },
      { "kind": "path-focus-shift",    "basis": "observed",  "weight": 2.06 }
    ]
  }],
  "epochs": [{ "startIndex": 0, "endIndex": 2170, "commitCount": 2170, "closedBy": "epoch-boundary:…" }],
  "unpairedFocusPeaks": []
}
```

`basis` separates the two kinds of claim, as elsewhere in the evidence model:
`observed` for a measured divergence, `candidate` for a model's reading.

## Not built yet

- **Eras.** A coarser pass grouping epochs, needed only when the carried
  semantic state outgrows a single request. The pilot's 39 capabilities do not
  come close. Build flat first; every summarization level is lossy and the
  losses compound.
- **Epoch labeling.** One model call per epoch. This is the cheapest available
  quality check on the boundaries themselves: if the labels read like "the
  demo-to-product restructure," the cuts are real; if they read like
  "commits 1446–1699," they are not.
- **Viewer integration.** Nothing renders epochs.
- **Feeding epochs back into interpretation.** The actual point of the exercise.
- **Structural episodes and release tags as boundary inputs.** `structure.mjs`
  already detects repository reorganizations deterministically and they are not
  yet consulted here.

## Known limits

- **Untested outside the pilot.** Every number above comes from one repository
  of 2,693 commits. `zod` has been analyzed but not with this pass.
- **Windows are commit-count based**, so a period of dense activity and a period
  of sparse activity are read at the same granularity despite covering very
  different spans of time.
- **`minCommits` silently drops cuts** that would create a runt epoch. A real
  boundary shortly after another is discarded rather than reported.
- **Contributor turnover is not a signal**, though the data is available and a
  changed active author set often marks a changed project.
- **Non-reproducible.** The model pass is not deterministic; re-running will
  move boundaries. Nothing yet measures how much. Saving proposals pins a run,
  which is a workaround rather than an answer.

## Prior art

- **DeepCommit / SWE-Milestone** ([arXiv 2603.13428](https://arxiv.org/html/2603.13428))
  reconstructs "Milestone DAGs" from commit history using the same division of
  labor: static analysis extracts structural signals including file co-change
  statistics, and an LLM agent reasons over them. Their milestone decomposition
  targets a size coefficient of variation below 1.0, they treat 100% commit
  coverage as a validity criterion rather than a metric, and they name
  pretraining contamination of popular repositories as a limitation of their own
  benchmark.
- **Meta-Chunking** ([arXiv 2410.12788](https://arxiv.org/abs/2410.12788))
  segments text by model *perplexity* rather than by asking a model where to
  cut — using the LLM as a measuring instrument instead of a judge. Not applied
  to commit histories anywhere found, and a plausible third signal here: a
  commit the model did not expect, given the preceding ones, is a candidate
  boundary. It would be cheap and stable at temperature 0.
- The deterministic side has long precedent; **change clusters** were used to
  segment PostgreSQL's evolution into maintenance and new-development phases in
  [ICPC 2006](https://www.cs.drexel.edu/~mancors/papers/ICPC06.pdf).
