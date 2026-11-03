import type { ExperienceId } from '../shared/experience-definitions'
import {
  isExperienceCommand,
  type ExperienceCommand,
  type ExperienceCommandResult,
  type ExperienceMode,
  type ExperienceSnapshot,
} from '../shared/experience-application-contract'
import type {
  ExperienceAcknowledgement,
  ExperienceStatusResponse,
} from '../shared/experience-control-protocol'

export interface ExperienceCommandService {
  selectExperience(requestId: string, experienceId: ExperienceId):
    ExperienceAcknowledgement | Promise<ExperienceAcknowledgement>
  start(requestId: string, operationId: string):
    ExperienceAcknowledgement | Promise<ExperienceAcknowledgement>
  stop(requestId: string, operationId: string):
    ExperienceAcknowledgement | Promise<ExperienceAcknowledgement>
  queryStatus(requestId: string): ExperienceStatusResponse | Promise<ExperienceStatusResponse>
}

export interface ExperienceCommandServices {
  mock: ExperienceCommandService
  firmware: ExperienceCommandService
}

export interface ExperienceCommandCoordinator {
  getSnapshot(mode: ExperienceMode): ExperienceSnapshot
  select(command: ExperienceCommand): Promise<ExperienceAcknowledgement>
  start(command: ExperienceCommand): Promise<ExperienceAcknowledgement>
  stop(command: ExperienceCommand): Promise<ExperienceCommandResult>
}

export async function dispatchExperienceCommand(
  payload: unknown,
  services: ExperienceCommandServices,
  coordinator?: ExperienceCommandCoordinator,
): Promise<ExperienceCommandResult> {
  if (!isExperienceCommand(payload)) throw new Error('Invalid experience command.')

  if (coordinator) {
    switch (payload.type) {
      case 'SELECT':
        return coordinator.select(payload)
      case 'START':
        return coordinator.start(payload)
      case 'STOP':
        return coordinator.stop(payload)
      case 'STATUS':
        break
    }
  }

  const service = payload.mode === 'mock' ? services.mock : services.firmware
  switch (payload.type) {
    case 'SELECT':
      return await service.selectExperience(payload.requestId, payload.experienceId)
    case 'START':
      return await service.start(payload.requestId, payload.operationId)
    case 'STOP':
      return await service.stop(payload.requestId, payload.operationId)
    case 'STATUS':
      return await service.queryStatus(payload.requestId)
  }
}

export async function dispatchLegacyExperienceCommand(
  command: ExperienceCommand,
  services: ExperienceCommandServices,
  coordinator: ExperienceCommandCoordinator,
): Promise<ExperienceAcknowledgement> {
  const result = await dispatchExperienceCommand(command, services, coordinator)
  if ('snapshot' in result && command.type === 'STOP') {
    const inactive = result.snapshot.state === 'IDLE' || result.snapshot.state === 'COMPLETED'
    const accepted = result.acknowledgement.accepted && inactive
    return {
      type: accepted ? 'ACK' : 'NACK',
      command: 'STOP',
      requestId: command.requestId,
      accepted,
      state: result.snapshot.state,
      operationId: command.operationId,
      ...(!accepted
        ? { code: result.snapshot.faultCode ?? result.acknowledgement.code ?? 'STOP_UNCONFIRMED' }
        : {}),
    }
  }
  return 'accepted' in result ? result : result.acknowledgement
}
