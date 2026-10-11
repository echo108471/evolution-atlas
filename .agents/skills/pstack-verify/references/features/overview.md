# Overview

Overview summarizes repository evidence and links the calendar, candidate feature stories, lifecycle stages, and recent structural interpretations to deeper views.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/RepositoryOverview.tsx](../../../../../src/RepositoryOverview.tsx), and [src/urlState.ts](../../../../../src/urlState.ts).

## Sub-features

- **overview-summary** shows counts for the loaded repository evidence.
- **overview-calendar** narrows recent stories to a calendar chapter and can return to the full history.
- **overview-stage** opens Features with a selected candidate lifecycle stage.
- **overview-feature** opens a candidate story in Features.
- **overview-reorganization** opens the selected structural candidate in Repository history.

## How to get to it (user POV)

- Open the atlas root with a local dataset; Overview is the default view unless a gallery manifest opens the gallery index.
- Choose **Overview** in the primary navigation.
- From Overview, use **Explore feature stories**, a feature card, a lifecycle total, or a recent candidate reorganization to continue into its detail view.
- Select a calendar chapter to scope the recent story list; choose **Show entire history** to clear that scope.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic fixture supplies an atlas dataset.

~~~sh
node scripts/control-atlas.mjs verify --feature overview
~~~

The journey asserts the Overview heading and synthetic candidate-feature count. Inspect the report and screenshot under the returned evidence directory. Calendar selection, stage navigation, and candidate-card links are mapped here but are not asserted by this journey.

## Gotchas

- Without a local atlas dataset, the app shows the dataset-needed state rather than Overview.
- Feature and lifecycle labels are candidate interpretations; their presence on the page does not prove their meaning.
- Chapter and stage choices update URL state. Inspect the resulting view, not only the button action.
