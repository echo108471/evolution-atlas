/** Explicit host status projection; saved interpretations stay privileged. */
export function engineStatusMetadata(run) {
  return {
    status: run.status,
    version: run.plan.version,
    mode: run.plan.mode,
    displayName: run.plan.displayName,
    commitSha: run.plan.commitSha,
    availableDiscoveryFiles: run.inventory.eligibleFiles,
    validationIssueCount: run.validationIssues.length,
    jobs: run.jobs.map(({ agent, state, handle, validation }) => ({
      agent, state, handle,
      // Validation targets/messages may quote authored IDs, fields or raw JSON.
      validationIssueCount: validation.length,
    })),
  }
}
