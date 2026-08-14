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

### Identity match and contributor profile

An identity match is a candidate or explicit relationship between two exact Git
author identities. Candidate matches carry a confidence, method version, and
human-readable signals. The deterministic first version considers normalized
name equality, non-generic email-handle equality, and GitHub noreply account
metadata. The comparison happens during local analysis; serialized match
evidence never contains an email address.

A repository `.mailmap` mapping is treated as explicit repository evidence, but
the viewer can still keep the identities separate locally. Other matches do not
combine histories until a person confirms them. Bot/human pairs are blocked,
and a keep-separate decision constrains later transitive grouping.

A contributor profile is a reversible viewer projection over one or more exact
identities. It does not replace contributor nodes, change authored
relationships, or claim that Git captures pair work, review, design, or feature
ownership. Decisions persist in local browser storage and can be imported or
exported as a repository-scoped JSON document.

### Change episode

The analyzer maps one commit to one raw change episode. The commit SHA,
parents, author date, subject, and file changes are observed evidence. Calling a
multi-commit cluster a semantic episode is a separate candidate interpretation
with its own method and evidence.

The current viewer therefore renders cited commits as discrete evidence events.
It may draw a dashed span between a feature candidate's first and last cited
commit, but that span is a visual index—not evidence of continuous development
or the feature's complete lifetime.

A semantic lifecycle episode is now a first-class candidate entity with its own
label, feature id, lifecycle stage, confidence, inference method, rationale, and
supporting commits. Lifecycle belongs on episodes over time rather than as one
permanent label for an entire feature. Feature discovery and lifecycle discovery
are separate passes so maintenance evidence does not have to compete with
capability discovery.

### Structural episode candidate

A structural episode candidate describes an observable repository-layout
transition rather than a user-facing feature. The first deterministic detector
looks within one commit for at least three corroborating path moves. Git rename
records carry their similarity evidence directly. When Git emits separate
deletes and adds, the detector may cautiously pair paths only when they share at
least two trailing path segments and several pairs support the same prefix
mapping.

Each candidate records old-to-new prefix mappings, individual path transitions,
confidence, method, and supporting commit/path evidence. For example,
`demo/frontend/... -> frontend/...` and equivalent backend and infrastructure
moves can support `demo -> repository root`. The candidate establishes a path
reorganization, not why it happened or whether the architecture changed.

Structural episodes are separate from feature lifecycle. A repository layout
reorganization should not be labeled as a feature migration merely because
both involve movement.

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

It does not carry a lifecycle stage. `semanticEpisodes[]` link staged changes to
the feature, allowing several stages—or repeated stages—along one trail.

The initial analyzer emits an empty feature-candidate collection.

### Relationship

An edge between entities. Initial observed edge kinds are:

- `authored`: Git author identity to commit episode; and
- `touched`: commit episode to provisional code area.

Later inferred relationships can connect episodes and code areas to feature
candidates. `supports-lifecycle` connects an observed commit to a semantic
episode, while `evolves-feature` connects that candidate episode to its feature.
Each edge carries at least one evidence reference and a confidence value;
observed Git relationships use confidence `1` without implying that Git is a
complete social record.

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

The lifecycle interpreter receives the complete serialized commit corpus again,
plus the validated feature candidates. It may cite commits outside the feature
discovery evidence, but every citation and feature id must resolve locally. It
is explicitly told not to fill stage quotas. A zero count is therefore allowed,
but should be evaluated against corpus coverage and pilot review rather than
treated as proof that the repository contains no such change.

Local validation also abstains from two migration-shaped false positives: a
transition explicitly reverted to the prior state, and a structural-only path
rename with no old/new interface, schema, storage, implementation, or
representation evidence. These checks can be reapplied without another model
call.

## Serialized contract

The first JSON schema version is `0.1.0`. It contains:

```text
repository
timeRange
contributors[]
identityMatches[]
episodes[]
structuralEpisodes[]
codeAreas[]
featureCandidates[]
semanticEpisodes[]
relationships[]
```

Identifiers are namespaced (`contributor:`, `episode:`, `area:`, `feature:`,
`semantic-episode:`) so the viewer can keep a single graph namespace.
Relationships reference those identifiers and include commit/path evidence.

Schema changes that remove or reinterpret fields require a version change and
migration note. New optional fields may be added within the pilot.

## Known attribution hazards

- author and committer can be different people;
- co-author trailers and pair work may spread authorship across identities;
- aliases can split one person into several nodes;
- similar names and account handles can also describe different people, so
  heuristic matches require confirmation;
- bots can author or rewrite commits;
- cherry-picks duplicate changes under new SHAs;
- squash merges collapse several contributors and episodes;
- merges and rebases reshape topology; and
- large refactors can touch an area without changing its feature behavior.

The interface should expose these limitations where they matter instead of
burying them in a global disclaimer.
