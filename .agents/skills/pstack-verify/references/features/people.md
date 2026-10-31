# People

People projects observed Git authorship into contributor trails alongside candidate feature context and code-area activity.

Source basis: [src/App.tsx](../../../../../src/App.tsx), [src/ContributorTrail.tsx](../../../../../src/ContributorTrail.tsx), [src/StoryLanes.tsx](../../../../../src/StoryLanes.tsx), and [src/identity.ts](../../../../../src/identity.ts).

## Sub-features

- **people-picker** selects a contributor or resolved profile.
- **people-authored-history** shows authored commits in the selected calendar range.
- **people-feature-context** shows candidate trails that cite the contributor's commits.
- **people-code-areas** shows authored activity across observed code areas, including uncited commits.
- **people-evidence** opens a commit, feature, lifecycle episode, or code area for inspection.

## How to get to it (user POV)

- Choose **People** in primary navigation. The button is hidden, and `?view=people` falls
  back to Overview, when the dataset has no contributor records.
- Choose a **Contributor** from the contributor picker.
- From a feature story or an identity review, open the related contributor trail.
- Adjust the **Time**, **Lifecycle**, or **Evidence** controls to change the visible scope.

## Driving it with control-atlas

Preconditions:

- Run the doctor and list commands in the skill before the journey.
- The synthetic fixture includes two recorded Ada Example identities with distinct authored commits.

~~~sh
node scripts/control-atlas.mjs verify --feature people
~~~

The journey opens People, selects the second recorded identity in the Contributor picker, and checks that its authored commit appears. It does not assert feature-context navigation or identity merging.

## Gotchas

- The view is a projection of Git authorship. Squashed contributors, pair work, design, and review may be absent.
- Candidate feature associations do not establish ownership.
- An empty authored range can be correct after filtering; clear **Time** to return to all commits.
- Do not translate density or commit counts into impact or performance claims.
