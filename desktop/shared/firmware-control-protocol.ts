import type { ExperienceSnapshot } from './experience-control-protocol'

export type FirmwareConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'faulted'

export interface FirmwareControlSnapshot {
  connectionState: FirmwareConnectionState
  identified: boolean
  protocolVersion: number | null
  firmware: string | null
  hardwareOutputsEnabled: false
  experience: ExperienceSnapshot
  lastEvent: string | null
  lastError: string | null
}

export const INITIAL_FIRMWARE_CONTROL_SNAPSHOT: FirmwareControlSnapshot = {
  connectionState: 'disconnected',
  identified: false,
  protocolVersion: null,
  firmware: null,
  hardwareOutputsEnabled: false,
  experience: {
    state: 'IDLE',
    selectedExperienceId: null,
    operationId: null,
    elapsedMs: 0,
    durationMs: null,
    progress: 0,
    faultCode: null,
  },
  lastEvent: null,
  lastError: null,
}
