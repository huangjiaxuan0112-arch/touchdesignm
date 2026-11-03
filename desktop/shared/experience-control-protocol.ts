import type { ExperienceId } from './experience-definitions'

export const EXPERIENCE_PROTOCOL_VERSION = 2

export type ExperienceControlState = 'IDLE' | 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'FAULT'
export type RequestId = string
export type OperationId = string

export type ExperienceCommandName =
  | 'IDENTIFY'
  | 'SELECT'
  | 'START'
  | 'STOP'
  | 'STATUS_QUERY'
  | 'RECOVER'

export type FirmwareProtocolCommand =
  | { type: 'IDENTIFY'; protocol: number; requestId: RequestId }
  | { type: 'SELECT'; experienceId: ExperienceId; requestId: RequestId }
  | { type: 'START'; operationId: OperationId; requestId: RequestId }
  | { type: 'STOP'; operationId: OperationId; requestId: RequestId }
  | { type: 'STATUS_QUERY'; requestId: RequestId }
  | { type: 'RECOVER'; requestId: RequestId }

export type ExperienceCommand = FirmwareProtocolCommand

export interface ExperienceSnapshot {
  state: ExperienceControlState
  selectedExperienceId: ExperienceId | null
  operationId: OperationId | null
  elapsedMs: number
  durationMs: number | null
  progress: number
  faultCode: string | null
}

export interface ExperienceAcknowledgement {
  type: 'ACK' | 'NACK'
  requestId: RequestId
  command: ExperienceCommandName
  accepted: boolean
  state: ExperienceControlState
  operationId?: OperationId
  code?: string
}

export interface ExperienceStatusResponse {
  type: 'STATUS'
  requestId: RequestId
  acknowledgement: ExperienceAcknowledgement
  snapshot: ExperienceSnapshot
}

export type FirmwareProtocolEvent =
  | { type: 'READY'; deviceId: string; protocol: number }
  | { type: 'COMPLETED'; operationId: OperationId; experienceId: ExperienceId }
  | { type: 'STOPPED'; operationId: OperationId }
  | { type: 'ERROR'; code: string; operationId?: OperationId }

export type ExperienceEvent = FirmwareProtocolEvent