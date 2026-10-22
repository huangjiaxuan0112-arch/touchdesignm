import type {
  DiagnosticReply,
  SerialPortInfo,
  SerialStateSnapshot,
} from './serial-protocol'
import type { ExperienceId } from './experience-definitions'
import type {
  ExperienceAcknowledgement,
  ExperienceSnapshot,
  ExperienceStatusResponse,
} from './experience-control-protocol'

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
  getExperienceState(): Promise<ExperienceSnapshot>
  onExperienceState(listener: (snapshot: ExperienceSnapshot) => void): () => void
  selectExperience(experienceId: ExperienceId, requestId: string): Promise<ExperienceAcknowledgement>
  startExperience(requestId: string, operationId: string): Promise<ExperienceAcknowledgement>
  stopExperience(requestId: string, operationId: string): Promise<ExperienceAcknowledgement>
  queryExperienceStatus(requestId: string): Promise<ExperienceStatusResponse>
  simulateExperienceFault(code: string): Promise<ExperienceSnapshot>
  simulateConnectionLoss(): Promise<ExperienceSnapshot>
  recoverExperience(requestId: string): Promise<ExperienceAcknowledgement>
}