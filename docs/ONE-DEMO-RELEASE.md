# One-demo public release proposal

Prepare a separate reviewed public repository with a clean initial history and
one observed-only Zod demo. Keep the existing repository, its history, saved
outputs, and recovery copies private. This document is a private proposal: it
does not approve snapshot bytes, create a destination, transfer files, publish,
change visibility, or rewrite history.

## Checked source and remaining evidence

The inspected tree is `b2228d2cada8a880e71eaf9dce986b609f499512`, confirmed as
`origin/main` on 2026-10-11. It contains 372 tracked files totaling 3,502,646
bytes: 183 scripts, 79 tests, 36 application files, 32 workflow/skill files,
22 documents, two Serena files, and the remaining configuration/catalog files.
No current tracked path is under the conventional private output roots,
`public/`, `scratch/`, or `publication/assets/`. The publication manifest has
version 1 and an empty asset list. These are current-tree observations, not
approval of every file's contents.

The earlier [release audit](RELEASE-AUDIT.md) establishes that 214 removed output
files totaling 58,464,261 bytes remain in ancestor commits. Changing the existing
repository's visibility would include that history in the public scope;
approving a new demo would not approve those outputs. This pass does not repeat
the history audit or inspect hosted hidden refs, releases, attachments, caches,
forks, or account settings.

Source tracing covered the [gallery loader](../src/App.tsx),
[gallery contract](../src/gallery.ts), [gallery generator](../scripts/gallery.mjs),
[Vite configuration](../vite.config.ts), and
[publication validator](../scripts/lib/build-publication.mjs). Tracked-text scans
reported locations and counts without reproducing private home-path values or
contact details. Private home workspace instructions and the optional project
note are absent in this environment. No experiment repository was fetched and
no full test suite, browser journey, or production build ran for this proposal.

## Proposed history and destination boundary

Use a new directory populated only from an exact, reviewed tracked-file inventory
plus the approved demo bytes. Initialize a new Git repository there after export
authorization; do not clone, mirror, copy `.git`, import private refs, use an
alternate object database, or copy a worktree's Git link. A shallow clone of the
private repository is not the proposed boundary. Keep the original untouched.

Before the first public commit, approve its author/committer identity and a public
provenance statement that preserves required copyright and attribution without
importing private commit metadata. The private export record can retain the exact
private source revision, path/hash mapping, exclusions, and transformations.
The public repository should contain its own reproducibility/provenance record
with only approved fields. A new remote, owner/account, repository name, hosting
target, and initial visibility still require explicit selection and authorization.

The first public commit must have no parents. Every reachable ref/object must
belong to the reviewed public export; no private commit/ref, unapproved historical
blob, private reflog-derived object, alternate, or promisor dependency may enter
it. Approved source blobs can naturally have the same hashes as their private
originals without importing their ancestor commits. A clean
export avoids publishing private history; it does not by itself clear the
exported source, documentation, contributor metadata, or licenses.

## Proposed tree allowlist and exclusions

Prepare portable rewrites privately, then freeze the final expansion as exact
relative paths with modes, byte sizes, source hashes, and final export SHA-256
hashes against the final integrated private source revision. The rows
below describe the proposed scope, not an executable wildcard approval.

| Proposed retained scope | Required treatment before export |
| --- | --- |
| `src/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` | Retain the application. Review source text and replace gallery setup text that points to the private original or claims interpretation for an observed-only demo. |
| `scripts/`, including `scripts/lib/`, `scripts/versions/`, and `scripts/verification/`, except the pilot below | Retain analyzers, generators, offline validation, engine/replay implementations, and tests' imports. Review source comments and embedded examples independently from runtime code. Do not import generated responses, receipts, or reports. |
| `test/` | Retain synthetic and rejection tests. Replace real contact examples in `test/identity.test.mjs` and `scripts/lib/identity.mjs` with equivalent fictitious explanatory text; do not remove identity safeguards or classify test token literals as live credentials. |
| `package.json`, `package-lock.json`, `.node-version`, `.nvmrc`, `.gitignore`, `.github/workflows/check.yml` | Keep locked installation and the credential-free offline gate. `package.json`'s `private: true` prevents npm publication and does not prevent a public source repository. Keep the CI workflow free of experiment/model calls. |
| `LICENSE`, `.agents/skills/`, and portable `AGENTS.md` | Keep Atlas's Apache-2.0 license and required notices, plus the pinned pstack provenance and unchanged upstream MIT license. Remove dependency on unavailable personal workspace/vault guidance; express approval as the repository owner's decision. Retain `.agents/` because `check:pstack` and the control-harness feature map require it. |
| Reusable documents listed below | Retain only rewritten portable instructions/contracts. Resolve excluded-document links and remove unapproved source-specific results or quoted evidence. |
| `gallery/catalog.json` | Retain immutable source catalog pins as candidates; only the separate runtime manifest selects the one published demo. Catalog membership is not snapshot approval or build inclusion. |
| `publication/manifest.json` and exactly three approved asset sources | Add only the reviewed gallery manifest, sanitized Zod JSON, and MIT notice described below; no automatic output discovery. |

Proposed reusable document set: `README.md`, `docs/ARCHITECTURE.md`,
`docs/DEVELOPMENT.md`, `docs/ENGINEERING.md`, `docs/EVIDENCE-MODEL.md`,
`docs/EXPERIMENTS.md`, `docs/HISTORY-WORKFLOW.md`,
`docs/PRIVATE-DEVELOPMENT.md`, `docs/ROADMAP.md`, and `docs/VERIFICATION.md`.
Add a concise public `docs/DEMO-SNAPSHOT.md` containing approved provenance,
data treatment, omissions, exact hashes, and interpretation limits.

Exclude the following from the proposed first public tree, preserving the
originals privately:

- `.serena/`, `CLAUDE.md`, and `TERAX.md`: optional machine/tool adapters;
  no active application, test, or package-script consumer was found.
- `scripts/run-pilot-course-recommender.mjs`: one-off pilot with a hardcoded
  workstation repository and saved-input dependencies. Its only found consumer
  is explanatory documentation; remove that reference from the public guide.
- Original research narratives `docs/CAPABILITIES.md`,
  `docs/CAPABILITY-GRAPH.md`, `docs/CAPABILITY-INDUCTION.md`, `docs/CONCEPT.md`,
  `docs/COURSE-RECOMMENDER-PILOT.md`, `docs/EPOCHS.md`,
  `docs/EXPERIMENT-SUMMARY.md`, `docs/INTERPRETATION-FINDINGS.md`,
  `docs/PER-COMMIT.md`, and `docs/PRODUCT.md`. Exclusion is a minimal scope
  choice, not a finding that every paragraph is confidential.
- Private operational reviews `docs/ARTIFACT-PRESERVATION.md`,
  `docs/DEMO-REVIEW.md`, `docs/RELEASE-AUDIT.md`, and this original proposal.
  Publish a separate approved demo/release record instead of cloud recovery
  locations, retained-output inventory, or unresolved multi-demo proposals.
- All real runs, raw/provider responses, cloned repositories, caches, generated
  reports, private fixtures, `node_modules/`, `dist/`, credential/config files,
  Git metadata, and ignored files. Approved assets are the only exception for
  real data, at their explicit `publication/assets/` paths.

Deleting documentation alone is insufficient. README, Architecture, Experiments,
Private Development, and Roadmap currently link to excluded documents.
The report renderer's fixed `SUMMARY_DOCUMENTS` list also reads excluded
narratives. Retain the generator but change its public default document set to
the reviewed retained documents; update its synthetic tests and documentation
so `render:reports` remains usable without private narratives. Preserve the
private renderer and original documents in the original repository. Review
research-specific comments in `scripts/lib/identity.mjs`,
`scripts/lib/commit-diff.mjs`, `scripts/lib/triage.mjs`, their versioned copies,
and `src/model.ts`; avoid publishing old quantitative claims as evidence for
the new snapshot. Real contact examples were confirmed in the current identity
helper's comment and its identity test's comment; preserve their reasoning using
fictitious examples. Keep versioned replay contracts intact. Retain loopback
addresses used by the harness, offline guard, and rejection tests; those are
portable test behavior, unlike links to private generated reports.

Portable `AGENTS.md` must keep project evidence, privacy, contributor-safety,
and verification rules while removing mandatory personal workspace reads.
Apply the same owner terminology to the workflow references. Replace gallery
setup with an explicit public project URL/target directory, `cd`, locked
`npm ci`, and accurate local observed-analysis instructions. Review all retained
Markdown links/headings after edits, including links checked by `check:pstack`.
Do not silently widen the allowlist to fix a broken link.

## One demo and exact production inclusion

The proposed source is Zod at catalog revision
`43f729db4aa0cedff6d6b3261f33f8556b3c7102`. Source-license review is recorded
in the private [demo review](DEMO-REVIEW.md); it does not approve a dataset.
Candidate generation, sanitization, final inventory, and owner approval remain
separate steps. No other demo or previous interpreted dataset is included.

| Exact proposed source path | Exact emitted path | Type | Final SHA-256 / approval |
| --- | --- | --- | --- |
| `publication/assets/zod-gallery-manifest.json` | `gallery/manifest.json` | `application/json` | Pending candidate review and explicit owner approval |
| `publication/assets/zod.json` | `gallery/zod.json` | `application/json` | Pending candidate review and explicit owner approval |
| `publication/assets/zod-LICENSE.txt` | `approved-snapshots/zod-LICENSE.txt` | `text/plain` | Pending exact notice-byte comparison and explicit owner approval |

The runtime gallery manifest has `version`, a fixed `generatedAt`, and exactly
one `subjects` entry with slug `zod`, dataset `zod.json`, upstream URL, exact
`headSha`, accurate corpus counts/date bounds, `license: "MIT"`,
`interpreted: false`, and `interpretation: null`. Its description/selection
rationale must explain the observed-only and identity-treatment limits.
Keep its optional byte/hash metadata consistent with the approved dataset.
Do not reuse a prior multi-subject manifest: `gallery.mjs --only` merges
previous entries when its output already has a manifest.

The Atlas JSON must match the existing `AtlasDataset` contract and retain
`analysis.mode: "observed-only"`. Proposed privacy default: no contributor
names, addresses, aliases, heuristic identity matches, copied source excerpts,
or commit bodies; use consistent opaque contributor labels/IDs and review all
remaining free-text subjects and paths. Removing identity fields is not
anonymity: commits, dates, paths, relationships, and hashes can resolve to
public upstream people. Record that limitation and any redaction separately
from observed facts; empty candidate arrays do not certify semantic accuracy.
Publish the owner's approved treatment only, after inspecting the complete
candidate bytes and verifying referential integrity and UI behavior.

Include the full applicable MIT copyright/permission notice with the demo,
preserving required names in that notice. Atlas's Apache-2.0 license does not
relicense upstream material. Provide a discoverable notice/provenance link
from the public demo, including when deployed independently of the source
repository. Review copied text and any third-party material in actual export
bytes; a project-root license label does not clear all content.

The publication manifest format is exactly
`{"version":1,"assets":[...]}`. Each asset has exactly `source`, `path`,
`sha256`, `mediaType`, and `approval`; hashes must be lowercase 64-digit hex,
and approval must reference the owner's actual decision on those bytes.
The build permits safe regular non-symlink files under `publication/assets/`
and emits only under `gallery/` or `approved-snapshots/`, with matching
extensions and no duplicate/conflicting destinations. JSON parsing is checked;
the build does not validate the Atlas semantics, sanitize content, authenticate
the approval reference, or approve publication.

Production disables `public/` copying and clears its owned `dist/`. Inspect
the actual production output: the app bundle plus exactly the three asset
paths/hashes above, with no other demo, report, local clone, cache, receipt,
response, source map containing unintended material, or stale build output.
Deploy only that verified build directory after separate hosting approval;
do not package the original checkout, scratch storage, or backup.

## Ordered implementation and acceptance

1. **Freeze the inputs privately.** Integrate portability fixes and the reviewed
   candidate in private development. Record the final source commit, raw and
   sanitized dataset hashes, generator source, sanitation rules, license bytes,
   and omissions. Prepare all public-facing rewrites in private staging before
   inventory approval, recording original source and final export hashes.
   Preserve raw inputs and expensive outputs; no paid pass is necessary for
   an observed-only demo.
2. **Review and authorize the concrete scope.** Present the exact export inventory,
   one demo's three byte hashes, public provenance/notice, identity treatment,
   proposed public commit identity, and destination. Resolve only substantive
   data/license/interpretation concerns. Snapshot approval, clean export approval,
   and remote/visibility/hosting approval are distinct decisions.
3. **Create the local export when authorized.** Copy only regular files from the
   already reviewed final path/hash inventory, byte-for-byte, into a new private
   directory, including the prepared rewrites and approved assets. Initialize new history
   without accessing or mutating the original refs/index. Validate inventory
   equality, forbidden-path/content absence, modes, hashes, links, licenses,
   and the new repository's complete ref/object scope. Keep the export private.
   Any later rewrite or asset change requires a refreshed final inventory and
   renewed review of the changed exact bytes before a public operation.
4. **Validate the exact export revision.** Install locked dependencies in the
   documented separate registry or prepared-cache stage; generate and validate
   synthetic fixtures; run `node scripts/check-offline.mjs`, the final exact
   fresh-checkout smoke, and the report-generator check. No private data, model
   credentials, paid calls, or experiment fetch may be needed for routine checks.
   Required link/provenance checks must pass with only export files present.
5. **Validate production and the actual demo.** Build from that checkout; compare
   the complete `dist/` inventory and all three asset hashes. Later browser
   checks must exercise the production gallery landing page, `?repo=zod`,
   observed overview/history navigation, evidence references, privacy omissions,
   and the accessible notice. Synthetic harness passes do not establish the
   real sanitized snapshot's usability or semantic history accuracy.
6. **Approve public operations last.** Independently review final tree/history,
   onboarding, exact built bytes, license/provenance, and recovery status. Obtain
   explicit authorization for the named new remote, visibility, and any hosting
   before creating/pushing/publishing them. Keep the private original and all
   artifact copies; a verified durable private backup remains a separate
   recovery requirement, especially before retiring this cloud environment.

Completion is testable: one parentless initial public commit, no imported private
commits/refs or unapproved historical blobs, exact approved export inventory,
all checks runnable from a clean checkout, and a production output containing
only the app and three
approved demo assets. Until candidate hashes and those checks exist, this
proposal is not release-ready.

The smallest remaining owner decisions are the one demo's exact bytes and
contributor/text treatment; clean initial history and public attribution;
the named public destination and eventual visibility/hosting; and the private
backup destination/custody needed for recovery. Extra demos and public research
rewrites can follow independently.
