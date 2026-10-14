// Defaults for new whole-corpus interpretations and epoch requests. Historical
// experiment pipelines keep their own model pins to preserve saved-run fingerprints.
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-6-luna:batch'

/** Reject batch-only routing before a synchronous request or its retry loop. */
export function requireSynchronousModel(model) {
  if (typeof model === 'string' && model.endsWith(':batch')) {
    throw new Error(
      `Model "${model}" requires the OpenRouter Batch API; this synchronous transport cannot submit batches. ` +
      'Use the interpret or epochs batch runner, or pass --model openai/gpt-6-luna to use a synchronous model.',
    )
  }
}
