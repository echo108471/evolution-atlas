// A synthetic OpenAI Files + Batches API for offline tests. It never touches the
// network: hand `fetchImpl` to a batch runner, or install it as globalThis.fetch in a
// subprocess guard.

const API = 'https://api.openai.com/v1'

const ok = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
})

/**
 * @param {object} options
 * @param {(line: object, submission: object) => object} [options.respond]
 *   Response body for one request line (default: an empty chat completion).
 * @param {(line: object, submission: object) => object} [options.item]
 *   Full result line for one request, overriding `respond` (for error results).
 * @param {(submission: object, pollCount: number) => string|object} [options.poll]
 *   Status (or full batch object) for each poll (default: 'completed').
 * @param {(submission: object) => string} [options.batchId]
 * @param {(submission: object) => void} [options.onSubmit]
 * @param {(request: {url: string, method: string, headers: object}) => void} [options.onRequest]
 */
export function createOpenAIBatchMock({
  respond = () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
  item,
  poll = () => 'completed',
  batchId = (submission) => `batch-${submission.lines[0].custom_id}`,
  onSubmit,
  onRequest,
} = {}) {
  const uploads = new Map()
  const batches = new Map()
  const submissions = []
  const requests = []
  let fileCount = 0

  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const request = { url: String(url), method, headers: options.headers ?? {} }
    requests.push(request)
    onRequest?.(request)
    if (method === 'POST' && url === `${API}/files`) {
      const text = await options.body.get('file').text()
      const id = `file-${++fileCount}`
      uploads.set(id, {
        purpose: options.body.get('purpose'),
        lines: text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line)),
      })
      return ok({ id, object: 'file', purpose: 'batch' })
    }
    if (method === 'POST' && url === `${API}/batches`) {
      const body = JSON.parse(options.body)
      const upload = uploads.get(body.input_file_id)
      if (!upload) throw new Error(`Unknown input file ${body.input_file_id}`)
      const submission = {
        endpoint: body.endpoint,
        completionWindow: body.completion_window,
        purpose: upload.purpose,
        lines: upload.lines,
        model: upload.lines[0]?.body?.model,
        polls: 0,
      }
      submission.id = batchId(submission)
      batches.set(submission.id, submission)
      submissions.push(submission)
      onSubmit?.(submission)
      return ok({ id: submission.id, status: 'validating' })
    }
    const batchMatch = String(url).match(/\/batches\/([^/]+)$/)
    if (method === 'GET' && batchMatch && batches.has(decodeURIComponent(batchMatch[1]))) {
      const submission = batches.get(decodeURIComponent(batchMatch[1]))
      submission.polls += 1
      const state = poll(submission, submission.polls)
      const raw = typeof state === 'string' ? { status: state } : state
      return ok({
        id: submission.id,
        ...(raw.status === 'completed' ? { output_file_id: `out-${submission.id}` } : {}),
        ...raw,
      })
    }
    const contentMatch = String(url).match(/\/files\/out-([^/]+)\/content$/)
    if (method === 'GET' && contentMatch && batches.has(decodeURIComponent(contentMatch[1]))) {
      const submission = batches.get(decodeURIComponent(contentMatch[1]))
      return ok(submission.lines.map((line) => JSON.stringify(item ? item(line, submission) : {
        id: `request-${line.custom_id}`,
        custom_id: line.custom_id,
        response: { status_code: 200, request_id: `response-${line.custom_id}`, body: respond(line, submission) },
        error: null,
      })).join('\n') + '\n')
    }
    throw new Error(`Unexpected synthetic OpenAI request: ${method} ${url}`)
  }

  return { fetchImpl, submissions, requests }
}

/** A chat completion body whose message content is `value` serialized as JSON. */
export function chatCompletion(value, usage) {
  return {
    choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  }
}
