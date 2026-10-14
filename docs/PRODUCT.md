# Productization

## Intent

Evolution Atlas should become something other people can use and look at.
The goal is distribution and pressure-testing, not revenue. Two artifacts
come out of this, and they are halves of one pipeline rather than competing
distributions:

1. An open-source tool a maintainer runs against their own repository.
2. A hosted gallery of pre-generated atlases for public repositories, built
   and published by the project owner.

Nothing here commits the project to supporting users, accepting external
analysis requests, or remaining maintained.

## Why the gallery shape

A hosted service that accepts a repository URL and analyzes it on demand
would need read access to private history, a credential to pay for
interpretation, and a plausible answer for contributor personal data. The
curated gallery avoids all three:

- The hosted site never reads a repository. It serves the JSON artifact.
- Interpretation cost is bounded by how many repositories the owner chooses,
  paid once per repository rather than once per visitor.
- Public source repositories still require snapshot review before their derived
  data is committed or published: exact revisions, licenses, copied material,
  contributor metadata, provenance, and interpretation limits matter. Publish
  only explicitly approved paths and hashes.

The analyzer/JSON/viewer boundary described in `ARCHITECTURE.md` is what
makes this work. The sensitive operation stays local by construction.

## Measured constraints

Numbers below were measured against the `course-recommender` dataset
(2,693 commits) on 2026-08-26. Treat token figures as approximate and
skewed low; paths and SHAs tokenize worse than prose.

| Property | Measurement | Consequence |
| --- | --- | --- |
| Interpretation corpus | ~39 tokens per commit, sent once per pass, two passes | Cost scales linearly with commit count |
| Estimate accuracy | Predicted 233,000 input tokens for `zod`; the run used 272,841 | The character-ratio estimate runs about 17% low, as expected |
| Prompt cache use | 256 cached tokens across both passes | Both passes send a byte-identical corpus; caching the shared prefix is unclaimed |
| Corpus delivery | Entire corpus in a single request | Hard ceiling near 15,000-20,000 commits against a 1M-token window |
| Atlas size | 6.6 MB raw, 559 KB gzipped (11.8x) | Transfer is a non-issue on any static host; parse and memory are the real limits |
| `authored` relationships | 2,693 of 2,693 derivable from `episode.contributorIds` | 0.84 MB of removable duplication |
| `touched` relationships | 0 of 2,336 derivable from `codeAreaIds` | Not redundant; carries path-level evidence |

The context-window ceiling, not cost, is the binding constraint. Repositories
above roughly 20,000 commits need the corpus chunked by time window with
feature candidates reconciled across chunks. That work is deferred. Gallery
subjects are curated below the ceiling instead.

Filtering merge commits and bot authors before interpretation would recover
meaningful headroom and is a cheaper first move than chunking.

## Provider

Interpretation runs through Anthropic directly or through OpenRouter. The
provider and model are recorded in each candidate's `method` field. OpenRouter
now defaults to `openai/gpt-6-luna:batch` for interpretation and epoch detection;
explicit OpenRouter `--model` overrides still apply. Anthropic retains
`claude-opus-5`, and model selection never switches providers. See
[selection and request formats](EXPERIMENTS.md#model-defaults-and-request-formats)
for credential precedence, transport details, and preserved experiment pins.
The historical measurements below remain measurements of their recorded
models, not evaluations of the new default.

Gallery generation should pin one provider and model across the whole batch
and record it in the manifest. Candidates produced by different models are
not comparable, and a gallery whose repositories were interpreted by
different routes cannot support claims about how the tool behaves across
repositories.

## Choosing gallery repositories

The first additional repository exists to calibrate, not to market. Its
value comes from whether the output can be graded, which is why a repository
the owner knows well is a legitimate second subject even though the stated
goal is to escape a single-repository model. Genuine third-party
repositories follow once the vocabulary survives a known-answer case.

These are the dimensions that actually stress the current pipeline. A
candidate is interesting when it differs from the subjects already analyzed:

1. **Identity mess.** Contributor count, aliases, GitHub noreply addresses,
   `.mailmap`, bots. Exercises `identity.mjs`. Co-author trailers, squash
   merges, and signed identities are unhandled.
2. **Merge topology.** The analyzer takes first-parent diffs on merges,
   which `ARCHITECTURE.md` marks provisional. A merge-heavy repository and a
   squash-only repository stress this differently.
3. **Bot volume.** Dependabot and Renovate traffic distorts both the
   contributor model and the directory lifespan bands.
4. **Commit subject quality.** Interpretation sees subjects and at most
   twelve paths per commit, never diffs. Subject quality is the single
   largest determinant of candidate feature quality. Conventional-commit
   repositories are the easy case; terse or careless subjects are the hard
   one.
5. **Structural reorganization.** `structure.mjs` groups only same-commit
   changes. A monorepo migration or large directory reshuffle tests where
   that bound starts to hurt.
6. **Code-area shape.** Top-level directories are the code-area candidates.
   A flat Go repository, a Rust repository that is mostly `src/`, and a
   `packages/*` monorepo produce very different area models.
7. **Time span.** Chronology, chapter strip, and lifespan bands behave
   differently across one year versus ten.
8. **Vendored and generated paths.** `vendor/`, `dist/`, lockfiles, and
   generated code inflate observed file counts.

Survey candidates with Git alone before spending anything on interpretation.
Commit count, contributor count, bot share, merge share, subject-length
distribution, top-level directory count, and time span are all observable
without a model.

## Selection evidence

Surveyed 2026-08-26 with `npm run survey`. Identity counts are distinct Git
author emails, not resolved contributors. Corpus tokens estimate what one
interpretation pass would send, using first-parent merge diffs to match the
analyzer; treat them as a floor.

```
    repo  commits  span  ids  bot%  merge%  conv%  terse%  medSubj  renames  dirs  corpusTok
--------  -------  ----  ---  ----  ------  -----  ------  -------  -------  ----  ---------
 ripgrep     2287  10.4  497   0.1     2.7    4.7    10.7       32      140     9      61681
     zod     3094   6.5  602   0.9    10.2   17.5    22.8       30     1211    12     116648
    htmx     3550   6.3  478     1    17.1    1.7    21.2       32     9366     7     125893
 esbuild     4478   6.6  137     0       0    2.2     0.5       41      152    11     239648
 sinatra     4684  18.9  545     0    20.5      2     6.9       42      118     6     146644
   flask     5556  16.4  873   3.4    31.2    0.7     3.8       41      434     6     179962
requests     6493  15.5  803     1    24.8    0.6    17.2       35      158     5     178098
```

Every candidate sits far below the context ceiling; the largest corpus is
under 200,000 tokens per pass. None of these subjects forces the chunking
work described above.

`zod` is the chosen second subject. Its commit count and corpus size are
close enough to `course-recommender` that differences in output quality are
attributable to the repository rather than to scale, its mixed commit
conventions resemble the pilot's, its v3-to-v4 rewrite exercises the
uncalibrated migrated-versus-structural boundary, and TypeScript keeps the
candidates gradeable by hand.

`esbuild` is the intended third subject as the opposite corpus-quality case:
disciplined subjects, no merge commits, and a small identity set. `flask` is
the intended stress case, with the highest merge share, bot share, and
identity count in the set. `htmx` is deliberately deferred; 9,366 rename
records would saturate structural detection before the detector is trusted
on a normal repository.

The most consequential finding is that identity counts run 17 to 31 times the
pilot's 28. `identity.mjs` was calibrated against manually reviewed aliases at
that smaller scale, and Identity Review and the People section were designed
around it. Expect identity behavior, not lifecycle vocabulary, to dominate
first impressions on any of these subjects.

## Second subject results

`zod` was analyzed and interpreted on 2026-08-26 through OpenRouter using
`x-ai/grok-4.6`.

The observed layer generalized without tuning. Structural detection proposed
nine candidate reorganizations, including the v4 monorepo move
(`packages/zod/src` into `packages/zod`, confidence 0.97) and a
move-and-return of the test directory. Directory lifespans show the migration
on their own: `src` runs from 2020-03 to 2025-05 and `packages` begins
2025-04, with `deno` retiring alongside `src`.

Interpretation produced 40 candidate features and 149 lifecycle episodes,
against the pilot's 37 and 138. Feature labels are recognizable domain
concepts rather than restated commit subjects. Nine `migrated` episodes
appeared, including the Zod 4 default line, dropping the PseudoPromise
parser engine, and the move to the zshy packaging tool. This is the first
evidence that the lifecycle vocabulary survives a repository it was not
calibrated against.

Interpretation is not reproducible. Two runs over the same corpus, model,
and commit produced 40 features with 149 episodes and 39 features with 138
episodes. The substance was stable — both runs identified the Zod 4 default
switch, the PseudoPromise removal, and the zshy packaging move — but labels,
counts, and stage assignments moved. A regenerated gallery subject therefore
shows visitors something different, and two subjects built at different times
are not strictly comparable. This argues for treating a published atlas as a
committed artifact pinned to a head commit rather than something rebuilt on
every deploy.

Feature granularity sits above episode granularity, sometimes wrongly. The
`Map and Set schemas` candidate carries two `introduced` episodes because
`z.map` and `z.set` genuinely arrived separately. Referential integrity is
intact — no episode cites a missing feature and every feature has an
introduction — so this is a modeling question rather than a validation gap,
and it is direct evidence for the open question about whether the primary
visual unit should be the feature or the episode.

Two cautions carry forward. Contributor identities numbered 602 against the
pilot's 28, so identity behavior will dominate first impressions. Code areas
numbered 25, of which ten are dotfile or generated directories; those account
for only 4.1% of commit associations, so the long tail is a rendering problem
rather than a heuristic failure. Five areas carry roughly 96% of
associations, and fourteen have fewer than fifteen commits.

## Sequence

1. Done. Apache-2.0, with the license recorded in `package.json`. The
   package stays `private` until publishing to a registry is a separate,
   deliberate step; the license governs the repository either way.
2. Done. `npm run survey` reports the dimensions above using Git only.
3. Analyzed. `zod` results are recorded above. Grading candidates by hand
   and recording counterexamples is still outstanding, and is what turns
   this into Milestone 1's exit signal rather than a promising first look.
4. Done. `npm run gallery` fetches, analyzes, interprets, and emits one
   dataset per catalog subject plus a manifest recording provider, model,
   head commit, and counts. Unchanged subjects are skipped, one failing
   subject does not discard the batch, and retryable provider failures back
   off rather than dropping a subject.
5. Done. The viewer reads the gallery manifest, resolves a subject from the
   `repo` query parameter, and falls back to the single local `/atlas.json`
   when no manifest is published.
6. Done. The gallery index page renders the available subjects before selection.
7. Choose three demo datasets later, review their exact snapshots and paths, and
   obtain explicit publication approval after the release checks.
8. Rewrite `README.md` for a maintainer analyzing their own repository
   rather than a reader learning about this one.

## Deferred

- Corpus chunking for repositories above the context ceiling.
- Incremental or database-backed storage.
- Any hosted analysis of user-supplied repositories.
- Accounts, collaboration, and persisted correction state.
- Monetization.

## Open questions

- Does the lifecycle vocabulary calibrated on one repository survive a
  second subject with different commit conventions?
- Which of the eight dimensions above actually change candidate quality, and
  which merely change the numbers?
- Should bot and merge filtering happen in the analyzer, in the
  interpretation corpus, or only in the viewer?
- Is a gallery atlas a committed fixture or a build artifact? Committing
  gives reproducibility and real test data; it also grows the repository.
- How should the gallery present a repository whose candidates came out
  poorly? Hiding it would misrepresent the tool.
