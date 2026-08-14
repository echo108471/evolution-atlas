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

1. **Time is structural.** Evidence events share a stable chronological axis,
   and selecting a calendar chapter changes the visible story.
2. **Evidence is one interaction away.** A feature, event, or matrix cell opens
   its commits, paths, inference method, and confidence.
3. **Interpretations look different from observations.** Candidate features
   and lifecycle labels never masquerade as raw Git facts.
4. **Contributor views describe association, not ownership or quality.** The
   interface uses authored, co-authored, associated with, and confirmed by.
5. **The map should be beautiful enough to invite exploration.** Visual polish
   serves comprehension rather than turning uncertain data into certainty.

## Visual hierarchy

The primary experience uses progressive disclosure rather than a global force
graph or an all-data-at-once dashboard:

1. **Overview** summarizes calendar activity, lifecycle totals, recently
   evidenced feature stories, and candidate structural reorganizations.
2. **Explore** starts with a searchable feature index and one selected feature
   story. Its lifecycle ribbon, observed commits, code areas, contributor
   associations, and evidence inspector remain coordinated.
3. **All timelines** retains the complete shared-axis lane view as a power tool.
   Dashed spans connect cited evidence without claiming continuous work or a
   complete feature lifetime.
4. **The code-area matrix** remains a secondary comparison of which top-level
   paths each candidate feature's supporting commits touched.
5. **A selected-feature neighborhood** shows only the contributors and code
   areas associated with one feature. The graph is scoped and deterministic,
   not a global constellation whose position changes arbitrarily.
6. **People** projects one confirmed contributor profile over
   the same chronology. A profile contains one exact Git identity until
   repository evidence or a human decision confirms more. Authored evidence is
   highlighted, other commits remain visible as feature context, and observed
   code-area rows include work outside candidate evidence.
7. **Identity Review** is a data-management utility rather than a primary story
   mode. It presents explainable, conservative match suggestions.
   Confirming a match changes only the contributor projection. Raw identities
   and authored relationships stay intact, and every decision can be reversed
   or exported.

Semantic lifecycle episodes are the narrative unit inside a feature trail. The
interface keeps their stage-colored spans separate from observed commit marks
and labels both the episode and its continuity as candidate interpretations.

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
- Which structural candidates are useful enough to show by default, and when
  should nested data-folder moves stay collapsed?
- What is the smallest confidence vocabulary that is honest without making the
  interface feel like a research paper?
- How should a maintainer correct a candidate without overwriting the original
  evidence or inference record?
- What precision and abstention thresholds should the identity matcher use
  after manually labeling the Course Recommender aliases?
