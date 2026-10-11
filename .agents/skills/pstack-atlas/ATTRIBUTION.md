# Attribution

This repository's workflow is a local adaptation of Lauren Tan's pstack,
using `cursor/plugins/pstack` at commit
`12d587dfb20741cafc376c42c696c5f6e2a64487` as the reference. The
Cooking Document pilot informed the local organization; its project-specific
contracts were replaced with Evolution Atlas's evidence and history rules.

- [Upstream README](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/README.md)
- [Upstream Poteto Mode](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/poteto-mode/SKILL.md)
- [Upstream license](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/LICENSE)

The project skills are focused entrypoints to local playbooks. Their names do
not claim equivalent upstream skills or reproduce every upstream procedure.

| Local skill | Upstream basis |
| --- | --- |
| `pstack-explore` | `skills/how/SKILL.md` and `skills/poteto-mode/playbooks/investigation.md` |
| `pstack-architect` | `skills/architect/SKILL.md` |
| `pstack-implement` | `skills/poteto-mode/playbooks/feature.md` |
| `pstack-refactor` | `skills/poteto-mode/playbooks/refactoring.md` |
| `pstack-debug` | `skills/poteto-mode/playbooks/bug-fix.md` and the root-cause principles |
| `pstack-verify` | `skills/principle-prove-it-works/SKILL.md` and the behavior-testing principle |
| `pstack-review` | `skills/blast-radius/SKILL.md` and the review stages of the playbooks |

Cursor plugin packaging, sticky mode, model routing, automations, and automatic
PR landing are outside this adaptation. The included [MIT license](LICENSE)
applies to the upstream material informing these playbooks.
