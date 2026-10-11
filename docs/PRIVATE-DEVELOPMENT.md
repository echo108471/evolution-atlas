# Private development and publication boundaries

Code, documentation, generators, deterministic synthetic fixtures, and repository
catalogs belong in Git. Real datasets, runs, model responses, receipts, reports,
repository clones, and caches belong in ignored local storage. Use `scratch/`
for new experiments; choose a new run directory when its engine source changes.
Repository catalogs describe candidates, not permission to publish their data.
Follow [Explicit experiments](EXPERIMENTS.md) for pinned source acquisition and
saved-output reuse; routine checks remain separate from paid execution.

## Preserved outputs

Before removing tracked outputs, preserve every regular working file under the
reviewed report roots, including untracked additions, to a new directory outside
the repository. The preservation utility refuses symlinks, existing destinations,
and destinations that contain or sit inside the checkout. Its manifest records
relative paths, sizes, modes, hashes, tracked status, and the source revision.
It verifies the backup and unchanged originals before returning success.

```sh
npm run preserve:artifacts -- --destination /absolute/private-backup-directory
npm run preserve:artifacts -- --verify --destination /absolute/private-backup-directory
```

This utility does not alter the index or history. Untracking is a separate,
reviewed operation after successful verification. Existing local copies remain
in place and ignored. The cloud migration also records its actual backup location
and manifest hash in ignored `scratch/artifact-recovery.json`. Preserve that
backup outside the cloud environment before retiring it; it is a local copy,
not an off-machine backup service.

For recovery, verify the backup, then copy only the required paths listed in its
manifest from `BACKUP/files/` into a new ignored experiment directory. Keep the
manifest with the recovered files and check their SHA-256 hashes. Avoid replacing
an existing run. Saved artifacts and source pins retain their provenance;
untracking does not remove earlier committed copies from Git history.

The report renderer now lives in `scripts/render-experiment-summary.mjs` and
uses the locked local Markdown dependency. `npm run render:reports` writes into
ignored `scratch/experiment-summary/`; rendering does not approve publication.

## Build inclusion

Production builds disable Vite's automatic `public/` copying. The versioned
`publication/manifest.json` starts with an empty asset list. Explicitly reviewed
assets must live under `publication/assets/`, specify a destination, SHA-256,
media type, and approval reference, and pass path, regular-file, and symlink
validation. The build emits only those exact bytes alongside the app bundle.
Git tracking and a gallery manifest do not grant publication permission.

Development-server local data access remains available for private use. Use
local file import for candidate maps and inspect the actual production `dist/`
inventory before any deployment. Ignoring a path protects Git staging, not every
server or packaging tool.

## Free routine checks

Install the locked dependencies with `npm ci` before running checks. Installation
may use the package registry; a prepared npm cache supports `npm ci --offline`.
Neither operation fetches experiment repositories or requests model inference.

```sh
node scripts/check-offline.mjs
```

Launch directly with Node for strictly offline validation: npm itself can check
the registry for updates before a package script starts. The npm alias is also
available when its launcher is opted out in advance:

```sh
NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_OFFLINE=true npm run check:offline
```

The gate runs the repository checks, tests, TypeScript compilation, production
build, and whitespace validation with an isolated home and an environment that
omits credentials and proxy settings. Node requests to external hosts fail;
loopback requests remain available for synthetic local verification. Git access
is limited to the local file protocol and automatic lazy fetching is disabled.
The test runner applies the same isolation and bounds file concurrency to one by
default; an explicit Node test-concurrency option overrides that bound.
Use `node scripts/test.mjs` when launching focused tests strictly offline.
This is a development guard, not an OS
network sandbox or a complete secret audit. Browser readiness and live UI
journeys remain separate checks described in [Verification](VERIFICATION.md).

## Later public release

Choose three demo datasets separately. Record exact repository revisions,
source licenses and notices, provenance, copied material, contributor metadata
treatment, interpretation limits, and the explicitly approved snapshot paths
and hashes. Real research narratives and saved reports need review even when
their sources are public or they appear under `docs/`.

Before release, audit the tracked tree and history, resolve history disposition,
exercise onboarding from a clean checkout, run tests and browser checks, and
inspect the actual built asset inventory. Preserve the Store / Decision session /
History contracts and versioned replay throughout this work. No real snapshot
or repository visibility change is authorized by this private development
workflow; each requires the user's later explicit approval.
