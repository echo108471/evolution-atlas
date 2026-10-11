# Attribution and adaptation

This repository's workflow adapts selected ideas and procedures from Lauren
Tan's pstack, version 0.15.17, at cursor/plugins commit
9d76bcab133aefcccb16121d7be874e6aa823729. The pinned source files, their
checksums, local owners, and exclusions are recorded in
[upstream.json](upstream.json).

- [Pinned pstack README](https://github.com/cursor/plugins/blob/9d76bcab133aefcccb16121d7be874e6aa823729/pstack/README.md)
- [Pinned Poteto Mode](https://github.com/cursor/plugins/blob/9d76bcab133aefcccb16121d7be874e6aa823729/pstack/skills/poteto-mode/SKILL.md)
- [Pinned upstream license](https://github.com/cursor/plugins/blob/9d76bcab133aefcccb16121d7be874e6aa823729/pstack/LICENSE)

The user-provided excerpts “The Complete Guide to pstack Pt. 1” and “The
Complete Guide to pstack Pt. 2” informed the local requirements for
maintainable verification tooling, source-backed feature guides,
plain-language grounding, empirical prototypes, measured performance, and
verifiable multi-phase work. They are supporting context; this repository
does not reproduce the articles or provision their platform-specific setup.

The repository-local skills and playbooks use Codex's native skill discovery
and the project's existing scripts, tests, browser verification, and evidence
contracts. The local names identify Evolution Atlas workflows; they do not
claim one-to-one feature parity with upstream.

| Local owner | Upstream basis | Evolution Atlas adaptation |
| --- | --- | --- |
| [pstack-atlas](SKILL.md) and [Engineering](../../../docs/ENGINEERING.md) | README, Poteto Mode, and task playbooks | Routes task types while keeping project-specific evidence, privacy, and milestone rules authoritative. |
| [pstack-explore](../pstack-explore/SKILL.md) and [explore](references/explore.md) | how, why, recall, teach, and investigation | Traces active callers and repository lineage; prior summaries are leads, and evidence stays distinct from inference. |
| [pstack-architect](../pstack-architect/SKILL.md) and [design](references/design.md) | architect and design red flags | Starts from caller data and ownership, preserves the Store / Decision session / History planes, and prototypes only to settle a real empirical choice. |
| [pstack-implement](../pstack-implement/SKILL.md) | feature playbook | Connects requested behavior through the real owner and caller while preserving evidence lineage. |
| [pstack-refactor](../pstack-refactor/SKILL.md) | refactoring playbook | Establishes a behavior baseline, migrates active callers, and preserves versioned replay. |
| [pstack-debug](../pstack-debug/SKILL.md) | bug-fix, runtime forensics, trace forensics, and root-cause principles | Reproduces the symptom on its affected surface and fixes the supported cause. |
| [pstack-verify](../pstack-verify/SKILL.md) and [test and verify](references/test-verify.md) | prove-it-works, behavior testing, and verification-skill guidance | Uses project checks, the repository control harness, saved artifacts, and explicit limits on each claim. |
| [pstack-maintain-verification](../pstack-maintain-verification/SKILL.md) | create-verification-skill and maintain-verification-skill | Reconciles the source-backed feature registry and verification harness with a coordinator-led live pass. |
| [performance](references/performance.md) | perf issue, hillclimb, benchmark checklist, and explain-the-number | Requires representative workloads, comparable measurements, isolated changes, and explicit measurement limits. |
| [prototype](references/prototype.md) | prototype, exhaust-the-design-space, and build-the-lever | Uses disposable local sketches and observed evidence to settle a design question; production work follows the project implementation path. |
| [coordinated work](references/coordinated-work.md) | multi-phase plan, orchestrate, session pickup, skill authoring, and evaluation | Uses temporary proof-centered checklists, bounded independent work, current-source pickup, and realistic skill evaluations. |
| [pstack-review](../pstack-review/SKILL.md) | review stages, blast radius, and interrogate | Reviews actual changes and contracts with evidence, while leaving review read-only unless a fix is requested. |
| [selected principles](references/principles.md) | selected core, architecture, verification, and delegation principles | Applies only the principles that change a decision in this project's evidence model and workflow. |

This adaptation excludes upstream platform packaging, platform-specific mode
and model configuration, hooks, cloud-agent setup, scheduled or event-driven
automation, and automatic pull-request landing. It also does not provision or
query external team systems by default. Those capabilities require separate
product support and authorization.

The [MIT license](LICENSE) applies to the upstream material informing these
local playbooks.
