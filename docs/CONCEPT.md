# Evolution Atlas concept

## Product statement

Evolution Atlas turns a Git repository's history into an interactive map of
how the codebase grew over time. It connects observable change episodes to
contributors and code areas, proposes evidence-backed feature lineages, and
makes each claim inspectable down to commits, diffs, and paths.

The product should feel like exploring a living system rather than reading a
changelog or contribution leaderboard.

## Intended user

The first user is a repository owner or technically curious maintainer who
wants to recover a coherent system history from a codebase they can inspect.
The first subject is the user's `course-recommender` repository.

## Core graph

```text
contributors <-> change episodes <-> feature candidates <-> code areas
                              all situated in time
```

The repository history is canonical. Contributor pages, feature trails, and
code-area views are projections over the same graph and evidence rather than
separate analyses.

## Experience principles

1. **Time is structural.** A time slider changes the graph, not merely a label.
2. **Evidence is one interaction away.** A node or edge opens its commits,
   paths, diffs, inference method, and confidence.
3. **Interpretations look different from observations.** Candidate features
   and lifecycle labels never masquerade as raw Git facts.
4. **Contributor views describe association, not ownership or quality.** The
   interface uses authored, co-authored, associated with, and confirmed by.
5. **The map should be beautiful enough to invite exploration.** Visual polish
   serves comprehension rather than turning uncertain data into certainty.

## Non-goals

- reconstructing a contributor's hidden intent;
- predicting unobserved alternative implementations;
- applying hindsight to judge historical decisions;
- ranking developers, teams, or productivity;
- claiming that Git authorship captures complete feature ownership; or
- building a general-purpose code intelligence platform before the pilot works.

## Success for the first pilot

The pilot succeeds if the repository owner can use one visualization to:

- recognize several real change episodes and feature trails;
- understand why each candidate label appeared;
- correct or reject weak interpretations;
- follow a trail back to relevant commits and paths; and
- learn something coherent about how the codebase changed over time.

Perfect inference, hosted collaboration, and broad repository compatibility are
not required for that result.

## Open product questions

- Is the primary visual unit a feature trail, a semantic episode, or a layered
  combination of both?
- Which lifecycle labels remain useful after manual review of the pilot?
- How should the map display tangled commits, merges, reverts, generated files,
  renames, and large migrations?
- What is the smallest confidence vocabulary that is honest without making the
  interface feel like a research paper?
- How should a maintainer correct a candidate without overwriting the original
  evidence or inference record?
