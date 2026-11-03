import type { NatureTouchApi } from '../../../shared/ipc'
import type { ExperienceId } from '../../../shared/experience-definitions'
import type { ExperienceSnapshot } from '../../../shared/experience-control-protocol'

// One UI intent, existing IPC only. Never arm, reconnect or recover hardware.
export async function startSelectedExperience(api: NatureTouchApi | undefined, realMode: boolean,
  id: ExperienceId): Promise<ExperienceSnapshot> {
  if (!api) throw new Error('Electron connection is required to start the experience.')
  const requestId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const firmware = realMode ? await api.getFirmwareState() : null
  const benchReady = firmware?.openAirBenchSession === true && firmware.realControlEligible === true &&
    firmware.firmware === 'nature-touch-unified-real' && firmware.hardwareOutputsEnabled === true
  const simulationReady = firmware?.simulationTestArmed === true && firmware.hardwareOutputsEnabled === false
  if (firmware && (!firmware.identified || firmware.connectionState !== 'connected' ||
      (!simulationReady && !benchReady))) {
    throw new Error('An explicitly armed, output-disabled simulation or reviewed open-air bench session is required.')
  }
  const current = firmware?.experience ?? await api.getExperienceState()
  if (current.state === 'RUNNING' && current.selectedExperienceId === id) return current
  if (current.state !== 'IDLE' && current.state !== 'COMPLETED') throw new Error(`Cannot start in ${current.state}.`)
  if (current.state === 'COMPLETED' || current.selectedExperienceId !== id) {
    const selected = realMode ? await api.selectFirmwareExperience(id, requestId()) : await api.selectExperience(id, requestId())
    if (!selected.accepted) throw new Error(`SELECT rejected: ${selected.code ?? 'UNKNOWN'}`)
  }
  const ack = realMode ? await api.startFirmwareExperience(requestId(), requestId()) : await api.startExperience(requestId(), requestId())
  if (!ack.accepted) throw new Error(`START rejected: ${ack.code ?? 'UNKNOWN'}`)
  const state = realMode ? (await api.queryFirmwareStatus(requestId())).snapshot : await api.getExperienceState()
  if (state.state !== 'RUNNING' || state.selectedExperienceId !== id) throw new Error('START did not establish the selected running experience.')
  return state
}
