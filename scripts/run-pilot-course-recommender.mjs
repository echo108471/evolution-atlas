#!/usr/bin/env node
/**
 * Synthetic Course Recommender contract exercise with hand-authored responses.
 * It does not perform model inference or establish owner review.
 * Executes baseline discovery -> sample review note -> history expansion -> review continuity.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE_DIR = resolve(ROOT, 'public/graph-reviews/history-delivery-cr-baseline');
const EXPANSION_DIR = resolve(ROOT, 'public/graph-reviews/history-delivery-cr-expansion');
const REPO = '/Users/echo/Projects/course-recommender';
const BASELINE_SHA = 'e3d4704a8475b34059037220789dcf00aca83b64';
const EXPANSION_SHA = 'e306b9206e9ede75726cb8a6070261507fdfd861';
const READINGS_FILE = resolve(ROOT, 'public/readings.cr.json');

const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C'
};

function runNode(script, args) {
  console.log(`> node ${script} ${args.join(' ')}`);
  const out = execFileSync('node', [resolve(ROOT, script), ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return out;
}

for (const dir of [BASELINE_DIR, EXPANSION_DIR]) {
  if (existsSync(dir)) throw new Error(`Existing run directory must be preserved: ${dir}`);
}

console.log('================================================================');
console.log('SYNTHETIC COURSE RECOMMENDER CONTRACT EXERCISE: BASELINE (e3d4704a)');
console.log('================================================================');

const baselineConfig = {
  mode: 'discovery',
  repo: REPO,
  revision: BASELINE_SHA,
  displayName: 'Davis Cattlelog Baseline',
  partitionCount: 2,
  maxFileBytes: 1048576
};
const baselineConfigFile = resolve(ROOT, 'scratch/cr-baseline-config.json');
mkdirSync(resolve(ROOT, 'scratch'), { recursive: true });
writeFileSync(baselineConfigFile, JSON.stringify(baselineConfig, null, 2));

runNode('scripts/repository-engine.mjs', ['prepare', BASELINE_DIR, baselineConfigFile]);
mkdirSync(resolve(BASELINE_DIR, 'proposals'), { recursive: true });

// Coordinate Worker A
console.log('\n--- Coordinating Worker A (Baseline) ---');
const resA = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', BASELINE_DIR, 'A']));
runNode('scripts/repository-engine.mjs', ['bind', BASELINE_DIR, 'A', resA.reservationId, 'host-worker-A']);

// Worker A retrieves evidence
const readOut1 = runNode('scripts/repository-engine.mjs', ['broker', BASELINE_DIR, 'A', 'read', 'demo/backend/sql_pipelines/routes.py', '1', '60']);
const receipt1 = JSON.parse(readOut1);
console.log(`Worker A read routes.py -> receipt ${receipt1.id}`);

const readOut2 = runNode('scripts/repository-engine.mjs', ['broker', BASELINE_DIR, 'A', 'read', 'demo/frontend/src/api/GetBackend.ts', '1', '50']);
const receipt2 = JSON.parse(readOut2);
console.log(`Worker A read GetBackend.ts -> receipt ${receipt2.id}`);

// Worker A proposes capabilities
const proposalA = {
  agent: 'A',
  scopeSummary: 'Backend API routes and frontend data fetching helpers',
  coverage: {
    inspected: ['demo/backend/sql_pipelines/routes.py', 'demo/frontend/src/api/GetBackend.ts'],
    omissions: []
  },
  crossPartitionLeads: [],
  nodes: [
    {
      id: 'A_backend_api',
      name: 'Course and Professor Query API',
      summary: 'FastAPI endpoints serving course details, professor profiles, and search queries against PostgreSQL',
      actor: 'FastAPI backend service',
      inputs: ['HTTP requests', 'query params'],
      outcomes: ['JSON course and professor records'],
      conditions: ['PostgreSQL database connection'],
      exclusions: ['Direct review submission'],
      implementations: ['demo/backend/sql_pipelines/routes.py'],
      uncertainty: [],
      evidenceIds: [receipt1.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Routes serve SQL-backed course and professor details',
          evidenceIds: [receipt1.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'A_api_client',
      name: 'Frontend API Client Layer',
      summary: 'API communication helper functions fetching backend courses, search results, and professor information',
      actor: 'React frontend application',
      inputs: ['Search parameters', 'course IDs'],
      outcomes: ['Promise-based backend response payloads'],
      conditions: ['Network connection to backend host'],
      exclusions: ['Local storage caching'],
      implementations: ['demo/frontend/src/api/GetBackend.ts'],
      uncertainty: [],
      evidenceIds: [receipt2.id],
      assessment: 'supported',
      claims: [
        {
          text: 'GetBackend provides central data fetch functions for the UI',
          evidenceIds: [receipt2.id],
          assessment: 'supported'
        }
      ]
    }
  ],
  edges: [
    {
      from: 'A_api_client',
      to: 'A_backend_api',
      type: 'depends_on',
      reason: 'Frontend client helpers consume backend FastAPI endpoints',
      evidenceIds: [receipt1.id, receipt2.id],
      assessment: 'supported'
    }
  ],
  limitations: []
};
writeFileSync(resolve(BASELINE_DIR, 'proposals/A.json'), JSON.stringify(proposalA, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', BASELINE_DIR, 'A', 'host-worker-A', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', BASELINE_DIR, 'A']);

// Coordinate Worker B
console.log('\n--- Coordinating Worker B (Baseline) ---');
const resB = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', BASELINE_DIR, 'B']));
runNode('scripts/repository-engine.mjs', ['bind', BASELINE_DIR, 'B', resB.reservationId, 'host-worker-B']);

const readOut3 = runNode('scripts/repository-engine.mjs', ['broker', BASELINE_DIR, 'B', 'read', 'demo/frontend/src/pages/Home.tsx', '1', '60']);
const receipt3 = JSON.parse(readOut3);
console.log(`Worker B read Home.tsx -> receipt ${receipt3.id}`);

const proposalB = {
  agent: 'B',
  scopeSummary: 'Frontend user interface browsing and course filtering pages',
  coverage: {
    inspected: ['demo/frontend/src/pages/Home.tsx'],
    omissions: []
  },
  crossPartitionLeads: [],
  nodes: [
    {
      id: 'B_course_browser',
      name: 'Course Catalog Browsing & Filter UI',
      summary: 'Main user interface page providing interactive course search, category filters, and course detail panels',
      actor: 'Student end user',
      inputs: ['User search query', 'filter selections'],
      outcomes: ['Rendered course list with ratings and descriptions'],
      conditions: ['Browser JavaScript enabled'],
      exclusions: ['User review authoring form'],
      implementations: ['demo/frontend/src/pages/Home.tsx'],
      uncertainty: [],
      evidenceIds: [receipt3.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Home page renders course cards and handles filter selections',
          evidenceIds: [receipt3.id],
          assessment: 'supported'
        }
      ]
    }
  ],
  edges: [],
  limitations: []
};
writeFileSync(resolve(BASELINE_DIR, 'proposals/B.json'), JSON.stringify(proposalB, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', BASELINE_DIR, 'B', 'host-worker-B', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', BASELINE_DIR, 'B']);

// Baseline Integration
console.log('\n--- Baseline Integration ---');
runNode('scripts/repository-engine.mjs', ['integrate', BASELINE_DIR]);

const resR = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', BASELINE_DIR, 'R']));
runNode('scripts/repository-engine.mjs', ['bind', BASELINE_DIR, 'R', resR.reservationId, 'host-integrator-R']);

// Integrator R consolidates proposals into candidate graph
const baselineReconciled = {
  nodes: [
    {
      id: 'C_backend_api',
      name: 'Course and Professor Query API',
      summary: 'FastAPI endpoints serving course details, professor profiles, and search queries against PostgreSQL',
      actor: 'FastAPI backend service',
      inputs: ['HTTP requests', 'query params'],
      outcomes: ['JSON course and professor records'],
      conditions: ['PostgreSQL database connection'],
      exclusions: ['Direct review submission'],
      implementations: ['demo/backend/sql_pipelines/routes.py'],
      uncertainty: [],
      evidenceIds: [receipt1.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Routes serve SQL-backed course and professor details',
          evidenceIds: [receipt1.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_api_client',
      name: 'Frontend API Client Layer',
      summary: 'API communication helper functions fetching backend courses, search results, and professor information',
      actor: 'React frontend application',
      inputs: ['Search parameters', 'course IDs'],
      outcomes: ['Promise-based backend response payloads'],
      conditions: ['Network connection to backend host'],
      exclusions: ['Local storage caching'],
      implementations: ['demo/frontend/src/api/GetBackend.ts'],
      uncertainty: [],
      evidenceIds: [receipt2.id],
      assessment: 'supported',
      claims: [
        {
          text: 'GetBackend provides central data fetch functions for the UI',
          evidenceIds: [receipt2.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_course_browser',
      name: 'Course Catalog Browsing & Filter UI',
      summary: 'Main user interface page providing interactive course search, category filters, and course detail panels',
      actor: 'Student end user',
      inputs: ['User search query', 'filter selections'],
      outcomes: ['Rendered course list with ratings and descriptions'],
      conditions: ['Browser JavaScript enabled'],
      exclusions: ['User review authoring form'],
      implementations: ['demo/frontend/src/pages/Home.tsx'],
      uncertainty: [],
      evidenceIds: [receipt3.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Home page renders course cards and handles filter selections',
          evidenceIds: [receipt3.id],
          assessment: 'supported'
        }
      ]
    }
  ],
  edges: [
    {
      from: 'C_api_client',
      to: 'C_backend_api',
      type: 'depends_on',
      reason: 'Frontend client helpers consume backend FastAPI endpoints',
      evidenceIds: [receipt1.id, receipt2.id],
      assessment: 'supported'
    },
    {
      from: 'C_course_browser',
      to: 'C_api_client',
      type: 'depends_on',
      reason: 'Home browsing page invokes frontend API client to fetch courses',
      evidenceIds: [receipt2.id, receipt3.id],
      assessment: 'supported'
    }
  ],
  lineage: [
    {
      originalId: 'A_backend_api',
      decision: 'rename',
      successorIds: ['C_backend_api'],
      reason: 'Standardized baseline capability ID'
    },
    {
      originalId: 'A_api_client',
      decision: 'rename',
      successorIds: ['C_api_client'],
      reason: 'Standardized baseline capability ID'
    },
    {
      originalId: 'B_course_browser',
      decision: 'rename',
      successorIds: ['C_course_browser'],
      reason: 'Standardized baseline capability ID'
    }
  ],
  edgeLineage: [
    {
      source: 'discovery',
      originalIndex: 0,
      decision: 'revise',
      successorEdges: [
        {
          from: 'C_api_client',
          to: 'C_backend_api',
          type: 'depends_on'
        }
      ],
      reason: 'Endpoints updated to consolidated baseline node IDs'
    }
  ],
  decisions: [
    {
      question: 'How to structure baseline capabilities across backend and frontend?',
      decision: 'Consolidated backend API, client helper layer, and browsing UI into baseline candidate map',
      reason: 'Separates data provider, API client, and user-facing presentation layers',
      uncertainty: [],
      evidenceIds: [receipt1.id, receipt2.id, receipt3.id]
    }
  ],
  limitations: [
    'Baseline sample covers core navigation and API paths; additional admin and scrapers withheld'
  ],
  comparisons: [],
  historyLineage: [],
  historyEdgeLineage: []
};
writeFileSync(resolve(BASELINE_DIR, 'reconciled.json'), JSON.stringify(baselineReconciled, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', BASELINE_DIR, 'R', 'host-integrator-R', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', BASELINE_DIR, 'R']);
runNode('scripts/repository-engine.mjs', ['publish', BASELINE_DIR]);
console.log('Baseline published successfully!');

// Synthetic owner-feedback note exercises the review overlay; no owner reviewed this run.
console.log('\n--- Attaching Sample Baseline Review Note ---');
const baseOutput = JSON.parse(readFileSync(resolve(BASELINE_DIR, 'output.json'), 'utf8'));
const graphSha256 = createHash('sha256').update(JSON.stringify(baseOutput.graph)).digest('hex');
const baselineNotes = {
  graphSha256,
  notes: [
    {
      nodeId: 'C_course_browser',
      field: 'summary',
      expectedText: 'Main user interface page providing interactive course search, category filters, and course detail panels',
      status: 'qualified',
      basis: 'owner-feedback',
      message: 'Synthetic example, not actual owner feedback: review authoring was not yet present at this baseline commit; users could only browse and search',
      evidenceIds: [receipt3.id]
    }
  ]
};
const baselineNotesFile = resolve(ROOT, 'scratch/baseline-review-notes.json');
writeFileSync(baselineNotesFile, JSON.stringify(baselineNotes, null, 2));
runNode('scripts/review-repository-map.mjs', [BASELINE_DIR, baselineNotesFile]);
console.log('Baseline review companion generated (reviewed-output.json)!');

console.log('\n================================================================');
console.log('SYNTHETIC COURSE RECOMMENDER CONTRACT EXERCISE: EXPANSION (e306b920, PR #153)');
console.log('================================================================');

const rawReadings = JSON.parse(readFileSync(READINGS_FILE, 'utf8'));
const rTarget = rawReadings.readings.find(r => r.commitSha === EXPANSION_SHA);
const filteredReadings = rawReadings.readings.filter(r => r.index <= rTarget.index);
const scopedDoc = {
  ...rawReadings,
  headSha: EXPANSION_SHA,
  commitCount: rTarget.index,
  readings: filteredReadings
};
const scopedReadingsPath = resolve(ROOT, 'scratch/readings-scoped.json');
writeFileSync(scopedReadingsPath, JSON.stringify(scopedDoc, null, 2));

const expansionConfig = {
  mode: 'expansion',
  repo: REPO,
  revision: EXPANSION_SHA,
  displayName: 'Davis Cattlelog Expansion (Review Submission & Telemetry)',
  partitionCount: 2,
  maxFileBytes: 1048576,
  baseline: resolve(BASELINE_DIR, 'output.json'),
  commitReadings: [scopedReadingsPath]
};
const expansionConfigFile = resolve(ROOT, 'scratch/cr-expansion-config.json');
writeFileSync(expansionConfigFile, JSON.stringify(expansionConfig, null, 2));

runNode('scripts/repository-engine.mjs', ['prepare', EXPANSION_DIR, expansionConfigFile]);
mkdirSync(resolve(EXPANSION_DIR, 'proposals'), { recursive: true });

// Coordinate Expansion Worker A
console.log('\n--- Coordinating Worker A (Expansion) ---');
const expResA = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', EXPANSION_DIR, 'A']));
runNode('scripts/repository-engine.mjs', ['bind', EXPANSION_DIR, 'A', expResA.reservationId, 'host-exp-worker-A']);

// Worker A retrieves the new WriteReview.tsx file and diff
const expRead1 = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'A', 'read', 'demo/frontend/src/pages/WriteReview.tsx', '1', '70']);
const expReceipt1 = JSON.parse(expRead1);
console.log(`Expansion Worker A read WriteReview.tsx -> receipt ${expReceipt1.id}`);

// Worker A queries commit-meta and post-baseline diff for commit e306b920
const metaOut = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'A', 'commit-meta', EXPANSION_SHA]);
const metaReceipt = JSON.parse(metaOut);
console.log(`Expansion Worker A retrieved commit-meta -> receipt ${metaReceipt.id}`);

const diffOut1 = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'A', 'diff', EXPANSION_SHA, 'demo/frontend/src/pages/WriteReview.tsx', '60', '8000']);
const diffReceipt1 = JSON.parse(diffOut1);
console.log(`Expansion Worker A retrieved diff for WriteReview.tsx -> receipt ${diffReceipt1.id}`);

const diffOut2 = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'A', 'diff', EXPANSION_SHA, 'demo/frontend/src/api/GetBackend.ts', '30', '4000']);
const diffReceipt2 = JSON.parse(diffOut2);
console.log(`Expansion Worker A retrieved diff for GetBackend.ts -> receipt ${diffReceipt2.id}`);

const expProposalA = {
  agent: 'A',
  scopeSummary: 'Review submission page UI and PostHog API telemetry instrumentation',
  coverage: {
    inspected: ['demo/frontend/src/pages/WriteReview.tsx'],
    omissions: []
  },
  crossPartitionLeads: [],
  nodes: [
    {
      id: 'A_write_review',
      name: 'Professor Review Submission UI',
      summary: 'Dedicated /write-review page with interactive form for submitting ratings, grades, attendance, tags, and feedback',
      actor: 'Student reviewer',
      inputs: ['Course code', 'Quality & difficulty ratings', 'Grade received', 'Tags', 'Comments'],
      outcomes: ['Validated review payload logged for submission'],
      conditions: ['Frontend form input validation'],
      exclusions: ['Direct backend persistence (currently logs submission in prototype)'],
      implementations: ['demo/frontend/src/pages/WriteReview.tsx'],
      uncertainty: [],
      evidenceIds: [expReceipt1.id, diffReceipt1.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Adds WriteReview component with form state, validation, and rating stars',
          evidenceIds: [expReceipt1.id, diffReceipt1.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'A_telemetry_instrumentation',
      name: 'API Telemetry & Analytics Instrumentation',
      summary: 'PostHog event tracking integrated into frontend API helpers capturing search and query interactions',
      actor: 'Frontend analytics service',
      inputs: ['API calls', 'search queries'],
      outcomes: ['PostHog event dispatches'],
      conditions: ['PostHog client initialized'],
      exclusions: ['Server-side event dispatching'],
      implementations: ['demo/frontend/src/api/GetBackend.ts'],
      uncertainty: [],
      evidenceIds: [diffReceipt2.id],
      assessment: 'supported',
      claims: [
        {
          text: 'GetBackend captures PostHog telemetry on API requests',
          evidenceIds: [diffReceipt2.id],
          assessment: 'supported'
        }
      ]
    }
  ],
  edges: [],
  limitations: []
};
writeFileSync(resolve(EXPANSION_DIR, 'proposals/A.json'), JSON.stringify(expProposalA, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', EXPANSION_DIR, 'A', 'host-exp-worker-A', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', EXPANSION_DIR, 'A']);

// Coordinate Expansion Worker B (empty proposal, no new capabilities in its partition)
console.log('\n--- Coordinating Worker B (Expansion) ---');
const expResB = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', EXPANSION_DIR, 'B']));
runNode('scripts/repository-engine.mjs', ['bind', EXPANSION_DIR, 'B', expResB.reservationId, 'host-exp-worker-B']);

const expProposalB = {
  agent: 'B',
  scopeSummary: 'Verified unchanged frontend browsing components',
  coverage: {
    inspected: [],
    omissions: []
  },
  crossPartitionLeads: [],
  nodes: [],
  edges: [],
  limitations: []
};
writeFileSync(resolve(EXPANSION_DIR, 'proposals/B.json'), JSON.stringify(expProposalB, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', EXPANSION_DIR, 'B', 'host-exp-worker-B', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', EXPANSION_DIR, 'B']);

// Expansion Integration
console.log('\n--- Expansion Integration ---');
runNode('scripts/repository-engine.mjs', ['integrate', EXPANSION_DIR]);

const expResR = JSON.parse(runNode('scripts/repository-engine.mjs', ['reserve', EXPANSION_DIR, 'R']));
runNode('scripts/repository-engine.mjs', ['bind', EXPANSION_DIR, 'R', expResR.reservationId, 'host-exp-integrator-R']);

// Integrator R can query prior readings or receipts
const readingOut = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'reading', 'C1', EXPANSION_SHA]);
const readingReceipt = JSON.parse(readingOut);
console.log(`Expansion Integrator R queried reading for ${EXPANSION_SHA} -> receipt ${readingReceipt.id}`);

// Read current revision versions of routes, backend, and home to provide current source receipts
const expReadRoutes = JSON.parse(runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'read', 'demo/backend/sql_pipelines/routes.py', '1', '60']));
console.log(`Expansion Integrator R read routes.py -> receipt ${expReadRoutes.id}`);

const expReadBackend = JSON.parse(runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'read', 'demo/frontend/src/api/GetBackend.ts', '1', '50']));
console.log(`Expansion Integrator R read GetBackend.ts -> receipt ${expReadBackend.id}`);

const expReadHome = JSON.parse(runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'read', 'demo/frontend/src/pages/Home.tsx', '1', '60']));
console.log(`Expansion Integrator R read Home.tsx -> receipt ${expReadHome.id}`);

// Read App.tsx to verify router wiring for WriteReview
const readAppOut = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'read', 'demo/frontend/src/App.tsx', '1', '40']);
const readAppReceipt = JSON.parse(readAppOut);
console.log(`Expansion Integrator R read App.tsx -> receipt ${readAppReceipt.id}`);

// Retrieve baseline receipt 3 from Store via catalog
const storeReceiptOut = runNode('scripts/repository-engine.mjs', ['broker', EXPANSION_DIR, 'R', 'receipt', 'old:' + receipt3.id]);
console.log(`Expansion Integrator R loaded store receipt old:${receipt3.id} on demand without size penalty`);

// Reconciled expansion map with history lineage!
const expansionReconciled = {
  nodes: [
    {
      id: 'C_backend_api',
      name: 'Course and Professor Query API',
      summary: 'FastAPI endpoints serving course details, professor profiles, and search queries against PostgreSQL',
      actor: 'FastAPI backend service',
      inputs: ['HTTP requests', 'query params'],
      outcomes: ['JSON course and professor records'],
      conditions: ['PostgreSQL database connection'],
      exclusions: ['Direct review submission'],
      implementations: ['demo/backend/sql_pipelines/routes.py'],
      uncertainty: [],
      evidenceIds: ['old:' + receipt1.id, expReadRoutes.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Routes serve SQL-backed course and professor details',
          evidenceIds: ['old:' + receipt1.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_api_client',
      name: 'Frontend API Client Layer',
      summary: 'API communication helper functions fetching backend courses, search results, and professor information',
      actor: 'React frontend application',
      inputs: ['Search parameters', 'course IDs'],
      outcomes: ['Promise-based backend response payloads'],
      conditions: ['Network connection to backend host'],
      exclusions: ['Local storage caching'],
      implementations: ['demo/frontend/src/api/GetBackend.ts'],
      uncertainty: [],
      evidenceIds: ['old:' + receipt2.id, expReadBackend.id],
      assessment: 'supported',
      claims: [
        {
          text: 'GetBackend provides central data fetch functions for the UI',
          evidenceIds: ['old:' + receipt2.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_course_browser',
      name: 'Course Catalog Browsing & Filter UI',
      summary: 'Main user interface page providing interactive course search, category filters, and course detail panels',
      actor: 'Student end user',
      inputs: ['User search query', 'filter selections'],
      outcomes: ['Rendered course list with ratings and descriptions'],
      conditions: ['Browser JavaScript enabled'],
      exclusions: ['User review authoring form'],
      implementations: ['demo/frontend/src/pages/Home.tsx'],
      uncertainty: [],
      evidenceIds: ['old:' + receipt3.id, expReadHome.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Home page renders course cards and handles filter selections',
          evidenceIds: ['old:' + receipt3.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_write_review',
      name: 'Professor Review Submission UI',
      summary: 'Dedicated /write-review page with interactive form for submitting ratings, grades, attendance, tags, and feedback',
      actor: 'Student reviewer',
      inputs: ['Course code', 'Quality & difficulty ratings', 'Grade received', 'Tags', 'Comments'],
      outcomes: ['Validated review payload logged for submission'],
      conditions: ['Frontend form input validation'],
      exclusions: ['Direct backend persistence (currently logs submission in prototype)'],
      implementations: ['demo/frontend/src/pages/WriteReview.tsx'],
      uncertainty: [],
      evidenceIds: [expReceipt1.id, diffReceipt1.id, readAppReceipt.id],
      assessment: 'supported',
      claims: [
        {
          text: 'Adds WriteReview component with form state, validation, and rating stars',
          evidenceIds: [expReceipt1.id, diffReceipt1.id],
          assessment: 'supported'
        },
        {
          text: 'Routes /write-review URL to WriteReview component in App router',
          evidenceIds: [readAppReceipt.id],
          assessment: 'supported'
        }
      ]
    },
    {
      id: 'C_telemetry_instrumentation',
      name: 'API Telemetry & Analytics Instrumentation',
      summary: 'PostHog event tracking integrated into frontend API helpers capturing search and query interactions',
      actor: 'Frontend analytics service',
      inputs: ['API calls', 'search queries'],
      outcomes: ['PostHog event dispatches'],
      conditions: ['PostHog client initialized'],
      exclusions: ['Server-side event dispatching'],
      implementations: ['demo/frontend/src/api/GetBackend.ts'],
      uncertainty: [],
      evidenceIds: [diffReceipt2.id],
      assessment: 'supported',
      claims: [
        {
          text: 'GetBackend captures PostHog telemetry on API requests',
          evidenceIds: [diffReceipt2.id],
          assessment: 'supported'
        }
      ]
    }
  ],
  edges: [
    {
      from: 'C_api_client',
      to: 'C_backend_api',
      type: 'depends_on',
      reason: 'Frontend client helpers consume backend FastAPI endpoints',
      evidenceIds: ['old:' + receipt1.id, 'old:' + receipt2.id],
      assessment: 'supported'
    },
    {
      from: 'C_course_browser',
      to: 'C_api_client',
      type: 'depends_on',
      reason: 'Home browsing page invokes frontend API client to fetch courses',
      evidenceIds: ['old:' + receipt2.id, 'old:' + receipt3.id],
      assessment: 'supported'
    },
    {
      from: 'C_write_review',
      to: 'C_course_browser',
      type: 'supports',
      reason: 'Review submission provides user-authored data to augment browsing catalog',
      evidenceIds: [diffReceipt1.id, 'old:' + receipt3.id],
      assessment: 'supported'
    },
    {
      from: 'C_telemetry_instrumentation',
      to: 'C_api_client',
      type: 'supports',
      reason: 'Telemetry instrumentation wraps API client data fetching',
      evidenceIds: [diffReceipt2.id, 'old:' + receipt2.id],
      assessment: 'supported'
    }
  ],
  lineage: [
    {
      originalId: 'old:C_backend_api',
      decision: 'revise',
      successorIds: ['C_backend_api'],
      reason: 'Re-validated backend API endpoints against current revision'
    },
    {
      originalId: 'old:C_api_client',
      decision: 'revise',
      successorIds: ['C_api_client'],
      reason: 'Re-validated API client layer against current revision'
    },
    {
      originalId: 'old:C_course_browser',
      decision: 'revise',
      successorIds: ['C_course_browser'],
      reason: 'Re-validated course browsing UI against current revision'
    },
    {
      originalId: 'A_write_review',
      decision: 'revise',
      successorIds: ['C_write_review'],
      reason: 'Consolidated into integrated candidate map with App router evidence'
    },
    {
      originalId: 'A_telemetry_instrumentation',
      decision: 'rename',
      successorIds: ['C_telemetry_instrumentation'],
      reason: 'Standardized telemetry capability ID'
    }
  ],
  edgeLineage: [
    {
      source: 'baseline',
      originalIndex: 0,
      decision: 'revise',
      successorEdges: [
        {
          from: 'C_api_client',
          to: 'C_backend_api',
          type: 'depends_on'
        }
      ],
      reason: 'Endpoints updated to unprefixed candidate node IDs'
    },
    {
      source: 'baseline',
      originalIndex: 1,
      decision: 'revise',
      successorEdges: [
        {
          from: 'C_course_browser',
          to: 'C_api_client',
          type: 'depends_on'
        }
      ],
      reason: 'Endpoints updated to unprefixed candidate node IDs'
    }
  ],
  decisions: [
    {
      question: 'How to incorporate review submission and telemetry with baseline capabilities?',
      decision: 'Added WriteReview as a dedicated authoring capability and telemetry as an analytics capability',
      reason: 'Preserves core browsing while expanding with review authoring and PostHog tracking',
      uncertainty: [],
      evidenceIds: [diffReceipt1.id, diffReceipt2.id]
    }
  ],
  limitations: [
    'WriteReview is currently a prototype form logging submissions before backend persistence pipeline is wired'
  ],
  comparisons: [
    {
      newNodeId: 'A_write_review',
      existingNodeIds: ['old:C_course_browser'],
      relation: 'distinct',
      reason: 'Review submission introduces an authoring flow distinct from read-only browsing',
      disposition: 'keep-both',
      evidenceIds: [diffReceipt1.id],
      uncertainty: []
    },
    {
      newNodeId: 'A_telemetry_instrumentation',
      existingNodeIds: ['old:C_api_client'],
      relation: 'distinct',
      reason: 'Telemetry instrumentation wraps existing API client functions with event tracking',
      disposition: 'keep-both',
      evidenceIds: [diffReceipt2.id],
      uncertainty: []
    }
  ],
  // HISTORICAL EVOLUTION PLANE:
  historyLineage: [
    {
      id: 'hist_backend_api',
      from: {
        commitSha: BASELINE_SHA,
        nodeId: 'old:C_backend_api'
      },
      to: [
        {
          commitSha: EXPANSION_SHA,
          nodeId: 'C_backend_api'
        }
      ],
      decision: 'retain',
      claim: 'Retains PostgreSQL-backed FastAPI queries',
      reason: 'No structural API changes in target commit range',
      evidenceIds: ['old:' + receipt1.id, expReadRoutes.id],
      assessment: 'supported'
    },
    {
      id: 'hist_api_client',
      from: {
        commitSha: BASELINE_SHA,
        nodeId: 'old:C_api_client'
      },
      to: [
        {
          commitSha: EXPANSION_SHA,
          nodeId: 'C_api_client'
        }
      ],
      decision: 'retain',
      claim: 'Retains API client helpers for backend queries',
      reason: 'Core data fetching methods preserved',
      evidenceIds: ['old:' + receipt2.id, expReadBackend.id],
      assessment: 'supported'
    },
    {
      id: 'hist_course_browser',
      from: {
        commitSha: BASELINE_SHA,
        nodeId: 'old:C_course_browser'
      },
      to: [
        {
          commitSha: EXPANSION_SHA,
          nodeId: 'C_course_browser'
        }
      ],
      decision: 'retain',
      claim: 'Retains course catalog browsing UI',
      reason: 'Browsing interface preserved',
      evidenceIds: ['old:' + receipt3.id, expReadHome.id],
      assessment: 'supported'
    },
    {
      id: 'hist_write_review',
      from: null,
      to: [
        {
          commitSha: EXPANSION_SHA,
          nodeId: 'C_write_review'
        }
      ],
      decision: 'introduce',
      claim: 'Introduces dedicated /write-review page with interactive professor review form',
      reason: 'New component WriteReview.tsx added in commit e306b920 (PR #153)',
      evidenceIds: [diffReceipt1.id],
      assessment: 'supported'
    },
    {
      id: 'hist_telemetry',
      from: null,
      to: [
        {
          commitSha: EXPANSION_SHA,
          nodeId: 'C_telemetry_instrumentation'
        }
      ],
      decision: 'introduce',
      claim: 'Introduces PostHog analytics telemetry event tracking across frontend API calls',
      reason: 'PR #153 instruments GetBackend.ts with analytics captures',
      evidenceIds: [diffReceipt2.id],
      assessment: 'supported'
    }
  ],
  historyEdgeLineage: [
    {
      id: 'hist_edge_0',
      from: {
        commitSha: BASELINE_SHA,
        from: 'old:C_api_client',
        to: 'old:C_backend_api',
        type: 'depends_on'
      },
      to: [
        {
          commitSha: EXPANSION_SHA,
          from: 'C_api_client',
          to: 'C_backend_api',
          type: 'depends_on'
        }
      ],
      decision: 'retain',
      claim: 'Preserves API client dependency on backend',
      reason: 'Unchanged client-server communication',
      evidenceIds: ['old:' + receipt1.id, expReadRoutes.id],
      assessment: 'supported'
    },
    {
      id: 'hist_edge_1',
      from: {
        commitSha: BASELINE_SHA,
        from: 'old:C_course_browser',
        to: 'old:C_api_client',
        type: 'depends_on'
      },
      to: [
        {
          commitSha: EXPANSION_SHA,
          from: 'C_course_browser',
          to: 'C_api_client',
          type: 'depends_on'
        }
      ],
      decision: 'retain',
      claim: 'Preserves browsing UI dependency on client',
      reason: 'Unchanged catalog loading',
      evidenceIds: ['old:' + receipt2.id, expReadBackend.id],
      assessment: 'supported'
    },
    {
      id: 'hist_edge_2',
      from: null,
      to: [
        {
          commitSha: EXPANSION_SHA,
          from: 'C_write_review',
          to: 'C_course_browser',
          type: 'supports'
        }
      ],
      decision: 'introduce',
      claim: 'Adds support relationship from review submission to course browser',
      reason: 'Review data feeds future course catalog displays',
      evidenceIds: [diffReceipt1.id],
      assessment: 'supported'
    },
    {
      id: 'hist_edge_3',
      from: null,
      to: [
        {
          commitSha: EXPANSION_SHA,
          from: 'C_telemetry_instrumentation',
          to: 'C_api_client',
          type: 'supports'
        }
      ],
      decision: 'introduce',
      claim: 'Adds telemetry support relationship to API client',
      reason: 'Monitors API request usage in PostHog',
      evidenceIds: [diffReceipt2.id],
      assessment: 'supported'
    }
  ]
};
writeFileSync(resolve(EXPANSION_DIR, 'reconciled.json'), JSON.stringify(expansionReconciled, null, 2));

runNode('scripts/repository-engine.mjs', ['terminal', EXPANSION_DIR, 'R', 'host-exp-integrator-R', 'completed']);
runNode('scripts/repository-engine.mjs', ['checkpoint', EXPANSION_DIR, 'R']);
runNode('scripts/repository-engine.mjs', ['publish', EXPANSION_DIR]);
console.log('Expansion published successfully!');

// Review Continuity
console.log('\n================================================================');
console.log('REVIEW CONTINUITY PROJECTION');
console.log('================================================================');
runNode('scripts/repository-review-history.mjs', [resolve(BASELINE_DIR, 'reviewed-output.json'), EXPANSION_DIR]);

console.log('\n================================================================');
console.log('SYNTHETIC CONTRACT EXERCISE COMPLETE!');
console.log('================================================================');
console.log('Artifacts generated:');
console.log(`- Baseline: ${BASELINE_DIR}/output.json`);
console.log(`- Baseline reviewed: ${BASELINE_DIR}/reviewed-output.json`);
console.log(`- Expansion: ${EXPANSION_DIR}/output.json`);
console.log(`- Expansion reviewed: ${EXPANSION_DIR}/reviewed-output.json`);
console.log(`- HTML Report: ${EXPANSION_DIR}/reviewed.html`);
