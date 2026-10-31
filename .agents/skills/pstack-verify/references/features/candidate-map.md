# Candidate map

Candidate map opens a repository-engine artifact and lets a user inspect proposed capabilities, relationships, source and history receipts, omissions, and review notes in the browser.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/RepositoryMapExplorer.tsx](../../../../../src/RepositoryMapExplorer.tsx), and [src/repositoryMap.ts](../../../../../src/repositoryMap.ts).

## Sub-features

- **candidate-map-open** opens an output file or same-origin JSON route without requiring an atlas dataset.
- **candidate-map-capabilities** searches and selects a candidate capability.
- **candidate-map-receipts** opens a cited source or history receipt from a claim.
- **candidate-map-history** inspects revision changes, history lineage, and explicit omissions.
- **candidate-map-review** inspects current review notes and earlier claim-local notes.
- **candidate-map-baseline** switches a version 3 expansion between its current integrated map and the `baselineGraph` it was compared against.
- **candidate-map-integration** inspects prior maps consulted and cached per-commit readings used (`history.priorMaps`, `history.commitReadings`), graph comparisons, global decisions, consolidation `lineage`/`edgeLineage`, and the artifact's provenance pins.

## How to get to it (user POV)

- Choose **Candidate map** in the product navigation, or open the map view at ?view=map.
- Choose **output.json** or **reviewed-output.json**, or enter a same-origin JSON route and choose **Open map**.
- Select a capability, then choose a cited receipt to inspect its saved text and Git metadata.
- When the artifact carries a non-empty `baselineGraph`, choose **Current map** or **Baseline map** above the capability list. Baseline IDs and receipts carry the `old:` prefix.
- Under History, read **Earlier interpretations consulted** and **Graph comparisons and decisions**; node IDs there open the matching capability in the current or baseline map.
- Use the section navigation for History, Evidence store, Review context, Coverage & omissions, and Provenance. The receipt catalog includes both observed Git receipts and separately labeled cached interpretations. Opening a receipt returns focus to the inspector. Missing history and review notes remain explicit.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The fixture artifact includes a capability with a cited source receipt and receipt body.

~~~sh
node scripts/control-atlas.mjs verify --feature candidate-map
~~~

The journey asserts that output.json imports in the browser session, the UI states that file imports are never uploaded, and source receipt S1 opens with its saved text. At a 1440 × 1000 viewport, it measures the receipt inspector, source text, citation heading, ID, and path after opening S1 and after scrolling the page. The receipt and citations must occupy separate space, fit in the viewport, and pass browser hit tests for obscured content. Geometry measurements are retained in the action log. It also asserts that independent verification is marked not performed.

Inspect both viewport.png and rendered.png along with the report, action log, and DOM capture; sticky behavior can differ between viewport and full-page captures. The journey also checks the snapshot-only history boundary, evidence-catalog navigation, repeated import, invalid replacement and dismissal. A second fictional version 3 descendant map exercises observed revision changes, a diff-backed candidate lineage link, a cached reading with structured receipt details, the consulted prior maps and readings panel, comparisons and decisions, the baseline toggle, and provenance pins. The final map is checked at 390px width for horizontal overflow. Review-note continuity and long-receipt scrolling remain outside this journey.

## Gotchas

- The viewer accepts files up to 64 MB; an invalid or oversized artifact is rejected with a visible error.
- File imports stay in browser memory. A route entry is restricted to a same-origin JSON resource.
- A citation whose receipt body is absent is shown as unavailable; a cited ID alone is not the source evidence.
- Version 3 outputs list history-plane receipts by ID in `history.receiptIds` and keep their bodies once in top-level `receipts`; the viewer resolves them there and warns about IDs with no body. Older artifacts that embed `history.receipts` still load.
- Prior maps and cached readings are labeled candidate context. Their panels never count as evidence, and the scripted journey checks them only against the fictional descendant map; inspect them against a real v3 expansion output as well.
- Candidate claims and recorded review assertions are interpretations. The viewer itself says independent verification was not performed.
