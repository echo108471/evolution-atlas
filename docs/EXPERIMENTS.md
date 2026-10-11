# Explicit experiments and saved-output reuse

Routine development follows [Development](DEVELOPMENT.md): fictional fixtures,
local Git histories, and a credential-free offline gate. Real source acquisition
and model execution are separate operations. This guide describes the legacy
gallery, interpretation, and period CLIs; the current versioned repository
engine and host workflow remain documented in [History workflow](HISTORY-WORKFLOW.md).

## Analyze pinned local source

The tracked `gallery/catalog.json` is a candidate catalog, not an approved demo
list. Every selected subject needs a full lowercase 40-character `commit` SHA.
The existing zod entry has a pin; esbuild and Flask still need deliberate pins
before they can be selected. Their recorded license strings and descriptions
are leads for later source review, not verified release permissions. No three
public demos have been chosen.

The gallery defaults to observed-only analysis of an existing local cache,
without fetching or model calls. It writes into ignored `scratch/` paths:

```sh
node scripts/gallery.mjs --only zod \
  --cache scratch/repositories/gallery --out scratch/gallery-observed
```

This command requires the named cache to already contain the pinned commit,
complete history, and required blobs. Missing or shallow history fails closed.
Analysis reads the pinned revision and its mailmap without moving cached HEAD,
resetting the worktree, or honoring replacement refs. Every selected source is
checked before output or inference begins.

Acquisition is explicit. When deliberately preparing that candidate source,
add `--fetch`:

```sh
node scripts/gallery.mjs --only zod --fetch \
  --cache scratch/repositories/gallery --out scratch/gallery-observed-next
```

This may clone/fetch and repair shallow history. Catalog selection and pins are
validated before acquisition; the complete selection is acquired and analyzed
before any model request. Choosing a pin does not approve publication.

## Reuse expensive artifacts first

Keep previous datasets, raw responses, source caches, proposals, and run
directories. For an analyzer change at the same repository and revision, reuse
an existing interpreted dataset in a fresh output directory:

```sh
node scripts/gallery.mjs --only zod \
  --cache scratch/repositories/gallery \
  --reuse-interpretation /absolute/path/to/saved-zod.json \
  --out scratch/gallery-reanalyzed-next
```

Reuse validates repository identity, the exact head pin, cited commits,
relationship endpoints and evidence. The new gallery manifest records the saved
input's SHA-256; keep that manifest alongside the dataset to retain this
provenance. The saved input remains unchanged. Resolvable citations establish
locations, not the truth of a candidate interpretation.

Local lifecycle revalidation also avoids a model call. It requires a saved
interpreted input with semantic lifecycle episodes:

```sh
node scripts/interpret.mjs --in scratch/saved-atlas.json \
  --revalidate --out scratch/saved-atlas.revalidated-next.json
```

Period analysis can replay saved model proposals without paid naming:

```sh
node scripts/epochs.mjs --in scratch/atlas.json \
  --proposals scratch/saved-proposals.json --no-labels \
  --out scratch/epochs-replayed-next.json
```

Saved proposals must match the dataset's repository and full head SHA and
resolve to their recorded commits. Output and saved-proposal paths must be
distinct from inputs, including symlink and hardlink aliases. New interpreted,
revalidated, period, and proposal files use exclusive creation and refuse an
existing destination.

## Deliberately request inference

These primary experiment CLIs require `--allow-paid` for model execution. A
gallery also needs `--interpret`; `--fetch` alone never opts into inference:

```sh
node scripts/gallery.mjs --only zod --interpret --allow-paid \
  --cache scratch/repositories/gallery --out scratch/gallery-interpreted-next
node scripts/interpret.mjs --in scratch/atlas.json --allow-paid \
  --out scratch/atlas.interpreted-next.json
node scripts/epochs.mjs --in scratch/atlas.json --allow-paid \
  --save-proposals scratch/proposals-next.json --out scratch/epochs-next.json
```

These are optional operator commands, not onboarding or validation steps. They
need the selected provider's credentials and may incur charges. `--reuse-features`
retains input feature candidates but still requests lifecycle inference;
`--no-labels` alone still requests period proposals. The free period path needs
both saved `--proposals` and `--no-labels`.

SDK retries are disabled. Gallery defaults to one attempt; `--retries N`
explicitly permits additional attempts and can repeat a completed first pass.
Preserve earlier responses and assess failures before opting into another
request. These gates cover gallery, interpret, and epochs; other historical
research CLIs retain their own execution contracts and are outside the routine
gate.

Gallery never replaces an interpreted or reused dataset, including when its
manifest is missing/stale or `--force` is supplied. A paid dataset is skipped
without inference only when its exact content hash, repository, revision, and
interpretation state match the existing manifest. Otherwise choose a new
`--out`. Cheap, clearly observed-only output can be regenerated with `--force`;
ambiguous or malformed saved output requires a fresh directory.

## Publication remains separate

All real experiment artifacts remain ignored. Production disables automatic
copying from `public/`; gallery generation does not add anything to the
publication manifest or authorize release. The legacy standalone viewer can
still use explicitly prepared local `public/atlas.json` and `public/epochs.json`
during private development; they remain excluded from production.

Before selecting three public demos, review exact source revisions, licenses
and notices, provenance, copied content, contributor metadata treatment,
interpretation limits, and snapshot paths and hashes. Only explicitly approved
snapshots may enter the publication asset list. Tree/history audit, clean
checkout checks, browser verification, actual build inventory review, and
separate explicit visibility approval remain release prerequisites. See
[Private development](PRIVATE-DEVELOPMENT.md).
