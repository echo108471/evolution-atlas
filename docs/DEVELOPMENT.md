# Local development without real datasets

Evolution Atlas's routine development path needs code, the committed npm
lockfile, and generated synthetic fixtures. It does not need a private dataset,
an experiment repository, provider credentials, or a model call. Real experiments
and future approved public demo snapshots have separate acquisition and review
steps.

## Install pinned tooling and dependencies

Use Node **24.19.0** (`.node-version` and `.nvmrc`) and npm **11.9.0**
(`package.json`'s `packageManager`). Git is also required for synthetic history
and the local checkout smoke run. Check the actual versions before installing:

```sh
node --version
npm --version
git --version
```

From a fresh checkout, install the exact dependency resolution in
`package-lock.json`. This first installation can download packages from the npm
registry; it is a dependency setup step, not an experiment or a paid model call.
Use an explicit cache so the same packages can support subsequent offline
checkouts:

```sh
npm ci --cache scratch/npm-cache --no-audit --no-fund
```

Do not use `npm install` to recreate the lockfile as part of routine setup.
An empty cache cannot support an offline dependency installation. Once the
cache contains the required packages, installation can instead use:

```sh
npm ci --offline --cache scratch/npm-cache --no-audit --no-fund
```

The cache includes platform-specific tooling. A cache prepared for another
operating system or CPU can be incomplete. Treat installation failures as missing
prerequisites rather than silently falling back to a remote experiment or model.

## Generate and validate fixtures

The generator imports the existing browser verification fixtures rather than
maintaining another set of viewer examples. It writes to ignored
`scratch/synthetic-fixtures/` by default:

```sh
node scripts/synthetic-fixtures.mjs generate
node scripts/synthetic-fixtures.mjs validate
```

Generation requires a new or empty destination and preserves existing files. To
regenerate without deleting a prior fixture, choose a new ignored directory and
pass the same destination to validation:

```sh
node scripts/synthetic-fixtures.mjs generate --out scratch/synthetic-fixtures-next
node scripts/synthetic-fixtures.mjs validate --out scratch/synthetic-fixtures-next
```

| Generated path | Purpose and evidence boundary |
| --- | --- |
| `atlas.json`, `epochs.json` | Hand-authored synthetic viewer data; candidate feature and lifecycle labels remain interpretations |
| `gallery/manifest.json`, `gallery/synthetic-atlas.json` | Synthetic gallery entry and the same viewer snapshot |
| `maps/output.json` | Importable candidate map, explicitly marked as not independently verified |
| `source-repository/` | Two local Git commits with fictitious identities, fixed source files, and fixed dates; no remote configured |
| `observed-atlas.json` | Raw observations extracted from that synthetic Git history using the real analyzer |
| `fixture-manifest.json`, `LIMITATIONS.txt` | Relative file inventory, hashes, source revision pins, and explicit interpretation limits |

The viewer snapshots use illustrative SHA values inherited from the browser
fixtures. Those values do not identify the separate `source-repository/` commits.
The observed dataset uses the actual generated Git revisions. Validation checks
the complete non-Git file inventory, content hashes, source checkout and history,
and repeated extraction. Repeated generation produces the same JSON and source
file bytes and the same commit identities; `.git/`'s local administrative files
are excluded from the byte-stability claim.

All names, source, and dates are fictitious. These fixtures exercise data
contracts, Git extraction, parser behavior, and scripted interactions. They do
not establish model quality, semantic accuracy, real-repository acceptance,
contributor ownership, or performance. Keep generated artifacts ignored and
outside `public/`; generation is not approval for publication.

## Run routine checks offline

After dependencies are installed, run the credential-free offline validation
gate:

```sh
node scripts/check-offline.mjs
```

Launch this command directly so the parent npm process cannot perform an update
notification before the child establishes its offline environment. If using the
npm alias, establish those limits before starting npm:

```sh
NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_OFFLINE=true npm run check:offline
```

The gate runs the repository's workflow checks, tests, build, and diff checks in
an isolated environment. Provider, GitHub, proxy, and Git credentials are not
passed to child processes. The Node preload rejects external network calls, and
Git transport is restricted to local files. Loopback remains available for local
browser tooling. This is a development guard, not an operating-system network
sandbox or a full privacy audit.

For focused iteration, consult [Verification](VERIFICATION.md) and use the
owning test file. The full gate remains required for completed changes. Do not
substitute a synthetic parser or lifecycle check for semantic review of a real
artifact.

## Validate an exact fresh checkout

Commit the source change first so the smoke command can test an exact revision.
It clones the local repository into a new ignored evidence directory, checks out
the selected full SHA, verifies tooling pins, installs from the supplied cache,
generates and validates fixtures, runs the full routine gate offline, and checks
that the checkout has no tracked changes or unignored files:

```sh
node scripts/fresh-checkout.mjs --cache "$(pwd)/scratch/npm-cache"
```

The selected revision is acquired explicitly from the same local repository, so
detached and reflog-only commits can also be tested. Source refs, history, and
files are preserved; this acquisition makes no third-party experiment fetch.

To validate another commit that is already present locally:

```sh
node scripts/fresh-checkout.mjs \
  --revision FULL_40_CHARACTER_SHA --cache /absolute/path/to/npm-cache
```

Offline is the default installation mode. A deliberate test of registry
installation uses a separate explicit mode; only that dependency-install stage
permits external Node requests:

```sh
node scripts/fresh-checkout.mjs \
  --install-mode registry --cache /absolute/path/to/new-empty-cache
```

Only the registry dependency-install stage inherits the caller's HTTP, HTTPS,
all-protocol, and bypass proxy routing variables, including their lowercase
forms. Provider, GitHub, and npm authentication variables stay excluded, and
the isolated home and Git transport limits remain in effect. Offline installs
and subsequent validation omit all proxy routing variables.

Inspect `report.json` and the ordered logs in the reported
`scratch/fresh-checkout-evidence/` directory. The command retains its owned clone
and logs for inspection and never removes user files. A passing offline cached
run verifies that cache and platform. Claim an empty-cache registry installation
only after that explicit mode succeeds with a new empty cache. No mode fetches
third-party experiment repositories or runs a paid model.

The local clone can retain historical Git objects from this private repository;
the check is about the current checkout and development path. It does not clear
history for public release. Browser interaction and Chromium availability also
remain separate checks.

## Exercise the viewer

The existing control harness serves the same synthetic fixtures from its own
isolated runtime, without copying data into app public assets. Its
[feature map](../.agents/skills/pstack-verify/references/features/README.md)
documents the available journeys. Run its read-only readiness check first:

```sh
npm run control:atlas -- doctor
npm run control:atlas -- list
```

Chromium installation is an explicit download prerequisite, separate from the
routine offline gate:

```sh
PLAYWRIGHT_BROWSERS_PATH=scratch/verification-browsers \
  npx playwright install chromium
npm run control:atlas -- verify --all
```

Inspect the emitted JSON report, screenshots, and action evidence before
claiming a journey passed. A missing browser remains an explicit prerequisite;
the unit tests and build do not establish browser acceptance. To inspect the
generated candidate map manually, start `npm run dev`, open `?view=map`, and
choose `scratch/synthetic-fixtures/maps/output.json` in the local file picker.

## Keep real experiments separate

Use a complete revision pin when explicitly acquiring an experiment source, or
load saved source and response artifacts with verified pins and hashes. Reuse
expensive outputs instead of interpreting again during onboarding or routine
validation. Real source acquisition, paid worker execution, snapshot selection,
contributor metadata review, and publication each need their stated inputs and
authorization. Preserve existing provenance and versioned replay contracts.

Before public release, separately review the current tree and history,
onboarding from a clean clone, licenses and notices, contributor metadata,
approved snapshot paths, and actual build contents. Private implementation and a
passing local smoke command do not authorize changing repository visibility.
