# Implementation and refactoring

Use the shared [engineering workflow](../../../../docs/ENGINEERING.md) and keep changed behavior distinct from behavior-preserving structure work.

## Implementation

- Name the requested outcome and the caller-facing data and evidence shape before adding logic.
- Build in the owning layer, then connect real callers through existing boundaries. For engine work, preserve the stable entry point, brokered Git access, receipt identity, bounded decision packet, and explicit omissions where relevant.
- Keep raw observations and candidate interpretations separate in code and serialized output. Validate evidence references before publication; an unsupported interpretation remains a candidate or an explicit gap.
- End slices with observable results. Use [design](design.md) for unsettled ownership and [verification](test-verify.md) for the real output.

## Refactoring

- Establish a relevant baseline from a test, replay, saved fixture, or direct output comparison. State the behavior being held constant.
- Inventory active callers, exported types, schemas, persisted outputs, versioned replay, tests, scripts, and docs before removing a path.
- Migrate callers and remove obsolete internal routes together. Keep compatibility only where a demonstrated external or versioned contract requires it.
- Check the original behavior after the change and confirm the new structure reduces reader effort. Route any intended behavior change through implementation.
