import { EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import { IPC_CHANNELS } from '../shared/ipc'
import {
  isExperienceCommand,
  isExperienceMode,
  type ExperienceCommand,
} from '../shared/experience-application-contract'
import type { ExhibitionLifecycleController } from '../experience/exhibition-lifecycle-controller'
import type { ExperienceCoordinator } from './experience-coordinator'
import {
  dispatchExperienceCommand,
  dispatchLegacyExperienceCommand,
  type ExperienceCommandServices,
} from './experience-command-dispatcher'

export type ExperienceIpcHandler = (...args: unknown[]) => unknown

function payloadObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message)
  return value as Record<string, unknown>
}

function dispatchLegacy(
  command: ExperienceCommand,
  services: ExperienceCommandServices,
  coordinator: ExperienceCoordinator,
) {
  return dispatchLegacyExperienceCommand(command, services, coordinator)
}

export function createExperienceIpcHandlers(
  services: ExperienceCommandServices,
  coordinator: ExperienceCoordinator,
  exhibition?: ExhibitionLifecycleController,
): Record<string, ExperienceIpcHandler> {
  const dispatchAudienceCommand = (payload: unknown) => {
    if (!exhibition || !isExperienceCommand(payload)) {
      return dispatchExperienceCommand(payload, services, coordinator)
    }
    if (payload.type === 'STOP') {
      throw new Error('Audience STOP is unavailable during an exhibition experience.')
    }
    if (payload.mode === 'firmware' && (payload.type === 'SELECT' || payload.type === 'START')) {
      throw new Error('Firmware experience commands are unavailable to exhibition audiences.')
    }
    if (payload.mode === 'mock' && payload.type === 'SELECT') return exhibition.select(payload)
    if (payload.mode === 'mock' && payload.type === 'START') return exhibition.start(payload)
    return dispatchExperienceCommand(payload, services, coordinator)
  }
  const dispatchAudienceLegacy = async (command: ExperienceCommand) => {
    const result = await dispatchAudienceCommand(command)
    return 'accepted' in result ? result : result.acknowledgement
  }

  return {
    [IPC_CHANNELS.experienceGetSnapshot]: (mode: unknown) => {
      if (!isExperienceMode(mode)) throw new Error('A valid experience mode is required.')
      return coordinator.getSnapshot(mode)
    },
    [IPC_CHANNELS.exhibitionGetSnapshot]: () => {
      if (!exhibition) throw new Error('Exhibition lifecycle is unavailable.')
      return exhibition.getSnapshot()
    },
    [IPC_CHANNELS.experienceDispatch]: (payload: unknown) => dispatchAudienceCommand(payload),
    [IPC_CHANNELS.experienceSelect]: (payload: unknown) => {
      const request = payloadObject(payload, 'Experience selection payload is required.')
      if (!EXPERIENCE_IDS.includes(request.experienceId as ExperienceId) ||
          typeof request.requestId !== 'string') {
        throw new Error('Invalid experience selection request.')
      }
      return dispatchAudienceLegacy({
        type: 'SELECT',
        mode: 'mock',
        experienceId: request.experienceId as ExperienceId,
        requestId: request.requestId,
      })
    },
    [IPC_CHANNELS.experienceStart]: (payload: unknown) => {
      const request = payloadObject(payload, 'Start payload is required.')
      if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
        throw new Error('Invalid experience start request.')
      }
      return exhibition
        ? dispatchAudienceLegacy({
            type: 'START',
            mode: 'mock',
            requestId: request.requestId,
            operationId: request.operationId,
          })
        : dispatchLegacy({
            type: 'START',
            mode: 'mock',
            requestId: request.requestId,
            operationId: request.operationId,
          }, services, coordinator)
    },
    [IPC_CHANNELS.experienceStop]: (payload: unknown) => {
      const request = payloadObject(payload, 'Stop payload is required.')
      if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
        throw new Error('Invalid experience stop request.')
      }
      if (exhibition) throw new Error('Audience STOP is unavailable during an exhibition experience.')
      return dispatchLegacy({
        type: 'STOP',
        mode: 'mock',
        requestId: request.requestId,
        operationId: request.operationId,
      }, services, coordinator)
    },
    [IPC_CHANNELS.firmwareSelect]: (payload: unknown) => {
      const request = payloadObject(payload, 'Firmware selection payload is required.')
      if (!EXPERIENCE_IDS.includes(request.experienceId as ExperienceId) ||
          typeof request.requestId !== 'string') {
        throw new Error('Invalid firmware selection request.')
      }
      if (exhibition) throw new Error('Firmware experience commands are unavailable to exhibition audiences.')
      return dispatchLegacy({
        type: 'SELECT',
        mode: 'firmware',
        experienceId: request.experienceId as ExperienceId,
        requestId: request.requestId,
      }, services, coordinator)
    },
    [IPC_CHANNELS.firmwareStart]: (payload: unknown) => {
      const request = payloadObject(payload, 'Firmware start payload is required.')
      if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
        throw new Error('Invalid firmware start request.')
      }
      if (exhibition) throw new Error('Firmware experience commands are unavailable to exhibition audiences.')
      return dispatchLegacy({
        type: 'START',
        mode: 'firmware',
        requestId: request.requestId,
        operationId: request.operationId,
      }, services, coordinator)
    },
    [IPC_CHANNELS.firmwareStop]: (payload: unknown) => {
      const request = payloadObject(payload, 'Firmware stop payload is required.')
      if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
        throw new Error('Invalid firmware stop request.')
      }
      if (exhibition) throw new Error('Audience STOP is unavailable during an exhibition experience.')
      return dispatchLegacy({
        type: 'STOP',
        mode: 'firmware',
        requestId: request.requestId,
        operationId: request.operationId,
      }, services, coordinator)
    },
  }
}
