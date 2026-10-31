# Periods

Periods presents a candidate hierarchy of time spans and the proposed or independently corroborated focus shifts between them.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/PeriodBands.tsx](../../../../../src/PeriodBands.tsx), and [src/periods.ts](../../../../../src/periods.ts).

## Sub-features

- **periods-hierarchy** displays the available period levels and their commit spans.
- **periods-detail** opens a period's dates, label, and recorded quality notes.
- **periods-boundary** opens the evidence for a proposed transition.
- **periods-unpaired-shifts** preserves focus shifts without a proposed boundary.

## How to get to it (user POV)

- Use the **Periods** navigation button when the loaded dataset has a matching periods document.
  A gallery subject supplies its document through the optional manifest `periods` path
  (for example `/gallery/zod-epochs.json`); a local single-dataset install reads
  `/epochs.json` beside `/atlas.json`.
- Select a period band to open its details.
- Select a boundary to inspect its proposed commit, corroboration state, and readings.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic periods document matches the synthetic dataset's repository, head SHA, and commit count.
- The synthetic gallery subject names `/gallery/synthetic-epochs.json` as its periods path.

~~~sh
node scripts/control-atlas.mjs verify --feature periods
~~~

The journey asserts that the head-matched synthetic period renders and its detail opens. Inspect the report and screenshot. Boundary details and unpaired shifts are source-mapped but are not asserted by this journey.

## Gotchas

- Periods data is optional, and the app hides the navigation button if the document is absent or stale.
- A gallery subject without a `periods` path makes no periods request at all, so a hosted
  subject view should show no epochs 404.
- `?view=periods` without a matching document falls back to Overview; it must never render
  another section such as identity management.
- Labels, boundaries, and hierarchy are candidate readings of history, not established phases.
- Commits between paired boundary readings belong to no period; they represent a transition interval.
- A source-text or link check does not show that period details render or open correctly.
