# Zod demo: exact release proposal

This proposes one demo in the existing
[Evolution Atlas repository](https://github.com/echo108471/evolution-atlas).
The owner has selected publication of that repository with its existing history.
This proposal does not grant asset publication or change repository visibility.
The broader scope and any material blockers are recorded in the
[existing-repository release audit](EXISTING-REPOSITORY-RELEASE.md).

## Four proposed files

The machine-readable proposal is
[publication/zod-demo.proposed.json](../publication/zod-demo.proposed.json).
Every `approval` is currently `null`. The active
[publication manifest](../publication/manifest.json) still contains zero assets;
these proposed source files are not yet committed or included by the build.

| Proposed repository source | Served build path | Bytes |
| --- | --- | ---: |
| `publication/assets/zod/zod.json` | `gallery/zod.json` | 4,320,385 |
| `publication/assets/zod/manifest.json` | `gallery/manifest.json` | 828 |
| `publication/assets/zod/zod-LICENSE.txt` | `approved-snapshots/zod-LICENSE.txt` | 1,072 |
| `publication/assets/zod/zod-PROVENANCE.json` | `approved-snapshots/zod-PROVENANCE.json` | 4,504 |

Total: **4,326,789 bytes**. Exact SHA-256 hashes:

- `zod.json`: `e37fd8f6826f746d47f1d25d78c47b0c4d21b68c48905ac577d77cffc7038558`
- `manifest.json`: `b9b9809b5cf925ba1f3fad957b5a0163cd2858ec359b0ff18669b9593419a09d`
- `zod-LICENSE.txt`: `3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8`
- `zod-PROVENANCE.json`: `42ca0418704cc3d2a0f40f8e462cbc5503f874e849674f49313fb2b63bda6204`

Approval must identify these paths and bytes. Filling the active manifest with
an actual owner decision reference and copying the approved files are later
implementation steps. A proposed manifest with `null` approvals fails closed;
it is not a second active manifest.

## Source and contents

The source is the public [Zod repository](https://github.com/colinhacks/zod) at
commit `43f729db4aa0cedff6d6b3261f33f8556b3c7102`, tree
`992c4000825b1e2e8b6a835b3f5471caebafa4ed`. Acquisition used that exact catalog
pin, not a moving branch. Local Git integrity and the complete parent graph
were checked. The observed analyzer revision is
`b2228d2cada8a880e71eaf9dce986b609f499512`; the minimization exporter revision is
`86282a14ee4ca3b6cc689c33052bb04c1155bbd8`. Included provenance binds those
implementations, the private raw-input hash, the source pin, the snapshot hash
and the notice hash. Its `publicationApproval: false` records its preparation
state; the later owner decision belongs in the canonical publication manifest.

The dataset contains **3,094 observed commits, 25 code areas and 4,753 touched
relationships**. It retains commit revisions, parents, timestamps, paths,
statuses and renames. Subjects are generic observed-commit labels. It omits
original subjects and bodies, contributors and identity-derived IDs, aliases,
authored relationships, identity matches, structural/feature candidates and
semantic interpretations. An empty contributor collection means deliberately
omitted metadata; it does not measure participation or performance.

These bytes are minimized, not anonymous. Public revision hashes, paths and
timestamps can identify commits and lead readers to upstream contributors.
No model interpretations, raw model responses or source-code excerpts are
included, and this preparation made no paid model call.

The included notice reproduces the full
[MIT notice at the pinned source](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/LICENSE).
Its required copyright attribution is retained. The MIT notice and the snapshot
provenance are linked from the demo card using the served paths above.

## Verified preparation and final publication step

Independent review checked the four final files, deterministic replay,
observed graph relationships, source/exporter hashes and the notice/provenance
bindings. A private production preview exercised the sole demo card, both
metadata downloads, overview, previous-checkpoint navigation and selected
commit evidence. Eight screenshots and request logs were reviewed. This is
coverage of that desktop journey, not exhaustive history navigation or a
semantic interpretation assessment.

The app build has three files; the private assembled preview has those three
plus exactly these four candidate assets. The private assembly did not claim
approved canonical-plugin emission. After owner approval, run a fresh checkout,
synthetic fixtures and the offline gate, then inspect a canonical production
build whose files equal the app bundle plus these four approved paths/hashes.
Follow the [private development boundaries](PRIVATE-DEVELOPMENT.md); preserve
the original outputs and history. Repository visibility requires the later
explicit publication authorization.
