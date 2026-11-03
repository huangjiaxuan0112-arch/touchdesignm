import { EXPERIENCE_IDS, type ExperienceId } from './experience-definitions'
import type {
  ExperienceAcknowledgement,
  ExperienceSnapshot as DeviceExperienceSnapshot,
  ExperienceStatusResponse,
  OperationId,
  RequestId,
} from './experience-control-protocol'

export type ExperienceMode = 'mock' | 'firmware'

export interface ExperienceSnapshot {
  mode: ExperienceMode
  revision: number
  experience: DeviceExperienceSnapshot
}

export type ExperienceCommand =
  | { type: 'SELECT'; mode: ExperienceMode; experienceId: ExperienceId; requestId: RequestId }
  | { type: 'START'; mode: ExperienceMode; requestId: RequestId; operationId: OperationId }
  | { type: 'STOP'; mode: ExperienceMode; requestId: RequestId; operationId: OperationId }
  | { type: 'STATUS'; mode: ExperienceMode; requestId: RequestId }

export type ExperienceCommandResult = ExperienceAcknowledgement | ExperienceStatusResponse

export type ExperienceEvent = {
  type: 'SNAPSHOT'
  snapshot: ExperienceSnapshot
}

const experienceStates = ['IDLE', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAULT'] as const

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return value === 'mock' || value === 'firmware'
}

export function isExperienceSnapshot(value: unknown): value is ExperienceSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ExperienceSnapshot>
  const experience = snapshot.experience
  if (!isExperienceMode(snapshot.mode) || !Number.isInteger(snapshot.revision) || snapshot.revision! < 0 ||
      !experience || typeof experience !== 'object') return false

  return experienceStates.includes(experience.state) &&
    (experience.selectedExperienceId === null || EXPERIENCE_IDS.includes(experience.selectedExperienceId)) &&
    (experience.operationId === null || typeof experience.operationId === 'string') &&
    Number.isFinite(experience.elapsedMs) && experience.elapsedMs >= 0 &&
    (experience.durationMs === null || (Number.isFinite(experience.durationMs) && experience.durationMs >= 0)) &&
    Number.isFinite(experience.progress) && experience.progress >= 0 && experience.progress <= 1 &&
    (experience.faultCode === null || typeof experience.faultCode === 'string')
}

export function isExperienceCommand(value: unknown): value is ExperienceCommand {
  if (!value || typeof value !== 'object') return false
  const command = value as Record<string, unknown>
  if (!isExperienceMode(command.mode)) return false

  switch (command.type) {
    case 'SELECT':
      return EXPERIENCE_IDS.includes(command.experienceId as ExperienceId) &&
        typeof command.requestId === 'string'
    case 'START':
    case 'STOP':
      return typeof command.requestId === 'string' && typeof command.operationId === 'string'
    case 'STATUS':
      return typeof command.requestId === 'string'
    default:
      return false
  }
}

export function isExperienceEvent(value: unknown): value is ExperienceEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ExperienceEvent>
  return event.type === 'SNAPSHOT' && isExperienceSnapshot(event.snapshot)
}

export function reconcileExperienceEvents(
  initial: ExperienceSnapshot,
  queuedEvents: readonly ExperienceEvent[],
): ExperienceEvent[] {
  const events: ExperienceEvent[] = [{ type: 'SNAPSHOT', snapshot: initial }]
  let latestRevision = initial.revision

  for (const event of queuedEvents) {
    if (event.snapshot.mode !== initial.mode || event.snapshot.revision <= latestRevision) continue
    events.push(event)
    latestRevision = event.snapshot.revision
  }

  return events
}
