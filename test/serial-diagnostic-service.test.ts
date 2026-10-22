import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SerialDiagnosticService } from '../desktop/electron/serial/serial-diagnostic-service'
import { MockSerialTransport } from '../desktop/electron/serial/mock-serial-transport'

test('connects only to a discovered port and completes PING and STATUS', async () => {
  const transport = new MockSerialTransport()
  const service = new SerialDiagnosticService(transport, { connectSettleMs: 0 })

  await service.connect('COM3')
  assert.deepEqual(transport.opened, [{ portPath: 'COM3', baudRate: 9600 }])
  assert.equal((await service.ping()).response, 'PONG')
  assert.equal((await service.getDiagnosticStatus()).response, 'STATUS:DIAGNOSTIC_READY')
  await service.disconnect()
  assert.equal(service.getState().state, 'disconnected')
})

test('rejects a port that was not discovered', async () => {
  const service = new SerialDiagnosticService(new MockSerialTransport(), { connectSettleMs: 0 })

  await assert.rejects(service.connect('COM99'), /not currently available/)
  assert.equal(service.getState().state, 'error')
})

test('times out and closes the session when a diagnostic reply is missing', async () => {
  const transport = new MockSerialTransport({ respond: () => undefined })
  const service = new SerialDiagnosticService(transport, {
    connectSettleMs: 0,
    commandTimeoutMs: 20,
  })
  await service.connect('COM3')

  await assert.rejects(service.ping(), /Timed out waiting for PONG/)
  assert.equal(service.getState().state, 'error')
})

test('rejects invalid response and closes the session', async () => {
  const transport = new MockSerialTransport({ respond: () => 'READY' })
  const service = new SerialDiagnosticService(transport, { connectSettleMs: 0 })
  await service.connect('COM3')

  await assert.rejects(service.ping(), /Invalid response to PING/)
  assert.equal(service.getState().state, 'error')
})

test('reports disconnection and rejects a pending diagnostic', async () => {
  const transport = new MockSerialTransport({ respond: () => undefined })
  const service = new SerialDiagnosticService(transport, { connectSettleMs: 0 })
  await service.connect('COM3')
  const pendingPing = service.ping()

  transport.lastConnection?.disconnect()

  await assert.rejects(pendingPing, /Serial port disconnected/)
  assert.equal(service.getState().state, 'disconnected')
})

test('requires an explicit reconnect after USB disconnection', async () => {
  const transport = new MockSerialTransport()
  const service = new SerialDiagnosticService(transport, { connectSettleMs: 0 })
  await service.connect('COM3')
  transport.lastConnection?.disconnect()
  assert.equal(service.getState().state, 'disconnected')

  await service.connect('COM3')
  assert.equal(service.getState().state, 'connected')
  assert.equal(transport.opened.length, 2)
  assert.equal((await service.ping()).response, 'PONG')
})