import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExperienceClock } from '../desktop/experience/experience-clock'
import { ExhibitionLifecycleController } from '../desktop/experience/exhibition-lifecycle-controller'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import { ExperienceCoordinator, type CoordinatedExperienceService } from '../desktop/electron/experience-coordinator'
import { createExperienceIpcHandlers } from '../desktop/electron/experience-ipc-handlers'
import type { ExperienceSnapshot } from '../desktop/shared/experience-control-protocol'
import { IPC_CHANNELS } from '../desktop/shared/ipc'

class FakeClock implements ExperienceClock {
  private currentTime = 0
  private nextId = 0
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>()

  now(): number { return this.currentTime }

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback })
    return () => this.timers.delete(id)
  }

  advanceBy(milliseconds: number): void {
    const targetTime = this.currentTime + milliseconds
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= targetTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0]
      if (!next) break
      const [id, timer] = next
      this.timers.delete(id)
      this.currentTime = timer.dueAt
      timer.callback()
    }
    this.currentTime = targetTime
  }
}

function createSystem(completionDurationMs = 20_000) {
  const clock = new FakeClock()
  const mock = new MockExperienceController({ clock, completionDurationMs, stopDelayMs: 200 })
  const firmware = new MockExperienceController({ clock })
  let mockStartCalls = 0
  let mockStopCalls = 0
  const startMock = mock.start.bind(mock)
  const stopMock = mock.stop.bind(mock)
  mock.start = (requestId, operationId) => {
    mockStartCalls += 1
    return startMock(requestId, operationId)
  }
  mock.stop = (requestId, operationId) => {
    mockStopCalls += 1
    return stopMock(requestId, operationId)
  }
  const service = (controller: MockExperienceController): CoordinatedExperienceService & {
    recover(requestId: string): ReturnType<MockExperienceController['recover']>
  } => ({
    selectExperience: (requestId, experienceId) => controller.selectExperience(requestId, experienceId),
    start: (requestId, operationId) => controller.start(requestId, operationId),
    stop: (requestId, operationId) => controller.stop(requestId, operationId),
    queryStatus: requestId => controller.queryStatus(requestId),
    recover: requestId => controller.recover(requestId),
    getExperienceSnapshot: () => controller.getSnapshot(),
    canStart: () => true,
    onStateChange: listener => controller.onStateChange(() => listener()),
  })
  const coordinator = new ExperienceCoordinator({
    mock: service(mock),
    firmware: service(firmware),
  })
  const lifecycle = new ExhibitionLifecycleController(coordinator, mock, clock)
  const handlers = createExperienceIpcHandlers({ mock, firmware }, coordinator, lifecycle)
  const invoke = async (channel: string, payload?: unknown): Promise<unknown> => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return await handler(payload)
  }
  return {
    clock,
    mock,
    firmware,
    coordinator,
    lifecycle,
    invoke,
    get mockStartCalls() { return mockStartCalls },
    get mockStopCalls() { return mockStopCalls },
  }
}

async function selectAndStart(
  system: ReturnType<typeof createSystem>,
  experienceId: 'WIND' | 'WAVE' | 'BUBBLE' = 'WIND',
) {
  const selected = await system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT',
    mode: 'mock',
    experienceId,
    requestId: `select-${experienceId}`,
  }) as { accepted: boolean }
  assert.equal(selected.accepted, true)
  assert.equal(system.lifecycle.getSnapshot().phase, 'STARTING')
  const started = await system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'START',
    mode: 'mock',
    requestId: `start-${experienceId}`,
    operationId: `operation-${experienceId}`,
  }) as { accepted: boolean }
  assert.equal(started.accepted, true)
  assert.equal(system.mockStartCalls, 1)
}

test('duplicate START calls share one device request and later START attempts are rejected', async () => {
  const system = createSystem()
  await system.invoke(IPC_CHANNELS.experienceSelect, {
    experienceId: 'BUBBLE',
    requestId: 'legacy-select',
  })
  const command = {
    type: 'START' as const,
    mode: 'mock' as const,
    requestId: 'start-once',
    operationId: 'one-operation',
  }
  const first = system.lifecycle.start(command)
  const duplicate = system.lifecycle.start({ ...command, requestId: 'duplicate-request' })
  assert.equal(first, duplicate)
  const results = await Promise.all([first, duplicate])
  assert.equal(results.every(result => result.accepted), true)
  assert.equal(system.mockStartCalls, 1)
  await assert.rejects(system.lifecycle.start({
    ...command,
    requestId: 'later-start',
    operationId: 'another-operation',
  }), /cannot START during WAITING/i)
  assert.equal(system.mockStartCalls, 1)
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('Mock exhibition lifecycle follows START confirmation, 5+15 seconds, device completion, and 8-second cooldown', async () => {
  const system = createSystem()
  const phases: string[] = []
  system.lifecycle.subscribe(snapshot => phases.push(snapshot.phase))
  await selectAndStart(system)
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')

  system.clock.advanceBy(4_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
  system.clock.advanceBy(14_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
  system.clock.advanceBy(1)
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')

  await assert.rejects(system.lifecycle.select({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'cooldown-select',
  }), /in progress or cooling down/)
  await assert.rejects(system.lifecycle.start({
    type: 'START', mode: 'mock', requestId: 'cooldown-start', operationId: 'early-start',
  }), /cannot START during COOLDOWN/i)

  system.clock.advanceBy(7_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
  assert.deepEqual(phases, ['STARTING', 'WAITING', 'EXPERIENCE', 'AWAIT_COMPLETION', 'COOLDOWN', 'READY'])
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('late device COMPLETED starts cooldown only after the full 5+15-second cycle', async () => {
  const system = createSystem(25_000)
  await selectAndStart(system, 'WAVE')
  system.clock.advanceBy(20_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT', mode: 'mock', experienceId: 'BUBBLE', requestId: 'await-select',
  }), /in progress or cooling down/)

  system.clock.advanceBy(5_000)
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
  system.clock.advanceBy(8_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('fault stays locked and never recovers or starts another Mock operation', async () => {
  const system = createSystem()
  await selectAndStart(system)
  system.clock.advanceBy(1_500)
  system.mock.simulateFault('SIMULATED_FAULT')
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  assert.equal(system.lifecycle.getSnapshot().faultCode, 'SIMULATED_FAULT')
  system.clock.advanceBy(60_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'fault-select',
  }), /in progress or cooling down/)
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'START', mode: 'mock', requestId: 'fault-start', operationId: 'second-operation',
  }), /cannot START during FAULT/i)
  assert.equal(system.mock.getSnapshot().state, 'FAULT')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('a Mock fault before START also prevents Coordinator auto-recovery on the next SELECT', async () => {
  const system = createSystem()
  system.mock.simulateFault('FAULT_BEFORE_START')
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT', mode: 'mock', experienceId: 'WIND', requestId: 'fault-before-start',
  }), /in progress or cooling down/)
  assert.equal(system.mock.getSnapshot().state, 'FAULT')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('audience IPC cannot select or start firmware experiences', async () => {
  const system = createSystem()
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT', mode: 'firmware', experienceId: 'WIND', requestId: 'firmware-dispatch-select',
  }), /Firmware experience commands are unavailable/)
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'START', mode: 'firmware', requestId: 'firmware-dispatch-start', operationId: 'firmware-op',
  }), /Firmware experience commands are unavailable/)
  await assert.rejects(system.invoke(IPC_CHANNELS.firmwareSelect, {
    experienceId: 'WIND', requestId: 'firmware-legacy-select',
  }), /Firmware experience commands are unavailable/)
  await assert.rejects(system.invoke(IPC_CHANNELS.firmwareStart, {
    requestId: 'firmware-legacy-start', operationId: 'firmware-op',
  }), /Firmware experience commands are unavailable/)
  assert.equal(system.firmware.getSnapshot().selectedExperienceId, null)
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('media failure retains its fault and performs one confirmed internal STOP', async () => {
  const system = createSystem()
  await selectAndStart(system)
  const stopping = system.lifecycle.reportMediaFailure('video-play-failed')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  assert.equal(system.mock.getSnapshot().state, 'STOPPING')
  system.clock.advanceBy(200)
  await stopping
  assert.equal(system.mockStopCalls, 1)
  assert.equal(system.mock.getSnapshot().state, 'IDLE')
  assert.equal(system.lifecycle.getSnapshot().faultCode, 'video-play-failed')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('public audience STOP entry points reject while the internal Coordinator STOP remains available', async () => {
  const system = createSystem()
  await selectAndStart(system)
  const device = system.mock.getSnapshot() as ExperienceSnapshot
  assert.equal(device.state, 'RUNNING')

  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'STOP', mode: 'mock', requestId: 'audience-stop', operationId: 'operation-WIND',
  }), /Audience STOP is unavailable/)
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceStop, {
    requestId: 'legacy-audience-stop', operationId: 'operation-WIND',
  }), /Audience STOP is unavailable/)
  assert.equal(system.mock.getSnapshot().state, 'RUNNING')

  const internalStop = system.coordinator.stop({
    type: 'STOP',
    mode: 'mock',
    requestId: 'system-stop',
    operationId: 'operation-WIND',
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(system.mock.getSnapshot().state, 'STOPPING')
  system.clock.advanceBy(200)
  const internal = await internalStop
  assert.equal('snapshot' in internal, true)
  assert.equal(system.mock.getSnapshot().state, 'IDLE')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})
