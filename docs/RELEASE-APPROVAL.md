# Release approval

## Owner approval 2026-10-12

The repository owner approved publication of the four exact Zod files in the
[inventory at 7e25872beea9efe670d0ddb8a93a85d5971576d7](https://github.com/echo108471/evolution-atlas/blob/7e25872beea9efe670d0ddb8a93a85d5971576d7/docs/ZOD-DEMO-RELEASE-INVENTORY.md).
The owner also authorized making the existing
`echo108471/evolution-atlas` repository public after final build and last-change
checks pass. The approval was given after disclosure of retained history,
Actions logs, snapshot identification limits, and the incomplete wiki,
deployment and package inventories. The owner answered: “yeah go ahead”.

This records that decision without publishing a private conversation link.
At that release, the canonical manifest referenced this section
for each of the four approved source/output paths and SHA-256 hashes. The files
total **4,326,789 bytes**. The earlier
[proposal](../publication/zod-demo.proposed.json) remains an unchanged record
of the preapproval state; it is not an active build manifest.

Approval covers these exact bytes and paths, the existing repository and
retained history. It does not select another dataset, authorize paid model
calls or a separate hosting deployment. Preserve history, unrelated work,
original ignored outputs and recovery copies.

Before the visibility operation, validate the exact final checkout, synthetic
fixtures, full offline gate and canonical build inventory; independently
review the release diff and CI; then review the immediate ref/log delta.
New consequential sensitive material or an additional action-time confirmation
must be reported before proceeding. The source provenance file's
`publicationApproval: false` remains unchanged because it records the export's
preparation state; this owner decision and canonical manifest provide the
later publication approval.

## Owner approval 2026-10-30

The owner approved publication and version control of the interpreted Zod
dataset prepared for private review, identified by SHA-256
`fefb73bbb7a06ab9754422393436d4a7af836339ce7103c1f557aa779f00170b`.
The owner also requested that it be preloaded on the hosted site. This decision
supersedes the observed-only snapshot for that demo; it does not authorize
other datasets or new model calls. The current
[release inventory](ZOD-DEMO-RELEASE-INVENTORY.md) records the dataset and the
associated manifest, provenance, and notice actually emitted by the build.

This approval does not establish exhaustive privacy, copied-material, license,
or semantic review. Contributor fields and original commit messages are
omitted from the prepared observed layer, but public Git links, paths, and dates
can permit reidentification. Model-authored feature and lifecycle labels and
rationales remain candidate interpretations; resolved evidence links do not
independently verify them.

## Owner approval 2026-10-31

On 2026-10-31 at 02:42 EDT the owner approved publishing the version 3 Zod
candidate capability map as-is. The owner answered “sure yeah” after the
disclosures below were presented. The approval covers these exact bytes and
the zod gallery manifest that links to them:

| Repository source | Served build path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `publication/assets/zod/maps/zod-reviewed-output.json` | `maps/zod/reviewed-output.json` | 571,366 | `53be27b3049fa74862497fd324149e010efa5558c809a724bb0bda3b9f6d6c31` |
| `publication/assets/zod/manifest.json` | `gallery/manifest.json` | 1,037 | `485903f8ca4c0f6365e9f3ed4ee1f738a51ed0e1934eba8d736ef311f4eceae3` |

The gallery manifest change only adds `"map":"/maps/zod/reviewed-output.json"`
to the zod subject; the rest of that file is the October 30 approved content.

The map is `repository-engine/3` expansion output for public Zod, from baseline
revision `43f729db4aa0cedff6d6b3261f33f8556b3c7102` to revision
`1c51cbe0fe23d09f8d520b31487d50a01588fae5` (v4.6.0). Workers and integrator
were run with model `gpt-6-luna`. It was produced by a custom host driving
`scripts/repository-engine.mjs` with a pre-save structural check that refuses
candidates failing the engine's own validation. The map contains 26 candidate
capabilities and 18 candidate relationships.

Disclosures accepted with this approval:

- **Commit subject lines are included.** Seven `path-history` receipts embed
  **62 original Zod commit subject lines**. No author names, email addresses,
  or commit bodies are included. This is a deliberate, approval-scoped
  exception to the October 30 dataset treatment, which omits original commit
  messages; that dataset remains unchanged.
- **Most claims cite baseline-only source.** 22 of 26 capabilities and 13 of
  18 relationships cite only baseline-revision (`43f729db`) source, yet carry
  the assessment `supported`. They were not re-read at `1c51cbe0`.
- **Independent verification was not performed.** The map records
  `independentVerification: "not-performed"`. Labels, lineage, relationships,
  and assessments are model-generated candidate interpretations; resolved
  receipts and content hashes establish linkage, not truth.

This approval does not authorize other maps, datasets, or new model calls, and
does not establish exhaustive privacy, copied-material, license, or semantic
review.
