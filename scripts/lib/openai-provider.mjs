// The one place that knows how to reach the model provider. Every live model call in
// the analysis pipelines goes through OpenAI's Chat Completions endpoint (or its Batch
// API for `:batch` models; see openai-batch.mjs), authenticated with OPENAI_API_KEY.

export const PROVIDER_NAME = 'openai'
export const PROVIDER_LABEL = 'OpenAI'
export const OPENAI_API_BASE = 'https://api.openai.com/v1'
export const CHAT_COMPLETIONS_PATH = '/v1/chat/completions'
export const CHAT_COMPLETIONS_ENDPOINT = `${OPENAI_API_BASE}/chat/completions`
export const API_KEY_ENV = 'OPENAI_API_KEY'

/**
 * Model defaults. A `:batch` suffix is a local routing marker, not part of the model ID:
 * it selects the asynchronous Batch API, and is stripped before the request is sent.
 * Provenance strings keep the selected ID, suffix included, so a batch run stays
 * distinguishable from a synchronous one.
 */
// New whole-corpus interpretations and epoch requests.
export const DEFAULT_MODEL = 'gpt-6-luna:batch'
// Synchronous form of the default, for transports that cannot submit batches.
export const DEFAULT_SYNC_MODEL = 'gpt-6-luna'
// Heavy synchronous analysis: capability induction, consolidation, critics, assignment.
export const DEFAULT_ANALYSIS_MODEL = 'gpt-6-luna'
// Cheap, high-volume calls: capability naming and first-tier commit readings.
export const DEFAULT_CHEAP_MODEL = 'gpt-5.4-mini'
// Second-tier (depth) commit readings.
export const DEFAULT_DEPTH_MODEL = 'gpt-5.4'

/** Reasoning effort values the current OpenAI reasoning models accept. */
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh']

/** Provenance method string for a candidate produced by `model`. */
export function providerMethod(prefix, model) {
  return `${prefix}:${PROVIDER_NAME}:${model}`
}

export function isBatchModel(model) {
  return typeof model === 'string' && model.endsWith(':batch')
}

/** The model ID OpenAI expects: the local `:batch` routing marker removed. */
export function wireModel(model) {
  return isBatchModel(model) ? model.slice(0, -':batch'.length) : model
}

/** Reject batch-only routing before a synchronous request or its retry loop. */
export function requireSynchronousModel(model) {
  if (isBatchModel(model)) {
    throw new Error(
      `Model "${model}" requires the OpenAI Batch API; this synchronous transport cannot submit batches. ` +
      `Use the interpret or epochs batch runner, or pass --model ${DEFAULT_SYNC_MODEL} to use a synchronous model.`,
    )
  }
}

export function authHeaders(apiKey) {
  return { authorization: `Bearer ${apiKey}` }
}

/**
 * POST one Chat Completions request and return the parsed JSON body. Failures carry an
 * HTTP `status` (a timeout becomes 408) so the shared retry policy can classify them,
 * and the response headers so a Retry-After delay is honored.
 */
export async function requestChatCompletion(
  body,
  { apiKey, fetchImpl = fetch, timeoutMs, timeoutMessage = 'model request' } = {},
) {
  requireSynchronousModel(body?.model)
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
  let response
  try {
    response = await fetchImpl(CHAT_COMPLETIONS_ENDPOINT, {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      const timeout = new Error(`${timeoutMessage} exceeded ${Math.round(timeoutMs / 1000)}s`)
      timeout.status = 408
      throw timeout
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`)
    error.status = response.status
    if (response.headers) error.headers = response.headers
    throw error
  }
  return response.json()
}

function textOf(content) {
  if (typeof content === 'string') return content
  return (content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
}

/**
 * Translate an Anthropic Messages-shaped request (as built by interpret.mjs) into a
 * Chat Completions body. Anthropic-only fields (output_config, cache_control) have no
 * Chat Completions equivalent and are dropped; OpenAI caches long prompt prefixes
 * automatically.
 */
export function messagesToChatBody(body) {
  const messages = []
  if (body.system) messages.push({ role: 'system', content: textOf(body.system) })
  for (const message of body.messages ?? []) {
    messages.push({ role: message.role, content: textOf(message.content) })
  }
  return {
    model: body.model,
    ...(body.max_tokens ? { max_completion_tokens: body.max_tokens } : {}),
    response_format: { type: 'json_object' },
    messages,
  }
}

const STOP_REASONS = { stop: 'end_turn', length: 'max_tokens', content_filter: 'refusal' }

/**
 * Translate a Chat Completions response back into the Messages shape interpret.mjs
 * parses, so one parser serves both providers.
 */
export function chatCompletionToMessage(payload) {
  if (payload?.error) throw new Error(`provider error: ${JSON.stringify(payload.error).slice(0, 180)}`)
  const choice = payload?.choices?.[0]
  if (!choice) throw new Error('response contained no choices')
  const refusal = choice.message?.refusal
  const usage = payload.usage
    ? {
        input_tokens: payload.usage.prompt_tokens ?? 0,
        cache_read_input_tokens: payload.usage.prompt_tokens_details?.cached_tokens ?? 0,
        output_tokens: payload.usage.completion_tokens ?? 0,
      }
    : undefined
  return {
    content: [{ type: 'text', text: choice.message?.content ?? '' }],
    stop_reason: refusal ? 'refusal' : (STOP_REASONS[choice.finish_reason] ?? choice.finish_reason ?? 'end_turn'),
    ...(refusal ? { stop_details: { category: String(refusal).slice(0, 120) } } : {}),
    ...(usage ? { usage } : {}),
  }
}

/**
 * A minimal client with the `messages.stream(body).finalMessage()` surface interpret.mjs
 * uses, backed by Chat Completions. It never retries by itself.
 */
export function createChatMessagesClient({ apiKey, fetchImpl = fetch, timeoutMs } = {}) {
  return {
    messages: {
      stream: (body) => ({
        finalMessage: async () => chatCompletionToMessage(
          await requestChatCompletion(messagesToChatBody(body), {
            apiKey, fetchImpl, timeoutMs, timeoutMessage: 'interpretation request',
          }),
        ),
      }),
    },
  }
}
