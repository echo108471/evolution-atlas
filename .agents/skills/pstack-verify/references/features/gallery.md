# Gallery

The gallery index introduces the available repository atlases, summarizes their observed Git shape and interpretation provenance, and opens a selected repository's atlas.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/GalleryIndex.tsx](../../../../../src/GalleryIndex.tsx), and [src/gallery.ts](../../../../../src/gallery.ts).

## Sub-features

- **gallery-arrival** shows the gallery index without downloading a subject dataset.
- **gallery-subject** opens an atlas by selecting its card.
- **gallery-provenance** shows the subject's dates, revision, observed counts, model details, and source repository.
- **gallery-local-run** explains the local analysis path and links to Candidate map.

## How to get to it (user POV)

- Open the site root when a non-empty gallery manifest is served and no repository subject is selected.
- Choose a repository card to open that subject's atlas.
- Use the subject selector to switch repositories when multiple subjects exist.
- Choose **Open a candidate capability map** from the run-your-own section to enter Candidate map.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic site serves a non-empty gallery manifest and its subject dataset.

~~~sh
node scripts/control-atlas.mjs verify --feature gallery
~~~

The journey asserts that the gallery index and synthetic card render, opens the subject, and checks that its repository slug appears in the URL. It does not assert the provenance details or subject-switcher path.

## Gotchas

- Without a valid manifest, the root opens the local single-dataset app rather than the gallery.
- A gallery subject can appear in the index while its dataset is missing; the app then shows a repair message.
- The hosted gallery serves prepared artifacts. It does not read a repository or run analysis on the visitor's machine.
- Observed commit and path counts are distinct from model-proposed feature and lifecycle counts.
