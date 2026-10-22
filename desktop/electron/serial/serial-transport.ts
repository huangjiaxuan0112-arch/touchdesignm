import type { SerialPortInfo } from '../../shared/serial-protocol'

export interface SerialConnection {
  write(line: string): Promise<void>
  close(): Promise<void>
  onData(listener: (chunk: string) => void): () => void
  onError(listener: (error: Error) => void): () => void
  onClose(listener: () => void): () => void
}

export interface SerialTransport {
  listPorts(): Promise<SerialPortInfo[]>
  open(portPath: string, baudRate: number): Promise<SerialConnection>
}