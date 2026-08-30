# Evolution Atlas

Evolution Atlas turns a Git repository's history into an interactive map of
how the codebase grew over time. It identifies candidate features and
meaningful changes, connects them to the contributors and code areas involved,
and visualizes how those relationships evolved from initial implementation
through expansion, hardening, migration, or removal.

The project is an experimental, personal exploration. Its first subject is
`course-recommender`.

## Purpose

Repositories contain a detailed record of change, but that record is difficult
to read as a coherent system history. Evolution Atlas aims to make that hidden
story explorable while keeping every meaningful claim connected to inspectable
Git evidence.

The intended user is initially the repository owner or a technically curious
maintainer who wants to understand what was built, who contributed, how
features took shape, and how the system became what it is today.

## Product boundaries

Evolution Atlas should:

- distinguish evidence observed in Git from labels or interpretations inferred
  from that evidence;
- treat detected features and lifecycle stages as candidates with inspectable
  support, not unquestionable facts;
- link visual elements back to relevant commits, paths, diffs, dates, and
  contributors;
- represent change over time, including implementation, expansion, hardening,
  migration, and removal; and
- make uncertainty and incomplete history visible.

Evolution Atlas should not:

- rank developers or turn contribution history into a performance score;
- judge whether historical decisions or contributors were good or bad;
- present inferred intent as repository fact; or
- inherit AGC's implementation or data model by default merely because the two
  projects share an evidence-bounded approach to Git history.

## First reversible experiment

The first experiment will use `course-recommender` to test a narrow vertical
slice:

1. Extract a small, deterministic history dataset from Git.
2. Propose a limited set of feature and meaningful-change candidates.
3. Preserve the evidence and uncertainty behind every candidate.
4. Render an interactive view of relationships among candidates, contributors,
   code areas, and time.
5. Check the resulting story against the repository before generalizing the
   model or architecture.

## Current decisions

- Evolution Atlas is a separate project and repository from AGC.
- Accuracy, traceability, and an engaging visual experience are all product
  requirements.
- The initial scope is one repository: `course-recommender`.
- The first implementation is a local Node.js analyzer plus a static
  React/TypeScript application built with Vite. D3 supplies temporal scales
  while React owns the chronology, comparison matrix, and evidence inspector.
- Versioned JSON is the initial boundary between analysis and visualization.
- No database, hosted service, or model-generated inference is required for the
  first pilot.
- No license has been selected.

## Open questions

- What is the most useful visual unit: feature, change episode, code area, or a
  coordinated combination of them?
- Which lifecycle transitions can be supported deterministically, and which
  should remain explicitly inferred?
- How should tangled commits, renames, merges, reverts, and deleted code appear
  in the map?
- What interaction makes the evidence trail understandable without overwhelming
  the visual narrative?

## Start here

Requires Node.js 22.12 or newer and Git.

```bash
npm install
npm run analyze -- --repo . --out public/atlas.json
npm run dev
```

Interpretation is a separate, optional two-pass stage. The first pass proposes
candidate features. The second reviews the same complete commit corpus for
evidence-linked lifecycle episodes within those features. Any cited commit or
feature id that does not resolve to the observed dataset is discarded:

```bash
npm run interpret -- --in public/atlas.json
```

During lifecycle calibration, validated features can be reused so only the
second model pass runs. Local boundary checks can also be reapplied without a
model call:

```bash
npm run interpret -- --in public/atlas.json --reuse-features
npm run interpret -- --in public/atlas.json --revalidate
```

It needs a model credential; the observed pipeline above does not. Features and
semantic lifecycle episodes are separate `candidate` entities carrying their
method, confidence, and supporting commits. A feature can therefore show a
sequence such as introduced → expanded → hardened instead of receiving one
permanent stage.

Requests can go to Anthropic directly or through OpenRouter, which serves the
same Messages API — only the base URL, credential, and model naming differ. The
provider is auto-detected from whichever key is set, or named explicitly:

```bash
npm run interpret -- --provider openrouter    # needs OPENROUTER_API_KEY
npm run interpret -- --provider anthropic     # needs ANTHROPIC_API_KEY, or `ant auth login`
```

Each candidate records which provider and model produced it in its `method`
field, so interpretations from different routes stay distinguishable.

The generated `public/atlas.json` is intentionally ignored because repository
history can contain contributor and project metadata. The application remains
useful without it: it explains how to generate a local dataset.

Epoch detection is a third optional stage, independent of interpretation. It divides the
history into periods during which the work was about roughly the same thing, so later
analysis can proceed period by period rather than needing the whole corpus in one request:

```bash
npm run epochs -- --in public/atlas.json --out public/epochs.json
```

It runs two passes that never see each other: a model reads raw commit windows and marks
where the work changed character, and two deterministic detectors measure where the
distribution of touched paths and of commit-subject vocabulary shifts. Because the two
locate the same transition at slightly different moments, a boundary is stored as the
interval spanning both readings, and the commits inside it belong to no period.

How many levels the hierarchy has is derived from the history, not fixed. A repository
small enough to analyze whole gets no periods at all; a mid-sized one gets epochs; only a
history with too many periods to describe together gets eras above them.

Periods are then named, which doubles as the cheapest check on the boundaries: a period
the model can only call "Mixed feature work" is a cut in the wrong place. `--no-labels`
skips naming, and `--proposals` reuses a saved run so the deterministic half can be
changed without paying again.

The viewer picks up `public/epochs.json` if it is present and adds a Periods tab. Like
`public/atlas.json`, it is gitignored and excluded from gallery builds, because it quotes
commit subjects and dates.

Useful checks:

```bash
npm test
npm run build
```

## Project documents

- [Concept](docs/CONCEPT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Evidence model](docs/EVIDENCE-MODEL.md)
- [Per-commit reading](docs/PER-COMMIT.md)
- [Epochs](docs/EPOCHS.md)
- [Interpretation findings](docs/INTERPRETATION-FINDINGS.md)
- [Course Recommender pilot](docs/COURSE-RECOMMENDER-PILOT.md)
- [Roadmap](docs/ROADMAP.md)
- [Productization](docs/PRODUCT.md)

## Current implementation boundary

The analyzer keeps an observed layer of commits as change episodes, exact Git
author identities, changed paths, and top-level code areas. A separate,
explicitly candidate identity-matching layer can suggest that two exact
identities belong together. It uses normalized names, non-revealing comparisons
of email handles, GitHub noreply account metadata, and repository `.mailmap`
evidence; email addresses are never emitted.

The same analysis pass proposes candidate structural episodes when one commit
contains a concentrated old-to-new path transition. Git rename records are the
strongest evidence. Repeated delete/add paths with matching suffixes can support
a lower-confidence candidate. The original file operations remain intact, and
the candidate claims only an observable repository reorganization—not its
intent or architectural significance.

Feature candidates come from the separate interpretation stage, which never
writes into that observed layer—it appends candidates alongside it and flips
`analysis.mode` to `interpreted`. Feature discovery and lifecycle discovery are
separate model passes over the same complete commit corpus. Lifecycle stages
belong to semantic episodes, not features; validation resolves every proposed
feature id and commit before serialization. Code-area and contributor
associations are still read from observed commits rather than proposed.

The interpreted viewer now leads with a repository overview, a repository time
machine, and a searchable selected-feature story. The time machine reconstructs
directory snapshots from observed path operations at initial, calendar,
structural-change, and current checkpoints. One adjacent panel explains what
changed and keeps candidate reorganizations linked to their evidence. A focused
lifecycle ribbon coordinates candidate semantic episodes, observed commits, code areas,
contributor associations, and the evidence inspector. Structural transitions
open the supporting commit, prefix mappings, and individual path transitions;
feature signals hand off to the full story instead of duplicating it. Lifecycle bars open
their own rationale and cited commits. Its only relationship graph is scoped to
the selected feature so the layout stays stable and attribution boundaries
remain visible. Identity Review is a data-management utility that makes match
evidence inspectable and lets the user merge, reject, undo, import, and export
decisions without rewriting raw history. Decisions are also retained locally
for the repository. Contributor
Trail then projects one confirmed contributor profile—which may still contain
only one exact Git identity—through the same evidence: authored commits remain
highlighted inside complete feature trails, while observed code-area rows
include authored changes that no candidate feature cites. It is an association
view, not an ownership or performance view.
