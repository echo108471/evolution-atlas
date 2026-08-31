# Grouping readings into capabilities

Per-commit reading produces one capability name per commit and no way to relate them.
On the pilot that is **579 distinct names across 606 units**, with only 23 used more than
once — a capability is almost never named the same way twice. Blind tier-2 reading
predicted this when it measured two models sharing 0.31 of their wording for the same
commit; at this scale, grouping by string equality recovers nothing.

`npm run capabilities` groups them two ways and compares the results. The comparison is
the point. Until a deterministic baseline exists, nobody can say what interpretation
contributes over a simple script, and that has been the most decision-relevant open
question in the project since before per-commit reading was built.

## Two arms, neither shown the other

**The deterministic arm** (`scripts/lib/capability-cluster.mjs`) sees only observed Git
facts: the directories a commit touched, at every depth, and the words in its subject.
Paths carry more weight than words, because a path is where the change landed and a
subject is whatever the author felt like typing. No reading, no model, no cost.

It clusters by **mutual nearest neighbours**, not by thresholded connected components.
Single linkage collapsed the pilot into one cluster of **568 units out of 606 at every
threshold tried** — a few sprawling commits touch enough of the tree to join unrelated
work, and connected components lets them. Requiring the link to be mutual denies a hub
that power: a hub is nobody's nearest neighbour. A baseline exists to be beaten honestly,
and leaving it degenerate would have made the comparison meaningless.

**The model arm** (`scripts/lib/capability-consolidate.mjs`) groups the proposed names.
It sees names alone — never paths, dates, authors, or the baseline's clusters. Names
split across request batches are rejoined by a second round, and a name the model drops
becomes its own capability rather than vanishing, because losing a capability silently is
worse than reporting one that should have merged.

The consolidation prompt originally illustrated "capability" with *"course search"* and
*"professor review scraping"* — two of the pilot repository's actual capabilities, which
is the answers written into the question. A test now forbids illustrations there.

## Judging them

Cluster counts cannot rank two clusterings: an arm can look better simply by splitting
more. Two measurements are used instead.

**Agreement over commit pairs.** Given two commits, do both arms put them in the same
capability? Reported as precision and recall with neither arm treated as truth.

**Naming as evaluation.** A group of commits nobody can name is a bad group whichever
method produced it — the same test the epoch work applies to periods. The same prompt
names every multi-commit group from both arms, is never told which arm a group came from,
and is told that refusing is a valid answer. Singletons are excluded, since a one-commit
group is trivially about one thing and counting them would reward whichever arm split
more.

## What was measured

Pilot repository, `course-recommender` at `ba900d8f`, 606 readings.

```
                        clusters   largest   singletons   grouped
baseline                     248        17          141       77%
model                         85        63           18       97%

agreement over commit pairs
  together in both           306
  baseline only              894
  model only               5,293
  F1 0.090   (precision 0.055, recall 0.255)

nameable, same prompt, arm concealed
  baseline               41/107      38%
  model                   28/67      42%

consolidation cost        $0.4618
naming cost               $0.0060
```

### The two arms do not agree

F1 0.090. They are not two approximations of one answer; they are different answers. The
model arm groups far more aggressively — 97% of units into 85 capabilities against 77%
into 248 — so it proposes about four times as many co-grouped pairs, and the baseline
endorses 5.5% of them.

### Interpretation does not measurably beat the baseline at grouping

**38% against 42% nameable**, on 107 and 67 groups. That difference is well inside noise,
and it is the answer to the question the roadmap has been asking: on this evidence, the
model arm does not earn its cost at grouping.

This is a negative result and it is recorded as one. It does not say interpretation is
worthless — per-commit reading itself is measurably strong, taking `unclear` from 29.7% to
0.5% and producing a calibrated confidence spread where whole-corpus interpretation
produced three values. It says the *grouping* step, as built, is not yet better than
paths and subject words.

### Two reasons to distrust both numbers

**The judge is handicapped.** It sees commit subjects only, and subjects alone were
already measured insufficient: an open-vocabulary pass over the same repository reported
itself uncertain on 46% of commits from subjects and paths. Both arms are handicapped
equally, so the comparison stands, but the absolute 38% and 42% are lower bounds on
coherence rather than measurements of it.

Feeding the judge the per-commit summaries instead would be stronger evidence, and would
also favour the model arm by construction: those summaries are what its capability names
were derived from, so it would be judged on its own inputs while the baseline would not.
That variant is therefore not a tiebreaker.

**The model arm is not reproducible.** Two runs over identical input:

```
run 1     106 capabilities, largest 27
run 2      85 capabilities, largest 63
```

The largest capability more than doubled. Any conclusion drawn from one consolidation run
inherits that variance, and the naming comparison above rests on a single run of each arm.

## What follows

The gold set is no longer deferrable. Two methods disagree at F1 0.090, neither is
measurably more nameable, and the model arm does not reproduce itself between runs. No
further tuning of either arm can be evaluated without an answer key, and the pilot is the
only subject whose owner can supply one.

Concretely, in order:

1. **Hand-grade a sample of the pilot's commits into capabilities.** Not all 606 — enough
   to score both arms, perhaps 100 commits across the history.
2. **Measure consolidation variance directly.** Run it several times and report how often
   two commits land together, which converts a non-reproducibility problem into the
   confidence measure the interpretation findings asked for.
3. **Give the judge the readings** as a secondary measurement, reported alongside the
   subject-only one rather than replacing it.
4. **Try grouping on evidence rather than names.** Both arms are extremes — one sees only
   paths, the other only names. Nothing has yet been tried that sees both.
