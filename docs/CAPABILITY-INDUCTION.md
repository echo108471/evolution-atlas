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

## What this establishes—and what it does not

This run establishes that autonomous discovery can produce a recognizably coarse hierarchy
without being told the answer or a target count. It does not establish that the hierarchy
is reproducible, that its evidence membership is correct, that two levels are enough, or
that the result generalizes beyond this repository.

The next measurement is repeated blind induction. Compare nodes across runs by their cited
commit sets and parent-child relationships, not by counts or label wording. After that,
sample disagreements, unassigned substantive commits, and rare overlaps for evidence review.
Only then should a separate critic pass be added to propose merges, splits, or reparenting;
otherwise the critic's apparent improvement has no pre-critic baseline.
