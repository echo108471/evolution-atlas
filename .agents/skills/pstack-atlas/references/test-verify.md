# Test and verify

Match evidence to the claim. Read the project's [verification guide](../../../../docs/VERIFICATION.md) for current commands, test owners, artifacts, and limits.

1. Name the tested source or working-tree state, requested behavior, expected output, and evidence link before selecting a check.
2. Run the narrowest meaningful test while changing a slice. Reproduce a defect on its affected surface and retest that surface after the fix. For an engine or history change, inspect the saved run and exact replay as well as test output.
3. Run `npm test`, `npm run build`, and `git diff --check` for completed implementation changes as [AGENTS.md](../../../../AGENTS.md) requires. Inspect rendered UI for visual changes and rendered Markdown for project documents. Repeat affected checks after later source edits.
4. Keep synthetic Git tests, versioned replay, serialized citation checks, browser interaction, and live model quality separate. A passing validator establishes that references and accounting resolve; it does not establish the meaning of a candidate capability or historical change.
5. Keep generated datasets in ignored local paths unless Eugene approves a fixture for version control. Report commands and results, inspectable artifacts, and remaining unverified claims.
