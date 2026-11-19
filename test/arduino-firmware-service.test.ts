import { ExhibitionLifecycleController } from '../desktop/experience/exhibition-lifecycle-controller'
import { ExperienceCoordinator } from '../desktop/electron/experience-coordinator'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArduinoFirmwareService } from '../desktop/electron/serial/arduino-firmware-service'
import { MockSerialTransport } from '../desktop/electron/serial/mock-serial-transport'

test('confirmed simulation recovery returns verified idle without arming, selecting or starting', async () => {
  const { transport, commands } = createFirmwareTransport({ initialState: 'FAULT' })
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    const count = commands.length
    await assert.rejects(service.recover('noConfirm'), /read-only/)
    await assert.rejects(service.recover('noIsolation', { loadsIsolated: false, simulationFirmwareConfirmed: true }), /read-only/)
    assert.equal(commands.length, count)
    assert.equal((await service.recover('recover', { loadsIsolated: true, simulationFirmwareConfirmed: true })).accepted, true)
    const state = service.getSnapshot()
    assert.equal(state.experience.state, 'IDLE')
    assert.equal(state.experience.selectedExperienceId, null)
    assert.equal(state.experience.operationId, null)
    assert.equal(state.simulationTestArmed, false)
    assert.deepEqual(commands.slice(count).map(line => JSON.parse(line).type), ['STATUS_QUERY', 'RECOVER', 'STATUS_QUERY'])
    await assert.rejects(service.start('start', 'op'), /read-only/)
  } finally { await service.disconnect() }
})

test('RECOVER NACK or unconfirmed idle preserves FAULT', async () => {
  for (const option of [{ rejectRecover: true }, { recoverWithoutTransition: true }]) {
    const { transport } = createFirmwareTransport({ initialState: 'FAULT', ...option })
    const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
    try {
      await service.connect('COM3')
      const operation = service.recover('recover', { loadsIsolated: true, simulationFirmwareConfirmed: true })
      if (option.rejectRecover) assert.equal((await operation).accepted, false)
      else await assert.rejects(operation, /safe idle was not confirmed/)
      assert.equal(service.getSnapshot().experience.state, 'FAULT')
      assert.equal(service.getSnapshot().simulationTestArmed, false)
    } finally { await service.disconnect() }
  }
})

test('lost post-recovery status never optimistically clears FAULT', async () => {
  let recovering = false
  const { transport } = createFirmwareTransport({ initialState: 'FAULT', onCommand: command => {
    if (command === 'RECOVER') recovering = true
  }, dropStatus: () => recovering })
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0, commandTimeoutMs: 20 })
  try {
    await service.connect('COM3')
    await assert.rejects(service.recover('recover', { loadsIsolated: true, simulationFirmwareConfirmed: true }), /Timed out/)
    assert.equal(service.getSnapshot().experience.state, 'FAULT')
    assert.equal(service.getSnapshot().identified, false)
  } finally { await service.disconnect() }
})

test('RECOVER confirmation cannot bypass missing simulation identity or disabled development controls', async () => {
  for (const option of [{ capabilities: [], allowSimulationTest: true }, { allowSimulationTest: false }]) {
    const { transport, commands } = createFirmwareTransport({ initialState: 'FAULT', ...option })
    const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: option.allowSimulationTest, connectSettleMs: 0 })
    try {
      await service.connect('COM3')
      await assert.rejects(service.recover('recover', { loadsIsolated: true, simulationFirmwareConfirmed: true }), /read-only/)
      assert.equal(commands.some(line => JSON.parse(line).type === 'RECOVER'), false)
    } finally { await service.disconnect() }
  }
})

test('read-only hardware integration blocks every mutation before serial write', async () => {
  const { transport, commands } = createFirmwareTransport({ initialState: 'RUNNING' })
  const service = new ArduinoFirmwareService(transport, { readOnly: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    const before = commands.length
    await assert.rejects(service.selectExperience('s1', 'WIND'), /read-only/)
    await assert.rejects(service.start('s2', 'o1'), /read-only/)
    await assert.rejects(service.stop('s3', 'o1'), /read-only/)
    await assert.rejects(service.recover('s4'), /read-only/)
    assert.equal(commands.length, before)
    await service.queryStatus('q1')
    assert.deepEqual(commands.map((line) => JSON.parse(line).type), ['IDENTIFY', 'STATUS_QUERY', 'STATUS_QUERY'])
    transport.lastConnection?.disconnect()
    assert.equal(service.getSnapshot().connectionState, 'faulted')
    assert.equal(service.getSnapshot().identified, false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(transport.opened.length, 1, 'USB loss must not reconnect automatically')
  } finally { await service.disconnect() }
})

function createFirmwareTransport(options: {
  omitStatusProgress?: boolean
  versionMetadata?: boolean
  identifyAs?: string
  identityOutputsEnabled?: boolean
  rejectRecover?: boolean
  recoverWithoutTransition?: boolean
  capabilities?: string[]
  statusOutputsEnabled?: () => boolean
  initialState?: string
  staleIdentityReply?: boolean
  legacyIdentityResponse?: boolean
  dropIdentify?: () => boolean
  dropStatus?: () => boolean
  onCommand?: (command: string) => void
  writeDelayMs?: number
  responseDelayMs?: number
  listPortsDelayMs?: number
  suppressResponseFor?: string[]
  onWrite?: (line: string, connection: import('../desktop/electron/serial/mock-serial-transport').MockSerialConnection) => void
} = {}) {
  let state = options.initialState ?? 'IDLE'
  let selectedExperience: string | null = null
  let operationId: string | null = null
  let requestCacheIndex = 0
  let startsExecuted = 0
  const requestCache: { requestId: string; signature: string; response: string }[] = []
  const operationHistory: string[] = []
  const commands: string[] = []
  const transport = new MockSerialTransport({
    respond: (line) => {
      commands.push(line)
      if (line === 'PING') return 'PONG'
      if (line.length > 159) {
        return JSON.stringify({ type: 'ERROR', code: 'LINE_TOO_LONG' })
      }
      let request: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return JSON.stringify({ type: 'ERROR', code: 'INVALID_SCHEMA' })
        }
        request = parsed as Record<string, unknown>
      } catch {
        return JSON.stringify({ type: 'ERROR', code: 'INVALID_SCHEMA' })
      }
      if (typeof request.type !== 'string' || typeof request.requestId !== 'string') {
        return JSON.stringify({ type: 'ERROR', code: 'INVALID_SCHEMA' })
      }
      const requestId = String(request.requestId)
      const command = String(request.type)
      options.onCommand?.(command)
      const payload = String(
        command === 'IDENTIFY' ? request.protocol
          : command === 'SELECT' ? request.experienceId
            : command === 'START' || command === 'STOP' ? request.operationId
              : '',
      )
      const signature = `${command}:${payload}`
      if (!['IDENTIFY', 'SELECT', 'START', 'STOP', 'STATUS_QUERY', 'RECOVER'].includes(command)) {
        return JSON.stringify({
          type: 'NACK',
          command: 'UNKNOWN',
          accepted: false,
          requestId,
          state,
          code: 'INVALID_COMMAND',
        })
      }
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(requestId)) {
        return JSON.stringify({ type: 'ERROR', code: 'INVALID_REQUEST_ID' })
      }
      const payloadKey = command === 'IDENTIFY' ? 'protocol'
        : command === 'SELECT' ? 'experienceId'
          : command === 'START' || command === 'STOP' ? 'operationId'
            : undefined
      if (payloadKey && (request[payloadKey] === undefined ||
          (command === 'IDENTIFY'
            ? typeof request[payloadKey] !== 'number'
            : typeof request[payloadKey] !== 'string'))) {
        return JSON.stringify({
          type: 'NACK',
          command,
          accepted: false,
          requestId,
          state,
          code: 'INVALID_SCHEMA',
        })
      }
      if (['SELECT', 'START', 'STOP'].includes(command) &&
          !/^[A-Za-z0-9_-]{1,16}$/.test(String(request[payloadKey ?? '']))) {
        return JSON.stringify({
          type: 'NACK',
          command,
          accepted: false,
          requestId,
          state,
          code: command === 'SELECT' ? 'UNKNOWN_EXPERIENCE' : 'INVALID_OPERATION_ID',
        })
      }
      const cached = requestCache.find((entry) => entry.requestId === requestId)
      if (cached) {
        if (cached.signature === signature) return cached.response
        return JSON.stringify({
          type: 'NACK',
          command,
          accepted: false,
          requestId,
          state,
          code: 'REQUEST_ID_REUSED',
        })
      }
      if (options.suppressResponseFor?.includes(command)) return undefined

      const cacheResponse = (response: string): string => {
        requestCache[requestCacheIndex] = { requestId, signature, response }
        requestCacheIndex = (requestCacheIndex + 1) % 4
        return response
      }

      if (command === 'IDENTIFY') {
        if (options.dropIdentify?.()) return undefined
        if (options.legacyIdentityResponse) return 'ERROR:UNKNOWN_COMMAND'
        if (request.protocol !== 2) {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'UNSUPPORTED_PROTOCOL',
          }))
        }
        const identity = JSON.stringify({
          type: 'ACK',
          command,
          accepted: true,
          requestId,
          state,
          protocol: 2,
          ...(options.versionMetadata ? { firmwareVersion:'3.0.0-c1',timelineVersion:'25s-12345678',sourceRevision:'5356f28e' } : {}),
          firmware: options.identifyAs ?? 'nature-touch-unified-simulation',
          hardwareOutputsEnabled: options.identityOutputsEnabled ?? false,
          capabilities: options.capabilities ?? ['WIND', 'WAVE', 'BUBBLE', 'SIMULATION_ONLY'],
        })
        return cacheResponse(options.staleIdentityReply
          ? `${JSON.stringify({ type: 'ACK', command, accepted: true, requestId: 'stale', state })}\n${identity}`
          : identity)
      }
      if (command === 'STATUS_QUERY') {
        if (options.dropStatus?.()) return undefined
        const acknowledgement = {
          type: 'ACK',
          command,
          accepted: true,
          requestId,
          state,
        }
        const snapshot = {
          hardwareOutputsEnabled: options.statusOutputsEnabled?.() ?? false,
          state,
          selectedExperienceId: selectedExperience,
          operationId,
          elapsedMs: 0,
          durationMs: selectedExperience === 'WIND' ? 25_000 : null,
          ...(options.omitStatusProgress ? {} : {progress:0}),
          faultCode: null,
        }
        return cacheResponse(`${JSON.stringify(acknowledgement)}\n${JSON.stringify({
          type: 'STATUS',
          requestId,
          acknowledgement,
          snapshot,
        })}`)
      }
      if (command === 'SELECT') {
        if (state !== 'IDLE' && state !== 'COMPLETED') {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'INVALID_STATE',
          }))
        }
        if (!['WIND', 'WAVE', 'BUBBLE'].includes(String(request.experienceId))) {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'UNKNOWN_EXPERIENCE',
          }))
        }
        selectedExperience = String(request.experienceId)
        state = 'IDLE'
      } else if (command === 'START') {
        if (!selectedExperience) {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'NO_EXPERIENCE_SELECTED',
          }))
        }
        if (state !== 'IDLE') {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'INVALID_STATE',
          }))
        }
        if (operationHistory.includes(String(request.operationId))) {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'OPERATION_ID_REUSED',
          }))
        }
        operationId = String(request.operationId)
        operationHistory.push(operationId)
        if (operationHistory.length > 4) operationHistory.shift()
        state = 'RUNNING'
        startsExecuted++
      } else if (command === 'STOP') {
        if (state !== 'RUNNING') {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'INVALID_STATE',
          }))
        }
        if (request.operationId !== operationId) {
          return cacheResponse(JSON.stringify({
            type: 'NACK',
            command,
            accepted: false,
            requestId,
            state,
            code: 'OPERATION_MISMATCH',
          }))
        }
        const stoppedOperation = operationId
        state = 'IDLE'
        operationId = null
        return cacheResponse([
          JSON.stringify({
            type: 'ACK',
            command,
            accepted: true,
            requestId,
            state: 'STOPPING',
            operationId: stoppedOperation,
          }),
          JSON.stringify({ type: 'EVENT', name: 'STOPPED', operationId: stoppedOperation }),
        ].join('\n'))
      } else if (command === 'RECOVER') {
        if (options.rejectRecover) return cacheResponse(JSON.stringify({ type: 'NACK', command, accepted: false, requestId, state, code: 'INVALID_STATE' }))
        if (options.recoverWithoutTransition) return cacheResponse(JSON.stringify({ type: 'ACK', command, accepted: true, requestId, state: 'IDLE' }))
        state = 'IDLE'
        selectedExperience = null
        operationId = null
      } else if (command !== 'STATUS_QUERY' && command !== 'IDENTIFY') {
        return cacheResponse(JSON.stringify({
          type: 'NACK',
          command: 'UNKNOWN',
          accepted: false,
          requestId,
          state,
          code: 'INVALID_COMMAND',
        }))
      }
      return cacheResponse(JSON.stringify({
        type: 'ACK',
        command,
        accepted: true,
        requestId,
        state,
        ...(operationId ? { operationId } : {}),
      }))
    },
    writeDelayMs: options.writeDelayMs,
    responseDelayMs: options.responseDelayMs,
    listPortsDelayMs: options.listPortsDelayMs,
    onWrite: options.onWrite,
  })
  return {
    transport,
    commands,
    get startsExecuted() { return startsExecuted },
    complete: () => {
      state = 'COMPLETED'
      transport.lastConnection?.emitData(JSON.stringify({type:'EVENT',name:'COMPLETED',operationId})+'\n')
    },
    reset: () => {
      state = 'IDLE'
      selectedExperience = null
      operationId = null
      operationHistory.length = 0
    },
  }
}

test('simulation arming requires every prerequisite and never starts on arm or reconnect', async () => {
  const { transport, commands } = createFirmwareTransport()
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
  try {
    await assert.rejects(service.armSimulationTest(true, true), /Identify/)
    await service.connect('COM3')
    await assert.rejects(service.armSimulationTest(false, true), /arming denied/)
    await assert.rejects(service.armSimulationTest(true, false), /arming denied/)
    await assert.rejects(service.selectExperience('s1', 'WIND'), /read-only/)
    assert.equal((await service.armSimulationTest(true, true)).simulationTestArmed, true)
    assert.equal(commands.some((line) => JSON.parse(line).type === 'START'), false)
    await service.selectExperience('s2', 'WIND')
    await service.start('s3', 'op1')
    assert.throws(() => service.disarmSimulationTest(), /STOP/)
    await assert.rejects(service.recover('s4'), /read-only/)
    await service.stop('s5', 'op1')
    service.disarmSimulationTest()
    await assert.rejects(service.selectExperience('s6', 'WAVE'), /read-only/)
    await service.armSimulationTest(true, true)
    transport.lastConnection?.disconnect()
    assert.equal(service.getSnapshot().simulationTestArmed, false)
    const count = commands.length
    await service.connect('COM3')
    assert.equal(service.getSnapshot().simulationTestArmed, false)
    assert.deepEqual(commands.slice(count).map((line) => JSON.parse(line).type), ['IDENTIFY', 'STATUS_QUERY'])
  } finally { await service.disconnect() }
})

test('simulation arming fails closed for absent capabilities, enabled outputs, or disabled development permission', async () => {
  for (const options of [
    { capabilities: [] }, { statusOutputsEnabled: () => true },
  ]) {
    const { transport, commands } = createFirmwareTransport(options)
    const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
    try {
      await service.connect('COM3')
      await assert.rejects(service.armSimulationTest(true, true), /arming denied/)
      assert.equal(commands.some((line) => JSON.parse(line).type === 'START'), false)
    } finally { await service.disconnect() }
  }
  const { transport } = createFirmwareTransport()
  const service = new ArduinoFirmwareService(transport, { readOnly: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    await assert.rejects(service.armSimulationTest(true, true), /arming denied/)
  } finally { await service.disconnect() }
})

test('loss of simulation-only status disarms and closes the session', async () => {
  let enabled = false
  const { transport } = createFirmwareTransport({ statusOutputsEnabled: () => enabled })
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    await service.armSimulationTest(true, true)
    enabled = true
    await assert.rejects(service.queryStatus('q1'), /flag lost/)
    assert.equal(service.getSnapshot().simulationTestArmed, false)
    assert.equal(service.getSnapshot().connectionState, 'faulted')
  } finally { await service.disconnect() }
})

test('one-shot run sends no periodic STATUS_QUERY and STOP remains available', async () => {
  const { transport, commands } = createFirmwareTransport({ responseDelayMs: 20 })
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowSimulationTest: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    await service.armSimulationTest(true, true)
    await service.selectExperience('s1', 'WIND')
    await service.start('s2', 'op1')
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.deepEqual(commands.map(line => JSON.parse(line).type), ['IDENTIFY', 'STATUS_QUERY', 'STATUS_QUERY', 'SELECT', 'START'])
    assert.equal((await service.stop('s3', 'op1')).accepted, true)
    assert.equal(service.getSnapshot().experience.state, 'IDLE')
  } finally { await service.disconnect() }
})

async function sendRawRequest(
  transport: MockSerialTransport,
  line: string,
): Promise<Record<string, unknown>[]> {
  const connection = await transport.open('COM3', 9600)
  let input = ''
  const messages: Record<string, unknown>[] = []
  const detach = connection.onData((chunk) => {
    input += chunk
    const lines = input.split('\n')
    input = lines.pop() ?? ''
    for (const responseLine of lines) {
      if (responseLine.trim()) messages.push(JSON.parse(responseLine.trim()) as Record<string, unknown>)
    }
  })
  await connection.write(line)
  await new Promise((resolve) => setTimeout(resolve, 0))
  detach()
  await connection.close()
  return messages
}

function createService(
  transport: MockSerialTransport,
  options: {
    commandTimeoutMs?: number
    identifyTimeoutMs?: number
    connectSettleMs?: number
    maxLineLength?: number
    onDiagnostic?: (event: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent) => void
  } = {},
) {
  return new ArduinoFirmwareService(transport, {
    connectSettleMs: options.connectSettleMs ?? 0,
    commandTimeoutMs: options.commandTimeoutMs ?? 100,
    identifyTimeoutMs: options.identifyTimeoutMs ?? options.commandTimeoutMs ?? 100,
    maxLineLength: options.maxLineLength,
    onDiagnostic: options.onDiagnostic,
  })
}

test('identifies protocol v2 before status or experience commands and ignores stale replies', async () => {
  const { transport, commands } = createFirmwareTransport({ staleIdentityReply: true })
  const service = createService(transport)
  const snapshot = await service.connect('COM3')
  assert.equal(snapshot.identified, true)
  assert.equal(snapshot.protocolVersion, 2)
  assert.deepEqual(
    commands.map((line) => (JSON.parse(line) as { type: string }).type),
    ['IDENTIFY', 'STATUS_QUERY'],
  )
  await service.selectExperience('r1', 'WIND')
  assert.equal((JSON.parse(commands[2]) as { type: string }).type, 'SELECT')
  await service.disconnect()
})

test('firmware request cache replays identical requests and rejects changed payloads', async () => {
  const { transport } = createFirmwareTransport()
  const select = '{"type":"SELECT","experienceId":"WIND","requestId":"same"}'
  const first = await sendRawRequest(transport, select)
  const replay = await sendRawRequest(transport, select)
  const reused = await sendRawRequest(
    transport,
    '{"type":"SELECT","experienceId":"WAVE","requestId":"same"}',
  )

  assert.deepEqual(replay, first)
  assert.equal(first[0].accepted, true)
  assert.equal(reused[0].type, 'NACK')
  assert.equal(reused[0].code, 'REQUEST_ID_REUSED')
})

test('duplicate START replays its ACK without executing twice', async () => {
  const firmware = createFirmwareTransport()
  const { transport } = firmware
  const service = createService(transport)
  await service.connect('COM3')
  await service.selectExperience('r1', 'WIND')
  const first = await service.start('r2', 'o1')
  const duplicate = await service.start('r2', 'o1')
  const changedPayload = await service.start('r2', 'o2')

  assert.deepEqual(duplicate, first)
  assert.equal(firmware.startsExecuted, 1)
  assert.equal(changedPayload.accepted, false)
  assert.equal(changedPayload.code, 'REQUEST_ID_REUSED')
  await service.disconnect()
})

test('firmware request cache retains four entries and evicts the oldest request', async () => {
  const { transport } = createFirmwareTransport()
  await sendRawRequest(transport, '{"type":"SELECT","experienceId":"WIND","requestId":"r1"}')
  for (const [requestId, experienceId] of [
    ['r2', 'WAVE'],
    ['r3', 'BUBBLE'],
    ['r4', 'WIND'],
    ['r5', 'WAVE'],
  ]) {
    await sendRawRequest(
      transport,
      JSON.stringify({ type: 'SELECT', experienceId, requestId }),
    )
  }

  const evicted = await sendRawRequest(
    transport,
    '{"type":"SELECT","experienceId":"BUBBLE","requestId":"r1"}',
  )
  assert.equal(evicted[0].type, 'ACK')
  assert.equal(evicted[0].accepted, true)
})

test('operation history prevents recent IDs from being started again', async () => {
  const { transport } = createFirmwareTransport()
  const select = await sendRawRequest(
    transport,
    '{"type":"SELECT","experienceId":"WIND","requestId":"select"}',
  )
  assert.equal(select[0].accepted, true)

  for (let index = 1; index <= 5; index++) {
    const started = await sendRawRequest(
      transport,
      JSON.stringify({ type: 'START', operationId: `o${index}`, requestId: `s${index}` }),
    )
    assert.equal(started[0].accepted, true)
    await sendRawRequest(
      transport,
      JSON.stringify({ type: 'STOP', operationId: `o${index}`, requestId: `t${index}` }),
    )
  }

  const recentlyUsed = await sendRawRequest(
    transport,
    '{"type":"START","operationId":"o2","requestId":"recent"}',
  )
  const evictedOperation = await sendRawRequest(
    transport,
    '{"type":"START","operationId":"o1","requestId":"old"}',
  )
  assert.equal(recentlyUsed[0].code, 'OPERATION_ID_REUSED')
  assert.equal(evictedOperation[0].accepted, true)
})

test('firmware rejects malformed requests with the existing protocol error codes', async () => {
  const { transport } = createFirmwareTransport()
  const cases: Array<[string, string, string | undefined]> = [
    ['{"type":"NOT_A_COMMAND","requestId":"r1"}', 'NACK', 'INVALID_COMMAND'],
    ['{"type":"SELECT","requestId":"r2"}', 'NACK', 'INVALID_SCHEMA'],
    ['{"type":"SELECT","experienceId":"WIND"}', 'ERROR', 'INVALID_SCHEMA'],
    ['{invalid json', 'ERROR', 'INVALID_SCHEMA'],
    ['{"type":"IDENTIFY","protocol":1,"requestId":"r3"}', 'NACK', 'UNSUPPORTED_PROTOCOL'],
    ['{"type":"SELECT","experienceId":"UNKNOWN","requestId":"r4"}', 'NACK', 'UNKNOWN_EXPERIENCE'],
    ['{"type":"START","operationId":"bad id","requestId":"r5"}', 'NACK', 'INVALID_OPERATION_ID'],
  ]

  for (const [request, type, code] of cases) {
    const [response] = await sendRawRequest(transport, request)
    assert.equal(response.type, type, request)
    assert.equal(response.code, code, request)
  }
})

test('firmware rejects an oversized serial input line and resumes at the next newline', async () => {
  const { transport } = createFirmwareTransport()
  const connection = await transport.open('COM3', 9600)
  let input = ''
  const responses: Record<string, unknown>[] = []
  connection.onData((chunk) => {
    input += chunk
    const lines = input.split('\n')
    input = lines.pop() ?? ''
    for (const responseLine of lines) {
      responses.push(JSON.parse(responseLine.trim()) as Record<string, unknown>)
    }
  })
  await connection.write('x'.repeat(160))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await connection.close()

  assert.equal(responses[0].type, 'ERROR')
  assert.equal(responses[0].code, 'LINE_TOO_LONG')
})

test('serial service handles split CRLF frames and asynchronous events among consecutive replies', async () => {
  const { transport } = createFirmwareTransport({
    suppressResponseFor: ['STATUS_QUERY'],
    onWrite: (line, connection) => {
      const request = JSON.parse(line) as { type: string; requestId: string }
      if (request.type !== 'STATUS_QUERY') return
      const acknowledgement = {
        type: 'ACK',
        command: request.type,
        accepted: true,
        requestId: request.requestId,
        state: 'IDLE',
      }
      const status = {
        type: 'STATUS',
        requestId: request.requestId,
        acknowledgement,
        snapshot: {
          state: 'IDLE',
          selectedExperienceId: null,
          operationId: null,
          elapsedMs: 0,
          durationMs: null,
          progress: 0,
          faultCode: null,
        },
      }
      const frames = `${JSON.stringify({
        type: 'EVENT',
        name: 'MARKER',
        text: 'INTERLEAVED EVENT',
      })}\r\n${JSON.stringify(acknowledgement)}\r\n${JSON.stringify(status)}\r\n`
      for (let index = 0; index < frames.length; index += 11) {
        connection.emitData(frames.slice(index, index + 11))
      }
    },
  })
  const service = createService(transport)
  const connected = await service.connect('COM3')
  assert.equal(connected.connectionState, 'connected')

  const status = await service.queryStatus('r1')
  assert.equal(status.snapshot.state, 'IDLE')
  assert.equal(service.getSnapshot().lastEvent, 'INTERLEAVED EVENT')
  await service.disconnect()
})

test('serial service faults and closes on an oversized response frame', async () => {
  const diagnostics: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent[] = []
  const { transport } = createFirmwareTransport({
    suppressResponseFor: ['STATUS_QUERY'],
    onWrite: (line, connection) => {
      if ((JSON.parse(line) as { type: string }).type === 'STATUS_QUERY') {
        connection.emitData(`${'x'.repeat(251)}\n`)
      }
    },
  })
  const service = createService(transport, {
    maxLineLength: 250,
    onDiagnostic: event => diagnostics.push(event),
  })
  await assert.rejects(service.connect('COM3'), /exceeded the maximum line length/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
  const oversizedDiagnostic = diagnostics.find(event => event.responseType === 'oversized')
  assert.ok(oversizedDiagnostic)
  if (!oversizedDiagnostic?.detail) throw new Error('Expected oversized RX diagnostic detail.')
  assert.match(oversizedDiagnostic.detail, /observed 251 characters/)
  assert.ok(oversizedDiagnostic.detail.length < 200)
})

test('358-character invalid frame is captured before JSON failure with bounded position-247 byte evidence and TX context', async () => {
  const diagnostics: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent[] = []
  const prefix = '{"type":"STATUS","payload":"'
  const property = '","broken"'
  const head = `${prefix}${'x'.repeat(247-prefix.length-property.length)}${property}}`
  const invalid = head + 'z'.repeat(358-head.length)
  const {transport} = createFirmwareTransport({suppressResponseFor:['STATUS_QUERY'],onWrite:(line,c)=>{
    const q=JSON.parse(line)
    if(q.type==='STATUS_QUERY') {
      c.emitData(JSON.stringify({type:'ACK',command:q.type,accepted:true,requestId:q.requestId,state:'IDLE'})+'\r\n')
      c.emitData(invalid.slice(0,247));c.emitData(invalid.slice(247)+'\r\n')
    }
  }})
  const service=createService(transport,{onDiagnostic:e=>diagnostics.push(e)})
  await assert.rejects(service.connect('COM3'),/Invalid firmware JSON/)
  const invalidEvent=diagnostics.find(e=>e.stage==='protocol.invalid')!
  assert.equal(invalidEvent.wire?.characters,358)
  assert.equal(invalidEvent.wire?.bytes,359) // Includes CR; LF is the delimiter.
  assert.equal(invalidEvent.wire?.position,247)
  assert.equal(invalidEvent.wire?.bytePosition,247)
  assert.equal(invalidEvent.wire?.before?.hex,Buffer.from(invalid.slice(215,247)).toString('hex'))
  assert.equal(invalidEvent.wire?.after?.hex,Buffer.from(invalid.slice(247,279)).toString('hex'))
  assert.equal(invalidEvent.wire?.terminator,'CRLF')
  assert.equal(invalidEvent.wire?.source,'reencoded-string')
  assert.equal(invalidEvent.wire?.tx?.at(-1)?.command,'STATUS_QUERY')
  assert.ok(diagnostics.findIndex(e=>e.stage==='response.frame'&&e.wire?.characters===358)<diagnostics.indexOf(invalidEvent))
  assert.equal(service.getSnapshot().experience.faultCode,'COMMUNICATION_FAILURE')
})

test('missing newline is captured as an unterminated bounded RX frame when the original command timeout fails closed', async()=>{
  const diagnostics: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent[]=[]
  const {transport}=createFirmwareTransport({suppressResponseFor:['STATUS_QUERY'],onWrite:(line,c)=>{
    if(JSON.parse(line).type==='STATUS_QUERY') c.emitData('{"type":"STATUS","partial":"'+'x'.repeat(5000))
  }})
  const service=createService(transport,{commandTimeoutMs:30,onDiagnostic:e=>diagnostics.push(e)})
  await assert.rejects(service.connect('COM3'),/Timed out/)
  const wire=diagnostics.find(e=>e.stage==='protocol.rx-aborted')?.wire
  assert.ok(wire&&wire.bytes>5000)
  assert.equal(wire.terminator,'NONE')
  assert.equal(wire.prefix?.hex.length,64)
  assert.equal(wire.suffix?.hex.length,64)
  assert.equal(service.getSnapshot().experience.faultCode,'COMMUNICATION_FAILURE')
})

test('requests made while disconnected are rejected without opening a port', async () => {
  const { transport } = createFirmwareTransport()
  const service = createService(transport)
  await assert.rejects(service.start('r1', 'o1'), /Identify the connected protocol v2 firmware/)
  assert.equal(transport.opened.length, 0)
})

test('rejects a connected board without the simulation-only firmware identity', async () => {
  const { transport, commands } = createFirmwareTransport({ identifyAs: 'other-firmware' })
  const service = createService(transport)
  await assert.rejects(service.connect('COM3'), /Incompatible firmware: expected output-disabled Nature Touch/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
  assert.equal(commands.length, 1)
})

test('waits for the Nano bootloader reset interval before sending IDENTIFY', async () => {
  let openedAt = 0
  let identifySentAt = 0
  const { transport } = createFirmwareTransport({
    onCommand: (command) => {
      if (command === 'IDENTIFY') identifySentAt = Date.now()
    },
  })
  const originalListPorts = transport.listPorts.bind(transport)
  transport.listPorts = async () => {
    openedAt = Date.now()
    return originalListPorts()
  }
  const service = createService(transport, {
    connectSettleMs: 30,
    identifyTimeoutMs: 100,
  })

  await service.connect('COM3')
  assert.ok(identifySentAt - openedAt >= 25)
  await service.disconnect()
})

test('reports Phase 1B diagnostic firmware as incompatible instead of waiting for IDENTIFY timeout', async () => {
  const { transport } = createFirmwareTransport({ legacyIdentityResponse: true })
  const service = createService(transport)
  await assert.rejects(
    service.connect('COM3'),
    /Incompatible firmware: the board returned Phase 1B text diagnostics/,
  )
  assert.equal(service.getSnapshot().experience.faultCode, 'INCOMPATIBLE_FIRMWARE')
  assert.equal(service.getSnapshot().connectionState, 'faulted')
})

test('IDENTIFY timeout closes the session and is recoverable only through explicit reconnect', async () => {
  let replyEnabled = false
  const { transport, commands } = createFirmwareTransport({
    dropIdentify: () => !replyEnabled,
  })
  const service = createService(transport, {
    commandTimeoutMs: 100,
    identifyTimeoutMs: 10,
  })
  await assert.rejects(service.connect('COM3'), /Timed out waiting for IDENTIFY/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
  assert.equal(service.getSnapshot().experience.faultCode, 'IDENTIFICATION_FAILED')

  replyEnabled = true
  const reconnect = await service.connect('COM3')
  assert.equal(reconnect.identified, true)
  assert.deepEqual(
    commands.slice(1).map((line) => (JSON.parse(line) as { type: string }).type),
    ['IDENTIFY', 'STATUS_QUERY'],
  )
  await service.disconnect()
})

test('a port disconnect during the IDENTIFY write rejects the pending command', async () => {
  const { transport } = createFirmwareTransport({
    writeDelayMs: 40,
    onWrite: (line, connection) => {
      if ((JSON.parse(line) as { type: string }).type === 'IDENTIFY') connection.disconnect()
    },
  })
  const service = createService(transport, {
    commandTimeoutMs: 100,
    identifyTimeoutMs: 100,
  })
  await assert.rejects(service.connect('COM3'), /Firmware serial port disconnected/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
  assert.equal(service.getSnapshot().identified, false)
})

test('rejects a concurrent connection attempt while the first port is opening', async () => {
  const { transport } = createFirmwareTransport()
  const originalListPorts = transport.listPorts.bind(transport)
  transport.listPorts = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return originalListPorts()
  }
  const service = createService(transport)
  const firstConnect = service.connect('COM3')
  await assert.rejects(service.connect('COM3'), /Disconnect the current firmware session/)
  await firstConnect
  assert.equal(transport.opened.length, 1)
  await service.disconnect()
})

test('selects, starts, stops, and waits for the correlated STOPPED event', async () => {
  const { transport } = createFirmwareTransport()
  const service = createService(transport)
  await service.connect('COM3')
  const selected = await service.selectExperience('r1', 'WAVE')
  assert.equal(selected.accepted, true)
  const started = await service.start('r2', 'o1')
  assert.equal(started.state, 'RUNNING')
  assert.equal(service.getSnapshot().experience.operationId, 'o1')
  const stopped = await service.stop('r3', 'o1')
  assert.equal(stopped.state, 'STOPPING')
  assert.equal(service.getSnapshot().experience.state, 'IDLE')
  assert.equal(service.getSnapshot().experience.operationId, null)
  assert.equal(service.getSnapshot().lastEvent, 'STOPPED')
  await service.disconnect()
})

test('reports correlated natural completion and scheduled diagnostic events', async () => {
  const { transport } = createFirmwareTransport()
  const service = createService(transport)
  await service.connect('COM3')
  await service.selectExperience('r1', 'WIND')
  await service.start('r2', 'o1')

  transport.lastConnection?.emitData(
    `${JSON.stringify({ type: 'EVENT', name: 'ACTUATOR_EVENT', operationId: 'o1', experienceId: 'WIND', atMs: 0, action: 'INFLATE', durationMs: 5000, D5: 180, D6: 180, D7: 0 })}\r\n`,
  )
  assert.match(service.getSnapshot().lastEvent ?? '', /diagnostic only/)

  transport.lastConnection?.emitData(
    `${JSON.stringify({ type: 'EVENT', name: 'COMPLETED', operationId: 'o1', experienceId: 'WIND' })}\r\n`,
  )
  assert.equal(service.getSnapshot().experience.state, 'COMPLETED')
  assert.equal(service.getSnapshot().experience.progress, 1)
  await service.disconnect()
})

test('rejects invalid-state commands and mismatched stop operation IDs', async () => {
  const { transport } = createFirmwareTransport()
  const service = createService(transport)
  await service.connect('COM3')
  const noSelection = await service.start('r1', 'o1')
  assert.equal(noSelection.accepted, false)
  assert.equal(noSelection.code, 'NO_EXPERIENCE_SELECTED')
  await service.selectExperience('r2', 'WIND')
  await service.start('r3', 'o2')
  const repeatedStart = await service.start('r4', 'o3')
  assert.equal(repeatedStart.accepted, false)
  assert.equal(repeatedStart.code, 'INVALID_STATE')
  const rejectedStop = await service.stop('r5', 'wrong-operation')
  assert.equal(rejectedStop.accepted, false)
  assert.equal(rejectedStop.code, 'OPERATION_MISMATCH')
  await service.stop('r6', 'o2')
  await assert.rejects(service.stop('r7', 'o2'), /no confirmed running operation/)
  await service.disconnect()
})

test('times out explicitly, faults the host session, and blocks future experience requests', async () => {
  let shouldDropStatus = false
  const { transport } = createFirmwareTransport({ dropStatus: () => shouldDropStatus })
  const service = createService(transport, { commandTimeoutMs: 15 })
  await service.connect('COM3')
  shouldDropStatus = true

  await assert.rejects(service.queryStatus('r1'), /Timed out waiting for STATUS_QUERY/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
  assert.equal(service.getSnapshot().experience.faultCode, 'COMMUNICATION_FAILURE')
  await assert.rejects(service.start('r2', 'o1'), /Identify the connected protocol v2 firmware/)
})

test('recovers from a communication fault only after explicit reconnect and never resends START', async () => {
  let statusAvailable = true
  const { transport, commands, reset } = createFirmwareTransport({
    dropStatus: () => !statusAvailable,
  })
  const service = createService(transport, { commandTimeoutMs: 15 })
  await service.connect('COM3')
  await service.selectExperience('r1', 'WIND')
  await service.start('r2', 'o1')
  statusAvailable = false
  await assert.rejects(service.queryStatus('r3'), /Timed out waiting for STATUS_QUERY/)
  assert.equal(service.getSnapshot().experience.state, 'FAULT')

  reset()
  statusAvailable = true
  const previousCommandCount = commands.length
  const recovered = await service.connect('COM3')
  assert.equal(recovered.experience.state, 'IDLE')
  assert.deepEqual(
    commands.slice(previousCommandCount).map((line) => (JSON.parse(line) as { type: string }).type),
    ['IDENTIFY', 'STATUS_QUERY'],
  )
  await service.disconnect()
})

test('USB loss during a one-shot run faults the host view without sending polling traffic', async () => {
  const { transport, commands } = createFirmwareTransport()
  const service = createService(transport)
  try {
    await service.connect('COM3')
    await service.selectExperience('r1', 'WIND')
    await service.start('r2', 'o1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.deepEqual(commands.map(line => JSON.parse(line).type), ['IDENTIFY', 'STATUS_QUERY', 'SELECT', 'START'])
    transport.lastConnection!.disconnect()
    assert.equal(service.getSnapshot().connectionState, 'faulted')
    assert.equal(service.getSnapshot().experience.faultCode, 'CONNECTION_LOST')
  } finally { await service.disconnect() }
})

test('serial transport errors are logged separately from response timeouts', async () => {
  const fixture = createFirmwareTransport(realIdentity)
  const diagnostics: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent[] = []
  const service = new ArduinoFirmwareService(fixture.transport, {
    readOnly: false,
    allowRealHardwareControl: true,
    connectSettleMs: 0,
    onDiagnostic: event => diagnostics.push(event),
  })
  try {
    await service.connect('COM3')
    await service.selectExperience('transport-select', 'WIND')
    await service.start('transport-start', 'transport-op')
    fixture.transport.lastConnection!.emitError(new Error('USB read failure'))
    assert.equal(service.getSnapshot().connectionState, 'faulted')
    assert.ok(diagnostics.some(event =>
      event.stage === 'transport.error' && event.detail === 'USB read failure',
    ))
    assert.ok(diagnostics.some(event =>
      event.stage === 'session.failure' &&
      event.responseType === 'COMMUNICATION_FAILURE' &&
      event.detail === 'USB read failure',
    ))
    assert.equal(diagnostics.some(event => event.stage === 'request.timeout'), false)
  } finally { await service.disconnect() }
})

test('reset and reconnect perform identify/status only and never resume the prior operation', async () => {
  const { transport, commands, reset } = createFirmwareTransport()
  const service = createService(transport)
  await service.connect('COM3')
  await service.selectExperience('r1', 'BUBBLE')
  await service.start('r2', 'o1')
  transport.lastConnection?.disconnect()
  reset()

  assert.equal(service.getSnapshot().experience.state, 'FAULT')
  const commandCountBeforeReconnect = commands.length
  const reconnected = await service.connect('COM3')
  assert.equal(reconnected.experience.state, 'IDLE')
  assert.equal(reconnected.experience.selectedExperienceId, null)
  assert.deepEqual(
    commands.slice(commandCountBeforeReconnect).map((line) => (JSON.parse(line) as { type: string }).type),
    ['IDENTIFY', 'STATUS_QUERY'],
  )
  await service.disconnect()
})

test('reconnect does not resume a firmware operation still reported as running', async () => {
  const { transport } = createFirmwareTransport()
  const service = createService(transport)
  await service.connect('COM3')
  await service.selectExperience('r1', 'WIND')
  await service.start('r2', 'o1')
  transport.lastConnection?.disconnect()

  const reconnected = await service.connect('COM3')
  assert.equal(reconnected.experience.state, 'FAULT')
  assert.equal(reconnected.experience.faultCode, 'RECONNECTED_WHILE_ACTIVE')
  assert.equal(reconnected.experience.operationId, 'o1')
  assert.match(reconnected.lastError ?? '', /was not resumed/)
  await service.stop('r3', 'o1')
  await service.disconnect()
})

test('recovers an explicitly faulted firmware state to IDLE without selecting a mode', async () => {
  const { transport } = createFirmwareTransport({ initialState: 'FAULT' })
  const service = createService(transport)
  const connected = await service.connect('COM3')
  assert.equal(connected.experience.state, 'FAULT')
  const recovered = await service.recover('r1')
  assert.equal(recovered.accepted, true)
  assert.equal(service.getSnapshot().experience.state, 'IDLE')
  assert.equal(service.getSnapshot().experience.selectedExperienceId, null)
  await service.disconnect()
})

const realIdentity = {
  identifyAs: 'nature-touch-unified-real',
  identityOutputsEnabled: true,
  statusOutputsEnabled: () => true,
  capabilities: ['WIND', 'WAVE', 'BUBBLE', 'REAL_ACTUATORS'],
}

test('real identity connects for status but cannot use simulation arming or default START', async () => {
  const { transport, commands } = createFirmwareTransport(realIdentity)
  const service = new ArduinoFirmwareService(transport, { readOnly: false, allowSimulationTest: true, connectSettleMs: 0 })
  try {
    const state = await service.connect('COM3')
    assert.equal(state.firmware, 'nature-touch-unified-real')
    assert.equal(state.hardwareOutputsEnabled, true)
    assert.equal(state.simulationTestEligible, false)
    await assert.rejects(service.armSimulationTest(true, true), /arming denied/)
    const before = commands.length
    await assert.rejects(service.selectExperience('realselect', 'WIND'), /Real actuator control is locked/)
    await assert.rejects(service.start('realstart', 'realop'), /Real actuator control is locked/)
    await assert.rejects(service.recover('realrecover'), /Real actuator control is locked/)
    assert.equal(commands.length, before)
  } finally { await service.disconnect() }
})

test('read-only real connection permits explicit STOP of a confirmed active operation', async () => {
  const { transport, commands } = createFirmwareTransport(realIdentity)
  const starter = new ArduinoFirmwareService(transport, { readOnly: false, allowRealHardwareControl: true,
    connectSettleMs: 0})
  await starter.connect('COM3')
  await starter.selectExperience('prepare', 'WIND')
  await starter.start('preparestart', 'active')
  await starter.disconnect()
  const before = commands.length
  const service = new ArduinoFirmwareService(transport, { readOnly: true, connectSettleMs: 0 })
  try {
    const state = await service.connect('COM3')
    assert.equal(state.experience.faultCode, 'RECONNECTED_WHILE_ACTIVE')
    assert.ok(state.experience.operationId)
    await service.stop('realstop', state.experience.operationId!)
    assert.equal(commands.slice(before).filter(line => JSON.parse(line).type === 'START').length, 0)
    assert.equal(service.getSnapshot().experience.state, 'IDLE')
  } finally { await service.disconnect() }
})

test('explicit real deployment permission enables protocol commands without automatic START', async () => {
  const { transport, commands } = createFirmwareTransport(realIdentity)
  const service = new ArduinoFirmwareService(transport, { readOnly: false, allowRealHardwareControl: true,
    connectSettleMs: 0})
  try {
    await service.connect('COM3')
    assert.deepEqual(commands.map(line => JSON.parse(line).type), ['IDENTIFY', 'STATUS_QUERY'])
    await service.selectExperience('realselect', 'WIND')
    assert.equal((await service.start('realstart', 'realop')).accepted, true)
    await service.stop('realstop', 'realop')
    assert.equal(service.getSnapshot().experience.state, 'IDLE')
  } finally { await service.disconnect() }
})

test('runtime RESET closes real session and never replays START or reconnects', async () => {
  const { transport, commands } = createFirmwareTransport(realIdentity)
  const service = new ArduinoFirmwareService(transport, { readOnly: false, allowRealHardwareControl: true,
    connectSettleMs: 0})
  try {
    await service.connect('COM3')
    await service.selectExperience('realselect', 'WIND')
    await service.start('realstart', 'realop')
    const before = commands.length
    transport.lastConnection?.emitData(JSON.stringify({ type: 'EVENT', name: 'READY', protocol: 2,
      deviceId: 'nature-touch-nano-real', hardwareOutputsEnabled: true }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(service.getSnapshot().experience.faultCode, 'DEVICE_RESET')
    assert.equal(service.getSnapshot().identified, false)
    assert.equal(commands.length, before)
    assert.equal(transport.opened.length, 1)
  } finally { await service.disconnect() }
})

test('real output status change invalidates identity instead of pretending physical OFF', async () => {
  let enabled = true
  const { transport } = createFirmwareTransport({ ...realIdentity, statusOutputsEnabled: () => enabled })
  const service = new ArduinoFirmwareService(transport, { connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    enabled = false
    await assert.rejects(service.queryStatus('changed'), /output capability changed/)
    assert.equal(service.getSnapshot().identified, false)
    assert.equal(service.getSnapshot().experience.state, 'FAULT')
  } finally { await service.disconnect() }
})

test('readOnly remains a real-control lock even when deployment option is supplied', async () => {
  const { transport, commands } = createFirmwareTransport(realIdentity)
  const service = new ArduinoFirmwareService(transport, { readOnly: true, allowRealHardwareControl: true, connectSettleMs: 0 })
  try {
    await service.connect('COM3')
    const before = commands.length
    await assert.rejects(service.start('locked', 'op'), /Real actuator control is locked/)
    assert.equal(commands.length, before)
  } finally { await service.disconnect() }
})

test('versioned identity is preserved and cleared on disconnect; legacy identities stay unknown',async()=>{
 for(const versionMetadata of [false,true]){
  const {transport}=createFirmwareTransport({versionMetadata})
  const service=new ArduinoFirmwareService(transport,{readOnly:true,connectSettleMs:0})
  const connected=await service.connect('COM3')
  assert.equal(connected.firmwareVersion,versionMetadata?'3.0.0-c1':null)
  assert.equal(connected.timelineVersion,versionMetadata?'25s-12345678':null)
  assert.equal(connected.sourceRevision,versionMetadata?'5356f28e':null)
  const disconnected=await service.disconnect()
  assert.equal(disconnected.firmwareVersion,null);assert.equal(disconnected.timelineVersion,null)
 }
})

for(const outcome of ['completed','disconnect'] as const) test('actual FirmwareService adapter lifecycle '+outcome+' uses device events and no automatic restart',async()=>{
 const fixture=createFirmwareTransport({versionMetadata:true})
 const service=new ArduinoFirmwareService(fixture.transport,{readOnly:true,allowSimulationTest:true,connectSettleMs:0})
 await service.connect('COM3');await service.armSimulationTest(true,true) // In-memory SIMULATION_ONLY fixture, no USB.
 let now=0,id=0;const timers=new Map<number,{at:number;fn:()=>void}>()
 const clock={now:()=>now,schedule:(fn:()=>void,delay:number)=>{const key=++id;timers.set(key,{at:now+delay,fn});return()=>{timers.delete(key)}}}
 const advance=(delta:number)=>{const end=now+delta;for(;;){const item=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;timers.delete(item[0]);now=item[1].at;item[1].fn()}now=end}
 const mock=new MockExperienceController({clock})
 const adapter={recover:(r:string)=>service.recover(r),selectExperience:(r:string,m:'WIND'|'WAVE'|'BUBBLE')=>service.selectExperience(r,m),start:(r:string,o:string)=>service.start(r,o),stop:(r:string,o:string)=>service.stop(r,o),queryStatus:(r:string)=>service.queryStatus(r),getExperienceSnapshot:()=>service.getSnapshot().experience,canStart:()=>true,onStateChange:(listener:()=>void)=>service.onStateChange(()=>listener())}
 const coordinator=new ExperienceCoordinator({mock:adapter,firmware:adapter})
 const lifecycle=new ExhibitionLifecycleController(coordinator,{getSnapshot:()=>service.getSnapshot().experience},clock,{mode:'firmware'})
 try{
  await lifecycle.select({type:'SELECT',mode:'firmware',experienceId:'WIND',requestId:'link-select'})
  await lifecycle.start({type:'START',mode:'firmware',requestId:'link-start',operationId:'link-op'})
  advance(10_000);assert.equal(lifecycle.getSnapshot().phase,'EXPERIENCE')
  if(outcome==='disconnect'){
   fixture.transport.lastConnection!.disconnect();assert.equal(lifecycle.getSnapshot().phase,'FAULT');advance(60_000);assert.equal(lifecycle.getSnapshot().phase,'FAULT')
  }else{
   advance(15_000);assert.equal(lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
   advance(5_000);assert.equal(lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
   fixture.complete();advance(0);assert.equal(lifecycle.getSnapshot().phase,'COOLDOWN')
   advance(2_999);assert.equal(lifecycle.getSnapshot().phase,'COOLDOWN');advance(1);assert.equal(lifecycle.getSnapshot().phase,'READY')
  }
  assert.equal(fixture.startsExecuted,1)
 }finally{lifecycle.dispose();coordinator.dispose();await service.disconnect()}
})

test('real v2 STATUS without progress is normalized for snapshots and subscribers',async()=>{
 const {transport}=createFirmwareTransport({omitStatusProgress:true})
 const service=new ArduinoFirmwareService(transport,{readOnly:true,connectSettleMs:0})
 const seen:number[]=[];service.onStateChange(s=>seen.push(s.experience.progress))
 try{const state=await service.connect('COM3');assert.equal(state.experience.progress,0)
 const status=await service.queryStatus('no-progress');assert.equal(status.snapshot.progress,0)
 assert.ok(seen.every(Number.isFinite))
 }finally{await service.disconnect()}
})


for (const code of ['HOST_TIMEOUT','ACTUATOR_FAULT']) test('async real firmware '+code+' latches immediately and ignores late COMPLETED',async()=>{
 const fixture=createFirmwareTransport(realIdentity)
 const diagnostics: import('../desktop/electron/serial/firmware-session-controller').FirmwareDiagnosticEvent[] = []
 const service=new ArduinoFirmwareService(fixture.transport,{readOnly:false,allowRealHardwareControl:true,connectSettleMs:0,onDiagnostic:event=>diagnostics.push(event)})
 try{
  await service.connect('COM3');await service.selectExperience('faultselect','WIND');await service.start('faultstart','faultop')
  const count=fixture.commands.length
  fixture.transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'FAULT',operationId:'faultop',code})+'\n')
  assert.equal(service.getSnapshot().experience.state,'FAULT','must consume asynchronous FAULT before the next status poll')
  assert.equal(service.getSnapshot().experience.faultCode,code)
  assert.ok(diagnostics.some(event=>event.stage==='firmware.fault'&&event.detail===code))
  assert.equal(diagnostics.some(event=>event.stage==='session.failure'),false,'firmware-reported FAULT is distinct from a host communication failure')
  assert.equal(service.getSnapshot().connectionState,'connected','a firmware FAULT is not a serial disconnect')
  fixture.transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'COMPLETED',operationId:'faultop'})+'\n')
  assert.equal(service.getSnapshot().experience.state,'FAULT','a late completion cannot clear the fault latch')
  assert.equal(fixture.commands.length,count,'handling fault must not auto START, RECOVER or reconnect')
 }finally{await service.disconnect()}
})
for(const command of ['SELECT','START'] as const)test('same-frame '+command+' ACK then FAULT cannot revive a real firmware operation',async()=>{
 let armed=false
 const fixture=createFirmwareTransport({...realIdentity,onWrite:(line,connection)=>{
  const request=JSON.parse(line)
  if(armed&&request.type===command){
   connection.emitData(JSON.stringify({type:'ACK',command,requestId:request.requestId,accepted:true,state:command==='START'?'RUNNING':'IDLE',...(command==='START'?{operationId:request.operationId}:{})})+'\n'+JSON.stringify({type:'EVENT',name:'FAULT',code:'ACTUATOR_FAULT',operationId:request.operationId??''})+'\n')
  }
 }})
 const service=new ArduinoFirmwareService(fixture.transport,{readOnly:false,allowRealHardwareControl:true,connectSettleMs:0})
 try{
  await service.connect('COM3');if(command==='START')await service.selectExperience('prerequisite','WIND');armed=true
  await assert.rejects(command==='SELECT'?service.selectExperience('ackfaultselect','WIND'):service.start('ackfaultstart','ackfaultop'),/fault/i)
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(service.getSnapshot().experience.state,'FAULT')
  assert.equal(service.getSnapshot().experience.faultCode,'ACTUATOR_FAULT')
 }finally{await service.disconnect()}
})

test('concurrent explicit STATUS reads serialize and preserve each request ID',async()=>{
 const fixture=createFirmwareTransport({...realIdentity,responseDelayMs:20})
 const service=new ArduinoFirmwareService(fixture.transport,{readOnly:true,connectSettleMs:0})
 try{
  await service.connect('COM3')
  const [first,second]=await Promise.all([service.queryStatus('status-one'),service.queryStatus('status-two')])
  assert.equal(first.requestId,'status-one');assert.equal(second.requestId,'status-two')
  assert.deepEqual(fixture.commands.slice(-2).map(x=>JSON.parse(x).requestId),['status-one','status-two'])
 }finally{await service.disconnect()}
})
test('late STATUS response cannot clear an asynchronous real firmware fault',async()=>{
 const fixture=createFirmwareTransport({...realIdentity,responseDelayMs:20})
 const service=new ArduinoFirmwareService(fixture.transport,{readOnly:false,allowRealHardwareControl:true,connectSettleMs:0})
 try{
  await service.connect('COM3');await service.selectExperience('statusfaultsel','WIND');await service.start('statusfaultstart','statusfaultop')
  const pending=service.queryStatus('old-status')
  fixture.transport.lastConnection!.emitData(JSON.stringify({type:'EVENT',name:'FAULT',operationId:'statusfaultop',code:'HOST_TIMEOUT'})+'\n')
  await pending
  assert.equal(service.getSnapshot().experience.state,'FAULT')
  assert.equal(service.getSnapshot().experience.faultCode,'HOST_TIMEOUT')
 }finally{await service.disconnect()}
})
