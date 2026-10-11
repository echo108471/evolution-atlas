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
Use [Verification](docs/VERIFICATION.md) to select focused checks and distinguish
what each result establishes.

Milestone lock (issue #1): historical evolution is in consolidation scope—not snapshot-only.
Prioritize decision-scoped `integrate` + history plane before further coverage waves; do not
raise the 1.5MB ceiling as the scaling strategy. Three planes: Store / Decision session /
History. See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md#three-planes-store--decision-session--history`.

Keep raw Git observations separate from candidate interpretations in both code
and serialized data. Analyzer output may include contributor and repository
metadata, so generated datasets belong in ignored local paths unless Eugene
explicitly approves a fixture for version control.

Use the repo-local [pstack engineering workflow](docs/ENGINEERING.md) for
substantial investigation, design, implementation, debugging, verification,
and review. Its values apply to ordinary work without a special invocation;
choose only the task-relevant steps. The [pstack-atlas skill](.agents/skills/pstack-atlas/SKILL.md)
routes broad requests to focused project skills. This workflow does not add
hooks, permissions, model settings, or authority to publish.

Use [pstack-verify](.agents/skills/pstack-verify/SKILL.md) and its
[feature map](.agents/skills/pstack-verify/references/features/README.md) to
exercise app behavior with `npm run control:atlas`. Keep verification evidence
in ignored `scratch/`, and distinguish scripted synthetic journeys from live
model or real-repository acceptance. Use
[pstack-maintain-verification](.agents/skills/pstack-maintain-verification/SKILL.md)
when the map or harness needs upkeep. Run `npm run check:pstack` after changing
the workflow, skills, or feature map.
