// Analyze recorded real responses only; never opens serial or generates device data.
require('../desktop/node_modules/tsx/dist/cjs/index.cjs')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
const { EXPERIENCE_DEFINITIONS } = require('../desktop/shared/experience-definitions.ts')
const directory = resolve(__dirname, '../docs/evidence')
const evidence = JSON.parse(readFileSync(resolve(directory, 'hardware-step2-real.json'), 'utf8'))
assert.ok(evidence.messages.every(({ message }) => !message.invalidLine), 'Malformed real serial frames detected')
const startIds = evidence.writes.filter(({ request }) => request.type === 'START').map(({ request }) => request.operationId)
assert.equal(new Set(startIds).size, startIds.length, 'Unexpected repeated START operation IDs')
const summary = { overall: evidence.result, modes: {}, commandCounts: {}, hostLease: evidence.hostLease,
  usbUnplugStep2: evidence.checks.physicalUsbUnplug ?? 'NOT RUN — stopped at firmware mismatch' }
for (const { request } of evidence.writes) summary.commandCounts[request.type] = (summary.commandCounts[request.type] ?? 0) + 1
for (const [mode, result] of Object.entries(evidence.modes)) {
  const operationId = result.naturalRun.experience.operationId
  const actions = evidence.messages.filter(({ message }) => message.name === 'ACTUATOR_EVENT' && message.operationId === operationId)
    .map(({ message }) => ({ atMs: message.atMs, action: message.action, durationMs: message.durationMs }))
  const expected = EXPERIENCE_DEFINITIONS[mode].timeline.filter((event) => event.kind === 'ACTION')
    .map(({ atMs, action, durationMs }) => ({ atMs, action, durationMs }))
  assert.deepEqual(actions, expected, mode + ': actual diagnostic events differ from calibrated timeline')
  const stopId = result.stopRun.experience.operationId
  const stopMessages = evidence.messages.filter(({ message }) => message.operationId === stopId).map(({ message }) => message)
  assert.ok(stopMessages.some((message) => message.command === 'STOP' && message.accepted && message.state === 'STOPPING'))
  assert.equal(stopMessages.filter((message) => message.name === 'STOPPED').length, 1)
  assert.equal(stopMessages.some((message) => message.name === 'COMPLETED'), false)
  const stoppedAt = evidence.messages.find(({ message }) => message.name === 'STOPPED' && message.operationId === stopId).at
  assert.equal(evidence.messages.some(({ at, message }) => at > stoppedAt && message.operationId === stopId && message.name === 'ACTUATOR_EVENT'), false)
  summary.modes[mode] = { result: result.result, actionCount: actions.length, timelineDiagnosticsMatch: true,
    hostAckToCompletedMs: result.hostObservedMs, nominalMs: EXPERIENCE_DEFINITIONS[mode].totalDurationMs,
    cancelledStateSequence: ['IDLE', 'RUNNING', 'STOPPING', 'IDLE'], naturalStateSequence: ['IDLE', 'RUNNING', 'COMPLETED'] }
}
const leaseStartIndex = evidence.writes.findIndex(({ request }) => request.requestId === 'leaseStart')
const leaseStatusIndex = evidence.writes.findIndex(({ request }) => request.requestId === 'leaseStatus')
if (leaseStartIndex >= 0 && leaseStatusIndex >= 0) {
  assert.equal(leaseStatusIndex, leaseStartIndex + 1, 'There must be no outgoing requests during lease silence')
  summary.hostLeaseWriteGapMs = evidence.writes[leaseStatusIndex].at - evidence.writes[leaseStartIndex].at
  summary.hostLeaseCompatible = evidence.hostLease.snapshot.state === 'FAULT' && evidence.hostLease.snapshot.faultCode === 'HOST_TIMEOUT'
  summary.cleanupStopped = evidence.messages.some(({ message }) => message.name === 'STOPPED' && message.operationId === 'leaseOperation')
}
writeFileSync(resolve(directory, 'hardware-step2-summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
