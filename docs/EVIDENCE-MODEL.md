# Evidence model

## Rule of the model

Every displayed statement is either an observation or a candidate
interpretation. Observations point to Git objects. Candidate interpretations
also record how they were produced, their confidence, and the observations that
support them.

## Core entities

### Contributor identity

A normalized identity derived from Git author metadata. The stored identifier
is a one-way hash of normalized email when available, with author name as a
fallback. Display names and observed aliases may be retained; email addresses
are not emitted.

This entity supports phrases such as "authored this commit" or "associated with
these episodes." It does not establish feature ownership, total contribution,
or responsibility for the final state.

### Change episode

The initial analyzer maps one commit to one raw change episode. The commit SHA,
parents, author date, subject, and file changes are observed evidence. Calling a
multi-commit cluster a semantic episode will be a later interpretation with its
own method and evidence.

### Code area

The initial analyzer groups paths by their top-level segment. These are
provisional structural areas, not architectural components. Later versions may
add language-aware boundaries, rename continuity, or maintainer corrections.

### Feature candidate

A proposed user-visible or system capability supported by one or more change
episodes and code areas. A feature candidate always carries:

- a human-readable label;
- `candidate` or `confirmed` status;
- confidence and inference method;
- supporting and contradicting evidence when known; and
- an edit history when a maintainer confirms, renames, splits, or rejects it.

The initial analyzer emits an empty feature-candidate collection.

### Relationship

An edge between entities. Initial observed edge kinds are:

- `authored`: Git author identity to commit episode; and
- `touched`: commit episode to provisional code area.

Later inferred relationships can connect episodes and code areas to feature
candidates. Each edge carries at least one evidence reference and a confidence
value; observed Git relationships use confidence `1` without implying that Git
is a complete social record.

## Lifecycle vocabulary

The working labels are **introduced**, **expanded**, **hardened**, **migrated**,
and **removed**. Each is a candidate interpretation unless direct evidence and
an explicit rule justify otherwise.

Examples of signals that may support—but do not alone prove—a label:

| Label | Possible evidence |
| --- | --- |
| Introduced | First capability code plus tests, routes, schema, or UI entry point |
| Expanded | New behavior connected to an existing feature trail |
| Hardened | Tests, validation, error handling, observability, or security changes tied to an existing capability |
| Migrated | Old and new representations connected across a transition, often with renames or adapters |
| Removed | Capability paths and entry points deleted with no surviving replacement in the analyzed range |

Commit-message keywords may contribute to a score but must never determine a
lifecycle label by themselves.

## Serialized contract

The first JSON schema version is `0.1.0`. It contains:

```text
repository
timeRange
contributors[]
episodes[]
codeAreas[]
featureCandidates[]
relationships[]
```

Identifiers are namespaced (`contributor:`, `episode:`, `area:`, `feature:`) so
the viewer can keep a single graph namespace. Relationships reference those
identifiers and include commit/path evidence.

Schema changes that remove or reinterpret fields require a version change and
migration note. New optional fields may be added within the pilot.

## Known attribution hazards

- author and committer can be different people;
- co-author trailers and pair work may spread authorship across identities;
- aliases can split one person into several nodes;
- bots can author or rewrite commits;
- cherry-picks duplicate changes under new SHAs;
- squash merges collapse several contributors and episodes;
- merges and rebases reshape topology; and
- large refactors can touch an area without changing its feature behavior.

The interface should expose these limitations where they matter instead of
burying them in a global disclaimer.
