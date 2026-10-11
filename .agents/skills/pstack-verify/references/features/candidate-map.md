# Candidate map

Candidate map opens a repository-engine artifact and lets a user inspect proposed capabilities, relationships, source and history receipts, omissions, and review notes in the browser.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/RepositoryMapExplorer.tsx](../../../../../src/RepositoryMapExplorer.tsx), and [src/repositoryMap.ts](../../../../../src/repositoryMap.ts).

## Sub-features

- **candidate-map-open** opens an output file or same-origin JSON route without requiring an atlas dataset.
- **candidate-map-capabilities** searches and selects a candidate capability.
- **candidate-map-receipts** opens a cited source or history receipt from a claim.
- **candidate-map-history** inspects revision changes, history lineage, and explicit omissions.
- **candidate-map-review** inspects current review notes and earlier claim-local notes.

## How to get to it (user POV)

- Choose **Candidate map** in the product navigation, or open the map view at ?view=map.
- Choose **output.json** or **reviewed-output.json**, or enter a same-origin JSON route and choose **Open map**.
- Select a capability, then choose a cited receipt to inspect its saved text and Git metadata.
- Inspect the history, coverage, omissions, or review sections when they are present in the artifact.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The fixture artifact includes a capability with a cited source receipt and receipt body.

~~~sh
node scripts/control-atlas.mjs verify --feature candidate-map
~~~

The journey asserts that output.json imports in the browser session, the UI states that file imports are never uploaded, and source receipt S1 opens with its saved text. At a 1440 × 1000 viewport, it measures the receipt inspector, source text, citation heading, ID, and path after opening S1 and after scrolling the page. The receipt and citations must occupy separate space, fit in the viewport, and pass browser hit tests for obscured content. Geometry measurements are retained in the action log. It also asserts that independent verification is marked not performed.

Inspect both viewport.png and rendered.png along with the report, action log, and DOM capture; sticky behavior can differ between viewport and full-page captures. History lineage, review notes, omissions, other viewport sizes, and long-receipt scrolling are source-mapped or available in the UI but are not asserted by this journey.

## Gotchas

- The viewer accepts files up to 64 MB; an invalid or oversized artifact is rejected with a visible error.
- File imports stay in browser memory. A route entry is restricted to a same-origin JSON resource.
- A citation whose receipt body is absent is shown as unavailable; a cited ID alone is not the source evidence.
- Candidate claims and recorded review assertions are interpretations. The viewer itself says independent verification was not performed.
