import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NativeSerialTransport } from '../desktop/electron/serial/native-serial-transport'

const require = createRequire(import.meta.url)
interface MockPort {
  readonly isOpen: boolean
  open(callback: (error?: Error | null) => void): void
  close(callback: (error?: Error | null) => void): void
  write(data: Buffer, callback: (error?: Error | null) => void): void
  drain(callback: (error?: Error | null) => void): void
  on(event: 'data', listener: (data: Buffer) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: () => void): this
  off(event: 'data', listener: (data: Buffer) => void): this
  off(event: 'error', listener: (error: Error) => void): this
  off(event: 'close', listener: () => void): this
  emit(event: string, error: Error): boolean
}
const { SerialPortMock } = require('../desktop/node_modules/serialport') as {
  SerialPortMock: {
    binding: {
      reset(): void
      createPort(path: string, options: { echo: boolean }): void
    }
    new (options: { path: string; baudRate: number; autoOpen: false }): MockPort
  }
}

test('handles native SerialPort errors and rejects active writes without an uncaught error event', async () => {
  SerialPortMock.binding.reset()
  SerialPortMock.binding.createPort('COM_NATIVE', { echo: false })
  let nativePort: InstanceType<typeof SerialPortMock> | undefined
  const transport = new NativeSerialTransport({
    list: async () => [{ path: 'COM_NATIVE' }],
    create: (options) => {
      nativePort = new SerialPortMock(options)
      return nativePort
    },
  })
  const connection = await transport.open('COM_NATIVE', 9600)
  let emittedError: Error | undefined
  connection.onError((error) => {
    emittedError = error
  })

  const pendingWrite = connection.write('{"type":"IDENTIFY"}')
  nativePort?.emit('error', new Error('Operation aborted'))

  await assert.rejects(pendingWrite, /Operation aborted/)
  assert.equal(emittedError?.message, 'Operation aborted')
  await connection.close()
})

test('cancels queued writes when a native serial port closes', async () => {
  SerialPortMock.binding.reset()
  SerialPortMock.binding.createPort('COM_CLOSE', { echo: false })
  const transport = new NativeSerialTransport({
    list: async () => [{ path: 'COM_CLOSE' }],
    create: (options) => new SerialPortMock(options),
  })
  const connection = await transport.open('COM_CLOSE', 9600)
  const pendingWrite = connection.write('{"type":"IDENTIFY"}')

  await connection.close()

  await assert.rejects(pendingWrite, /closed/)
})

test('frames native serial writes with one newline delimiter', async () => {
  SerialPortMock.binding.reset()
  SerialPortMock.binding.createPort('COM_FRAME', { echo: true })
  const transport = new NativeSerialTransport({
    list: async () => [{ path: 'COM_FRAME' }],
    create: (options) => new SerialPortMock(options),
  })
  const connection = await transport.open('COM_FRAME', 9600)
  let received = ''
  connection.onData((chunk) => {
    received += chunk
  })

  await connection.write('{"type":"IDENTIFY"}')
  await new Promise((resolve) => setTimeout(resolve, 0))
  await connection.close()

  assert.equal(received, '{"type":"IDENTIFY"}\n')
})
