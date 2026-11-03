import { EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import { IPC_CHANNELS } from '../shared/ipc'
import {
  isExperienceMode,
  type ExperienceCommand,
} from '../shared/experience-application-contract'
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
): Record<string, ExperienceIpcHandler> {
  return {
    [IPC_CHANNELS.experienceGetSnapshot]: (mode: unknown) => {
      if (!isExperienceMode(mode)) throw new Error('A valid experience mode is required.')
      return coordinator.getSnapshot(mode)
    },
    [IPC_CHANNELS.experienceDispatch]: (payload: unknown) =>
      dispatchExperienceCommand(payload, services, coordinator),
    [IPC_CHANNELS.experienceSelect]: (payload: unknown) => {
      const request = payloadObject(payload, 'Experience selection payload is required.')
      if (!EXPERIENCE_IDS.includes(request.experienceId as ExperienceId) ||
          typeof request.requestId !== 'string') {
        throw new Error('Invalid experience selection request.')
      }
      return dispatchLegacy({
        type: 'SELECT',
        mode: 'mock',
        experienceId: request.experienceId as ExperienceId,
        requestId: request.requestId,
      }, services, coordinator)
    },
    [IPC_CHANNELS.experienceStart]: (payload: unknown) => {
      const request = payloadObject(payload, 'Start payload is required.')
      if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
        throw new Error('Invalid experience start request.')
      }
      return dispatchLegacy({
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
      return dispatchLegacy({
        type: 'STOP',
        mode: 'firmware',
        requestId: request.requestId,
        operationId: request.operationId,
      }, services, coordinator)
    },
  }
}
