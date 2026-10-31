# Zod demo: approved release inventory

The current Zod demo combines a minimized observed Git history with saved
candidate interpretations. The owner approved the exact dataset bytes for
publication and version control in the [October 30 decision](RELEASE-APPROVAL.md#owner-approval-2026-10-30).
The [publication manifest](../publication/manifest.json) binds the build to
the files and hashes below; no local `public/` data is copied automatically.

| Repository source | Served build path | Bytes |
| --- | --- | ---: |
| `publication/assets/zod/zod.json` | `gallery/zod.json` | 4,879,876 |
| `publication/assets/zod/manifest.json` | `gallery/manifest.json` | 1,037 |
| `publication/assets/zod/zod-LICENSE.txt` | `approved-snapshots/zod-LICENSE.txt` | 1,072 |
| `publication/assets/zod/zod-PROVENANCE.json` | `approved-snapshots/zod-PROVENANCE.json` | 7,323 |
| `publication/assets/zod/maps/zod-reviewed-output.json` | `maps/zod/reviewed-output.json` | 571,366 |

SHA-256 hashes:

- `zod.json`: `fefb73bbb7a06ab9754422393436d4a7af836339ce7103c1f557aa779f00170b`
- `manifest.json`: `485903f8ca4c0f6365e9f3ed4ee1f738a51ed0e1934eba8d736ef311f4eceae3`
- `zod-LICENSE.txt`: `3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8`
- `zod-PROVENANCE.json`: `163282962a3bf5717970fc12744c27c5ce39e7579fd0ed15e6d5744bd67ea579`
- `zod-reviewed-output.json`: `53be27b3049fa74862497fd324149e010efa5558c809a724bb0bda3b9f6d6c31`

These files total **5,460,674 bytes**. The MIT notice remains the previously
approved notice; the gallery and provenance metadata describe the approved
dataset. The gallery manifest now also links the zod subject to the candidate
capability map approved in the [October 31 decision](RELEASE-APPROVAL.md#owner-approval-2026-10-31);
that manifest change only adds the map route. The earlier [proposal](../publication/zod-demo.proposed.json)
is a historical record, not the active publication manifest.

## Source, preparation, and limits

The source is the public [Zod repository](https://github.com/colinhacks/zod) at
commit `43f729db4aa0cedff6d6b3261f33f8556b3c7102`, tree
`992c4000825b1e2e8b6a835b3f5471caebafa4ed`. The observed base contains 3,094
commits, 25 code areas, and 4,753 touched relationships. It retains commit
revisions, parents, timestamps, paths, statuses, and renames. The structured
contributor records, identity matches, authored relationships, and original
commit subjects and bodies are omitted. An empty contributor collection is a
disclosure choice, not a measure of participation.

The prepared dataset adds **40 candidate features**, **149 candidate lifecycle
episodes**, and **651 interpretation-derived relationships** from a saved
legacy atlas interpretation. The recorded method is
`llm-induction:openrouter:x-ai/grok-4.6`. The saved interpretation was reused;
preparing this snapshot made no new model call. The included provenance records
the saved artifact hash and the previously approved observed-base provenance.
Complete original request and response provenance has not been independently
established.

Preparation checked that 1,291 candidate evidence references resolve to
observed commits, 7,219 cited paths occur in their cited commits, and candidate
relationship endpoints resolve. These checks establish linkage, not the truth,
intent, or completeness of any interpretation. Labels and rationales remain
model-authored candidates, not independently verified facts. The legacy atlas
data populates the Zod viewer; it does not populate the separate v3 Candidate
Map, which uses a different output format.

## Candidate capability map (v3)

The [October 31 decision](RELEASE-APPROVAL.md#owner-approval-2026-10-31)
approved the `repository-engine/3` expansion map for Zod
`43f729db` → `1c51cbe0` (v4.6.0), produced with model `gpt-6-luna` by a custom
host driving the repository engine with a pre-save structural check. It is
served at `maps/zod/reviewed-output.json` and opened from the gallery card's
"Open candidate capability map" link. It holds 26 candidate capabilities and
18 candidate relationships; 22 of the capabilities and 13 of the relationships
cite only baseline-revision source. Unlike the dataset above, it embeds 62
original commit subject lines in path-history receipts (no authors, emails, or
bodies). Independent verification was not performed.

The snapshot is minimized, not anonymous: public commit hashes, paths, and
timestamps can lead readers to upstream contributors. Candidate prose is
included; the approval does not establish exhaustive privacy, copied-material,
or semantic review. The [MIT notice at the pinned source](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/LICENSE)
is included, but the root notice does not by itself clear every historical
source or copied passage.

## Prior observed-only release

The [October 12 decision](RELEASE-APPROVAL.md#owner-approval-2026-10-12)
approved an observed-only Zod snapshot with SHA-256
`e37fd8f6826f746d47f1d25d78c47b0c4d21b68c48905ac577d77cffc7038558`.
Its observed analyzer revision was `b2228d2cada8a880e71eaf9dce986b609f499512`,
and its minimization exporter revision was `86282a14ee4ca3b6cc689c33052bb04c1155bbd8`.
That snapshot omitted feature and lifecycle candidates. Its original
provenance is retained inside the current provenance record; its earlier
inventory and exact file hashes remain available in repository history.

A private preview of the interpreted review candidate exercised the Zod card,
overview, an earlier checkpoint, and selected commit evidence. It showed 40
candidate features and 149 lifecycle episodes; this is a bounded UI check,
not evidence of interpretation quality or exhaustive navigation coverage.
Production builds must still emit exactly the five current manifest assets
(the four demo files plus the October 31 candidate map) alongside the application bundle.
