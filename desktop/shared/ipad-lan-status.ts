import type { ExhibitionLifecycleSnapshot } from './exhibition-lifecycle'
import type { ExperienceControlState } from './experience-control-protocol'
import type { FirmwareConnectionState } from './firmware-control-protocol'

// A projection of existing Main state, not another lifecycle or hardware permission.
export interface IpadLanRuntimeStatus {
  runtimeMode: 'mock' | 'exhibition'
  deviceSource: 'mock' | 'firmware'
  deviceReady: boolean
  device: {
    connectionState: FirmwareConnectionState | 'simulated' | 'unknown'
    identified: boolean
    state: ExperienceControlState | 'UNKNOWN'
    firmware: string | null
    firmwareVersion: string | null
    verified: boolean
    hardwareOutputsEnabled: boolean | null
  }
}

export interface IpadLanSnapshot extends ExhibitionLifecycleSnapshot, IpadLanRuntimeStatus {
  /** Lifecycle revision is unchanged; revision is the existing SSE transport sequence. */
  lifecycleRevision: number
  canSelect: boolean
}
