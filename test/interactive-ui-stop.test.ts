import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stopActiveExperience } from '../desktop/renderer/src/app/stop-active-experience'
import { startSelectedExperience } from '../desktop/renderer/src/app/start-selected-experience'
import type { NatureTouchApi } from '../desktop/shared/ipc'
import type { ExperienceSnapshot } from '../desktop/shared/experience-control-protocol'

const running: ExperienceSnapshot = { state: 'RUNNING', selectedExperienceId: 'WIND', operationId: 'operation-1', elapsedMs: 0, durationMs: 24000, progress: 0, faultCode: null }
const appSnapshot = (experience: ExperienceSnapshot, mode: 'mock' | 'firmware' = 'mock') => ({
  mode,
  revision: 0,
  experience,
})

test('media-only idle/browser exit sends no STOP or START', async () => {
  await stopActiveExperience(undefined, false)
  const api = { getExperienceSnapshot: async () => appSnapshot({ ...running, state: 'IDLE' }) } as unknown as NatureTouchApi
  await stopActiveExperience(api, false)
})
test('mock UI stop waits for cancellation instead of treating ACK as IDLE', async () => {
  let reads = 0, stops = 0
  const api = {
    getExperienceSnapshot: async () => appSnapshot(++reads === 1 ? running : { ...running, state: reads === 2 ? 'STOPPING' : 'IDLE' }),
    dispatchExperienceCommand: async (command: { type: string; operationId?: string }) => {
      if (command.type === 'STOP') { assert.equal(command.operationId, running.operationId); stops++; return { accepted: true } }
      return { snapshot: { ...running, state: 'IDLE' } }
    },
  } as unknown as NatureTouchApi
  await stopActiveExperience(api, false)
  assert.equal(stops, 1); assert.equal(reads, 1)
})
test('real UI stop reuses firmware STOP and STATUS; never reconnects or STARTs', async () => {
  let stops = 0, queries = 0
  const api = {
    getExperienceSnapshot: async () => appSnapshot(running, 'firmware'),
    dispatchExperienceCommand: async (command: { type: string }) => {
      if (command.type === 'STOP') { stops++; return { accepted: true } }
      queries++
      return { snapshot: { ...running, state: 'IDLE' } }
    },
  } as unknown as NatureTouchApi
  await stopActiveExperience(api, true)
  assert.equal(stops, 1); assert.equal(queries, 1)
})
test('rejected STOP cannot approve safe exit', async () => {
  const api = {
    getExperienceSnapshot: async () => appSnapshot(running),
    dispatchExperienceCommand: async () => ({ accepted: false, code: 'INVALID_STATE' }),
  } as unknown as NatureTouchApi
  await assert.rejects(stopActiveExperience(api, false), /STOP rejected/)
})
test('FAULT during STOP preserves failure instead of reporting successful cancellation', async () => {
  let reads = 0
  const api = {
    getExperienceSnapshot: async () => appSnapshot(running),
    dispatchExperienceCommand: async (command: { type: string }) => {
      if (command.type === 'STOP') return { accepted: true }
      reads++
      return { snapshot: { ...running, state: 'FAULT', faultCode: 'HOST_TIMEOUT' } }
    },
  } as unknown as NatureTouchApi
  await assert.rejects(stopActiveExperience(api, false), /HOST_TIMEOUT/)
})
test('disconnect during STOP cannot approve safe exit', async () => {
  const api = {
    getExperienceSnapshot: async () => appSnapshot(running, 'firmware'),
    dispatchExperienceCommand: async () => { throw Error('Device disconnected') },
  } as unknown as NatureTouchApi
  await assert.rejects(stopActiveExperience(api, true), /disconnected/)
})

test('media START reuses selected mock mode and returns its running clock', async () => {
  let starts = 0
  const api = {
    getExperienceSnapshot: async () => appSnapshot(starts ? running : { ...running, state: 'IDLE', operationId: null }),
    dispatchExperienceCommand: async (command: { type: string }) => {
      if (command.type === 'START') { starts++; return { accepted: true } }
      return { snapshot: running }
    },
  } as unknown as NatureTouchApi
  const snapshot = await startSelectedExperience(api, false, 'WIND')
  assert.equal(starts, 1); assert.equal(snapshot.state, 'RUNNING')
  await startSelectedExperience(api, false, 'WIND')
  assert.equal(starts, 1, 'Already-running media does not duplicate START')
})

test('media cannot START a disconnected, unarmed or output-enabled firmware', async () => {
  for (const extra of [{ connectionState: 'disconnected' }, { simulationTestArmed: false }, { hardwareOutputsEnabled: true }]) {
    const api = { getFirmwareState: async () => ({ identified: true, connectionState: 'connected', simulationTestArmed: true,
      hardwareOutputsEnabled: false, experience: running, ...extra }) } as unknown as NatureTouchApi
    await assert.rejects(startSelectedExperience(api, true, 'WIND'), /armed, output-disabled/)
  }
})

test('media start rejection never claims a running experience', async () => {
  const api = {
    getExperienceSnapshot: async () => appSnapshot({ ...running, state: 'IDLE' }),
    dispatchExperienceCommand: async () => ({ accepted: false, code: 'INVALID_STATE' }),
  } as unknown as NatureTouchApi
  await assert.rejects(startSelectedExperience(api, false, 'WIND'), /START rejected/)
})
