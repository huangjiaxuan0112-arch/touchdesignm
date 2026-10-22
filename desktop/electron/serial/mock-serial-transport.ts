import type { SerialPortInfo } from '../../shared/serial-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

type MockResponse = string | undefined

export class MockSerialConnection implements SerialConnection {
  private readonly dataListeners = new Set<(chunk: string) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  constructor(
    private readonly respond: (line: string) => MockResponse,
    private readonly writeDelayMs = 0,
    private readonly responseDelayMs = 0,
    private readonly onWrite?: (line: string, connection: MockSerialConnection) => void,
  ) {}

  async write(line: string): Promise<void> {
    if (this.closed) throw new Error('Mock serial port is closed.')
    this.onWrite?.(line, this)
    if (this.writeDelayMs > 0) await this.delay(this.writeDelayMs)
    if (this.closed) throw new Error('Mock serial port disconnected during write.')
    const response = this.respond(line)
    if (response !== undefined) {
      if (this.responseDelayMs > 0) {
        setTimeout(() => this.emitData(`${response}\r\n`), this.responseDelayMs)
      } else {
        queueMicrotask(() => this.emitData(`${response}\r\n`))
      }
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

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }
}

export interface MockSerialTransportOptions {
  ports?: SerialPortInfo[]
  respond?: (line: string) => MockResponse
  writeDelayMs?: number
  responseDelayMs?: number
  listPortsDelayMs?: number
  openDelayMs?: number
  onWrite?: (line: string, connection: MockSerialConnection) => void
}

export class MockSerialTransport implements SerialTransport {
  readonly opened: { portPath: string; baudRate: number }[] = []
  lastConnection: MockSerialConnection | undefined
  private readonly ports: SerialPortInfo[]
  private readonly respond: (line: string) => MockResponse
  private readonly writeDelayMs: number
  private readonly responseDelayMs: number
  private readonly listPortsDelayMs: number
  private readonly openDelayMs: number
  private readonly onWrite: MockSerialTransportOptions['onWrite']

  constructor(options: MockSerialTransportOptions = {}) {
    this.ports = options.ports ?? [{ path: 'COM3', manufacturer: 'Mock Arduino' }]
    this.writeDelayMs = options.writeDelayMs ?? 0
    this.responseDelayMs = options.responseDelayMs ?? 0
    this.listPortsDelayMs = options.listPortsDelayMs ?? 0
    this.openDelayMs = options.openDelayMs ?? 0
    this.onWrite = options.onWrite
    this.respond = options.respond ?? ((line) => {
      if (line === 'PING') return 'PONG'
      if (line === 'STATUS') return 'STATUS:DIAGNOSTIC_READY'
      return undefined
    })
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    if (this.listPortsDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.listPortsDelayMs))
    return this.ports.map((port) => ({ ...port }))
  }

  async open(portPath: string, baudRate: number): Promise<SerialConnection> {
    if (this.openDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.openDelayMs))
    this.opened.push({ portPath, baudRate })
    this.lastConnection = new MockSerialConnection(
      this.respond,
      this.writeDelayMs,
      this.responseDelayMs,
      this.onWrite,
    )
    return this.lastConnection
  }
}