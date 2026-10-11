# Review

Use for review requests or an independent pass over a consequential change. Review-only work is read-only.

1. Establish the intended behavior, exact diff and base, and the active callers and owner documents.
2. Check whether raw Git observations and candidate interpretations stay distinct in code and serialized data. Resolve citations to Git evidence. Inspect omissions, history lineage, and reviewer qualifications before accepting a claimed change.
3. Examine versioned replay, host/worker coordination, UI paths, generated-data privacy, tests, and documentation where the diff touches them. Contributor history must not become a ranking or performance judgment.
4. Prove consequential risks with a real call, fixture, or artifact when feasible. Report findings with file and line, trigger, consequence, and evidence; label uncertain risks as such.
5. If asked to fix findings, make the smallest supported correction and rerun affected verification. Do not treat review as publication authority.
