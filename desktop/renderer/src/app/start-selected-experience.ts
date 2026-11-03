import type { NatureTouchApi } from '../../../shared/ipc'
import type { ExperienceId } from '../../../shared/experience-definitions'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type {
  ExperienceMode,
  ExperienceSnapshot as ApplicationExperienceSnapshot,
} from '../../../shared/experience-application-contract'

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function assertAccepted(result: { accepted: boolean; code?: string }, command: string): void {
  if (!result.accepted) throw new Error(`${command} rejected: ${result.code ?? 'UNKNOWN'}`)
}

export async function selectExperienceIntent(
  api: NatureTouchApi,
  mode: ExperienceMode,
  experienceId: ExperienceId,
): Promise<ApplicationExperienceSnapshot> {
  const result = await api.dispatchExperienceCommand({
    type: 'SELECT',
    mode,
    experienceId,
    requestId: requestId(),
  })
  if (!('accepted' in result)) throw new Error('SELECT returned an invalid response.')
  assertAccepted(result, 'SELECT')
  const snapshot = await api.getExperienceSnapshot(mode)
  return snapshot
}

export async function startSelectedExperience(
  api: NatureTouchApi | undefined,
  mode: ExperienceMode,
  operationId: string,
): Promise<ExperienceSnapshot> {
  if (!api) throw new Error('Electron connection is required to start the experience.')
  const result = await api.dispatchExperienceCommand({
    type: 'START',
    mode,
    requestId: requestId(),
    operationId,
  })
  if (!('accepted' in result)) throw new Error('START returned an invalid response.')
  assertAccepted(result, 'START')

  const status = await api.dispatchExperienceCommand({
    type: 'STATUS',
    mode,
    requestId: requestId(),
  })
  if (!('snapshot' in status)) throw new Error('STATUS returned an invalid response.')
  return status.snapshot
}
