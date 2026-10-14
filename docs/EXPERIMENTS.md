# Explicit experiments and saved-output reuse

Routine development follows [Development](DEVELOPMENT.md): fictional fixtures,
local Git histories, and a credential-free offline gate. Real source acquisition
and model execution are separate operations. This guide describes the legacy
gallery, interpretation, and period CLIs; the current versioned repository
engine and host workflow remain documented in [History workflow](HISTORY-WORKFLOW.md).

## Analyze pinned local source

The tracked `gallery/catalog.json` is a candidate catalog, not an approved demo
list. Every selected subject needs a full lowercase 40-character `commit` SHA.
The catalog pins zod, esbuild, and Flask as proposed source candidates. The
[demo source review](DEMO-REVIEW.md) records their exact revisions, selected
license evidence, provenance gaps, and proposed contributor treatment. Those
source pins do not approve generated snapshots or publication. No three public
demo snapshots have been approved.

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

## Model defaults and request formats

The shared [OpenRouter default](../scripts/lib/model-defaults.mjs) is
`openai/gpt-6-luna:batch`. It is used by interpretation (including gallery
interpretation) and epoch proposal discovery. The epochs CLI also passes the
selected model to period labeling.

| Caller | Provider selection | Model selection |
| --- | --- | --- |
| `scripts/interpret.mjs`, gallery interpretation | Explicit `--provider`; otherwise OpenRouter only when `OPENROUTER_API_KEY` is set without `ANTHROPIC_API_KEY`, Anthropic otherwise | OpenRouter: explicit `--model`, then shared default. Anthropic: existing `claude-opus-5` default; `--model` remains rejected |
| `scripts/epochs.mjs` | OpenRouter only, with `OPENROUTER_API_KEY` | Explicit `--model`, then shared default, for both new proposals and labels |

There is no model-selection environment override in these CLIs. Their API-key
environment variables and Anthropic SDK credential resolution are unchanged.
Anthropic cannot serve the OpenAI model, so its default stays `claude-opus-5`;
choosing a model never silently switches providers. Anthropic SDK environment
settings still apply where the client does not explicitly supply a value;
the OpenRouter client supplies its own base URL and API key.

The two OpenRouter paths use different request formats:

- Interpretation uses the Anthropic SDK to `POST
  https://openrouter.ai/api/v1/messages`. With the ordinary API-key setup, it
  sends `x-api-key: <OPENROUTER_API_KEY>`, `anthropic-version: 2023-06-01`, and
  `content-type: application/json`, plus SDK headers. The JSON body contains
  `model`, `max_tokens: 32000`, `system`, and a `messages` array with user text
  content blocks, including an ephemeral `cache_control` marker on the corpus.
  The SDK adds `stream: true`. `output_config` is added only for Claude model
  IDs, so it is absent for the Luna default. The lifecycle pass uses the same
  envelope with the feature candidates included in its prompt.
- Epoch proposals and period labels `POST` to
  `https://openrouter.ai/api/v1/chat/completions` with `authorization: Bearer
  <OPENROUTER_API_KEY>` and `content-type: application/json`. Their JSON body
  contains `model`, `max_tokens` (4000 for proposals, 1500 for labels), and
  `messages` with system and user string content. They do not request
  streaming.

The `:batch` suffix is part of the model ID; these paths do not submit jobs to
a separate Batch API. These details describe the local request construction,
not verified live service support for that ID or transport.

Candidate `method` values continue to record provider and model. Replaying
epoch proposals retains the saved `model` and uses it in the document's
`method`; adding new labels records the selected label model separately.
`--proposals ... --no-labels` therefore retains proposal provenance even after
the default changes.

Independent historical experiment pins in `capability-induction.mjs`,
`capability-consolidate.mjs`, `capability-naming.mjs`, and `commit-analysis.mjs`
remain unchanged, as do their experiment consumers. In particular, direct
library use of period labeling requires a caller-supplied model; the epochs
CLI passes its own selected model explicitly. Moving the historical
experiment defaults onto the new shared constant would change saved request
construction or replay fingerprints, so they remain separate. Existing
saved runs and their pinned engine source are not rewritten.

## Retry and output preservation

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
