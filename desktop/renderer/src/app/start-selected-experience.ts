import type { NatureTouchApi } from '../../../shared/ipc'
import type { ExperienceId } from '../../../shared/experience-definitions'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'
import type { ExperienceMode } from '../../../shared/experience-application-contract'

// One UI intent, existing IPC only. Never arm, reconnect or recover hardware.
export async function startSelectedExperience(api: NatureTouchApi | undefined, realMode: boolean,
  id: ExperienceId): Promise<ExperienceSnapshot> {
  if (!api) throw new Error('Electron connection is required to start the experience.')
  const requestId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const mode: ExperienceMode = realMode ? 'firmware' : 'mock'
  const firmware = realMode ? await api.getFirmwareState() : null
  const benchReady = firmware?.openAirBenchSession === true && firmware.realControlEligible === true &&
    firmware.firmware === 'nature-touch-unified-real' && firmware.hardwareOutputsEnabled === true
  const simulationReady = firmware?.simulationTestArmed === true && firmware.hardwareOutputsEnabled === false
  if (firmware && (!firmware.identified || firmware.connectionState !== 'connected' ||
      (!simulationReady && !benchReady))) {
    throw new Error('An explicitly armed, output-disabled simulation or reviewed open-air bench session is required.')
  }
  const current = firmware?.experience ?? (await api.getExperienceSnapshot(mode)).experience
  if (current.state === 'RUNNING' && current.selectedExperienceId === id) return current
  if (current.state !== 'IDLE' && current.state !== 'COMPLETED') throw new Error(`Cannot start in ${current.state}.`)
  if (current.state === 'COMPLETED' || current.selectedExperienceId !== id) {
    const selected = await api.dispatchExperienceCommand({
      type: 'SELECT', mode, experienceId: id, requestId: requestId(),
    })
    if (!('accepted' in selected)) throw new Error('SELECT returned an invalid response.')
    if (!selected.accepted) throw new Error(`SELECT rejected: ${selected.code ?? 'UNKNOWN'}`)
  }
  const ack = await api.dispatchExperienceCommand({
    type: 'START', mode, requestId: requestId(), operationId: requestId(),
  })
  if (!('accepted' in ack)) throw new Error('START returned an invalid response.')
  if (!ack.accepted) throw new Error(`START rejected: ${ack.code ?? 'UNKNOWN'}`)
  const status = await api.dispatchExperienceCommand({ type: 'STATUS', mode, requestId: requestId() })
  if (!('snapshot' in status)) throw new Error('STATUS returned an invalid response.')
  const state = status.snapshot
  if (state.state !== 'RUNNING' || state.selectedExperienceId !== id) throw new Error('START did not establish the selected running experience.')
  return state
}
