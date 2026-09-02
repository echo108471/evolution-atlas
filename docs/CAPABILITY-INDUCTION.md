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
capabilities exist and where their boundaries lie. This experiment used one assignment
sample per discovered map, so it also does not yet separate assignment-model randomness
from disagreement caused by the different hierarchies.

## What this establishes—and what it does not

The experiments establish that autonomous discovery can produce a recognizably coarse and
substantially recurring umbrella hierarchy without being told the answer or a target count,
and that a separate assignment pass makes cross-cutting membership more reproducible. They
do not establish that any generated membership is correct, that child boundaries are
dependable, that two levels are enough, or that the result generalizes beyond this
repository.

Before adding a hierarchy critic, repeat assignment against one unchanged map to measure the
assignment pass's own variance. Then the critic can focus on the residual cross-map split,
merge, and child-boundary disagreements with evidence rather than being credited for noise
from a different stage. Evidence review should come from those disagreements, substantive
unassigned commits, and unstable overlaps rather than from a maintainer-authored taxonomy.
