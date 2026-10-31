# Capability history workflow

The repository engine keeps three separate things: immutable evidence on disk,
bounded evidence requests for a model decision, and candidate maps across Git
revisions. A capability map is an interpretation. A commit, blob, path change,
or saved diff is an observation. Validating their references does not establish
that a capability explanation is correct.

New runs use version 3 through `scripts/repository-engine.mjs`. Existing version
1 and version 2 runs select their preserved implementation by version and exact
source fingerprints. They are not migrated or overwritten.

## Start and expand

Prepare an initial run with an explicit repository and revision:

```json
{
  "mode": "discovery",
  "repo": "/path/to/repository",
  "revision": "FULL_COMMIT_SHA",
  "displayName": "My repository",
  "partitionCount": 1
}
```

```sh
node scripts/repository-engine.mjs prepare RUN CONFIG.json
npm run experiment:status -- RUN
```

Keep generated runs in an ignored local directory. Within this checkout,
`scratch/history-delivery-*/` is one suitable location. Do not
commit repository datasets or assume that ignored files are safe to publish.
The status command is read-only and reports worker states, validation issues,
and published-map counts. It supports current version 3 runs whose pinned
engine source still matches this checkout; older outputs can be inspected as
saved artifacts without rewriting them.

After checkpointing and publishing the initial map, prepare an expansion at a
descendant revision with `mode: "expansion"` and `baseline` pointing to its
`output.json`. The previous source evidence retains its original commit and
blob identities. Changed files become eligible for fresh discovery; previously
sampled files whose blobs are unchanged remain withheld. Deleted files remain
historical evidence, not evidence that a capability necessarily disappeared.

Optional `priorMaps` lists explicitly selected prior run directories. Optional
`commitReadings` lists saved JSON documents from `analyze-commits`. Both are
frozen and fingerprinted at preparation. Ancestry and artifact provenance are
validated before lookup. Earlier review notes and owner labels stay outside
discovery inputs.

## Coordinate a worker

The host reserves an assignment before spawning its worker, then binds the
actual returned handle. A reservation is not evidence that a worker is running.

```sh
node scripts/repository-engine.mjs reserve RUN A
# Host spawns a fresh worker using RUN/tasks/A.json.
node scripts/repository-engine.mjs bind RUN A RESERVATION_ID HOST_HANDLE
node scripts/repository-engine.mjs status RUN A
# Host observes the worker's terminal state before recording it.
node scripts/repository-engine.mjs terminal RUN A HOST_HANDLE completed
node scripts/repository-engine.mjs checkpoint RUN A
```

Workers use only assignment-scoped status. It contains no other workers'
responses, review labels, or task summaries. The broker waits briefly for a
reserved worker to be bound and otherwise rejects access. An interrupted worker
retains its evidence and budget; redispatch requires an explicit terminal host
observation. Dead or unreadable lock files require deliberate recovery after
checking their recorded process. They never expire merely because time passed.

## Retrieve evidence and integrate

The source broker provides `list`, `read`, and `search`. History operations
provide `commit-meta`, bounded `diff`, and paginated `path-history`, restricted
to ancestors of the pinned revision. Searches navigate; they do not prove
behavior. Cached model readings and earlier maps are interpretations, not raw
Git observations.

An empty diff is not evidence that a commit made no change. When any changed
path is restricted, the broker withholds the entire commit patch, including an
explicitly requested ordinary path, to prevent a restricted-file rename from
exposing its earlier contents. Inspect `partial` and `withheldPathCount`; keep
unsupported lifecycle claims unresolved rather than bypassing that boundary.
Source windows use `read PATH START_LINE LINE_COUNT` (not an ending line
number). A `diff` request names one commit, compared with its first parent,
followed by the path and optional line/byte limits; it does not take a revision
range.

```sh
node scripts/repository-engine.mjs broker RUN A diff COMMIT_SHA PATH MAX_LINES MAX_BYTES
node scripts/repository-engine.mjs integrate RUN
node scripts/repository-engine.mjs reserve RUN R
# Spawn the integrator, then bind its actual handle as above.
node scripts/repository-engine.mjs broker RUN R receipt RECEIPT_ID
node scripts/repository-engine.mjs broker RUN R prior-map MAP_ID OFFSET LIMIT
node scripts/repository-engine.mjs broker RUN R reading ARTIFACT_ID COMMIT_SHA
```

Integration sees the candidate graph, proposals, evidence catalog, and explicit
omissions. Full evidence bodies remain in the store and are fetched when needed.
The complete map and evidence remain available in the published offline output.
The catalog and graph still grow with the run; removing evidence bodies is not
a claim of constant-size integration or proven semantic scaling.

The model writes ordinary node/edge consolidation accounting separately from
`historyLineage` and `historyEdgeLineage`. Historical claims identify their
before/after revisions and capability identities, explain the proposed change,
and cite observed history evidence. Earlier model readings cannot independently
satisfy a historical source citation. Unsupported explanations stay unresolved.

After the host observes completion:

```sh
node scripts/repository-engine.mjs terminal RUN R HOST_HANDLE completed
node scripts/repository-engine.mjs checkpoint RUN R
node scripts/repository-engine.mjs publish RUN
```

## Carry review notes and inspect the map

Review continuity happens after inference:

```sh
node scripts/repository-review-history.mjs PREVIOUS_REVIEWED_OUTPUT.json CURRENT_RUN
```

This creates `reviewed-output.json` and `reviewed.html`. Earlier notes follow
explicit lineage and exact evidence correspondence. Changed text, split/merged
successors, relationship changes, and removed nodes stay visible. Matching text
never transfers approval, and changed wording never automatically resolves an
earlier qualification. The candidate graph and original output remain unchanged.

Open **Candidate map** from the app and choose `output.json` or
`reviewed-output.json`. Imports stay in browser memory. A local preview can also
use `?view=map&map=/graph-reviews/YOUR_RUN/reviewed-output.json`. The view separates
observed revision changes, candidate evolution, coverage limits, source receipts,
current review notes, and historical review notes. For an expansion it can switch
between the current map and the `baselineGraph` it was compared against, lists the
prior maps and cached per-commit readings integration consulted (labeled candidate
context, never evidence), shows the integrator's comparisons, decisions and
consolidation lineage, and shows the output's provenance pins. History receipts are
resolved from `history.receiptIds` against the top-level `receipts`. Importing a file
does not add it to the hosted gallery. A gallery subject links to a map only when an
owner-approved map is published under `maps/` and named by the subject's `map` field.

## Acceptance boundary

The milestone requires an expansion across revisions with visible omissions and
at least one history-backed capability claim. Synthetic multi-commit tests verify
mechanics and rejection cases. A model-authored run on real repository revisions
checks that the pieces work together. Neither establishes exhaustive discovery,
correct capability granularity, or independently verified semantic history.
