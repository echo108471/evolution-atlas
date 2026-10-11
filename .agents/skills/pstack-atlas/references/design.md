# Design

Use when a change crosses an ownership boundary or when more than one sound shape fits.

1. Start with a real caller. Sketch the inputs, outputs, evidence references, and serialized effects it needs. For an ambiguous report, first restate the observed symptom, requested outcome, and unknowns; proceed when the request is actionable.
2. Locate each invariant in the observed Git layer, candidate interpretation layer, reviewer decision, or runtime orchestration. Keep those layers distinct. Respect the [Store / Decision session / History](../../../../docs/ARCHITECTURE.md#three-planes-store--decision-session--history) contracts and the stable repository engine entry point.
3. Compare materially different options when a real design choice exists. Assess evidence traceability, bounded packets, replay, migration cost, and reader effort. When a small observation could change the decision, use the [prototype playbook](prototype.md) to settle it before committing to a shape. Do not invent alternatives or build throwaway work when the evidence already selects an option.
4. Choose the smallest interface that owns its decisions. Avoid a pass-through layer, a higher packet ceiling as the scaling answer, or another coverage wave before the current [history priority](../../../../docs/ROADMAP.md#immediate-next-steps).
5. State the chosen shape, rejected alternatives, caller migration, versioned contract impact, and verification evidence. For a consequential choice, independent design sketches or review can add signal when they are available and have distinct scopes. Revisit an assumption when repeated workarounds show it does not fit.

[AGENTS.md](../../../../AGENTS.md) owns project requirements; this playbook adds a design lens.
