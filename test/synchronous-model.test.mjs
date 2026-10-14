import assert from 'node:assert/strict'
import test from 'node:test'
import { requestReading } from '../scripts/lib/commit-analysis.mjs'
import { evaluateArm, requestNaming } from '../scripts/lib/capability-naming.mjs'
import { consolidateCapabilities, requestConsolidation } from '../scripts/lib/capability-consolidate.mjs'
import { requestInductionPayload } from '../scripts/lib/capability-induction.mjs'
import { requestCapabilityAssignmentPayload } from '../scripts/lib/capability-assignment.mjs'
import { requestCapabilityCriticPayload } from '../scripts/lib/capability-critic.mjs'
import { requestHierarchyCriticPayload, requestHierarchyCriticRequestPayload } from '../scripts/lib/capability-hierarchy-critic.mjs'

const transports = [
  ['commit reading', (options) => requestReading({ model: options.model }, options)],
  ['capability naming', (options) => requestNaming([], options)],
  ['capability consolidation', (options) => requestConsolidation([], options)],
  ['capability induction', (options) => requestInductionPayload([], options)],
  ['capability assignment', (options) => requestCapabilityAssignmentPayload([], {}, options)],
  ['capability critic', (options) => requestCapabilityCriticPayload({}, options)],
  ['hierarchy critic', (options) => requestHierarchyCriticPayload({}, options)],
  ['shared hierarchy and graph transport', (options) => requestHierarchyCriticRequestPayload({ model: options.model }, options)],
]

function rejectsBatch(model) {
  return (error) => {
    assert.ok(error.message.includes(model))
    assert.match(error.message, /Batch API submission is not implemented/)
    assert.match(error.message, /--model openai\/gpt-6-luna/)
    return true
  }
}

for (const [name, request] of transports) {
  for (const model of ['openai/gpt-6-luna:batch', 'synthetic/explicit:batch']) {
    test(`${name} rejects ${model} before network dispatch`, async () => {
      let calls = 0
      const fetchImpl = async () => { calls += 1; throw new Error('Unexpected dispatch') }
      await assert.rejects(() => request({ model, fetchImpl }), rejectsBatch(model))
      assert.equal(calls, 0)
    })
  }

  test(`${name} permits the explicit synchronous workaround`, async () => {
    const dispatched = new Error('Injected transport reached')
    const model = 'openai/gpt-6-luna'
    let calls = 0
    const fetchImpl = async (_url, options) => {
      calls += 1
      assert.equal(JSON.parse(options.body).model, model)
      throw dispatched
    }
    await assert.rejects(() => request({ model, fetchImpl }), (error) => error === dispatched)
    assert.equal(calls, 1)
  })
}

for (const model of ['openai/gpt-6-luna:batch', 'synthetic/explicit:batch']) {
  test(`capability passes reject ${model} before retries or per-group failure recovery`, async () => {
    let calls = 0
    const request = async () => { calls += 1; throw new Error('Unexpected dispatch') }
    const mapper = (items, _limit, task) => Promise.all(items.map(task))
    await assert.rejects(
      () => evaluateArm([{ commitCount: 2, evidence: [] }], { model, request, mapper }),
      rejectsBatch(model),
    )
    await assert.rejects(
      () => consolidateCapabilities(['Synthetic capability'], { model, request }),
      rejectsBatch(model),
    )
    assert.equal(calls, 0)
  })
}
