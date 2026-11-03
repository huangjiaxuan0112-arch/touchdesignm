import type {
  ExperienceAcknowledgement,
  ExperienceStatusResponse,
} from '../../shared/experience-control-protocol'
import type { ExperienceId } from '../../shared/experience-definitions'
import type { FirmwareControlSnapshot } from '../../shared/firmware-control-protocol'
import type { SerialPortInfo } from '../../shared/serial-protocol'
import { FirmwareSessionController, type FirmwareServiceOptions } from './firmware-session-controller'
import type { SerialTransport } from './serial-transport'

export type FirmwareServiceListener = (snapshot: FirmwareControlSnapshot) => void

export class ArduinoFirmwareService {
  private readonly session: FirmwareSessionController

  constructor(transport: SerialTransport, options: FirmwareServiceOptions = {}) {
    this.session = new FirmwareSessionController(transport, options)
  }

  getSnapshot(): FirmwareControlSnapshot {
    return this.session.getSnapshot()
  }

  onStateChange(listener: FirmwareServiceListener): () => void {
    return this.session.onStateChange(listener)
  }

  listPorts(): Promise<SerialPortInfo[]> {
    return this.session.listPorts()
  }

  connect(portPath: string, baudRate?: number): Promise<FirmwareControlSnapshot> {
    return this.session.connect(portPath, baudRate)
  }

  disconnect(): Promise<FirmwareControlSnapshot> {
    return this.session.disconnect()
  }

  armSimulationTest(
    loadsIsolated: boolean,
    simulationFirmwareConfirmed: boolean,
  ): Promise<FirmwareControlSnapshot> {
    return this.session.armSimulationTest(loadsIsolated, simulationFirmwareConfirmed)
  }

  disarmSimulationTest(): FirmwareControlSnapshot {
    return this.session.disarmSimulationTest()
  }

  selectExperience(requestId: string, experienceId: ExperienceId): Promise<ExperienceAcknowledgement> {
    return this.session.selectExperience(requestId, experienceId)
  }

  start(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    return this.session.start(requestId, operationId)
  }

  stop(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    return this.session.stop(requestId, operationId)
  }

  queryStatus(requestId: string): Promise<ExperienceStatusResponse> {
    return this.session.queryStatus(requestId)
  }

  recover(
    requestId: string,
    confirmation?: { loadsIsolated: boolean; simulationFirmwareConfirmed: boolean },
  ): Promise<ExperienceAcknowledgement> {
    return this.session.recover(requestId, confirmation)
  }
}
