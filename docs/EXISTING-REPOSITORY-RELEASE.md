# Existing repository: release scope and findings

This document records the October 12 release audit. The Zod snapshot was later
replaced with an owner-approved interpreted dataset; see the
[current inventory](ZOD-DEMO-RELEASE-INVENTORY.md) and
[later approval](RELEASE-APPROVAL.md#owner-approval-2026-10-30).

The owner has chosen to make [echo108471/evolution-atlas](https://github.com/echo108471/evolution-atlas)
public with its existing history. The earlier clean-export recommendation is
superseded. Old reports, contact-like text, local paths and ordinary Git
attribution are part of the accepted disclosure; this document does not request
that decision again. The repository stayed **private** during assessment. The owner subsequently
[approved the four demo assets and conditional public visibility](RELEASE-APPROVAL.md#owner-approval-2026-10-12).

## Exact assessed scope

The remote main revision is **`64a0cb61a56b57c23bc702fe9a6a4d7651db6174`**.
On 2026-10-12 the audit fetched every ref advertised by
`git ls-remote --refs origin`: **nine branch heads, ten PR heads and one PR merge
ref; no tags**. The exact tips are listed below. Current-tree and history review,
GitHub-hosted records and build inclusion are separate checks.

The original **214 generated files / 58,464,261 bytes** remain in ancestor
commits. They include saved JSON, rendered reports and copied source windows;
their removal from today's index did not remove them from history. Original
local copies and the previously verified recovery backup are preserved. No
history rewriting, ref deletion or visibility change is part of this proposal.

## Material findings and treatment

The full fetched-ref union contains **97 commits, 404 trees and 927 unique file
blobs**. All 51,360,519 blob bytes and 73,729 commit-metadata bytes were scanned;
no object was skipped. JSON/HTML-decoded source views were also checked.
Contextual review resolved all 139 detected candidates as runtime references,
configuration, test inputs, source paths or prose. Historical repeated
connection-token literals belong to a VS Code Rust unit-test fixture; execution
consent text is not an authentication credential. Supplemental signed-URL and
cookie checks found no match.

Independent current-tree review covered 378 tracked paths / 350 unique blobs,
parsed 302 source files and inspected the nine tracked JSON schemas. No
**actionable credential or unexpected sensitive personal record** was identified
in the examined scope. Credential-shaped current-tree matches are deliberate
rejection fixtures or runtime/environment lookups. No LFS pointer, gitlink,
symlink, binary payload, archive or encrypted container was found in the
captured Git objects.

This is a bounded contextual audit, not an assertion that every possible secret
format is absent. No credential was exercised against a live service. It does
not clear obfuscated or unlabeled secrets, ignored local files, environment
credentials or unavailable hosted stores. Ordinary historical attribution,
contact-like text and local paths retain the owner's already selected treatment.

The historical larger-demonstration source is **VS Code**, not the separately
named Course Recommender pilot. Three snapshot run plans record official
Microsoft revision `33341eb227ab213b011868c9bc5c5f735aaaf875`; GitHub resolves
it to tree `0eabf9366df0aba562eb80c231b3f7aa92a9f48a`. Across the assessed
history, 191 unique copied source windows / 118 unique commit-blob-path records
claim that revision. The full Microsoft MIT permission notice was absent from
the assessed blobs. The proposed change adds the exact 1,088-byte pinned
[notice](../licenses/vscode-33341eb-LICENSE.txt) and
[source attribution](../THIRD_PARTY_NOTICES.md), preserving the old commits.
The notice SHA-256 is
`9480271317925265e806a9a196aaa33410a962fa9d4d1e248a4a5187bc8c9df9`.

All 118 distinct copied-source path/blob claims match the official pinned Git
tree, with zero mismatches. This used selective tree metadata, not a third-party
clone or fetched code bodies. The source windows were inspected locally for
copyright/license indicators; the fetched metadata check does not independently
compare every window byte with a downloaded upstream code body.

A second attribution gap concerned the adapted Zod passage in
[Interpretation findings](INTERPRETATION-FINDINGS.md#the-corpus-discards-the-best-available-evidence)
and its historical rendered report. It is based on source commit
`21a6f0cbd3bef24d47e488a48cc9cb4d0bf97743`. The proposed correction identifies
that source, labels the passage as adapted rather than a full verbatim body,
and adds the exact 1,072-byte root
[Zod MIT notice](../licenses/zod-21a6f0c-LICENSE.txt), SHA-256
`3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8`.
The earlier notice for two short historical Zod subject examples is preserved
separately, with the exact source revisions listed in
[Third-party notices](../THIRD_PARTY_NOTICES.md). Earlier commits remain untouched.
No other concrete license conflict was
established by this copied-material review; it is not blanket rights clearance.

These findings concern concrete contents and attribution. Dated experiment
claims remain candidate interpretations; they are not validated by publication
or by a passing test. Contributor associations do not support performance
judgments.

## Available GitHub-hosted records

Read-only access verified **one issue, ten PRs and three conversation comments**.
All ten PR review lists and the inline-review comment collection were empty;
there were no releases or release assets. All **35 available Actions run
artifact lists returned zero**. All 35 job logs were read and scanned, totaling
3,654,112 characters, with no truncation. Hosted bodies and available patches
covered 330 records / 1,732,023 characters. No raw log or discussion contents
were retained in the audit report. No live credential was identified; the sole
recognized credential-URL match was a deliberate denial-test fixture using a
reserved example domain. No attachment URL was found in those records.

The connector omitted 26 PR file patches. Git-object review covers the fetched
PR tips separately. A supported per-commit follow-up checked all 99 captured
reachable commits plus merged main `7e25872beea9efe670d0ddb8a93a85d5971576d7`:
100 complete empty comment lists, no inaccessible reads or truncation. The
repository-wide comment endpoint remains unsupported. The connector rejected
deployment, direct
Pages, forks and wiki inventories; package listing was unavailable. Repository
metadata reports Pages disabled and fork/network counts zero. Wiki is enabled,
but its Git endpoint returned Repository not found. This does not establish
that wiki, packages or deployment records are empty. Server-only deleted refs,
caches and other inaccessible stores were not inspected. These are explicit
coverage limits, not findings of secret content or proof of absence.

## One demo and publication boundary

The [Zod release inventory](ZOD-DEMO-RELEASE-INVENTORY.md) gives the exact four
proposed source paths, served paths, byte sizes, SHA-256 hashes, omissions and
identification limits. The machine-readable
[proposal](../publication/zod-demo.proposed.json) retains its four earlier
`approval: null` entries as a historical record. The [active manifest](../publication/manifest.json)
now includes exactly the four owner-approved files, with references to the
[actual decision](RELEASE-APPROVAL.md#owner-approval-2026-10-12). Only those approved
snapshot bytes are added; raw inputs, clones, caches and reports remain ignored.

The existing code's exact checked revision
`db6d284cc4010ae5bc2b595920affe64bdbaa83a` has the same tree as assessed main.
It passed 629/629 offline tests and
[CI including locked installation and exact clean-checkout validation](https://github.com/echo108471/evolution-atlas/actions/runs/38185232781).
A separate exact export passed cached offline installation, fixture generation
and validation, and 629/629 tests; its seven preview files match the exercised
private Zod preview. That export is prior validation evidence, not the selected
publication destination. Desktop preview acceptance covered the sole card,
notice/provenance downloads, overview and selected history evidence. It does
not establish exhaustive interaction coverage or semantic interpretation truth.

Following the owner approval, complete these release checks:

1. Preserve the recorded approval for the four exact paths/hashes. Do not expand
   access to the disclosed unavailable hosted stores. Report newly discovered
   consequential sensitive material before publication.
2. Verify only the approved files are present at their canonical sources and
   the manifest binds the actual decision. Keep raw outputs,
   clones, caches and generated reports ignored.
3. Validate an exact final checkout: locked install, synthetic fixtures and the
   free offline gate. Inspect canonical production output: the app bundle plus
   exactly the four approved paths/hashes, with no automatically copied public
   directory or unapproved report.
4. Use the owner's conditional authorization to change this existing repository's
   visibility only after the checks pass. Recheck its actual identity, main
   revision and remote ref/log delta immediately before that specific operation. Hosting is a separate optional
   action.

No new repository or release-commit identity decision is needed. Generic
acceptance of the old history has already been given; this proposal leaves the
visibility operation conditional on final validation.

## Exact remote tips at the audit snapshot

| Advertised ref | Revision |
| --- | --- |
| `refs/heads/codex/citation-layout-fix` | `b8c0eaa09f51c67afb38d2eeb33ceef90f2df778` |
| `refs/heads/codex/explicit-experiment-boundaries` | `cfbc3d56614a1e6ed0ac37ffdff5238ce5dd5046` |
| `refs/heads/codex/offline-onboarding` | `bcaac9d9b741bf9b53581035e4e4bc96dcbc0ff7` |
| `refs/heads/codex/one-demo-preparation` | `bb93d722246d2920df74d82bd3fa0e0afe320736` |
| `refs/heads/codex/one-demo-preview-evidence` | `db6d284cc4010ae5bc2b595920affe64bdbaa83a` |
| `refs/heads/codex/private-output-boundary` | `46235d5b9956f05e181f59b0923d62b42638db08` |
| `refs/heads/codex/release-readiness-review` | `492975baec64e45dcd09e6088c0e9ca04c14e968` |
| `refs/heads/feat/host-launch-lock-blind-status` | `3268736cd7d4db3fe475ef7a2c2040888f77087f` |
| `refs/heads/main` | `64a0cb61a56b57c23bc702fe9a6a4d7651db6174` |
| `refs/pull/4/merge` | `45350abccc66ee857c2fe92e237f19f9ff5bbf06` |
| `refs/pull/10/head` | `bb93d722246d2920df74d82bd3fa0e0afe320736` |
| `refs/pull/11/head` | `db6d284cc4010ae5bc2b595920affe64bdbaa83a` |
| `refs/pull/2/head` | `f1bfd217b198c2d24fce4e9e92e72839686aac21` |
| `refs/pull/3/head` | `b43c84a6ec5125c42cbe533982331f2019a91b2c` |
| `refs/pull/4/head` | `3268736cd7d4db3fe475ef7a2c2040888f77087f` |
| `refs/pull/5/head` | `46235d5b9956f05e181f59b0923d62b42638db08` |
| `refs/pull/6/head` | `bcaac9d9b741bf9b53581035e4e4bc96dcbc0ff7` |
| `refs/pull/7/head` | `cfbc3d56614a1e6ed0ac37ffdff5238ce5dd5046` |
| `refs/pull/8/head` | `b8c0eaa09f51c67afb38d2eeb33ceef90f2df778` |
| `refs/pull/9/head` | `492975baec64e45dcd09e6088c0e9ca04c14e968` |

The redacted supporting remote-ref inventory SHA-256 is
`5b8e9a8bc3ded4d853f55d3311b35cf2aa5a2efc0c66f8ddbcef760c4589ef72`;
the hosted-audit report SHA-256 is
`2c700e39729887503a07add5c2f75e8993c78caa6f6806e88616016dd0eab603`.
The contextual-history report SHA-256 is
`275779e67cf47faa7e8e27afd28f00e0fa5a43a88f8b4e501f2b1e9447914e16`;
the copied-material report SHA-256 is
`ef10721cb9ba11a0ffe060ba134ce82b0838692c950a66f0a3846115529c3b78`.
Those reports remain in ignored audit scratch. The facts needed for release
review are recorded here so approval does not depend only on sandbox paths.
