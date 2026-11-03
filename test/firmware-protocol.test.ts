import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FirmwareJsonlDecoder,
  firmwareCommandMatches,
  isFirmwareAcknowledgementForRequest,
  isFirmwareOperationId,
  isFirmwareRequestId,
  isFirmwareStatusResponseForRequest,
  parseFirmwareJsonObject,
} from '../desktop/electron/serial/firmware-protocol'
import { FirmwareSessionState } from '../desktop/electron/serial/firmware-session-state'

test('JSONL decoder handles split chunks, CRLF, and blank lines', () => {
  const decoder = new FirmwareJsonlDecoder(64)
  assert.deepEqual(decoder.push('{"type":"ACK"'), [])
  assert.deepEqual(decoder.push('}\r\n\n{"type":"NACK"}\n'), [
    { type: 'line', line: '{"type":"ACK"}' },
    { type: 'line', line: '{"type":"NACK"}' },
  ])
})

test('JSONL decoder rejects an oversized frame and resumes at the next newline', () => {
  const decoder = new FirmwareJsonlDecoder(4)
  assert.deepEqual(decoder.push('12345'), [])
  assert.deepEqual(decoder.push('6\nok\n'), [
    { type: 'oversized' },
    { type: 'line', line: 'ok' },
  ])
})

test('JSONL decoder reset discards partial and oversized frames', () => {
  const decoder = new FirmwareJsonlDecoder(4)
  decoder.push('12345')
  decoder.reset()
  assert.deepEqual(decoder.push('ok\n'), [{ type: 'line', line: 'ok' }])
})

test('firmware frame parsing requires a JSON object', () => {
  assert.deepEqual(parseFirmwareJsonObject('{"type":"ACK"}'), { type: 'ACK' })
  assert.throws(() => parseFirmwareJsonObject('[]'), /must be a JSON object/)
  assert.throws(() => parseFirmwareJsonObject('{invalid'), SyntaxError)
})

test('firmware IDs preserve the protocol v2 1-16 ASCII character boundary', () => {
  assert.equal(isFirmwareRequestId('A_9-z'), true)
  assert.equal(isFirmwareOperationId('x'.repeat(16)), true)
  assert.equal(isFirmwareRequestId(''), false)
  assert.equal(isFirmwareOperationId('x'.repeat(17)), false)
  assert.equal(isFirmwareRequestId('id with spaces'), false)
  assert.equal(isFirmwareOperationId('é'), false)
})

test('response validation associates ACK and STATUS with the pending request', () => {
  const acknowledgement = {
    type: 'ACK',
    requestId: 'r1',
    command: 'STATUS_QUERY',
    accepted: true,
    state: 'IDLE',
  }
  const response = {
    type: 'STATUS',
    requestId: 'r1',
    acknowledgement,
    snapshot: { state: 'IDLE' },
  }

  assert.equal(firmwareCommandMatches(acknowledgement, 'STATUS_QUERY'), true)
  assert.equal(isFirmwareAcknowledgementForRequest(acknowledgement, 'r1'), true)
  assert.equal(isFirmwareAcknowledgementForRequest(acknowledgement, 'r2'), false)
  assert.equal(isFirmwareStatusResponseForRequest(response, 'r1'), true)
  assert.equal(isFirmwareStatusResponseForRequest(response, 'r2'), false)
})

test('firmware session owns device identity and runtime-state metadata', () => {
  const session = new FirmwareSessionState()
  session.confirmSimulationIdentity(true)
  session.confirmRealIdentity(true)
  session.setRemoteState('RUNNING')
  session.setRunStartedAt(123)

  session.beginConnection()

  assert.equal(session.remoteState, 'IDLE')
  assert.equal(session.runStartedAt, undefined)
  assert.equal(session.simulationIdentityConfirmed, false)
  assert.equal(session.realIdentityConfirmed, false)

  session.confirmRealIdentity(true)
  session.invalidateIdentity()
  assert.equal(session.realIdentityConfirmed, false)
})
