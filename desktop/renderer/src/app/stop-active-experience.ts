import type { NatureTouchApi } from '../../../shared/ipc'
import type { ExperienceMode } from '../../../shared/experience-application-contract'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'

export function isDeviceUnavailable(
  runState: Pick<ExperienceSnapshot, 'state'>,
  connectionReady: boolean,
): boolean {
  return !connectionReady || runState.state === 'FAULT'
}

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

export async function stopActiveExperience(
  api: NatureTouchApi | undefined,
  mode: ExperienceMode,
  operationId: string | null,
): Promise<void> {
  if (!api || !operationId) return

  const result = await api.dispatchExperienceCommand({
    type: 'STOP',
    mode,
    requestId: requestId(),
    operationId,
  })
  if ('accepted' in result) {
    if (!result.accepted) throw new Error(`STOP rejected: ${result.code ?? 'UNKNOWN'}`)
    throw new Error('STOP was accepted but no inactive device state was confirmed.')
  }
  if (result.snapshot.state === 'FAULT') {
    throw new Error(`FAULT: ${result.snapshot.faultCode ?? 'UNKNOWN'}`)
  }
  if (!result.acknowledgement.accepted) {
    throw new Error(`STOP status was not confirmed: ${result.acknowledgement.code ?? 'UNKNOWN'}.`)
  }
  if (result.snapshot.state !== 'IDLE' && result.snapshot.state !== 'COMPLETED') {
    throw new Error(`STOP was not confirmed; device state is ${result.snapshot.state}.`)
  }
}
