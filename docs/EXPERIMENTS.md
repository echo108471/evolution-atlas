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
  --provider openrouter --model openai/gpt-6-luna \
  --cache scratch/repositories/gallery --out scratch/gallery-interpreted-next
node scripts/interpret.mjs --in scratch/atlas.json --allow-paid \
  --provider openrouter \
  --out scratch/atlas.interpreted-next.json
node scripts/epochs.mjs --in scratch/atlas.json --allow-paid \
  --save-proposals scratch/proposals-next.json --out scratch/epochs-next.json
```

These are optional operator commands, not onboarding or validation steps. They
need the selected provider's credentials and may incur charges. `--reuse-features`
retains input feature candidates but still requests lifecycle inference;
`--no-labels` alone still requests period proposals. The free period path needs
both saved `--proposals` and `--no-labels`.
The interpretation and epochs examples use the asynchronous OpenRouter batch
default. Gallery's transport remains live-only, so its example must explicitly
select a live model; gallery still rejects `:batch` slugs.

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

The two OpenRouter paths use different request formats. For a model without
the `:batch` suffix, their live transports remain unchanged:

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

In the interpretation and epochs CLIs, OpenRouter models ending in `:batch`
use the Batch API described below. Gallery retains its live-only transport.
Interpretation retains its Messages body shape without `stream` or the inner
`model`; epoch requests retain their chat-completions body shape without the
inner `model`. Parsed responses feed the same evidence validation as live
responses.

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

## OpenRouter batch runs

`scripts/interpret.mjs` and `scripts/epochs.mjs` automatically route OpenRouter
`:batch` models through `POST https://openrouter.ai/api/v1/batches`, with
`Authorization: Bearer <OPENROUTER_API_KEY>`. The JSON body places `endpoint`,
`model`, and `completion_window` before the `requests` array, as the API's
streaming parser requires. Each request has a unique `custom_id`; its body
inherits the batch-level model. The default sends the selected `--model` slug
verbatim, including `:batch`. `--batch-model <slug>` changes only the
batch-level API field, so an operator can adjust routing after a live check
without changing inner bodies or candidate `method` conventions. Both the
selected model and effective batch model are retained in the sidecar.

Feature discovery uses `/v1/messages`, followed by a separate lifecycle batch
whose prompt depends on the validated features. `--reuse-features` needs only
the lifecycle stage. Epoch discovery groups all proposal windows into one
`/v1/chat/completions` batch, validates proposals and builds the hierarchy,
then batches period labels by hierarchy level. Parent label prompts wait for
child labels. `--no-labels` skips these label stages.

Submission returns `202` with status `validating`; it is not a completed
inference result. Atlas polls `GET /api/v1/batches/:id` through `validating`,
`in_progress`, `finalizing`, or `cancelling` until `completed`, `failed`,
`expired`, or `cancelled`. Completed results are inline in the status response
and are matched by `custom_id`, independent of their order. Batch-wide failure,
expiry, cancellation, or timeout stops the run before a final output is written.
Interpretation also stops on a per-request error. Epochs retains its existing
failure accounting: a failed proposal window or an unnamed period is reported,
and the run can publish a partial result. Failed batches and errored requests
are never automatically resubmitted.

Unlike live calls, a batch can take the full **24-hour completion window**.
Dependent stages each have their own window, so a complete multi-stage run can
take longer than 24 hours. These flags apply to both CLIs:

| Flag | Behavior |
| --- | --- |
| `--batch-model <slug>` | Override the batch-level model; defaults to the selected model exactly as given. |
| `--batch-poll-ms <n>` | Initial polling interval in milliseconds; default `30000`. The interval doubles to a cap of `300000`, or the initial interval if larger. |
| `--batch-max-wait-ms <n>` | Maximum wait per stage in milliseconds; default `86400000` (24 hours). |
| `--batch-replay <path>` | Read saved completed results from a sidecar without any network calls. |

Before polling, Atlas saves each batch ID and request fingerprint in
`<output>.batch-state.json`. Epochs requires `--out` for new batch work.
The sidecar also pins the input dataset and inference options, and saves raw
terminal responses before parsing them. Keep it beside the saved output in
ignored `scratch/`; it can contain repository evidence and model content.

After a timeout or interruption, **rerun the same command against the same
input and output**. Atlas reuses completed stages and resumes polling the
recorded batch ID, without submitting it again. The timeout error includes
the batch ID, last status, and resume instructions. Poll interval and wait
limit may change on resume; a mismatched input, inference option, or request
fingerprint is refused. Epochs writes `--save-proposals` only after dependent
label batches finish, so a label timeout leaves the original command resumable.
Existing final outputs remain immutable; choose a new output for another
experiment.

Submission also reserves its stage in the sidecar before sending the POST.
If submission is interrupted or its response is lost before the batch ID is
saved, Atlas refuses to submit again automatically: the provider may already
have accepted paid work. Preserve that state and inspect the OpenRouter
workspace to reconcile the batch ID before continuing. Creating a new output
to bypass this state can purchase the same work again.

Once all required stages have completed, replay the raw results offline using
the original input and inference options and a new output path:

```sh
node scripts/interpret.mjs --in scratch/atlas.json --provider openrouter \
  --batch-replay scratch/atlas.interpreted-next.json.batch-state.json \
  --out scratch/atlas.batch-replayed-next.json
node scripts/epochs.mjs --in scratch/atlas.json \
  --batch-replay scratch/epochs-next.json.batch-state.json \
  --out scratch/epochs.batch-replayed-next.json
```

Replay requires neither credentials nor `--allow-paid`; missing saved stages
fail locally. Preserve the sidecar for long-term replay. OpenRouter retains
batch inputs and results for **30 days after creation**; a later fetch can
return `410 Gone`. Local saved results remain usable after remote retention
ends. This flow follows the operator-provided OpenRouter Batch API quickstart,
saved locally at `scratch/openrouter-batch-quickstart.md`.

OpenRouter documents batch requests as typically costing **50% of standard
per-token pricing**. Non-token components are not uniformly discounted:
web search uses standard rates and prompt-cache pricing varies. The
[model page](https://openrouter.ai/openai/gpt-6-luna:batch) is the pricing
source of truth. A completed batch's saved `usage.cost` is the OpenRouter
charge. For BYOK it is only OpenRouter's fee, because the provider bills
inference separately; `usage.cost_details.upstream_inference_cost` records the
estimated provider inference cost. These are documented pricing rules, not a
measured cost or live acceptance claim for Atlas's new batch path.

For a small optional live smoke check, generate a fresh fictional two-commit
dataset and cap both candidate counts. The first command is local; the second
needs `OPENROUTER_API_KEY` and purchases inference:

```sh
node scripts/synthetic-fixtures.mjs generate --out scratch/luna-batch-smoke
node scripts/interpret.mjs --in scratch/luna-batch-smoke/observed-atlas.json \
  --provider openrouter --model openai/gpt-6-luna:batch --allow-paid \
  --max-features 1 --max-lifecycle-episodes 1 \
  --batch-poll-ms 30000 --batch-max-wait-ms 86400000 \
  --out scratch/luna-batch-smoke/interpreted.json
```

The fixture directory must be new or empty. On timeout, rerun only the
interpretation command to resume; do not regenerate the input or remove its
sidecar. Small candidate limits keep the request narrow but are not a billing
cap. Once the run succeeds, preserve its output and use a fresh output path
for another run.

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
