# Evolution Atlas verification map

This is the maintained source map for Evolution Atlas's user-facing surfaces
and its v3 history workflow. Read the relevant feature file before driving a
surface. Each file records the source-backed user path and the observable state
that a check should inspect.

## Baseline and coverage boundary

- Run doctor before any browser journey and list the registered journeys:

~~~sh
node scripts/control-atlas.mjs doctor
node scripts/control-atlas.mjs list
~~~

- A source map is not a test result. Record a feature as covered only after its
  current-source journey succeeds and its returned action, assertion, and
  visual artifacts have been inspected.
- A journey proves only the interactions named by its registry assertions. It
  does not exercise every sub-feature in its guide.
- The browser driver uses synthetic data. It can establish repeatable route and
  interaction mechanics, not semantic accuracy on a real repository, model
  quality, exhaustive history coverage, or product value.
- Manual app routes need a local atlas dataset. Generate one and start the app
  with:

~~~sh
npm run analyze -- --repo PATH --out public/atlas.json
npm run dev
~~~

- The optional Periods view needs a matching periods document. Keep generated
  repository data in ignored local paths.

## User-facing surfaces

| Feature ID | Surface and user entry | Source map |
| --- | --- | --- |
| overview | Overview, the default view and primary navigation button | [overview](overview.md) |
| repository | Repository history and checkpoint navigation | [repository](repository.md) |
| periods | Period bands, available only for a matching periods document | [periods](periods.md) |
| features | Candidate feature stories and their evidence | [features](features.md) |
| people | Contributor history in repository context | [people](people.md) |
| identity | Manage identities from the product utilities | [identity](identity.md) |
| candidate-map | Open output.json or reviewed-output.json in the map view | [candidate map](candidate-map.md) |
| gallery | Repository gallery index when a non-empty gallery manifest is served | [gallery](gallery.md) |

The driver's list output is the authority for registered executable journeys.
An unlisted surface remains mapped but uncovered; do not count another
surface's journey as evidence for it.

## CLI history workflow

| Feature ID | Surface and user entry | Source map |
| --- | --- | --- |
| history-plane | Prepare, coordinate, integrate, and publish a v3 cross-revision run | [history plane](history-plane.md) |

history-plane is documented as a manual engine workflow and is not a
control-atlas browser journey. The status command is a read-only inspection of
a prepared v3 run; the engine test command covers synthetic mechanics. Neither
command by itself establishes successful model-authored history integration.
