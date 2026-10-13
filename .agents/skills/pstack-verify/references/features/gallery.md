# Gallery

The front door leads with the current repository-engine workflow and a candidate-map entry. Prepared observed-history atlases remain a separate demo section with observed Git shape and provenance.

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
- Choose **Open a candidate capability map** from the primary current-workflow section to enter Candidate map.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic site serves a non-empty gallery manifest and its subject dataset.

~~~sh
node scripts/control-atlas.mjs verify --feature gallery
~~~

The journey asserts that the current-engine entry opens Candidate map, browser Back restores the front door, and a synthetic demo card opens its matching atlas with its repository slug in the URL. It saves entry.png before navigation. It does not assert provenance details or subject switching.

For an explicitly requested private production preview, use the skill's
`verify-preview --directory ABS_PATH --inventory ABS_PATH` command. This
separate path checks a sole prepared card's counts and revision, opens it,
verifies the browser dataset response against the inventory hash and full
repository revision, and checks the overview's rendered counts. It records
inventoried license-notice and provenance link hrefs and checks their browser
GET responses against exact hashes when those fields are present. It records
gallery, overview, repository and selected-commit evidence screenshots plus
source/build fingerprints. It checks a previous checkpoint when available and
compares the selected commit's revision, label and touched paths against the
prepared dataset without copying its full commit corpus into evidence logs. A missing
optional epochs.json is recorded as a scoped 404; other browser or request
errors fail. It does not approve publication or attest that assets were emitted
by the publication plugin. Synthetic `verify --feature gallery` stays the
default; no prepared snapshot is loaded by that command.

## Gotchas

- Without a valid manifest, the root opens the local single-dataset app rather than the gallery.
- A gallery subject can appear in the index while its dataset is missing; the app then shows a repair message.
- The hosted gallery serves prepared artifacts. It does not read a repository or run analysis on the visitor's machine.
- Observed commit and path counts are distinct from model-proposed feature and lifecycle counts.
