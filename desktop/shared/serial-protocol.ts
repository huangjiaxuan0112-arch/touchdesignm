export const DEVICE_MODES = ['WIND', 'WAVE', 'BUBBLE'] as const

export type DeviceMode = (typeof DEVICE_MODES)[number]

export type DeviceState =
  | 'disconnected'
  | 'connecting'
  | 'connected_not_ready'
  | 'ready'
  | 'preparing'
  | 'prepared'
  | 'running'
  | 'stopping'
  | 'faulted'

export type DeviceCommand =
  | { type: 'HELLO'; protocol: 1; requestId: string }
  | { type: 'STATUS'; requestId: string }
  | { type: 'PREPARE'; mode: DeviceMode; requestId: string }
  | { type: 'START'; requestId: string }
  | { type: 'CANCEL'; requestId: string }

export type DeviceMessage =
  | {
      type: 'ACK'
      command: DeviceCommand['type']
      requestId: string
      state: DeviceState
      firmware?: string
    }
  | { type: 'EVENT'; name: 'READY' | 'STARTED'; requestId: string; mode: DeviceMode }
  | { type: 'EVENT'; name: 'STOPPED'; requestId: string }
  | {
      type: 'ERROR'
      requestId: string
      code: string
      state: DeviceState
    }

export const DEFAULT_SERIAL_BAUD_RATE = 9600

export type DiagnosticCommand = 'PING' | 'STATUS'

export type DiagnosticResponse = 'PONG' | 'STATUS:DIAGNOSTIC_READY'

export type SerialConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export interface SerialStateSnapshot {
  state: SerialConnectionState
  portPath?: string
  baudRate?: number
  lastResponse?: string
  lastError?: string
}

export interface DiagnosticReply {
  command: DiagnosticCommand
  response: DiagnosticResponse
  roundTripMs: number
}