# Blind hierarchical capability induction

The flat grouping experiment answered a narrower question than the product asks. It
compared ways to partition commits into same-level groups. A repository capability can
instead be an umbrella containing narrower behaviors, and one commit can support several
capabilities. A flat partition cannot represent either fact.

`npm run induce-capabilities` tests a different formulation: show one model the complete
set of saved per-commit readings and ask it to infer a hierarchy directly. It receives no
maintainer taxonomy, no desired capability count, and none of the earlier clusters.

## Experimental contract

The induction prompt makes five choices explicit:

1. A capability is a durable outcome or behavior recognizable to a user, developer, or
   operator, rather than a directory, framework, layer, phase, or implementation step.
2. Several narrower behaviors may sit beneath one umbrella capability. The current
   experiment emits at most two levels: umbrella plus optional children.
3. A cross-cutting commit may support more than one capability.
4. A capability may cover any fraction of the repository. Size alone cannot reject it.
5. Routine or ambiguous work may remain unassigned.

The model attaches numbered readings to the most specific nodes it directly supports.
The parser resolves those numbers back to commit SHAs, derives each ancestor's rolled-up
evidence, reports unassigned and overlapping commits, and rejects unsupported nodes. Raw
provider output is written before parsing and can be replayed with `--response`, so a
validation change never requires buying the inference again.

Two levels are a deliberate present boundary, not an ontology. A larger or longer-lived
repository may support broader umbrellas above today's capabilities, or further useful
structure below them. The output is recursively shaped so later experiments can permit
that without a schema migration; the prompt and validator simply stop at two today.

This hierarchy is also orthogonal to epochs and eras. Epochs organize **when** the work
changed character. Capability umbrellas organize **what** the system does, and one
capability may cross several epochs. A future view may relate the two axes, but neither
should be forced to stand in for the other.

## First blind pilot run

Input: `course-recommender` at `ba900d8f`, 605 saved readings. Model:
`x-ai/grok-4.6` through OpenRouter.

```
top-level umbrellas       16
total supported nodes     48
maximum depth              2
assigned commits         557   (92.1%)
unassigned commits        48
overlapping commits        6
provider omissions         2   (made explicitly unassigned by the parser)
unsupported nodes          1   (rejected by the parser)
cost                 $0.2500
```

The top-level map was:

| umbrella | rolled-up commits | children |
| --- | ---: | ---: |
| Course catalog discovery | 105 | 5 |
| Professor discovery and profiles | 25 | 3 |
| Grade distribution insights | 31 | 3 |
| Course and schedule comparison | 17 | 0 |
| Saved favorite courses | 10 | 0 |
| Student review submission | 14 | 0 |
| Find-a-tutor resources | 2 | 0 |
| User authentication | 2 | 0 |
| Site experience, branding, and SEO | 80 | 4 |
| Growth, sharing, and email capture | 18 | 4 |
| Product analytics and experiments | 27 | 0 |
| Schedule Builder browser extension | 4 | 0 |
| Academic data pipeline | 115 | 7 |
| Course and professor API | 49 | 3 supported |
| Deployment, hosting, and operations | 47 | 3 |
| Developer tooling and project documentation | 17 | 0 |

The count is not the result. The useful first result is structural: the same evidence that
the flat methods split into 81–398 pieces produced broad umbrellas with meaningful children.
For example, Course catalog discovery contains search, filtering and sorting, details and
deep links, catalog delivery, and current-term indicators. Academic data pipeline contains
source collection, ETL orchestration, identity resolution, schema migration, and embedding
generation.

## Held-out owner audit

Only after the run completed was the generated hierarchy compared with the owner's rough
list. It independently named counterparts for the list's major concepts: course search and
filters, professor pages, grade distributions, comparison, review submission, landing/site
experience, editorial blog, ETL, and deployment/monitoring.

That is a promising recall check, not a score. The list did not define exact membership or
parent-child relationships, and matching names do not prove that the cited commits are
right. In particular, the model used overlap for only six commits despite being allowed to
use it, and this is one run from the same model family previously used for consolidation.

The owner list remains held out. It must not be inserted into the induction prompt or used
as a target taxonomy for tuning this repository. Its role is to expose conspicuous misses
after autonomous discovery, as it already exposed the flat methods' granularity error.

## Repeated-run stability

The first pilot is not part of the formal repeatability measurement because the explicit
two-level sentence was added to the prompt after that request. Three fresh runs used the
same 605 readings, model, complete prompt, parser, and two-level boundary. Every parsed
document carries a SHA-256 fingerprint of the complete request; the comparator refuses to
claim identical protocols when the fingerprints are absent or different.

`npm run compare-capability-inductions` matches nodes only by cited commit sets. Names are
retained in the report for inspection but never enter matching or any score. It reports:

- maximum-weight one-to-one Jaccard matches between umbrella evidence sets and between
  child evidence sets;
- commit-pair co-membership, which exposes splits and merges even when node counts differ;
- whether independently matched children recur beneath independently matched parents;
- assigned, unassigned, and multiply assigned commit-set agreement.

The clean runs cost $0.7389 together and produced:

| run | umbrellas | total nodes | assigned | overlapping | cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 11 | 37 | 549 (90.7%) | 69 | $0.2982 |
| 2 | 13 | 43 | 549 (90.7%) | 81 | $0.2464 |
| 3 | 12 | 32 | 540 (89.3%) | 53 | $0.1943 |

Across the three run pairs:

| evidence-based measurement | minimum | mean | maximum |
| --- | ---: | ---: | ---: |
| assigned-commit F1 | 98.3% | 98.6% | 99.0% |
| unassigned-commit F1 | 84.3% | 87.0% | 90.9% |
| multiply assigned commit F1 | 53.3% | 53.7% | 54.1% |
| umbrella commit-pair co-membership F1 | 78.3% | 79.3% | 80.8% |
| child commit-pair co-membership F1 | 53.3% | 55.6% | 57.7% |
| matched umbrella evidence Jaccard | 76.6% | 78.6% | 80.0% |
| matched child evidence Jaccard | 59.2% | 61.7% | 66.1% |
| matched child evidence under the same matched parent | 86.6% | 92.8% | 100.0% |

This corrects both an optimistic and a pessimistic reading of the varying node counts.
The model is not regenerating an identical hierarchy, but it is also not starting over.
It repeatedly makes almost the same assigned-versus-unassigned decision and substantially
recovers the broad umbrellas. The narrower child boundaries are much less stable. Overlap
is now used materially, unlike the first pilot, but *which* commits overlap is also
unstable. Parent placement is comparatively consistent once a child has a meaningful
evidence counterpart.

These measurements do not say which run is correct. They establish a pre-critic baseline
and identify where more evidence or a separate decision pass is needed: child boundaries,
cross-cutting assignment, and a small set of split/merge alternatives. The full reports and
raw provider responses remain ignored under `public/` because they contain repository and
provider metadata.

## Fixed-hierarchy evidence assignment

`npm run assign-capability-evidence` separates two semantic decisions that induction made
at once. It receives one discovered hierarchy—IDs, names, summaries, audience, and parent-
child structure—but none of that run's prior commit memberships. It then reconsiders all
605 readings globally and assigns each to zero, one, or several of the fixed nodes.

The three clean discovery maps were each assigned once under one shared assignment protocol.
The full requests intentionally differ because their candidate maps differ, while a second
fingerprint proves that the model, instructions, readings, and output contract are the same.
The parser rejects unknown capability IDs, makes omissions explicitly unassigned, retains
fixed nodes even when they receive no evidence, and removes ancestor assignments that merely
duplicate a more specific child.

The assignment passes cost $0.8799 together and produced:

| source map | fixed nodes | assigned before | assigned after | overlap before | overlap after | cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 37 | 549 | 537 | 69 | 118 | $0.2815 |
| 2 | 43 | 549 | 551 | 81 | 184 | $0.3119 |
| 3 | 32 | 540 | 544 | 53 | 115 | $0.2865 |

No pass invented an ID, omitted an input, or emptied a fixed capability. One pass repeated
one commit on a child and its ancestor; deterministic validation removed the redundant
ancestor copy when the saved response was replayed.

The useful comparison is between the original cross-run baseline and the independently
reassigned maps:

| mean pairwise measurement | discovery | fixed-map assignment | change |
| --- | ---: | ---: | ---: |
| assigned-commit F1 | 98.6% | 98.0% | -0.6 points |
| unassigned-commit F1 | 87.0% | 81.8% | -5.1 points |
| multiply assigned commit F1 | 53.7% | 68.5% | +14.7 points |
| umbrella co-membership F1 | 79.3% | 79.8% | +0.5 points |
| child co-membership F1 | 55.6% | 58.3% | +2.7 points |
| matched umbrella evidence Jaccard | 78.6% | 79.1% | +0.5 points |
| matched child evidence Jaccard | 61.7% | 63.1% | +1.4 points |
| matched child evidence under the same parent | 92.8% | 95.4% | +2.6 points |

The dedicated pass materially improves agreement about cross-cutting commits. It does not
materially improve the umbrella map, and it only modestly improves child boundaries. It
also changes the memberships inside its own source map: discovery-versus-assignment child
co-membership F1 ranges from 61.6% to 66.1%, and overlap F1 from 47.6% to 53.5%. Assignment
is therefore a distinct semantic judgment, not a cleanup that reproduces discovery.

The architectural conclusion is to keep discovery and assignment separate, because they
answer different questions and the second pass represents overlap better. But another
model pass is not sufficient by itself: the principal remaining instability is which child
capabilities exist and where their boundaries lie. Because the three assigned maps above
still changed the hierarchy and the assignment sample together, a second experiment held
the first clean hierarchy constant.

## Fixed-map assignment repeatability

The first clean map's 11 umbrellas and 26 children were assigned three times. All three
documents carry the same complete-request and comparison-protocol fingerprints: the model,
instructions, 605 readings, hierarchy, and output contract were identical. The two new
passes cost $0.4975 together; all three fixed-map samples cost $0.7790.

| assignment sample | assigned | unassigned | overlapping | assignments | cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 537 | 68 | 118 | 682 | $0.2815 |
| 2 | 538 | 67 | 113 | 672 | $0.2223 |
| 3 | 533 | 72 | 80 | 619 | $0.2753 |

Across the three sample pairs:

| fixed-map measurement | minimum | mean | maximum |
| --- | ---: | ---: | ---: |
| assigned-commit F1 | 98.3% | 98.8% | 99.2% |
| unassigned-commit F1 | 87.1% | 90.4% | 93.3% |
| multiply assigned commit F1 | 78.8% | 82.9% | 89.2% |
| umbrella commit-pair co-membership F1 | 89.0% | 89.9% | 90.6% |
| child commit-pair co-membership F1 | 82.5% | 84.7% | 86.3% |
| matched umbrella evidence Jaccard | 89.5% | 90.7% | 91.9% |
| matched child evidence Jaccard | 85.1% | 86.3% | 87.1% |
| matched child evidence under the same parent | 100.0% | 100.0% | 100.0% |

Of the 605 commits, 489 (80.8%) received exactly the same direct capability set in all
three samples. Assigned-versus-unassigned status agreed for 585 (96.7%), and overlap status
agreed for 553 (91.4%). Across 735 distinct commit-to-capability edges, 579 appeared in all
three samples, 80 in two, and 76 in only one. The least repeatable individual node was
`CI/CD and environments`: its direct evidence count varied from 17 to 32 and its mean
pairwise F1 was 72.4%.

This separates two effects that the cross-map experiment conflated. With the hierarchy
fixed, mean child co-membership rises from 58.3% to 84.7%, umbrella co-membership from 79.8%
to 89.9%, and overlap agreement from 68.5% to 82.9%. Hierarchy formation is therefore the
larger source of disagreement. Assignment is nevertheless not deterministic: cross-cutting
membership and a few child boundaries still need evidence review rather than silent
majority voting.

## Disagreement critic experiment

`npm run build-capability-disagreements` turns repeated assignments into a deterministic
review dataset. For the fixed-map runs it found the same 116 unstable commits and selected
87 reference exemplars only from commits whose complete direct assignment was identical in
all three runs. The saved dataset retains the exact alternatives and their frequencies for
measurement after the fact.

`npm run critic-capability-disagreements` gives an evidence-reading critic the fixed
hierarchy, those provisional exemplars, and all 116 disputed readings. It receives no owner
taxonomy, run identity, vote count, or exact assignment alternative. The first arm did show
the unordered union of capability IDs previously proposed for each commit. A blinded control
withheld that union as well. Both responses covered every input and cited only valid
capabilities and exemplars.

Each arm was run three times with an unchanged request fingerprint. The four added responses
cost $0.6617; all six responses cost $1.0247.

| critic input | runs | assigned range | unassigned range | map-insufficient range | mean full candidate union | mean candidate-edge retention | total cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate union visible | 3 | 100–105 | 9–13 | 0–2 | 72.2% | 85.0% | $0.4991 |
| candidate union hidden | 3 | 90–96 | 18–23 | 2–2 | 38.3% | 70.3% | $0.5255 |

The repeated comparison separates prompt treatment from ordinary run variance. Each
within-arm row contains three pairwise comparisons; the cross-arm row contains nine. These
pairs share runs and therefore are descriptive measurements, not fifteen independent trials.

| pair type | exact decision min | exact decision mean | exact decision max | selected-edge F1 mean | same-verdict mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| candidate visible, within arm | 84.5% | 85.9% | 87.9% | 95.1% | 92.8% |
| candidate hidden, within arm | 68.1% | 71.6% | 75.9% | 90.4% | 91.1% |
| visible versus hidden | 52.6% | 54.5% | 58.6% | 83.6% | 88.0% |

The complete cross-arm agreement never reaches the least-agreeing blind-with-blind pair,
and the same separation appears in selected-edge F1. Showing candidate IDs therefore has a
repeatable anchoring effect on this model, repository, map, and disagreement set; the
one-sample difference was not just critic randomness. The visible arm kept substantially
more prior edges and selected the full prior union almost twice as often.

Both Dependabot commits were marked `map_insufficient` in all three blind runs. They were
also marked that way in one of three visible runs, while the other visible runs assigned
them to an existing node. This is a stronger, still provisional signal that durable
dependency automation may be absent from the hierarchy and is a concrete input for the
hierarchy critic.

The architecture should default to a blind critic. Earlier alternatives belong in the
post-decision comparison, not in the critic's evidence. Neither critic output is a truth
set, and neither has been installed as the repository's canonical assignments. The result
also does not establish that the blind answers are more correct; it establishes that the
visible answers are conditioned by IDs they were shown.

## What this establishes—and what it does not

The experiments establish that autonomous discovery can produce a recognizably coarse and
substantially recurring umbrella hierarchy without being told the answer or a target count,
that a separate assignment pass makes cross-cutting membership more reproducible, and that
hierarchy formation accounts for more of the remaining variance than assignment alone.
The disagreement pipeline also establishes that a critic can account for every unstable
input, preserve ambiguity, identify a recurring possible map gap without an owner-authored
answer, and measure candidate anchoring separately from within-prompt variance. The
experiments do not establish that any generated membership is correct, that child boundaries
are dependable, that two levels are enough, or that the result generalizes beyond this
repository.

The recurring blind-critic `map_insufficient` findings and residual cross-map splits,
merges, and child-boundary disagreements should now feed a separate hierarchy critic. That
critic should be measured against the pre-critic stability baseline, not a
maintainer-authored target taxonomy.
