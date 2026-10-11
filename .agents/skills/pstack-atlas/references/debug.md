# Debug

Use for a reported failure. A fix needs a reproduced symptom and the same path checked afterward.

1. Reproduce at the affected surface: deterministic engine operation, versioned replay, serialized output, or browser view. Record the exact input and observed result.
2. Trace the active caller and state. Separate hypotheses from observations; inspect Git evidence, receipts, worker status, and candidate validation as relevant. A saved handle alone does not prove completion.
3. Fix the cause supported by evidence with the smallest complete change. Avoid hiding missing evidence behind a fallback.
4. Repeat the original reproduction, then use the relevant [verification](test-verify.md). An inconclusive or wrong-surface check is not a pass.

If repeated fixes fail on the same assumption, test the assumption before another variant. [Engineering](../../../../docs/ENGINEERING.md) owns the shared workflow.
