import type { ExperienceId } from '../shared/experience-definitions'
import {
  isExperienceCommand,
  type ExperienceCommandResult,
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

export async function dispatchExperienceCommand(
  payload: unknown,
  services: ExperienceCommandServices,
): Promise<ExperienceCommandResult> {
  if (!isExperienceCommand(payload)) throw new Error('Invalid experience command.')

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
