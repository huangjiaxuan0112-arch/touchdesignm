import type { NatureTouchApi } from './ipc'
import { EXHIBITION_TIMING, EXPERIENCE_IDS, type ExperienceId } from './experience-definitions'

export const PROJECTOR_DURATION_MS = EXHIBITION_TIMING.waitingMs + EXHIBITION_TIMING.experienceMs
export const PROJECTOR_DURATION_TOLERANCE_SECONDS = 0.1

export type ProjectorMediaReport = {
  operationId: string
  experienceId: ExperienceId
  event: 'ready' | 'playing' | 'ended' | 'error'
  occurredAtMs: number
  durationSeconds?: number
  currentTime?: number
  code?: string
}

export function isProjectorMediaReport(value: unknown): value is ProjectorMediaReport {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<ProjectorMediaReport>
  return typeof r.operationId === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(r.operationId) &&
    EXPERIENCE_IDS.includes(r.experienceId!) && ['ready', 'playing', 'ended', 'error'].includes(r.event ?? '') &&
    typeof r.occurredAtMs === 'number' && Number.isFinite(r.occurredAtMs) &&
    (r.durationSeconds === undefined || (typeof r.durationSeconds === 'number' && Number.isFinite(r.durationSeconds))) &&
    (r.currentTime === undefined || (typeof r.currentTime === 'number' && Number.isFinite(r.currentTime))) &&
    (r.code === undefined || (typeof r.code === 'string' && r.code.length <= 80))
}

export type ProjectorApi = Pick<NatureTouchApi, 'subscribeExhibition'> & {
  readonly developmentPreview: boolean
  reportMedia(report: ProjectorMediaReport): Promise<boolean>
}
