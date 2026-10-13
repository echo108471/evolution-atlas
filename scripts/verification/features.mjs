/**
 * Stable user-facing feature IDs and the evidence each browser journey produces.
 * Keep this registry declarative: docs and tools can compare it without launching UI.
 */
const sharedSources = [
  'index.html',
  'package.json',
  'src/App.tsx',
  'src/EngineEntry.tsx',
  'src/main.tsx',
  'src/model.ts',
  'src/styles.css',
  'src/urlState.ts',
  'src/useAtlasUrl.ts',
]

const sharedLimits = [
  'The journey uses synthetic, hand-authored fixture data and does not establish semantic accuracy on a real repository.',
  'A passing browser journey establishes the exercised route and interaction only; it does not establish complete feature coverage.',
]

export const FEATURE_REGISTRY = Object.freeze([
  {
    id: 'overview',
    title: 'Repository overview',
    route: '?view=overview',
    journey: 'overview',
    assertions: ['Overview headline and synthetic repository evidence summary render.'],
    sourceFiles: [...sharedSources, 'src/RepositoryOverview.tsx', 'src/story.ts'],
    testFiles: ['test/story.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits],
  },
  {
    id: 'repository',
    title: 'Repository time machine',
    route: '?view=repository',
    journey: 'repository',
    assertions: ['Repository history renders and checkpoint navigation changes the selected checkpoint.'],
    sourceFiles: [...sharedSources, 'src/RepositoryTimeMachine.tsx', 'src/repositorySnapshots.ts'],
    testFiles: ['test/directoryLifespans.test.ts', 'test/story.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'This does not exercise a model-authored history integration run.'],
  },
  {
    id: 'periods',
    title: 'History periods',
    route: '?view=periods',
    journey: 'periods',
    assertions: ['A head-matched synthetic period is shown and its detail opens.'],
    sourceFiles: [...sharedSources, 'src/PeriodBands.tsx', 'src/periods.ts'],
    testFiles: ['test/periods.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'This does not verify model-authored period boundaries.'],
  },
  {
    id: 'features',
    title: 'Feature stories',
    route: '?view=features',
    journey: 'features',
    assertions: ['The synthetic candidate appears in the feature list and its story can be selected.'],
    sourceFiles: [...sharedSources, 'src/FeatureExplorer.tsx', 'src/FeatureStory.tsx', 'src/FeatureIndex.tsx', 'src/story.ts'],
    testFiles: ['test/story.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'The fixture label is a candidate interpretation supplied by the test harness.'],
  },
  {
    id: 'people',
    title: 'People in repository context',
    route: '?view=people',
    journey: 'people',
    assertions: ['Selecting the second synthetic contributor shows its authored commit in repository evidence.'],
    sourceFiles: [...sharedSources, 'src/ContributorTrail.tsx', 'src/story.ts'],
    testFiles: ['test/story.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'The journey does not rank contributors or infer ownership.'],
  },
  {
    id: 'identity',
    title: 'Identity review',
    route: '?view=identity',
    journey: 'identity',
    assertions: ['A synthetic candidate identity match appears for review.'],
    sourceFiles: [...sharedSources, 'src/IdentityReview.tsx', 'src/identity.ts'],
    testFiles: ['test/identity.test.mjs', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'The isolated browser context does not read or modify the user browser profile.'],
  },
  {
    id: 'candidate-map',
    title: 'Candidate capability map',
    route: '?view=map',
    journey: 'candidate-map',
    assertions: [
      'A synthetic output.json file is imported into the browser session without upload.',
      'File import creates no network request, including a same-origin GET with query parameters.',
      'A cited source receipt opens in the evidence inspector with its source text.',
      'History, evidence catalog, repeated import, invalid replacement and dismissal retain explicit evidence boundaries.',
      'Synthetic descendant lineage opens its observed diff; cached readings retain candidate provenance and structured content.',
      'Candidate map fits a 390px viewport without horizontal overflow.',
      'At 1440 × 1000, receipt S1 and its citation labels are visible and unobscured without overlap after opening and scrolling.',
    ],
    sourceFiles: [...sharedSources, 'src/RepositoryMapExplorer.tsx', 'src/repositoryMap.ts'],
    testFiles: ['test/repositoryMap.test.ts', 'test/urlState.test.ts'],
    limits: [...sharedLimits, 'This does not establish semantic support for the synthetic capability claim.'],
  },
  {
    id: 'gallery',
    title: 'Gallery index and subject entry',
    route: '/',
    journey: 'gallery',
    assertions: ['The current-engine entry opens the map workspace and browser Back restores arrival.', 'The synthetic gallery card renders and opens its matching synthetic dataset.'],
    sourceFiles: [...sharedSources, 'src/GalleryIndex.tsx', 'src/gallery.ts'],
    testFiles: [],
    limits: [...sharedLimits, 'No public gallery artifact is read or published by this check.'],
  },
])

export const FEATURE_IDS = Object.freeze(FEATURE_REGISTRY.map(({ id }) => id))

export function getFeature(featureId) {
  return FEATURE_REGISTRY.find((feature) => feature.id === featureId) ?? null
}
