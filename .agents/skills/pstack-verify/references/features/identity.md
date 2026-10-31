# Manage identities

Manage identities lets a user review likely matches between Git author identities, keep identities separate, or export and reuse explicit decisions while preserving raw commit evidence.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/IdentityReview.tsx](../../../../../src/IdentityReview.tsx), and [src/identity.ts](../../../../../src/identity.ts).

## Sub-features

- **identity-suggestions** displays the signals and conflicts behind suggested matches.
- **identity-decisions** merges a suggested pair, keeps it separate, and undoes a prior manual choice.
- **identity-threshold** changes the automatic-merge confidence stop.
- **identity-import-export** exports decisions or imports a JSON decision document.
- **identity-to-people** opens a resolved contributor trail from a merged match.

## How to get to it (user POV)

- Choose **Manage identities** in the product utilities. It is hidden, and
  `?view=identity` falls back to Overview, when the dataset has no contributor records.
- Choose **Merge identities**, **Keep separate**, or **Undo decision** on a match.
- Choose a stop in **Automatic merge threshold**.
- Use **Export decisions** or **Import decisions** to move the review document.
- Open a merged contributor from **Open contributor trail**.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The isolated fixture contains a synthetic candidate identity match.

~~~sh
node scripts/control-atlas.mjs verify --feature identity
~~~

The journey asserts that the identity review and synthetic candidate match render. It does not activate a merge, separation, threshold, import, or export action.

## Gotchas

- Identity decisions and threshold settings are stored locally per repository; use an isolated browser context for verification.
- Importing a malformed or mismatched decision document can fail or be rejected. Inspect the visible result.
- Manual decisions affect the contributor projection; they do not rewrite commits or raw author identities.
- The presence of a suggested match is not proof that the identities belong together.
