import type { ExperienceId } from './experience-definitions'

export const EXPERIENCE_PROTOCOL_VERSION = 2

export type ExperienceControlState = 'IDLE' | 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'FAULT'

export type ExperienceCommandName =
  | 'IDENTIFY'
  | 'SELECT'
  | 'START'
  | 'STOP'
  | 'STATUS_QUERY'
  | 'RECOVER'

export type ExperienceCommand =
  | { type: 'IDENTIFY'; protocol: number; requestId: string }
  | { type: 'SELECT'; experienceId: ExperienceId; requestId: string }
  | { type: 'START'; operationId: string; requestId: string }
  | { type: 'STOP'; operationId: string; requestId: string }
  | { type: 'STATUS_QUERY'; requestId: string }
  | { type: 'RECOVER'; requestId: string }

export interface ExperienceSnapshot {
  state: ExperienceControlState
  selectedExperienceId: ExperienceId | null
  operationId: string | null
  elapsedMs: number
  durationMs: number | null
  progress: number
  faultCode: string | null
}

export interface ExperienceAcknowledgement {
  type: 'ACK' | 'NACK'
  requestId: string
  command: ExperienceCommandName
  accepted: boolean
  state: ExperienceControlState
  operationId?: string
  code?: string
}

export interface ExperienceStatusResponse {
  type: 'STATUS'
  requestId: string
  acknowledgement: ExperienceAcknowledgement
  snapshot: ExperienceSnapshot
}

export type ExperienceEvent =
  | { type: 'READY'; deviceId: string; protocol: number }
  | { type: 'COMPLETED'; operationId: string; experienceId: ExperienceId }
  | { type: 'STOPPED'; operationId: string }
  | { type: 'ERROR'; code: string; operationId?: string }