# Codex Project Adapter

Read `~/Projects/_workspace/WORKSPACE.md` before working in this project. Also
read the matching project note at
`~/Projects/_vault/projects/evolution-atlas.md` when it exists and is
accessible.

Keep project-specific working, validation, and review instructions below this
paragraph.

Treat feature, lifecycle, and intent labels as candidate interpretations unless
the cited repository evidence directly establishes them. Preserve links from
derived claims to Git evidence, and do not use contributor history for ranking
or performance judgment.

Validate implementation changes with `npm test`, `npm run build`, and
`git diff --check`. Review rendered Markdown whenever project documents change.

Milestone lock (issue #1): historical evolution is in consolidation scope—not snapshot-only.
Prioritize decision-scoped `integrate` + history plane before further coverage waves; do not
raise the 1.5MB ceiling as the scaling strategy. Three planes: Store / Decision session /
History. See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md#three-planes-store-decision-session-history`.

Keep raw Git observations separate from candidate interpretations in both code
and serialized data. Analyzer output may include contributor and repository
metadata, so generated datasets belong in ignored local paths unless Eugene
explicitly approves a fixture for version control.
