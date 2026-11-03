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

export const IPC_CHANNELS = {
  runtimeInfo: 'app:get-runtime-info',
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
  experienceGetState: 'experience:get-state',
  experienceState: 'experience:state',
  experienceSelect: 'experience:select',
  experienceStart: 'experience:start',
  experienceStop: 'experience:stop',
  experienceStatus: 'experience:status',
  experienceSimulateFault: 'experience:simulate-fault',
  experienceSimulateConnectionLoss: 'experience:simulate-connection-loss',
  experienceRecover: 'experience:recover',
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

export interface RuntimeInfo {
  appVersion: string
  platform: string
}

export interface NatureTouchApi {
  getRuntimeInfo(): Promise<RuntimeInfo>
  listSerialPorts(): Promise<SerialPortInfo[]>
  getSerialState(): Promise<SerialStateSnapshot>
  connectSerial(portPath: string, baudRate: number): Promise<SerialStateSnapshot>
  disconnectSerial(): Promise<SerialStateSnapshot>
  pingSerial(): Promise<DiagnosticReply>
  getDiagnosticStatus(): Promise<DiagnosticReply>
  onSerialState(listener: (snapshot: SerialStateSnapshot) => void): () => void
  getExperienceSnapshot(mode: ExperienceMode): Promise<ExperienceSnapshot>
  subscribeExperience(
    mode: ExperienceMode,
    listener: (event: ExperienceEvent) => void,
  ): Promise<() => void>
  dispatchExperienceCommand(command: ExperienceCommand): Promise<ExperienceCommandResult>
  getExperienceState(): Promise<DeviceExperienceSnapshot>
  onExperienceState(listener: (snapshot: DeviceExperienceSnapshot) => void): () => void
  selectExperience(experienceId: ExperienceId, requestId: RequestId): Promise<ExperienceAcknowledgement>
  startExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  stopExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  queryExperienceStatus(requestId: RequestId): Promise<ExperienceStatusResponse>
  simulateExperienceFault(code: string): Promise<DeviceExperienceSnapshot>
  simulateConnectionLoss(): Promise<DeviceExperienceSnapshot>
  recoverExperience(requestId: RequestId): Promise<ExperienceAcknowledgement>
  getFirmwareState(): Promise<FirmwareControlSnapshot>
  armFirmwareSimulationTest(loadsIsolated: boolean, simulationFirmwareConfirmed: boolean): Promise<FirmwareControlSnapshot>
  disarmFirmwareSimulationTest(): Promise<FirmwareControlSnapshot>
  connectFirmware(portPath: string, baudRate: number, loadsIsolated?: boolean, benchFixtureConfirmed?: boolean): Promise<FirmwareControlSnapshot>
  disconnectFirmware(): Promise<FirmwareControlSnapshot>
  onFirmwareState(listener: (snapshot: FirmwareControlSnapshot) => void): () => void
  selectFirmwareExperience(experienceId: ExperienceId, requestId: RequestId): Promise<ExperienceAcknowledgement>
  startFirmwareExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  stopFirmwareExperience(requestId: RequestId, operationId: OperationId): Promise<ExperienceAcknowledgement>
  queryFirmwareStatus(requestId: RequestId): Promise<ExperienceStatusResponse>
  recoverFirmware(requestId: RequestId, loadsIsolated?: boolean, simulationFirmwareConfirmed?: boolean): Promise<ExperienceAcknowledgement>
}
