# Repository history

Repository history shows observed commits and path changes at selectable checkpoints, with top-level directory scope and candidate reorganization context.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/RepositoryTimeMachine.tsx](../../../../../src/RepositoryTimeMachine.tsx), [src/RepositoryShape.tsx](../../../../../src/RepositoryShape.tsx), and [src/urlState.ts](../../../../../src/urlState.ts).

## Sub-features

- **repository-checkpoints** moves through the observed commit checkpoints.
- **repository-scope** drills into a directory and returns through the scope breadcrumb.
- **repository-shape** shows observed files and path operations at the selected checkpoint.
- **repository-evidence** opens a commit or candidate reorganization in the evidence inspector.
- **repository-time-filter** narrows the visible history by calendar chapter.

## How to get to it (user POV)

- Open the atlas root with a local dataset and choose **Repository** in primary navigation.
- Choose a calendar range using the **Time** controls.
- Select a directory in the repository shape, then use the **Repository scope** breadcrumb to move back up.
- Choose a checkpoint on the timeline or use the previous/next checkpoint buttons.
- Open a commit mark or candidate reorganization to inspect its supporting evidence.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic fixture supplies two checkpoints.

~~~sh
node scripts/control-atlas.mjs verify --feature repository
~~~

The journey asserts the Repository heading and moves from the latest to the previous checkpoint. Inspect the updated checkpoint position in the report and screenshot. Directory scope and evidence-inspector interactions are source-mapped but are not asserted by this journey.

## Gotchas

- The checkpoint date flag anchors proportionally to its position, so the first and latest
  checkpoints stay inside the chart. Reorganization wording and legend are hidden when the
  dataset publishes an empty `structuralEpisodes` array.
- An atlas dataset is required. A browser route alone does not supply repository evidence.
- A directory row is a top-level path grouping, not proof of an architectural component or contributor ownership.
- Structural reorganizations are candidate interpretations. The checkpoint's commit, path, and operation counts are observed evidence.
- Changing scope resets the checkpoint to the latest checkpoint available in that scope.
