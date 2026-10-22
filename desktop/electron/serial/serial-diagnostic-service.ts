import {
  DEFAULT_SERIAL_BAUD_RATE,
  type DiagnosticCommand,
  type DiagnosticReply,
  type DiagnosticResponse,
  type SerialPortInfo,
  type SerialStateSnapshot,
} from '../../shared/serial-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

interface ServiceOptions {
  commandTimeoutMs?: number
  connectSettleMs?: number
  maxLineLength?: number
}

interface PendingRequest {
  command: DiagnosticCommand
  startedAt: number
  resolve: (reply: DiagnosticReply) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type StateListener = (snapshot: SerialStateSnapshot) => void

const EXPECTED_RESPONSES: Record<DiagnosticCommand, DiagnosticResponse> = {
  PING: 'PONG',
  STATUS: 'STATUS:DIAGNOSTIC_READY',
}

export class SerialDiagnosticService {
  private snapshot: SerialStateSnapshot = { state: 'disconnected' }
  private connection: SerialConnection | undefined
  private detachConnectionListeners: (() => void)[] = []
  private pendingRequest: PendingRequest | undefined
  private readonly stateListeners = new Set<StateListener>()
  private inputLine = ''
  private discardingLongLine = false
  private readonly commandTimeoutMs: number
  private readonly connectSettleMs: number
  private readonly maxLineLength: number

  constructor(
    private readonly transport: SerialTransport,
    options: ServiceOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 1500
    this.connectSettleMs = options.connectSettleMs ?? 1500
    this.maxLineLength = options.maxLineLength ?? 128
  }

  getState(): SerialStateSnapshot {
    return { ...this.snapshot }
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  listPorts(): Promise<SerialPortInfo[]> {
    return this.transport.listPorts()
  }

  async connect(
    portPath: string,
    baudRate = DEFAULT_SERIAL_BAUD_RATE,
  ): Promise<SerialStateSnapshot> {
    if (this.connection || this.snapshot.state === 'connecting') {
      throw new Error('Disconnect the current serial session before connecting another port.')
    }
    if (!portPath.trim()) throw new Error('Select a serial port first.')
    if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 2_000_000) {
      throw new Error('Baud rate must be an integer between 300 and 2000000.')
    }

    this.updateState({ state: 'connecting', portPath, baudRate, lastError: undefined })

    try {
      const ports = await this.transport.listPorts()
      if (!ports.some((port) => port.path === portPath)) {
        throw new Error(`Serial port ${portPath} is not currently available.`)
      }

      const connection = await this.transport.open(portPath, baudRate)
      this.connection = connection
      this.detachConnectionListeners = [
        connection.onData((chunk) => this.consumeData(connection, chunk)),
        connection.onError((error) => this.handleConnectionError(connection, error)),
        connection.onClose(() => this.handleConnectionClose(connection)),
      ]

      await this.delay(this.connectSettleMs)
      if (this.connection !== connection) {
        throw new Error('Serial port disconnected during connection startup.')
      }

      this.updateState({ state: 'connected', portPath, baudRate, lastError: undefined })
      return this.getState()
    } catch (error) {
      const message = this.errorMessage(error)
      if (this.connection) {
        const connection = this.connection
        this.detachListeners()
        this.connection = undefined
        void connection.close().catch(() => undefined)
      }
      this.updateState({ state: 'error', portPath, baudRate, lastError: message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<SerialStateSnapshot> {
    const connection = this.connection
    this.rejectPending(new Error('Serial connection was disconnected.'))
    this.inputLine = ''
    this.discardingLongLine = false

    if (!connection) {
      this.detachListeners()
      this.updateState({ state: 'disconnected' })
      return this.getState()
    }

    this.updateState({ ...this.snapshot, state: 'disconnecting', lastError: undefined })
    this.detachListeners()
    this.connection = undefined

    try {
      await connection.close()
      this.updateState({ state: 'disconnected' })
      return this.getState()
    } catch (error) {
      const message = this.errorMessage(error)
      this.updateState({ state: 'error', lastError: message })
      throw new Error(message)
    }
  }

  ping(): Promise<DiagnosticReply> {
    return this.request('PING')
  }

  getDiagnosticStatus(): Promise<DiagnosticReply> {
    return this.request('STATUS')
  }

  private request(command: DiagnosticCommand): Promise<DiagnosticReply> {
    const connection = this.connection
    if (!connection || this.snapshot.state !== 'connected') {
      return Promise.reject(new Error('Connect to a serial port before sending diagnostics.'))
    }
    if (this.pendingRequest) {
      return Promise.reject(new Error('Wait for the current diagnostic request to finish.'))
    }

    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequest?.startedAt !== startedAt) return
        this.failConnection(
          connection,
          new Error(`Timed out waiting for ${EXPECTED_RESPONSES[command]}. Reconnect before retrying.`),
        )
      }, this.commandTimeoutMs)

      this.pendingRequest = { command, startedAt, resolve, reject, timeout }
      void connection.write(command).catch((error: unknown) => {
        this.failConnection(connection, new Error(this.errorMessage(error)))
      })
    })
  }

  private consumeData(connection: SerialConnection, chunk: string): void {
    if (connection !== this.connection) return

    for (const character of chunk) {
      if (character === '\n') {
        if (this.discardingLongLine) {
          this.discardingLongLine = false
          this.inputLine = ''
          this.failPending(new Error('Diagnostic response exceeded the maximum line length.'))
          continue
        }

        const line = this.inputLine.replace(/\r$/, '')
        this.inputLine = ''
        if (line.length > 0) this.handleLine(line)
        continue
      }

      if (this.discardingLongLine) continue
      this.inputLine += character
      if (this.inputLine.length > this.maxLineLength) {
        this.inputLine = ''
        this.discardingLongLine = true
      }
    }
  }

  private handleLine(line: string): void {
    const pending = this.pendingRequest
    if (!pending) return

    const expected = EXPECTED_RESPONSES[pending.command]
    if (line !== expected) {
      this.failConnection(
        this.connection,
        new Error(`Invalid response to ${pending.command}: received "${line}".`),
      )
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequest = undefined
    const reply: DiagnosticReply = {
      command: pending.command,
      response: expected,
      roundTripMs: Date.now() - pending.startedAt,
    }
    this.updateState({ ...this.snapshot, lastResponse: line, lastError: undefined })
    pending.resolve(reply)
  }

  private handleConnectionError(connection: SerialConnection, error: Error): void {
    this.failConnection(connection, error)
  }

  private handleConnectionClose(connection: SerialConnection): void {
    if (connection !== this.connection) return
    this.rejectPending(new Error('Serial port disconnected.'))
    this.connection = undefined
    this.detachListeners()
    this.inputLine = ''
    this.discardingLongLine = false
    this.updateState({
      state: 'disconnected',
      lastError: 'Serial port disconnected.',
    })
  }

  private failConnection(connection: SerialConnection | undefined, error: Error): void {
    if (!connection || connection !== this.connection) return
    this.rejectPending(error)
    this.connection = undefined
    this.detachListeners()
    this.inputLine = ''
    this.discardingLongLine = false
    this.updateState({
      state: 'error',
      portPath: this.snapshot.portPath,
      baudRate: this.snapshot.baudRate,
      lastError: error.message,
    })
    void connection.close().catch(() => undefined)
  }

  private failPending(error: Error): void {
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingRequest
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pendingRequest = undefined
    pending.reject(error)
  }

  private detachListeners(): void {
    for (const detach of this.detachConnectionListeners) detach()
    this.detachConnectionListeners = []
  }

  private updateState(snapshot: SerialStateSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.stateListeners) listener(this.getState())
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}