# Grouping readings into capabilities

Per-commit reading produces one capability name per commit and no way to relate them. On
the pilot that is **585 distinct names across 605 units**, with only 15 phrases used more
than once, covering 35 commits between them. The reading prompt explicitly asks for
reusable wording — *"use the same words you would use if you saw a related commit later,
since these names are compared across commits"* — and the words are in fact shared:
`course` appears in 157 names, `frontend` in 91, `etl` in 75. It is the phrases that are
unique, averaging 5.2 words. An independent per-commit call can be asked for a shared
vocabulary but cannot be given one, because it has no access to the vocabulary.

`npm run capabilities` groups the readings four ways and compares them.

## Correction: all four arms impose the wrong shape

The four-arm comparison is valid as a comparison of flat grouping methods, but not as a
measurement of capability quality. After the measurements below were complete, the
repository owner named roughly thirteen broad capabilities. The four arms return 81, 256,
287, and 398 groups; even an unambiguous 17-commit blog capability is split across 11–13
groups. All four methods are solving a task 10–50 times finer than the owner's concept of a
capability.

The cause was partly designed in. The defaults were chosen to prevent any group from
holding more than a tenth of the corpus, and groups over that size were called blobs. One
owner-recognized capability covers roughly 28% of the pilot. The rule structurally forbids
that answer. It is retracted: size can identify an umbrella to inspect, but cannot decide
that it is invalid.

There is a second mismatch. These arms partition commits into one flat set, while one
capability may contain meaningful sub-capabilities and a cross-cutting commit may support
more than one. The measurements below remain useful for understanding evidence channels,
model stability, and judging noise. Conclusions about which arm groups capabilities well
do not survive the granularity error.

[Blind hierarchical capability induction](CAPABILITY-INDUCTION.md) records the replacement
experiment. It withholds the owner's list, infers umbrellas and children from the readings,
and allows overlapping evidence.

## Four arms, and why three of them share one routine

The first version of this comparison had two arms and could not interpret its own result.
The baseline saw paths and subjects and clustered them; the model arm saw capability names
and had a model group them. They disagreed at F1 0.090, and nothing in the design said
whether the evidence or the method was responsible.

Three arms now share one clustering routine — the same mutual-kNN, the same neighbour
count, the same floor — and differ only in which evidence channels the similarity may
read.

| arm | directories | message | capability | summary |
| --- | --- | --- | --- | --- |
| `baseline` | 0.65 | 0.35 | — | — |
| `reading` | — | — | 0.65 | 0.35 |
| `combined` | 0.325 | 0.175 | 0.325 | 0.175 |

`combined` is the plain mean of the other two, and a test holds it there. With no gold set
there is nothing to tune a mixture against, so a hand-tuned one would only be fitted to
whichever arm looked better afterwards.

The fourth arm, `model`, hands the capability names to the configured analysis model
(default `gpt-6-luna` through OpenAI; runs recorded here used `x-ai/grok-4.6`) and asks
it to group them. It sees names alone — never paths, dates, authors, or another arm's clusters.

`message` is the commit subject plus its body, with merge provenance removed. `Merge pull
request #431 from AggieWorks/prefetch-api` contributes `prefetch-api` and not
`AggieWorks`: grouping commits by whose fork they arrived through is not a capability, and
is contributor history being used to impose structure.

Clustering is by **mutual nearest neighbours**, not thresholded connected components.
Single linkage collapsed the pilot into one cluster of 568 units out of 606 at every
threshold tried. Requiring the link to be mutual denies a hub that power: a hub is nobody's
nearest neighbour.

## Judging

Cluster counts cannot rank two clusterings — an arm can look better by splitting more — so
four measurements are used, and each needs the others to be readable.

**Agreement over commit pairs.** Given two commits, do both arms put them in the same
capability? Precision and recall, with neither arm treated as truth.

**A chance floor.** Two clusterings share some pairs by accident, and how many depends on
their shapes. Keeping each arm's exact group sizes and shuffling which commits fill them
gives the floor: **0.004 to 0.012** for these shapes. Every number below is above it, and
saying two arms "disagree" without this would have been saying nothing.

**A stability ceiling.** The model arm is not deterministic, so its agreement with anything
cannot exceed its agreement with itself. Three runs over identical input give that ceiling.

**Naming, from three views.** A group nobody can name is a bad group whichever method
produced it — the test the epoch work applies to periods. One prompt names every
multi-commit group, is never told which arm produced it, and may refuse. There is no
neutral view: showing the readings favours the arms that group on readings, showing the
paths favours the arms that group on paths, and showing only the commit message favours
neither but is itself weak evidence. So all three are reported and their agreement is the
finding.

## What was measured

Pilot repository, `course-recommender` at `ba900d8f`, 605 readings on the first-parent
chain.

```
arm         groups  largest  singletons  grouped  mean size
baseline       256       17         146      76%        4.2
reading        398       21         326      46%        3.9
combined       287       20         196      68%        4.5
model           81       48          19      97%        9.5

agreement over commit pairs        F1     chance floor
  baseline vs reading             0.104        0.006
  baseline vs combined            0.321        0.004
  baseline vs model               0.112        0.009
  reading  vs combined            0.219        0.006
  reading  vs model               0.143        0.008
  combined vs model               0.152        0.012

model arm, three runs over identical input
  capabilities              81, 64, 77
  largest                   48, 53, 48
  F1 between runs           0.717, 0.773, 0.738
  pairs grouped by any run  7113, of which 3222 by all three (45%)

nameable, same prompt, arm concealed; two independent passes over identical groups
                   message      +readings      +paths
  baseline        50%  52%      70%  71%      57%  59%
  reading         53%  46%      96%  97%      75%  72%
  combined        48%  46%      79%  81%      68%  71%
  model           52%  56%      89%  92%      70%  70%

the same, conditioned on group size, +paths view, second pass
                    2-3 commits   4-6 commits   7+ commits
  baseline          70% (35/50)   54% (25/46)   36%  (5/14)
  reading           72% (33/46)   81% (13/16)   60%  (6/10)
  combined          78% (35/45)   71% (22/31)   46%  (6/13)
  model             61% (11/18)   82%  (9/11)   72% (23/32)

readings         $0.4508
consolidation    $1.3181  (three runs)
naming           $0.0461  (four arms, three views)
```

### The evidence decides the grouping; the method barely matters

`reading` is a deterministic clustering and `model` is a language model, working on the
same capability names by completely different mechanisms. Against the path-based baseline
they land at **0.104 and 0.112** — indistinguishable. The original two-arm result of 0.090
was not a fact about consolidation. It was a fact about what capability names are.

A sweep of 24 shaping settings — four neighbour counts by three floors, with and without
commit bodies — keeps `baseline vs reading` below 0.15 in 22 of them, the whole range being
0.013 to 0.399. This is not an artifact of one choice of neighbour count or floor.

### The model arm is more stable than cluster counts suggested

This corrects an earlier record. Two runs producing 106 and 85 capabilities were written
down here as evidence that the arm "is not reproducible". Measured over pairs, three runs
agree at **F1 0.717 to 0.773** — substantial. The cluster count is the unstable thing; the
membership is not, and counting the wrong unit exaggerated the instability.

The ceiling matters more than the correction. The model agrees with itself at ~0.74 and
with every other arm at 0.11 to 0.15. Its disagreement with them is real rather than run
noise, and roughly an order of magnitude larger than its disagreement with itself.

45% of commit pairs grouped by any run were grouped by all three. A pairing proposed by one
run is closer to a coin flip than to a finding; a pairing all three runs make is worth
something. That is the confidence measure the interpretation findings asked for, and it
costs one extra consolidation run to obtain.

### The judge has its own noise, and it is not small

Judging is cheap where grouping is expensive, so the same four arms were judged twice. The
two passes differ by up to **7 points on the message view** and by about 3 on the other
two — weak evidence makes an indecisive judge. Every comparison below is read against that.

### No arm groups better under the neutral view

Under the message view the arms span 48% to 53% on the first pass and 46% to 56% on the
second, and they do not keep their order between passes. That spread is entirely inside
the judge's noise. Four methods, two of which cost money, none distinguishable from the
free one.

### Interpretation explains groups it did not form

Showing the readings lifts every arm, the baseline from 50% to **70%** — on groups built
without ever seeing a reading, a rise far outside the judge's noise. The readings did not
form those groups and cannot take credit for them. They explain them: shown a reading, the
judge names a group it had just refused.

That is the separable-stages result. Group with the free clustering, describe with the
readings, and pay for only one of the two.

### But path grouping falls apart as groups get larger, and interpretation does not

The separable-stages conclusion holds only for small groups. `reading` beats `baseline`
under the **paths** view — the baseline's own channel, where self-favouring runs the wrong
way — 75% against 57%, and 72% against 59% on the second pass. Conditioning on group size
shows why, and it is not the group-size confound it looks like:

```
                    2-3 commits   4-6 commits   7+ commits
  baseline              70%           54%           36%
  reading               72%           81%           60%
  model                 61%           82%           72%
```

The baseline is fine at pairs and triples and collapses beyond them, from 70% to 36%. The
interpretation arms hold, and `model` improves. Paths group small clusters of adjacent work
well and cannot sustain a capability; a capability that spans fourteen months is exactly
what the atlas is for.

The cells are small — 14, 10 and 32 groups in the 7+ column — so this is a direction, not a
coefficient. It is the strongest argument in this document that interpretation contributes
something to grouping and not only to description, and it is the thing a gold set should be
built to settle first.

### Commit bodies: a mixed result

72.4% of the pilot's first-parent chain carries a commit body, and 445 of those 535 are
merges whose subject is provenance and whose body is the pull request title. Adding them
tightened the baseline slightly, 256 groups to 245. It made `combined` worse: its largest
group went from 20 to 45 and became the project's first six months, held together by
bodies reading `New frontend`, `New data`, `push`. And `baseline vs reading` did not move
at all, staying at 0.104. The gap between grouping on paths and grouping on interpretation
is not one the message text closes.

## Two caveats, one corrected

**The no-dominant-cluster rule was wrong.** Across the sweep the largest baseline group
ranges from 10 units to 226, and k=5 and k=8 produce groups up to 493 of 605. Those were
dismissed as blobs without an external reason. The report now flags a large group as a
possible umbrella that a flat arm cannot represent, rather than declaring it invalid.

**Nameability is not correctness.** A judge can name a group that is wrong; the three views
disagree by up to 43 points on the same groups; and two passes of the same view disagree by
up to 7. Nameability discriminates between methods only where they differ by more than
that. Under the neutral view they do not differ at all, and in the 7+ column they do.

## What follows

Do not turn the owner's list into the system's taxonomy. Giving a model those categories,
sorting the pilot into them, and tuning against the result would make the solution imitate
one repository owner's memory. Keep the list held out and let it audit what autonomous
discovery missed.

1. Add proposal-to-map novelty review and one bounded follow-up evidence round to the staged
   hierarchy critic.
2. Repeat that unchanged staged condition and measure proposal/evidence recurrence before
   reconciliation.
3. Repeat the blind hierarchy and assignment experiment on a structurally different
   repository.
4. Put per-commit readings and candidate hierarchies in the viewer with their interpretation
   status and cited Git evidence visible.

The assignment-disagreement critic now has three candidate-visible and three blind samples.
Exact decisions agree by 85.9% within the visible arm, 71.6% within the blind arm, and 54.5%
across arms. That separation confirms candidate-ID anchoring on this fixed experiment and
keeps the blind critic as the default source of hierarchy-review signals.

The first hierarchy critic now consumes those signals without receiving an owner taxonomy
or mutating the map. From 83 supplied structural signals it proposed two candidate changes:
add dependency-update automation beneath operations, and test splitting the growth/analytics
umbrella into its existing children. Both are evidence-cited and still unapplied. A single
run demonstrates the decision interface, not proposal correctness or stability.

A focused-packet experiment then retained all recurring gaps and unmatched alternatives plus
the 24 lowest-overlap boundary comparisons. Changing context changed the capable model's
secondary proposals, confirming that retrieval policy is part of the semantic method. Three
cheap-model repeats had only 24.9% mean operation-target F1 and failed signal coverage, even
though dependency automation recurred 3/3 with identical evidence. The system now records
that distinction: recurring proposals from an incomplete condition are not eligible to
revise the map.

The first staged-retrieval run then used a cheap model to plan every signal, a deterministic
broker to reduce 69 requested readings to a 32-reading budget, and a capable model for the
decision. Every signal retained evidence and the final review was complete. Peak input fell
34% and cost fell 51%, while total two-stage input rose 25%. Dependency automation recurred;
three new additions did not appear in the static run, and two overlap existing node
descriptions. Staging is now operational, but it needs an explicit novelty/boundary gate
before it can replace full-context review.
