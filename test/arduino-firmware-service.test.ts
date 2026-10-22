import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArduinoFirmwareService } from '../desktop/electron/serial/arduino-firmware-service'
import { MockSerialTransport } from '../desktop/electron/serial/mock-serial-transport'

function createFirmwareTransport(options: {
  identifyAs?: string
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
          firmware: options.identifyAs ?? 'nature-touch-unified-simulation',
          hardwareOutputsEnabled: false,
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
          state,
          selectedExperienceId: selectedExperience,
          operationId,
          elapsedMs: 0,
          durationMs: selectedExperience === 'WIND' ? 24_000 : null,
          progress: 0,
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
    reset: () => {
      state = 'IDLE'
      selectedExperience = null
      operationId = null
      operationHistory.length = 0
    },
  }
}

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
    heartbeatIntervalMs?: number
    maxLineLength?: number
  } = {},
) {
  return new ArduinoFirmwareService(transport, {
    connectSettleMs: options.connectSettleMs ?? 0,
    commandTimeoutMs: options.commandTimeoutMs ?? 100,
    identifyTimeoutMs: options.identifyTimeoutMs ?? options.commandTimeoutMs ?? 100,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 10_000,
    maxLineLength: options.maxLineLength,
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
  const { transport } = createFirmwareTransport({
    suppressResponseFor: ['STATUS_QUERY'],
    onWrite: (line, connection) => {
      if ((JSON.parse(line) as { type: string }).type === 'STATUS_QUERY') {
        connection.emitData(`${'x'.repeat(25)}\n`)
      }
    },
  })
  const service = createService(transport, { maxLineLength: 24 })
  await assert.rejects(service.connect('COM3'), /exceeded the maximum line length/)
  assert.equal(service.getSnapshot().connectionState, 'faulted')
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

test('status heartbeat faults a running host session when replies stop arriving', async () => {
  let shouldDropStatus = false
  const { transport } = createFirmwareTransport({ dropStatus: () => shouldDropStatus })
  const service = createService(transport, {
    commandTimeoutMs: 15,
    heartbeatIntervalMs: 5,
  })
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    await service.connect('COM3')
    await service.selectExperience('r1', 'WIND')
    await service.start('r2', 'o1')
    shouldDropStatus = true
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(service.getSnapshot().connectionState, 'faulted')
    assert.equal(service.getSnapshot().experience.faultCode, 'COMMUNICATION_FAILURE')
  } finally {
    console.error = originalConsoleError
  }
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
