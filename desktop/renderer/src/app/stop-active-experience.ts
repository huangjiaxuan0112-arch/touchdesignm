import type { NatureTouchApi } from '../../../shared/ipc'

// Reuse the existing IPC services and wait for cancellation to finish. Media
// controls never arm, SELECT, START, reconnect, or recover a physical device.
export async function stopActiveExperience(api: NatureTouchApi | undefined, realMode: boolean): Promise<void> {
  if (!api) return
  const requestId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  let state = realMode ? (await api.getFirmwareState()).experience : await api.getExperienceState()
  if (state.state !== 'RUNNING' && state.state !== 'STOPPING') return
  if (state.state === 'RUNNING') {
    if (!state.operationId) throw new Error('実行中の操作 ID がありません。')
    const ack = realMode
      ? await api.stopFirmwareExperience(requestId(), state.operationId)
      : await api.stopExperience(requestId(), state.operationId)
    if (!ack.accepted) throw new Error(`STOP rejected: ${ack.code ?? 'UNKNOWN'}`)
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    state = realMode
      ? (await api.queryFirmwareStatus(requestId())).snapshot
      : (await api.getExperienceState())
    if (state.state === 'IDLE' || state.state === 'COMPLETED') return
    if (state.state === 'FAULT') throw new Error(`FAULT: ${state.faultCode ?? 'UNKNOWN'}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('STOP の完了が確認できません。')
}
