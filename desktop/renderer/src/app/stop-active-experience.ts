import type { NatureTouchApi } from '../../../shared/ipc'
import type { ExperienceMode } from '../../../shared/experience-application-contract'

// Reuse the existing IPC services and wait for cancellation to finish. Media
// controls never arm, SELECT, START, reconnect, or recover a physical device.
export async function stopActiveExperience(api: NatureTouchApi | undefined, realMode: boolean): Promise<void> {
  if (!api) return
  const requestId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const mode: ExperienceMode = realMode ? 'firmware' : 'mock'
  let state = (await api.getExperienceSnapshot(mode)).experience
  if (state.state !== 'RUNNING' && state.state !== 'STOPPING') return
  if (state.state === 'RUNNING') {
    if (!state.operationId) throw new Error('実行中の操作 ID がありません。')
    const ack = await api.dispatchExperienceCommand({
      type: 'STOP', mode, requestId: requestId(), operationId: state.operationId,
    })
    if (!('accepted' in ack)) throw new Error('STOP returned an invalid response.')
    if (!ack.accepted) throw new Error(`STOP rejected: ${ack.code ?? 'UNKNOWN'}`)
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await api.dispatchExperienceCommand({ type: 'STATUS', mode, requestId: requestId() })
    if (!('snapshot' in status)) throw new Error('STATUS returned an invalid response.')
    state = status.snapshot
    if (state.state === 'IDLE' || state.state === 'COMPLETED') return
    if (state.state === 'FAULT') throw new Error(`FAULT: ${state.faultCode ?? 'UNKNOWN'}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('STOP の完了が確認できません。')
}
