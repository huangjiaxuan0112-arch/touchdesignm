import { SerialPort } from 'serialport'
import type { SerialPortInfo } from '../../shared/serial-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

export class NativeSerialTransport implements SerialTransport {
  async listPorts(): Promise<SerialPortInfo[]> {
    const ports = await SerialPort.list()
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
      const port = new SerialPort({ path: portPath, baudRate, autoOpen: false })
      port.open((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(new NativeSerialConnection(port))
      })
    })
  }
}

class NativeSerialConnection implements SerialConnection {
  constructor(private readonly port: SerialPort) {}

  write(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(`${line}\n`, 'utf8'), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  close(): Promise<void> {
    if (!this.port.isOpen) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.port.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  onData(listener: (chunk: string) => void): () => void {
    const handler = (data: Buffer) => listener(data.toString('utf8'))
    this.port.on('data', handler)
    return () => this.port.off('data', handler)
  }

  onError(listener: (error: Error) => void): () => void {
    this.port.on('error', listener)
    return () => this.port.off('error', listener)
  }

  onClose(listener: () => void): () => void {
    this.port.on('close', listener)
    return () => this.port.off('close', listener)
  }
}