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

The analyzer currently emits only observed Git facts: commits as change
episodes, author associations, changed paths, and top-level code areas. It does
not yet infer features, semantic intent, or lifecycle stages. That restraint is
intentional; the pilot will establish which interpretations are useful and
defensible before they become code.
