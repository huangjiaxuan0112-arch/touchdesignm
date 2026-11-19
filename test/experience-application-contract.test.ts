import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchExperienceCommand } from '../desktop/electron/experience-command-dispatcher'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import { EXPERIENCE_DISPLAY_NAMES, EXPERIENCE_IDS } from '../desktop/shared/experience-definitions'
import { IPC_CHANNELS } from '../desktop/shared/ipc'
import {
  isExperienceCommand,
  isExperienceEvent,
  isExperienceSnapshot,
  reconcileExperienceEvents,
  type ExperienceSnapshot,
} from '../desktop/shared/experience-application-contract'

const initial: ExperienceSnapshot = {
  mode: 'mock',
  revision: 3,
  experience: {
    state: 'IDLE',
    selectedExperienceId: 'WAVE',
    operationId: null,
    elapsedMs: 0,
    durationMs: null,
    progress: 0,
    faultCode: null,
  },
}

test('application commands validate mode, protocol identifiers, and request/operation IDs', () => {
  assert.deepEqual(EXPERIENCE_IDS, ['WIND', 'WAVE', 'BUBBLE'])
  assert.deepEqual(EXPERIENCE_DISPLAY_NAMES, { WIND: 'WIND', WAVE: 'WAVES', BUBBLE: 'BUBBLES' })
  assert.equal(IPC_CHANNELS.experienceSelect, 'experience:select')
  assert.equal(IPC_CHANNELS.firmwareStart, 'firmware:start')
  assert.equal(isExperienceCommand({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'request-1',
  }), true)
  assert.equal(isExperienceCommand({
    type: 'START', mode: 'firmware', requestId: 'request-2', operationId: 'operation-1',
  }), true)
  assert.equal(isExperienceCommand({ type: 'STATUS', mode: 'mock', requestId: 'request-3' }), true)
  assert.equal(isExperienceCommand({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVES', requestId: 'request-4',
  }), false)
  assert.equal(isExperienceCommand({
    type: 'STOP', mode: 'real', requestId: 'request-5', operationId: 'operation-2',
  }), false)
  assert.equal(isExperienceCommand({
    type: 'STOP', mode: 'firmware', requestId: 'request-6', operationId: 7,
  }), false)
  assert.equal(isExperienceCommand({ type: 'RECOVER', mode: 'mock', requestId: 'request-7' }), false)
})

test('snapshot events preserve the device snapshot and reconcile buffered updates by revision', () => {
  const stale: ExperienceSnapshot = { ...initial, revision: 2 }
  const updated: ExperienceSnapshot = {
    ...initial,
    revision: 4,
    experience: { ...initial.experience, state: 'RUNNING', operationId: 'operation-4', durationMs: 30_000 },
  }
  const otherMode: ExperienceSnapshot = { ...updated, mode: 'firmware', revision: 5 }
  const events = [
    { type: 'SNAPSHOT' as const, snapshot: stale },
    { type: 'SNAPSHOT' as const, snapshot: updated },
    { type: 'SNAPSHOT' as const, snapshot: otherMode },
  ]

  assert.equal(isExperienceSnapshot(initial), true)
  assert.equal(isExperienceEvent(events[1]), true)
  assert.equal(isExperienceSnapshot({ ...initial, revision: -1 }), false)
  assert.deepEqual(
    reconcileExperienceEvents(initial, events),
    [{ type: 'SNAPSHOT', snapshot: initial }, events[1]],
  )
})

test('Main command dispatch rejects invalid payloads and preserves controller state/duplicate rules', async () => {
  const mock = new MockExperienceController()
  const firmwareCalls: string[] = []
  const firmware = {
    selectExperience: async (requestId: string) => {
      firmwareCalls.push(`SELECT:${requestId}`)
      return { type: 'ACK' as const, requestId, command: 'SELECT' as const, accepted: true, state: 'IDLE' as const }
    },
    start: async (requestId: string, operationId: string) => {
      firmwareCalls.push(`START:${requestId}:${operationId}`)
      return { type: 'ACK' as const, requestId, command: 'START' as const, accepted: true, state: 'RUNNING' as const, operationId }
    },
    stop: async (requestId: string, operationId: string) => {
      firmwareCalls.push(`STOP:${requestId}:${operationId}`)
      return { type: 'ACK' as const, requestId, command: 'STOP' as const, accepted: true, state: 'STOPPING' as const, operationId }
    },
    queryStatus: async (requestId: string) => ({
      type: 'STATUS' as const,
      requestId,
      acknowledgement: { type: 'ACK' as const, requestId, command: 'STATUS_QUERY' as const, accepted: true, state: 'IDLE' as const },
      snapshot: initial.experience,
    }),
  }
  const services = { mock, firmware }

  const startBeforeSelect = await dispatchExperienceCommand({
    type: 'START', mode: 'mock', requestId: 'r1', operationId: 'o1',
  }, services)
  assert.equal('accepted' in startBeforeSelect && startBeforeSelect.accepted, false)

  const selected = await dispatchExperienceCommand({
    type: 'SELECT', mode: 'mock', experienceId: 'WIND', requestId: 'select-1',
  }, services)
  assert.equal('accepted' in selected && selected.accepted, true)
  const startCommand = { type: 'START', mode: 'mock', requestId: 'start-1', operationId: 'operation-1' } as const
  const first = await dispatchExperienceCommand(startCommand, services)
  const duplicate = await dispatchExperienceCommand(startCommand, services)
  assert.deepEqual(duplicate, first)
  const reusedRequestId = await dispatchExperienceCommand({
    ...startCommand, operationId: 'operation-2',
  }, services)
  assert.equal('accepted' in reusedRequestId && reusedRequestId.accepted, false)

  const firmwareAck = await dispatchExperienceCommand({
    type: 'SELECT', mode: 'firmware', experienceId: 'WAVE', requestId: 'firmware-select',
  }, services)
  assert.equal('accepted' in firmwareAck && firmwareAck.accepted, true)
  assert.deepEqual(firmwareCalls, ['SELECT:firmware-select'])
  await assert.rejects(
    dispatchExperienceCommand({ type: 'SELECT', mode: 'mock', experienceId: 'WAVES', requestId: 'bad' }, services),
    /Invalid experience command/,
  )
})
