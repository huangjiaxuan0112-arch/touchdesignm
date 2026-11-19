import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FirmwareJsonlDecoder,
  firmwareCommandMatches,
  getFirmwareJsonParseDiagnostic,
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
    { type: 'oversized', observedLength: 6, prefix: '123456', suffix: '123456' },
    { type: 'line', line: 'ok' },
  ])
})

test('JSONL decoder keeps oversized RX diagnostics to bounded prefix and suffix samples', () => {
  const decoder = new FirmwareJsonlDecoder(8)
  const input = `START-${'x'.repeat(100)}-END\n`
  const [frame] = decoder.push(input)
  assert.equal(frame?.type, 'oversized')
  if (frame?.type !== 'oversized') throw new Error('Expected oversized frame metadata.')
  assert.equal(frame.observedLength, input.length - 1)
  assert.equal(frame.prefix.length, 32)
  assert.equal(frame.suffix.length, 32)
  assert.equal(frame.prefix, input.slice(0, 32))
  assert.equal(frame.suffix, input.slice(-33, -1))
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

test('malformed firmware JSON diagnostics include bounded context and frame type', () => {
  const prefix = '{"type":"STATUS","payload":"'
  const malformedProperty = '","broken"'
  const errorPosition = 247
  const payloadLength = errorPosition - prefix.length - malformedProperty.length
  const invalidHead = `${prefix}${'x'.repeat(payloadLength)}${malformedProperty}}`
  const line = `${invalidHead}${'z'.repeat(358 - invalidHead.length)}`
  assert.equal(line.length, 358)

  let parseError: unknown
  try {
    JSON.parse(line)
  } catch (error) {
    parseError = error
  }
  assert.ok(parseError instanceof SyntaxError)
  assert.match(parseError.message, /Expected ':' after property name.*position 247/)

  const diagnostic = getFirmwareJsonParseDiagnostic(
    line,
    parseError,
  )

  assert.equal(diagnostic.frameType, 'STATUS')
  assert.equal(diagnostic.position, 247)
  assert.ok(diagnostic.context.length <= 64)
  assert.ok(diagnostic.before.length <= 8)
  assert.ok(diagnostic.after.length <= 8)
  assert.match(diagnostic.message, /Expected ':' after property name/)
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
