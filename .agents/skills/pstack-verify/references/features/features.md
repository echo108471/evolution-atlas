# Features

Features lets a user find candidate capability stories, follow their cited commits and lifecycle episodes, and inspect the evidence behind those proposals.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/FeatureExplorer.tsx](../../../../../src/FeatureExplorer.tsx), [src/FeatureIndex.tsx](../../../../../src/FeatureIndex.tsx), [src/FeatureFocus.tsx](../../../../../src/FeatureFocus.tsx), and [src/EvidenceRail.tsx](../../../../../src/EvidenceRail.tsx).

## Sub-features

- **features-search** finds candidate names in the feature index.
- **features-story** selects a candidate and displays its cited commit and lifecycle timeline.
- **features-scope** filters by calendar chapter, lifecycle stage, and evidence preset.
- **features-inspector** opens a feature, commit, code area, or contributor in the evidence inspector.
- **features-all-evidence** opens the full evidence view for the selected candidate.

## How to get to it (user POV)

- Choose **Features** in primary navigation, or choose **Explore feature stories** from Overview.
- Enter a name in **Find a feature…**, then choose a matching candidate in **Feature index**.
- Use **Time**, **Lifecycle**, or **Evidence** controls to adjust the visible stories.
- Choose **View all feature evidence**, a timeline mark, or a context chip to inspect supporting evidence.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic fixture includes one candidate feature.

~~~sh
node scripts/control-atlas.mjs verify --feature features
~~~

The journey asserts that the synthetic candidate appears in the feature view and can be selected. Inspect the action record and screenshot. Search, scope filters, lifecycle marks, and evidence citations are mapped but are not asserted by this journey.

## Gotchas

- At 880px and below the explorer is one column; a `feature=` deep link (or an index choice)
  scrolls the story into view below the sticky header, while a default selection does not
  move the page. The section tabs scroll sideways there instead of widening the page.
- Feature names and lifecycle stages are candidate interpretations. A resolved citation does not establish semantic accuracy.
- Search matches feature names; scope controls independently filter the displayed stories.
- A selected calendar chapter can leave no matching story visible. Clear it with **All** before treating an empty index as a defect.
- Contributor counts describe Git authorship and are not ownership or performance measures.
