import { SerialPort } from 'serialport'
import type { SerialPortInfo } from '../../shared/serial-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

interface NativePort {
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
}

interface NativeSerialPortAdapter {
  list(): Promise<SerialPortInfo[]>
  create(options: { path: string; baudRate: number; autoOpen: false }): NativePort
}

export class NativeSerialTransport implements SerialTransport {
  constructor(
    private readonly adapter: NativeSerialPortAdapter = {
      list: () => SerialPort.list(),
      create: (options) => new SerialPort(options),
    },
  ) {}

  async listPorts(): Promise<SerialPortInfo[]> {
    const ports = await this.adapter.list()
    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      vendorId: port.vendorId,
      productId: port.productId,
      serialNumber: port.serialNumber,
    }))
  }

  open(portPath: string, baudRate: number): Promise<SerialConnection> {
    return new Promise((resolve, reject) => {
      const port = this.adapter.create({ path: portPath, baudRate, autoOpen: false })
      const connection = new NativeSerialConnection(port)
      let settled = false
      const failOpen = (error: Error): void => {
        if (settled) return
        settled = true
        connection.close().catch((closeError: unknown) => {
          console.error('Failed to close serial port after open error:', closeError)
        })
        reject(error)
      }

      connection.onError(failOpen)
      try {
        port.open((error) => {
          if (error) {
            failOpen(error)
            return
          }
          if (settled) {
            connection.close().catch((closeError: unknown) => {
              console.error('Failed to close serial port after an open race:', closeError)
            })
            return
          }
          settled = true
          resolve(connection)
        })
      } catch (error) {
        failOpen(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

class NativeSerialConnection implements SerialConnection {
  private readonly dataListeners = new Set<(chunk: string) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly pendingWriteRejectors = new Set<(error: Error) => void>()
  private writeQueue: Promise<void> = Promise.resolve()
  private closing = false
  private closed = false
  private lastError: Error | undefined

  constructor(private readonly port: NativePort) {
    port.on('data', this.handleData)
    port.on('error', this.handleError)
    port.on('close', this.handleClose)
  }

  write(line: string): Promise<void> {
    if (this.closing || this.closed || this.lastError || !this.port.isOpen) {
      return Promise.reject(new Error('Cannot write because the serial port is closed.'))
    }

    const operation = this.writeQueue.then(() => this.writeFrame(Buffer.from(`${line}\n`, 'utf8')))
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }

  close(): Promise<void> {
    if (this.closed || !this.port.isOpen) {
      this.closing = true
      this.closed = true
      this.rejectPendingWrites(new Error('Serial port closed before the pending write completed.'))
      this.removePortListeners()
      return Promise.resolve()
    }
    if (this.closing) return Promise.resolve()
    this.closing = true
    this.rejectPendingWrites(new Error('Serial port closed before the pending write completed.'))
    return new Promise((resolve, reject) => {
      this.port.close((error) => {
        if (error) {
          this.closing = false
          reject(error)
        } else {
          this.closed = true
          this.removePortListeners()
          resolve()
        }
      })
    })
  }

  onData(listener: (chunk: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    if (this.lastError) {
      const error = this.lastError
      queueMicrotask(() => this.notifyListener(() => listener(error), 'error'))
    }
    return () => this.errorListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    if (this.closed) queueMicrotask(listener)
    return () => this.closeListeners.delete(listener)
  }

  private readonly handleData = (data: Buffer): void => {
    const chunk = data.toString('utf8')
    for (const listener of this.dataListeners) {
      this.notifyListener(() => listener(chunk), 'data')
    }
  }

  private readonly handleError = (error: Error): void => {
    this.lastError = error
    this.rejectPendingWrites(error)
    for (const listener of this.errorListeners) {
      this.notifyListener(() => listener(error), 'error')
    }
  }

  private readonly handleClose = (): void => {
    this.closed = true
    this.closing = true
    this.rejectPendingWrites(new Error('Serial port closed before the pending write completed.'))
    this.removePortListeners()
    for (const listener of this.closeListeners) {
      this.notifyListener(listener, 'close')
    }
  }

  private writeFrame(data: Buffer): Promise<void> {
    if (this.closing || this.closed || this.lastError || !this.port.isOpen) {
      return Promise.reject(
        this.lastError ?? new Error('Cannot write because the serial port is closed.'),
      )
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: Error | null): void => {
        if (settled) return
        settled = true
        this.pendingWriteRejectors.delete(rejectPending)
        if (error) reject(error)
        else resolve()
      }
      const rejectPending = (error: Error): void => finish(error)
      this.pendingWriteRejectors.add(rejectPending)

      try {
        this.port.write(data, (writeError) => {
          if (writeError) {
            finish(writeError)
            return
          }
          if (this.closing || this.closed || !this.port.isOpen) {
            finish(new Error('Serial port closed before the write completed.'))
            return
          }
          try {
            this.port.drain((drainError) => finish(drainError))
          } catch (drainError) {
            finish(drainError instanceof Error ? drainError : new Error(String(drainError)))
          }
        })
      } catch (writeError) {
        finish(writeError instanceof Error ? writeError : new Error(String(writeError)))
      }
    })
  }

  private rejectPendingWrites(error: Error): void {
    for (const reject of [...this.pendingWriteRejectors]) reject(error)
  }

  private removePortListeners(): void {
    this.port.off('data', this.handleData)
    this.port.off('error', this.handleError)
    this.port.off('close', this.handleClose)
  }

  private notifyListener(listener: () => void, eventName: string): void {
    try {
      listener()
    } catch (error) {
      console.error(`Serial ${eventName} listener failed:`, error)
    }
  }
}