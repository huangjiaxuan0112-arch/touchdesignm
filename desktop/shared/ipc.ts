import type {
  DiagnosticReply,
  SerialPortInfo,
  SerialStateSnapshot,
} from './serial-protocol'
import type { ExperienceId } from './experience-definitions'
import type {
  ExperienceAcknowledgement,
  ExperienceSnapshot as DeviceExperienceSnapshot,
  ExperienceStatusResponse,
  OperationId,
  RequestId,
} from './experience-control-protocol'
import type {
  ExperienceCommand,
  ExperienceCommandResult,
  ExperienceEvent,
  ExperienceMode,
  ExperienceSnapshot,
} from './experience-application-contract'
import type { FirmwareControlSnapshot } from './firmware-control-protocol'
import type { ExhibitionLifecycleSnapshot } from './exhibition-lifecycle'

export const IPC_CHANNELS = {
  runtimeInfo: 'app:get-runtime-info',
  logMediaError: 'app:log-media-error',
  serialListPorts: 'serial:list-ports',
  serialGetState: 'serial:get-state',
  serialConnect: 'serial:connect',
  serialDisconnect: 'serial:disconnect',
  serialPing: 'serial:ping',
  serialStatus: 'serial:status',
  serialState: 'serial:state',
  experienceGetSnapshot: 'experience:get-snapshot',
  experienceDispatch: 'experience:dispatch',
  experienceEvent: 'experience:event',
  exhibitionGetSnapshot: 'exhibition:get-snapshot',
  exhibitionEvent: 'exhibition:event',
  experienceGetState: 'experience:get-state',
  experienceSelect: 'experience:select',
  experienceStart: 'experience:start',
  experienceStop: 'experience:stop',
  experienceSimulateFault: 'experience:simulate-fault',
  experienceSimulateConnectionLoss: 'experience:simulate-connection-loss',
  firmwareGetState: 'firmware:get-state',
  firmwareArmSimulation: 'firmware:arm-simulation',
  firmwareDisarmSimulation: 'firmware:disarm-simulation',
  firmwareConnect: 'firmware:connect',
  firmwareDisconnect: 'firmware:disconnect',
  firmwareSelect: 'firmware:select',
  firmwareStart: 'firmware:start',
  firmwareStop: 'firmware:stop',
  firmwareStatus: 'firmware:status',
  firmwareRecover: 'firmware:recover',
  firmwareState: 'firmware:state',
} as const

export type MediaErrorCode =
  | 'audio-load-failed'
  | 'audio-play-failed'
  | 'audio-position-invalid'
  | 'experience-start-failed'
  | 'media-prepare-failed'
  | 'video-load-failed'
  | 'video-play-failed'

export interface RuntimeInfo {
  appVersion: string
  platform: string
}

export interface NatureTouchApi {
  getRuntimeInfo(): Promise<RuntimeInfo>
  logMediaError(code: MediaErrorCode): Promise<void>
  listSerialPorts(): Promise<SerialPortInfo[]>
  getSerialState(): Promise<SerialStateSnapshot>
  connectSerial(portPath: string, baudRate: number): Promise<SerialStateSnapshot>
  disconnectSerial(): Promise<SerialStateSnapshot>
  pingSerial(): Promise<DiagnosticReply>
  getDiagnosticStatus(): Promise<DiagnosticReply>
  onSerialState(listener: (snapshot: SerialStateSnapshot) => void): () => void
  getExperienceSnapshot(mode: ExperienceMode): Promise<ExperienceSnapshot>
  getExhibitionSnapshot(): Promise<ExhibitionLifecycleSnapshot>
  subscribeExhibition(
    listener: (snapshot: ExhibitionLifecycleSnapshot) => void,
  ): Promise<() => void>
  subscribeExperience(
    mode: ExperienceMode,
    listener: (event: ExperienceEvent) => void,
  ): Promise<() => void>
  dispatchExperienceCommand(command: ExperienceCommand): Promise<ExperienceCommandResult>
  getExperienceState(): Promise<DeviceExperienceSnapshot>
  selectExperience(experienceId: ExperienceId, requestId: RequestId): Promise<ExperienceAcknowledgement>
  startExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  stopExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  simulateExperienceFault(code: string): Promise<DeviceExperienceSnapshot>
  simulateConnectionLoss(): Promise<DeviceExperienceSnapshot>
  getFirmwareState(): Promise<FirmwareControlSnapshot>
  armFirmwareSimulationTest(loadsIsolated: boolean, simulationFirmwareConfirmed: boolean): Promise<FirmwareControlSnapshot>
  disarmFirmwareSimulationTest(): Promise<FirmwareControlSnapshot>
  connectFirmware(
    portPath: string,
    baudRate: number,
    loadsIsolated?: boolean,
    benchFixtureConfirmed?: boolean,
  ): Promise<FirmwareControlSnapshot>
  disconnectFirmware(): Promise<FirmwareControlSnapshot>
  onFirmwareState(listener: (snapshot: FirmwareControlSnapshot) => void): () => void
  selectFirmwareExperience(experienceId: ExperienceId, requestId: RequestId): Promise<ExperienceAcknowledgement>
  startFirmwareExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  stopFirmwareExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  queryFirmwareStatus(requestId: RequestId): Promise<ExperienceStatusResponse>
  recoverFirmware(requestId: RequestId, loadsIsolated?: boolean, simulationFirmwareConfirmed?: boolean): Promise<ExperienceAcknowledgement>
}
