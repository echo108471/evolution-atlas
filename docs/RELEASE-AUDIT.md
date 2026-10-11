# Release audit: retained history and research narratives

Public release is not cleared by this audit. Private development can continue;
the remaining decisions concern historical material, research narratives, and
the exact snapshots approved for publication.

## Audited source and boundaries

This assessment is pinned to Evolution Atlas commit
`83b8ded09906aff025d936fa665ab1d33a158f6b`. The local ref snapshot was taken on
2026-10-11 at 18:56 UTC. It covered 10 local branch refs and one remote-tracking
ref, with no tags: 80 reachable commits, 362 trees, and 884 unique blobs.
Commit dates span 2026-08-10 through 2026-10-11. Git metadata contains two
author identity/address pairs and three committer identity/address pairs;
these counts are not counts of people and their values are not reproduced.

The pinned tree has 369 tracked files totaling 3,460,688 bytes. It tracks no
files under `public/`, `scratch/`, `.gallery-cache/`, the conventional private
data/run/report/clone/cache roots, or `publication/assets/`.
`publication/manifest.json` has zero approved assets. The
[private development boundary](PRIVATE-DEVELOPMENT.md) describes preservation,
ignored storage, build inclusion, and free validation.

The assessment reads local tree/history objects, four retained narrative/config
files, and the two preserved output roots. It does not fetch repositories,
dispatch models, change visibility, publish data, remove originals, or rewrite
history. Its documentation commit adds this report only.

## Preserved outputs and historical reachability

The original checkout retains 214 ignored regular files totaling 58,464,261
bytes under these reviewed roots:

| Root | Files | Bytes |
| --- | ---: | ---: |
| `public/graph-reviews/consolidated-engine/larger-demonstration/` | 203 | 58,103,015 |
| `public/graph-reviews/experiment-summary/` | 11 | 361,246 |

They comprise 196 parseable JSON files, 14 HTML reports, three protocol documents,
and the old renderer. The reusable renderer is retained as source in
`scripts/render-experiment-summary.mjs`; its output belongs in ignored scratch
storage. The preserved backup manifest records the same 214 files and byte
total at source revision `abe494d9922faf6af425075259afcf0c93dba557`. Its SHA-256 is
`eb3ec8c1d7f6743087f0b567b79678359f499feac3006803a375ff082fc8c09d`.
The ignored `scratch/artifact-recovery.json` in the original checkout identifies
the local backup. This pass checked manifest metadata; it did not replace the
earlier file-by-file preservation verification or create an off-machine backup.

Both roots remain present in ancestor
`c11c2246ff1dd30cfe81724555b0ad67614b99e1` and in
`abe494d9922faf6af425075259afcf0c93dba557`, each with 214 files and the same byte
total. Removing them from the current index does not remove them from history.
A visibility change that exposes this history would expose the earlier copies.

The outputs contain source-bearing evidence and saved candidate interpretations:

- All 108 standalone receipts have `commitSha`; 90 source-window receipts also
  have blob/path/line metadata and copied `text`. They have no structured
  upstream repository identity.
- Eight saved proposals link through `evidenceIds` and surrounding receipts;
  they do not themselves carry a repository identity or commit revision.
- Seven graph outputs/baselines carry revision, display, provenance, and receipt
  fields. Their structured provenance principally records processing hashes;
  it is not a publication approval or a source-license record.
- Stored revision fields have full SHA format and agree across the three wave
  configurations, plans, and inventories on one commit revision. This confirms
  internal consistency, not upstream identity or availability of Git objects.
- Plans/configurations use absolute local repository paths, including
  `wave-1/snapshot/run-plan.json:5` and `wave-1-config.json:3` beneath the larger
  demonstration root. Publication requires an explicit upstream binding.

No reviewed structured license/notice/attribution/SPDX fields were found.
Seventeen email-like occurrences appear in 16 artifact files inside copied
receipt text or rendered code blocks. Their absence from explicit contributor
fields does not clear the copied content. Four demonstration reports contain
1,404 `pre` blocks; `scripts/render-repository-map.mjs:69` and `:70` embed saved
source text and proposals. Approval must therefore cover the actual exported
bytes, including embedded evidence, rather than a report's title or outer JSON
schema. No recognized raw-response/provider/model/usage/cost keys were found;
this does not establish how the saved interpretations were produced.

## Retained narratives and configuration

| Evidence location | Confirmed classification | Proposed treatment |
| --- | --- | --- |
| `docs/CAPABILITY-GRAPH.md:604`, `:821`, `:902` | Three local-home repository paths. The document also has 54 graph-review reference lines, 16 numeric metric-table rows, and model flags at `:93`, `:99`, `:113`; no full 40-character source revision was found. | Retain reusable design/protocol guidance. Replace workstation commands with pinned catalog, synthetic, or saved-output examples. Keep source-specific results private until approved. |
| `docs/EXPERIMENT-SUMMARY.md:116` through `:136`, `:379`, `:636` | Retained experiment report: 33 numeric metric-table rows, 40 localhost report links, one full source revision, and a preserved-artifact reference. | Preserve the original privately. Publish a separate sanitized summary only when its exact inputs, provenance, copied material, and claims are approved. |
| `docs/INTERPRETATION-FINDINGS.md:84`, `:99` through `:105` | External-source link and a quoted passage; six schematic/code fences. No full source revision or explicit license/notice marker was found. | Retain general lessons after reviewing quote provenance and examples. Keep source-specific findings private pending approval. |
| `.serena/project.yml:53`, `:70`, `:114` | Developer configuration. Its eight URLs are comment links to public upstream/Python documentation; additional workspace folders and initial prompt are empty; ignored-file protection is enabled. | Retain if useful. No confirmed private-host or custom-prompt exposure was found in this file. |
| `scripts/run-pilot-course-recommender.mjs:15` | The tracked source still contains a local-home path. | Replace it with explicit caller-supplied or pinned-catalog input before public release; do not carry workstation paths into public examples. |

No email-shaped address was found in the four requested narrative/config files.
Metric-table counts are textual classifications, not verification of the
experiments or their conclusions. Candidate feature, lifecycle, identity, and
contributor associations remain interpretations unless their cited evidence
establishes the claim. Contributor evidence must not become ranking or a
performance judgment.

For each retained research document, choose either private archival under an
ignored research-notes path or a reviewed public rewrite. A public rewrite
should distinguish reusable guidance from dated observations, replace local
links with resolvable approved evidence, and attach a provenance record to every
retained result. Keep originals so the public explanation can be traced back
without silently changing the historical findings.

## Secret-pattern triage and limits

All 884 unique reachable blobs were scanned, totaling 50,549,316 logical bytes.
The bounds were 20 MB per blob and 200 MB overall; no reachable blob was skipped.
Identical blobs are counted once and can occur at multiple paths/revisions.
The scan's display-path counts are therefore not a complete enumeration of
every historical path/version.

| Pattern family | Pinned tree | Reachable history | Classification |
| --- | ---: | ---: | --- |
| Common provider-token prefixes | 0 | 0 | No match under these rules. |
| JWT-shaped tokens | 0 | 0 | No match under these rules. |
| Private-key begin marker | 1 | 1 | Incomplete safety-test literal at `test/repository-source.test.mjs:81`; no corresponding end marker. |
| Credential-bearing HTTP URL | 1 | 1 | Invalid-input safety fixture at `test/experiment-permissions.test.mjs:220`. |
| Email-like strings | 64 across 19 paths | 192 across 32 display paths | Current locations are identity examples/synthetic fixtures/tests; historical locations also include copied source in retained artifacts. |
| Absolute local-home paths | 4 across 2 paths | 130 across 46 display paths | Current locations are the narrative/source paths listed above. Historical output/configuration copies also need disposition. |

No conventional credential/key filename was found in the complete union of
586 historical changed paths. History also retains the removed `.codex/hooks.json` local execution
configuration; review it with the selected public ref set rather than treating
its absence at HEAD as removal from history.

Local `git fsck --unreachable --no-reflogs` returned success and one unreachable
blob of 8,327 bytes. The same bounded patterns found no match in that blob.
Its contents were not printed. This identifies local storage outside ordinary
ref reachability; it does not establish the state of hosted unreachable objects.

These are redacted heuristic checks, not secret clearance or a full review of
copied code and personal data. They do not cover arbitrary secret formats,
encrypted/compressed embedded material, all ignored files, dependency caches,
environment credentials, or external data stores. No remote fetch or hosted
inventory was performed. The snapshot does not establish GitHub's hidden/PR
refs, deleted refs, remote reflogs, releases, attachments, forks, LFS storage, or
cached downloads. A release audit must separately verify the exact hosted and
exported scope with authorized access and redacted reporting. A confirmed live
credential requires containment/rotation before publication; deleting a file
or rewriting history alone would not revoke it.

## History disposition choices

Keep the existing repository private until the owner selects a disposition and
approves the exact release scope. The smallest change to private development is
to preserve its current history and prepare a separate reviewed public export.

| Choice | Result | Required evidence before public release |
| --- | --- | --- |
| Separate public export with clean initial history | Preserve the complete original privately; start a new public repository/export from the approved tree. No private history rewrite is needed. | Audit the export, retain required notices/provenance, verify its reachable objects contain only approved material, and approve its destination and visibility. |
| Publish existing history | Retain commit IDs, historical replay, and attribution. Earlier outputs and configurations become part of the public scope. | Approve every retained historical artifact and copied-text/contributor-data exposure across the selected refs; current-tree approval alone is insufficient. |
| Sanitize a separate history mirror | Remove selected historical paths/content in a dedicated mirror while keeping an untouched private original. Commit IDs can change. | Explicit authorization for rewriting, verified recovery copies, a reviewed filter/ref plan, commit-ID/replay/link impact assessment, and fresh tree/object/build checks. Do not force-push or replace the original as an incidental cleanup. |

Do not assume that choosing three new demo snapshots approves the legacy
demonstration, its source excerpts, or the older research narratives. Approval
must identify exact paths/hashes and the history/ref scope, and visibility still
requires later explicit approval.

## Testable release criteria

1. **Tree and narratives:** every release path is code, reusable documentation,
   a generator, deterministic synthetic fixture, catalog, or an explicitly
   approved snapshot. Resolve each narrative row above; remove unintended local
   paths/localhost links from release-facing prose and commands. Record reviewed
   copied material and contributor-data treatment without exposing raw private
   responses or contact details in audit logs.
2. **Snapshot provenance:** for each of the three demos, record upstream identity,
   exact revision, source license/notices, acquisition/artifact hashes, engine
   and interpretation provenance, limitations, and approved paths/hashes.
   Resolve evidence against the pinned source or retained receipts. A processing
   fingerprint or full SHA without an upstream binding is insufficient.
3. **History/export:** audit every ref and object included in the chosen public
   artifact. Demonstrate that unapproved historical paths/blobs are absent, or
   have explicit approval under the selected disposition. Include author/committer
   metadata and hosted stores in that decision; keep the private backup intact.
4. **Packaging:** inspect a production build from the final release checkout.
   Its emitted files must equal the app bundle plus the exact approved
   `publication/manifest.json` assets, with matching hashes and no unapproved
   source-bearing report, local clone, cache, run, or response.
5. **Onboarding and validation:** exercise locked installation, deterministic
   fixture generation, offline checks, and the relevant browser journeys from a
   clean final checkout without private datasets or paid APIs. Retain exact
   source fingerprints and distinguish synthetic mechanics from model quality.
6. **Authorization and recovery:** preserve the originals and a verified backup
   outside any retiring cloud environment. Record the approved snapshot/history
   disposition and obtain explicit visibility approval before publishing.

The immediate decisions are the history disposition, which research narratives
to archive or rewrite, and the three approved demo snapshots with their data
treatment. None requires changing repository visibility or rewriting history
during this assessment.
