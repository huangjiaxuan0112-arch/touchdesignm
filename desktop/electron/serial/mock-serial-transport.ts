import type { SerialPortInfo } from '../../shared/serial-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

type MockResponse = string | undefined

export class MockSerialConnection implements SerialConnection {
  private readonly dataListeners = new Set<(chunk: string) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  constructor(private readonly respond: (line: string) => MockResponse) {}

  async write(line: string): Promise<void> {
    if (this.closed) throw new Error('Mock serial port is closed.')
    const response = this.respond(line)
    if (response !== undefined) {
      queueMicrotask(() => this.emitData(`${response}\r\n`))
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners) listener()
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  emitData(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk)
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }

  disconnect(): void {
    void this.close()
  }
}

export interface MockSerialTransportOptions {
  ports?: SerialPortInfo[]
  respond?: (line: string) => MockResponse
}

export class MockSerialTransport implements SerialTransport {
  readonly opened: { portPath: string; baudRate: number }[] = []
  lastConnection: MockSerialConnection | undefined
  private readonly ports: SerialPortInfo[]
  private readonly respond: (line: string) => MockResponse

  constructor(options: MockSerialTransportOptions = {}) {
    this.ports = options.ports ?? [{ path: 'COM3', manufacturer: 'Mock Arduino' }]
    this.respond = options.respond ?? ((line) => {
      if (line === 'PING') return 'PONG'
      if (line === 'STATUS') return 'STATUS:DIAGNOSTIC_READY'
      return undefined
    })
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    return this.ports.map((port) => ({ ...port }))
  }

  async open(portPath: string, baudRate: number): Promise<SerialConnection> {
    this.opened.push({ portPath, baudRate })
    this.lastConnection = new MockSerialConnection(this.respond)
    return this.lastConnection
  }
}