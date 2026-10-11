# Three demo source candidates

Review date: 2026-10-11. Evolution Atlas baseline:
[`83b8ded09906aff025d936fa665ab1d33a158f6b`](https://github.com/echo108471/evolution-atlas/commit/83b8ded09906aff025d936fa665ab1d33a158f6b).
Recommend zod, esbuild, and Flask as **source candidates** for a later three-demo
decision. Their identities, immutable source revisions, and selected license
files were verified against GitHub's primary metadata and exact-revision files.
No matching retained snapshot was found in the bounded inspection below. No
snapshot bytes, hashes, or publication approval exist for these recommendations.
`gallery/catalog.json` pins candidates; `publication/manifest.json` remains empty.

## Recommendation and verified pins

| Candidate | Proposed source revision | Why investigate this candidate | Readiness |
| --- | --- | --- | --- |
| [zod](https://github.com/colinhacks/zod) | Existing catalog pin [43f729db](https://github.com/colinhacks/zod/commit/43f729db4aa0cedff6d6b3261f33f8556b3c7102); package manifest reports 4.4.3 | TypeScript schema library; review whether its v3/v4 path structure supports migration or structural interpretations. | Source verified; snapshot absent. |
| [esbuild](https://github.com/evanw/esbuild) | [v0.28.2](https://github.com/evanw/esbuild/releases/tag/v0.28.2) resolves to [609683d8](https://github.com/evanw/esbuild/commit/609683d892977362a0f99026cb74b96263d728a9) | Go bundler with JavaScript interfaces; compare commit conventions, merge structure, and evidence coverage after measuring them. | Source verified; snapshot absent. |
| [Flask](https://github.com/pallets/flask) | [3.1.3](https://github.com/pallets/flask/releases/tag/3.1.3) resolves to [22d92470](https://github.com/pallets/flask/commit/22d924701a6ae2e4cd01e9a15bbaf3946094af65) | Python web framework; inspect merge structure and contributor identity ambiguity without assuming an extreme corpus. | Source verified; snapshot absent. |

These are proposed contrasts in project role and language, not proven differences
in history quality, merge share, bot share, identity count, or model performance.
The old catalog's claims about linear history, no merges, and highest counts were
not established by retained evidence and have been replaced with questions.

The commit and tree objects verified through GitHub's commit API were:

| Candidate | Full source commit | Full source tree | Commit timestamp (UTC) |
| --- | --- | --- | --- |
| zod | `43f729db4aa0cedff6d6b3261f33f8556b3c7102` | `992c4000825b1e2e8b6a835b3f5471caebafa4ed` | 2026-08-26 00:21:48 |
| esbuild | `609683d892977362a0f99026cb74b96263d728a9` | `a58e636987c5d8878037e68fb5e71c90329f0bab` | 2026-08-08 19:46:44 |
| Flask | `22d924701a6ae2e4cd01e9a15bbaf3946094af65` | `49f9a8f8cdf5b51b90b61e64ea098b94b7aaac32` | 2026-02-19 03:41:55 |

Full commit SHAs, rather than movable tags or branch heads, are the proposed
analysis inputs. The existing zod pin is preserved; this review does not claim it
is a release tag. GitHub's repository metadata confirmed the three owner/name
identities above. These requests inspected metadata, file paths, and selected
small files; no experiment repository was cloned or fetched, dependency installed,
or model called for this review.

## Retained evidence and prospective artifact paths

The local preservation inventory at
`/workspace/evolution-atlas-private-artifacts/abe494d9922faf6af425075259afcf0c93dba557/manifest.json`
records baseline `abe494d9922faf6af425075259afcf0c93dba557`. Its SHA-256 is
`eb3ec8c1d7f6743087f0b567b79678359f499feac3006803a375ff082fc8c09d`.
All **214 regular files / 58,464,261 bytes** matched their recorded sizes and
hashes. They cover two retained report roots, `public/graph-reviews/experiment-summary`
and `public/graph-reviews/consolidated-engine/larger-demonstration`. Metadata
inspection of **196 parseable JSON files** found no zod, esbuild, or Flask repository
identity in recognized repository fields. A bounded filename inspection of the
workspace and its existing scratch locations also found no candidate snapshot.
This is not a claim about every file on the machine or omitted historical objects.
No raw responses, contributor records, or secrets are reproduced here.

The following are **planned ignored destinations**, not existing artifacts or
approved publication paths. Choose a fresh run directory when generation starts.

| Source candidate | Proposed private output from a new gallery run | Dataset size / SHA-256 now |
| --- | --- | --- |
| zod | `scratch/demo-review/observed-83b8ded/zod.json` | Absent; cannot inventory yet. |
| esbuild | `scratch/demo-review/observed-83b8ded/esbuild.json` | Absent; cannot inventory yet. |
| Flask | `scratch/demo-review/observed-83b8ded/flask.json` | Absent; cannot inventory yet. |

The accompanying planned private `manifest.json` must record the exact source
head, dataset hash, and observed/interpreted mode. Before approval, create a
separate private approval inventory containing each actual source path, byte
size, SHA-256, source URL and commit, analyzer revision, generation options,
contributor treatment, copied material, notice files, and interpretation limits.
Saved interpretation reuse additionally needs the original artifact's hash and
provider/model/method provenance. No proposed public destination should enter
`publication/manifest.json` until the user approves its actual reviewed bytes,
destination, and approval reference.

## License, notice, and copied-material review

The exact-revision tree listings were not truncated. They were inspected for
license, notice, copying, author/contributor, vendor, and third-party filenames;
selected license files and package manifests were then read. This establishes
the files below, not an exhaustive license audit of file contents or all history.

**zod:** the [root MIT license](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/LICENSE)
and [package license](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/packages/zod/LICENSE)
match; [v3 documentation](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/packages/docs-v3/LICENSE)
has its own copyright year. Preserve the applicable copyright and permission
notice with copies or substantial portions. The [package manifest](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/packages/zod/package.json)
declares no runtime dependencies; the [workspace manifest](https://github.com/colinhacks/zod/blob/43f729db4aa0cedff6d6b3261f33f8556b3c7102/package.json)
has many development dependencies. Neither fact licenses copied dependency code
or proves every historical file has the same terms.

**esbuild:** the [root MIT license](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/LICENSE.md)
requires preservation of its copyright and permission notice for copies or
substantial portions. The tree also has a separate [MIT notice for internal/xxhash](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/internal/xxhash/LICENSE.txt),
which must accompany any copied substantial portion of that component. The
[Go manifest](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/go.mod)
pins `golang.org/x/sys`; the [npm manifest](https://github.com/evanw/esbuild/blob/609683d892977362a0f99026cb74b96263d728a9/npm/esbuild/package.json)
lists platform-specific optional binary packages. Any inclusion of dependency
source or binaries requires its own version and notice review; source metadata
analysis does not require installing them.

**Flask:** the [BSD-3-Clause license](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/LICENSE.txt)
requires retention of its copyright, conditions, and disclaimer in source
redistributions and their reproduction with binary redistributions. It also
restricts use of holder/contributor names to endorse derived products without
permission. The [documentation license page](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/docs/license.rst)
includes that license; the tutorial and JavaScript example licenses match it.
The [project manifest](https://github.com/pallets/flask/blob/22d924701a6ae2e4cd01e9a15bbaf3946094af65/pyproject.toml)
lists Blinker, Click, ItsDangerous, Jinja2, MarkupSafe, Werkzeug, and conditional
importlib-metadata, plus optional dependencies. Those dependencies' licenses were
not audited here because none is proposed for redistribution in an Atlas snapshot.

Verified notice byte inventory (these are license hashes, **not dataset hashes**):

| Candidate / exact-revision file | Bytes | SHA-256 |
| --- | ---: | --- |
| zod `LICENSE` and `packages/zod/LICENSE`, each | 1,072 | `3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8` |
| zod `packages/docs-v3/LICENSE` | 1,072 | `0225e7c0a96845a7477cd44d75d3dc9c999f673454efa84b54e218415055eece` |
| esbuild `LICENSE.md` | 1,069 | `b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681` |
| esbuild `internal/xxhash/LICENSE.txt` | 1,068 | `f566a9f97bacdaf00d9f21dd991e81dc11201c4e016c86b470799429a1c9a79c` |
| Flask `LICENSE.txt`, `examples/tutorial/LICENSE.txt`, and `examples/javascript/LICENSE.txt`, each | 1,475 | `489a8e1108509ed98a37bb983e11e0f7e1d31f0bd8f99a79c8448e7ff37d07ea` |

A project's current root license is not blanket clearance for all dependencies,
historical revisions, commit messages, issue text, documentation excerpts, or
model responses. Before redistribution, inventory source snippets and quoted text
in the actual candidate snapshot, resolve each to its origin/revision, and retain
the applicable notices. Prefer observed metadata and evidence links over copied
source and raw model responses. Do not label a demo as upstream endorsement.

## Contributor treatment and interpretation limits

Recommend a public demo with no emails, avatars, coauthor trailers, alias tables,
or raw author/committer fields. If people-related behavior is needed, first review
an export with scoped pseudonymous identifiers and aggregate observations. This
is a proposed policy, not an implemented sanitizer: source links and commit hashes
can still make contributors identifiable. Names in required license notices remain
copyright attribution and should not be removed by a metadata filter.

Decide explicitly whether any public contributor names are necessary, then review
the actual export, narrative, and UI for reidentification and ambiguity. Record
identity merges, bots, and uncertain aliases as uncertain observations. Do not
convert counts into rankings, performance judgments, code ownership, or claims
about a person's intent. Public availability of Git history does not remove the
need for this publication review.

Start with observed-only snapshots. Features, lifecycle labels, epochs, semantic
relationships, and reasons inferred later remain candidate interpretations.
Resolvable citations and schema validation establish evidence linkage and format,
not semantic accuracy or completeness. Commit subjects alone do not establish
intent; missing history, renamed files, copied source, identity ambiguity, and
uneven evidence can change the interpretation. Display these limits with each
approved demo; do not compare models or contributor groups using this selection.

## Ordered remaining work and approval decisions

1. **Confirm source selection and pins.** Accept or replace these three source
   candidates. This is distinct from approval to publish a dataset. Catalog
   rationale now records questions rather than unsupported corpus conclusions.
2. **Acquire and generate privately in a separately authorized run.** Use
   [Explicit experiments](EXPERIMENTS.md): an explicit `--fetch` acquires only
   selected pinned sources into an ignored cache. Use a fresh ignored output
   directory and observed-only mode; no paid API is needed. Verify each cache's
   identity, full commit, and required local objects before analysis, then repeat
   without `--fetch` or credentials to validate offline generation. No remote
   acquisition or dataset generation was performed in this review.
3. **Review actual content and prepare approval candidates.** Inspect schema,
   scope, size, historical coverage, secret-like values, contributor fields,
   quoted/copied material, notices, and narrative limits. Apply a reviewed export
   policy and validate the sanitized output. Record actual paths, sizes, SHA-256
   hashes, and provenance. If saved interpretations are available later, preserve
   their bytes and validate exact-head reuse; paid generation needs its own explicit
   authorization and is unnecessary for an observed demo.
4. **Approve exact snapshots and contributor treatment.** The smallest remaining
   user choices are source/pin selection; whether named people are needed versus
   omitted or pseudonymous fields; and each final byte hash, publication path,
   accompanying notices, and interpretation-limit text. Actual bytes must exist
   and be reviewed before this approval can be concrete.
5. **Validate release inclusion after approval.** Add only approved assets and
   their approval references to the publication manifest, confirm built bytes and
   hashes against that manifest, and run the repository's offline checks, clean
   checkout onboarding, browser validation, and tree/history audit. Repository
   visibility requires later explicit approval independently of snapshot approval.

Completion criteria for a ready demo: its exact source is reproducible; an
observed generation/revalidation succeeds offline from an existing complete cache;
the private and approved export inventories have real hashes and provenance;
contributor/copy/notice review is recorded; evidence resolves to the pinned
history; and the production build includes exactly the approved bytes. Currently
all three candidates stop before artifact acquisition/generation, so none meets
those snapshot completion criteria.
