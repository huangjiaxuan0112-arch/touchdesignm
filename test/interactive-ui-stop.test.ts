import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  selectExperienceIntent,
  startSelectedExperience,
} from '../desktop/renderer/src/app/start-selected-experience'
import { isDeviceUnavailable, stopActiveExperience } from '../desktop/renderer/src/app/stop-active-experience'
import type { NatureTouchApi } from '../desktop/shared/ipc'
import type { ExperienceSnapshot } from '../desktop/shared/experience-control-protocol'
import { EXPERIENCE_IDS } from '../desktop/shared/experience-definitions'

const idle: ExperienceSnapshot = {
  state: 'IDLE',
  selectedExperienceId: 'WIND',
  operationId: null,
  elapsedMs: 0,
  durationMs: null,
  progress: 0,
  faultCode: null,
}
const running: ExperienceSnapshot = {
  ...idle,
  state: 'RUNNING',
  operationId: 'operation-1',
  durationMs: 24_000,
}
const completed: ExperienceSnapshot = { ...running, state: 'COMPLETED', progress: 1 }
const appSnapshot = (experience: ExperienceSnapshot, mode: 'mock' | 'firmware' = 'mock') => ({
  mode,
  revision: 1,
  experience,
})

function fakeApi(
  dispatchExperienceCommand: NatureTouchApi['dispatchExperienceCommand'],
  getExperienceSnapshot: NatureTouchApi['getExperienceSnapshot'] = async () => appSnapshot(idle),
): NatureTouchApi {
  return { dispatchExperienceCommand, getExperienceSnapshot } as unknown as NatureTouchApi
}

test('selection helper sends exactly one selection intent and returns the coordinator snapshot', async () => {
  const commands: Array<{ type: string; mode: string }> = []
  const api = fakeApi(async command => {
    commands.push(command)
    return { type: 'ACK', command: 'SELECT', requestId: command.requestId, accepted: true, state: 'IDLE' }
  }, async mode => appSnapshot({ ...idle, selectedExperienceId: 'BUBBLE' }, mode))

  const selected = await selectExperienceIntent(api, 'mock', 'BUBBLE')

  assert.deepEqual(commands.map(({ type, mode }) => [type, mode]), [['SELECT', 'mock']])
  assert.equal(selected.experience.selectedExperienceId, 'BUBBLE')
  assert.equal(selected.revision, 1)
})

test('selection rejection does not query or alter a selected device mode', async () => {
  let snapshotReads = 0
  const api = fakeApi(async () => ({
    type: 'NACK',
    command: 'SELECT',
    requestId: 'select',
    accepted: false,
    state: 'FAULT',
    code: 'INVALID_STATE',
  }), async () => {
    snapshotReads++
    return appSnapshot(idle)
  })

  await assert.rejects(selectExperienceIntent(api, 'firmware', 'WIND'), /SELECT rejected/)
  assert.equal(snapshotReads, 0)
})

test('media-ready START helper sends only START then reads the confirmed snapshot', async () => {
  const commands: string[] = []
  let statusReads = 0
  const api = fakeApi(async command => {
    commands.push(command.type)
    if (command.type === 'START') {
      return {
        type: 'ACK',
        command: 'START',
        requestId: command.requestId,
        accepted: true,
        state: 'RUNNING',
        operationId: command.operationId,
      }
    }
    statusReads++
    return {
      type: 'STATUS',
      requestId: command.requestId,
      acknowledgement: {
        type: 'ACK',
        command: 'STATUS_QUERY',
        requestId: command.requestId,
        accepted: true,
        state: 'RUNNING',
      },
      snapshot: running,
    }
  })

  const result = await startSelectedExperience(api, 'mock', 'operation-1')

  assert.deepEqual(commands, ['START', 'STATUS'])
  assert.equal(statusReads, 1)
  assert.equal(result.state, 'RUNNING')
})

test('all experience selections flow into exactly one media-ready START in both modes', async () => {
  for (const mode of ['mock', 'firmware'] as const) {
    for (const experienceId of EXPERIENCE_IDS) {
      const commands: string[] = []
      const selectedSnapshot = { ...running, selectedExperienceId: experienceId }
      const api = fakeApi(async command => {
        commands.push(command.type)
        if (command.type === 'SELECT') {
          assert.equal(command.experienceId, experienceId)
          return {
            type: 'ACK',
            command: 'SELECT',
            requestId: command.requestId,
            accepted: true,
            state: 'IDLE',
          }
        }
        if (command.type === 'START') {
          return {
            type: 'ACK',
            command: 'START',
            requestId: command.requestId,
            accepted: true,
            state: 'RUNNING',
            operationId: command.operationId,
          }
        }
        if (command.type === 'STATUS') {
          return {
            type: 'STATUS',
            requestId: command.requestId,
            acknowledgement: {
              type: 'ACK',
              command: 'STATUS_QUERY',
              requestId: command.requestId,
              accepted: true,
              state: 'RUNNING',
            },
            snapshot: selectedSnapshot,
          }
        }
        throw new Error(`Unexpected ${command.type} command`)
      }, async requestedMode => appSnapshot({ ...idle, selectedExperienceId: experienceId }, requestedMode))

      await selectExperienceIntent(api, mode, experienceId)
      const started = await startSelectedExperience(api, mode, `operation-${mode}-${experienceId}`)

      assert.deepEqual(commands, ['SELECT', 'START', 'STATUS'])
      assert.equal(started.selectedExperienceId, experienceId)
    }
  }
})

test('firmware and all experience modes use the same lightweight START adapter', async () => {
  for (const mode of ['mock', 'firmware'] as const) {
    const commands: string[] = []
    const api = fakeApi(async command => {
      commands.push(command.type)
      if (command.type === 'START') {
        return {
          type: 'ACK',
          command: 'START',
          requestId: command.requestId,
          accepted: true,
          state: 'RUNNING',
          operationId: command.operationId,
        }
      }
      return {
        type: 'STATUS',
        requestId: command.requestId,
        acknowledgement: {
          type: 'ACK',
          command: 'STATUS_QUERY',
          requestId: command.requestId,
          accepted: true,
          state: 'RUNNING',
        },
        snapshot: running,
      }
    })

    await startSelectedExperience(api, mode, `operation-${mode}`)

    assert.deepEqual(commands, ['START', 'STATUS'])
  }
})

test('rejected START does not issue STATUS or claim playback can begin', async () => {
  let commands = 0
  const api = fakeApi(async () => {
    commands++
    return {
      type: 'NACK',
      command: 'START',
      requestId: 'start',
      accepted: false,
      state: 'FAULT',
      code: 'INVALID_STATE',
    }
  })

  await assert.rejects(startSelectedExperience(api, 'mock', 'operation-1'), /START rejected/)
  assert.equal(commands, 1)
})

test('STOP adapter submits a single intent and accepts only confirmed inactive snapshots', async () => {
  let stops = 0
  const api = fakeApi(async command => {
    assert.equal(command.type, 'STOP')
    assert.equal(command.mode, 'firmware')
    assert.equal(command.operationId, 'operation-1')
    stops++
    return {
      type: 'STATUS',
      requestId: command.requestId,
      acknowledgement: {
        type: 'ACK',
        command: 'STATUS_QUERY',
        requestId: command.requestId,
        accepted: true,
        state: 'COMPLETED',
      },
      snapshot: completed,
    }
  })

  await stopActiveExperience(api, 'firmware', 'operation-1')
  assert.equal(stops, 1)
})

test('STOP adapter does not treat an ACK alone as proof that the device is stopped', async () => {
  const api = fakeApi(async command => {
    if (command.type !== 'STOP') throw new Error('Expected STOP')
    return {
      type: 'ACK',
      command: 'STOP',
      requestId: command.requestId,
      accepted: true,
      state: 'STOPPING',
      operationId: command.operationId,
    }
  })

  await assert.rejects(stopActiveExperience(api, 'mock', 'operation-1'), /no inactive device state/)
})

test('STOP adapter rejects an unconfirmed STATUS even when its snapshot appears inactive', async () => {
  const api = fakeApi(async command => ({
    type: 'STATUS',
    requestId: command.requestId,
    acknowledgement: {
      type: 'NACK',
      command: 'STATUS_QUERY',
      requestId: command.requestId,
      accepted: false,
      state: 'COMPLETED',
      code: 'STATUS_UNAVAILABLE',
    },
    snapshot: completed,
  }))

  await assert.rejects(stopActiveExperience(api, 'mock', 'operation-1'), /STATUS_UNAVAILABLE/)
})

test('STOP failure, fault, or disconnect is surfaced without claiming safe exit', async () => {
  const rejected = fakeApi(async command => {
    if (command.type !== 'STOP') throw new Error('Expected STOP')
    return {
      type: 'NACK',
      command: 'STOP',
      requestId: command.requestId,
      accepted: false,
      state: 'RUNNING',
      operationId: command.operationId,
      code: 'INVALID_STATE',
    }
  })
  await assert.rejects(stopActiveExperience(rejected, 'mock', 'operation-1'), /STOP rejected/)

  const faulted = fakeApi(async command => ({
    type: 'STATUS',
    requestId: command.requestId,
    acknowledgement: {
      type: 'ACK',
      command: 'STATUS_QUERY',
      requestId: command.requestId,
      accepted: true,
      state: 'FAULT',
    },
    snapshot: { ...running, state: 'FAULT', faultCode: 'HOST_TIMEOUT' },
  }))
  await assert.rejects(stopActiveExperience(faulted, 'mock', 'operation-1'), /HOST_TIMEOUT/)

  const disconnected = fakeApi(async () => { throw new Error('Device disconnected') })
  await assert.rejects(stopActiveExperience(disconnected, 'firmware', 'operation-1'), /disconnected/)
})

test('cancelled media preparation without a START operation sends no STOP', async () => {
  let commands = 0
  const api = fakeApi(async () => {
    commands++
    throw new Error('Unexpected command')
  })

  await stopActiveExperience(api, 'mock', null)
  assert.equal(commands, 0)
})

test('only authoritative FAULT or unavailable connection permits exit without device STOP', () => {
  assert.equal(isDeviceUnavailable({ state: 'FAULT' }, true), true)
  assert.equal(isDeviceUnavailable({ state: 'RUNNING' }, false), true)
  assert.equal(isDeviceUnavailable({ state: 'RUNNING' }, true), false)
  assert.equal(isDeviceUnavailable({ state: 'COMPLETED' }, true), false)
})
