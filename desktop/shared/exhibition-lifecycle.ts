import { EXPERIENCE_IDS, type ExperienceId } from './experience-definitions'

export const EXHIBITION_TIMING = {
  waitingMs: 5_000,
  experienceMs: 15_000,
  cooldownMs: 8_000,
  mockDeviceCompletionMs: 20_000,
} as const

export type ExhibitionPhase =
  | 'READY'
  | 'STARTING'
  | 'WAITING'
  | 'EXPERIENCE'
  | 'AWAIT_COMPLETION'
  | 'COOLDOWN'
  | 'FAULT'

export interface ExhibitionLifecycleSnapshot {
  revision: number
  phase: ExhibitionPhase
  experienceId: ExperienceId | null
  operationId: string | null
  faultCode: string | null
}

export function isExhibitionLifecycleSnapshot(value: unknown): value is ExhibitionLifecycleSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ExhibitionLifecycleSnapshot>
  return Number.isInteger(snapshot.revision) && snapshot.revision! >= 0 &&
    ['READY', 'STARTING', 'WAITING', 'EXPERIENCE', 'AWAIT_COMPLETION', 'COOLDOWN', 'FAULT']
      .includes(snapshot.phase ?? '') &&
    (snapshot.experienceId === null || EXPERIENCE_IDS.includes(snapshot.experienceId!)) &&
    (snapshot.operationId === null || typeof snapshot.operationId === 'string') &&
    (snapshot.faultCode === null || typeof snapshot.faultCode === 'string')
}
