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
  React/TypeScript application built with Vite. D3 supplies temporal scales and
  graph layout while React owns interface state and SVG rendering.
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

Feature induction is a separate, optional stage. It reads an observed dataset,
asks a model to propose candidate features, and discards any commit it cites
that is not in the dataset:

```bash
npm run interpret -- --in public/atlas.json
```

It needs a model credential; the observed pipeline above does not. Every feature
it emits is a `candidate` carrying its method, confidence, and the commits
behind it, for a maintainer to accept or reject.

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

Useful checks:

```bash
npm test
npm run build
```

## Project documents

- [Concept](docs/CONCEPT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Evidence model](docs/EVIDENCE-MODEL.md)
- [Course Recommender pilot](docs/COURSE-RECOMMENDER-PILOT.md)
- [Roadmap](docs/ROADMAP.md)

## Current implementation boundary

The analyzer emits only observed Git facts: commits as change episodes, author
associations, changed paths, and top-level code areas. It infers nothing.

Feature candidates come from the separate interpretation stage, which never
writes into that observed layer — it appends candidates alongside it and flips
`analysis.mode` to `interpreted`. A model proposes only which commits form a
capability; the code areas and contributors behind each feature are then read
off those commits rather than proposed. Contributor association therefore stays
an observation even when the feature it hangs from is an interpretation.
