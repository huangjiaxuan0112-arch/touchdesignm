import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExperienceClock } from '../desktop/experience/experience-clock'
import { ExhibitionLifecycleController } from '../desktop/experience/exhibition-lifecycle-controller'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import { ExperienceCoordinator, type CoordinatedExperienceService } from '../desktop/electron/experience-coordinator'
import { createExperienceIpcHandlers } from '../desktop/electron/experience-ipc-handlers'
import type { ExperienceSnapshot } from '../desktop/shared/experience-control-protocol'
import { IPC_CHANNELS } from '../desktop/shared/ipc'
import { EXHIBITION_TIMING } from '../desktop/shared/exhibition-lifecycle'

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

function createSystem(completionDurationMs: number = EXHIBITION_TIMING.mockDeviceCompletionMs, startGate?: Promise<void>, requireProjectorMedia = false, mode: 'mock'|'firmware' = 'mock') {
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
    start: (requestId, operationId) => startGate && controller === mock
      ? startGate.then(() => controller.start(requestId, operationId))
      : controller.start(requestId, operationId),
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
  const lifecycle = new ExhibitionLifecycleController(coordinator, mode==='mock'?mock:firmware, clock, { requireProjectorMedia, mode })
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

test('STARTING and pending START do not consume the ten-second waiting deadline', async () => {
  let acknowledge!: () => void
  const ack = new Promise<void>(resolve => { acknowledge = resolve })
  const system = createSystem(30_000, ack)
  await system.lifecycle.select({ type: 'SELECT', mode: 'mock', experienceId: 'WIND', requestId: 'select' })
  system.clock.advanceBy(12_000) // Media can load for any duration before START.
  assert.equal(system.lifecycle.getSnapshot().phase, 'STARTING')
  assert.equal(system.mockStartCalls, 0)
  const pending = system.lifecycle.start({ type: 'START', mode: 'mock', requestId: 'start', operationId: 'op' })
  system.clock.advanceBy(3_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'STARTING')
  acknowledge()
  await pending
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
  system.clock.advanceBy(9_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
  assert.equal(system.mockStartCalls, 1)
  system.lifecycle.dispose(); system.coordinator.dispose()
})

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

test('Mock exhibition lifecycle follows START confirmation, 10-second waiting, 15-second experience and 3-second cooldown', async () => {
  const system = createSystem()
  const phases: string[] = []
  system.lifecycle.subscribe(snapshot => phases.push(snapshot.phase))
  await selectAndStart(system)
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
  system.clock.advanceBy(9_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
  system.clock.advanceBy(14_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
  assert.equal(system.mock.getSnapshot().state, 'RUNNING')
  system.clock.advanceBy(4_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
  system.clock.advanceBy(1)
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
  await system.lifecycle.reportMediaFailure('late-media-error')
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')

  await assert.rejects(system.lifecycle.select({
    type: 'SELECT', mode: 'mock', experienceId: 'WAVE', requestId: 'cooldown-select',
  }), /in progress or cooling down/)
  await assert.rejects(system.lifecycle.start({
    type: 'START', mode: 'mock', requestId: 'cooldown-start', operationId: 'early-start',
  }), /cannot START during COOLDOWN/i)

  system.clock.advanceBy(2_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
  system.clock.advanceBy(1)
  assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
  await system.lifecycle.reportMediaFailure('late-media-error')
  assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
  assert.deepEqual(phases, ['STARTING', 'WAITING', 'EXPERIENCE', 'AWAIT_COMPLETION', 'COOLDOWN', 'READY'])
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

test('late device COMPLETED starts cooldown after the 15-second experience', async () => {
  const system = createSystem(32_000)
  await selectAndStart(system, 'WAVE')
  system.clock.advanceBy(25_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
  await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'SELECT', mode: 'mock', experienceId: 'BUBBLE', requestId: 'await-select',
  }), /in progress or cooling down/)

  system.clock.advanceBy(6_999)
  assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
  system.clock.advanceBy(1)
  assert.equal(system.mock.getSnapshot().state, 'COMPLETED')
  assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
  system.clock.advanceBy(3_000)
  assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
  system.coordinator.dispose()
  system.lifecycle.dispose()
})

for (const experienceId of ['WIND', 'WAVE', 'BUBBLE'] as const) {
  test(`${experienceId} runs one START and cannot skip waiting, experience or cooldown`, async () => {
    const system = createSystem()
    await selectAndStart(system, experienceId)
    assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
    system.clock.advanceBy(10_000)
    assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
    system.clock.advanceBy(14_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
    system.clock.advanceBy(4_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
    system.clock.advanceBy(2_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
    assert.equal(system.mockStartCalls, 1)
    assert.equal(system.mockStopCalls, 0)
    system.lifecycle.dispose(); system.coordinator.dispose()
  })
}

for (const elapsed of [1_000, 11_000, 26_000, 29_000]) {
  for (const kind of ['fault', 'disconnect', 'media-error', 'stop'] as const) {
    test(`${kind} at T=${elapsed} cancels future transitions without another START`, async () => {
      const system = createSystem()
      await selectAndStart(system)
      system.clock.advanceBy(elapsed)
      let stopping: Promise<unknown> | undefined
      if (kind === 'fault') system.mock.simulateFault('TEST_FAULT')
      if (kind === 'disconnect') system.mock.simulateConnectionLoss()
      if (kind === 'media-error') stopping = system.lifecycle.reportMediaFailure('video-load-failed')
      if (kind === 'stop') stopping = system.coordinator.stop({
        type: 'STOP', mode: 'mock', requestId: 'internal-stop', operationId: 'operation-WIND',
      })
      await Promise.resolve(); await Promise.resolve()
      system.clock.advanceBy(60_000)
      await stopping
      assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
      assert.equal(system.mockStartCalls, 1)
      await assert.rejects(system.lifecycle.start({
        type: 'START', mode: 'mock', requestId: 'late-start', operationId: 'late-op',
      }), /cannot START during FAULT/)
      system.lifecycle.dispose(); system.coordinator.dispose()
    })
  }
}

test('media failure before readiness never starts; failure during pending START stops its late operation', async () => {
  const before = createSystem()
  await before.lifecycle.select({ type: 'SELECT', mode: 'mock', experienceId: 'WIND', requestId: 'select' })
  await before.lifecycle.reportMediaFailure('media-prepare-failed')
  before.clock.advanceBy(60_000)
  assert.equal(before.mockStartCalls, 0)
  assert.equal(before.lifecycle.getSnapshot().phase, 'FAULT')
  before.lifecycle.dispose(); before.coordinator.dispose()

  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const system = createSystem(30_000, gate)
  await system.lifecycle.select({ type: 'SELECT', mode: 'mock', experienceId: 'WIND', requestId: 'select' })
  const pending = system.lifecycle.start({ type: 'START', mode: 'mock', requestId: 'start', operationId: 'op' })
  const rejected = assert.rejects(pending, /cancelled|invalidated/)
  const stopping = system.lifecycle.reportMediaFailure('video-load-failed')
  release()
  // Flush the delayed ACK and Coordinator's internal STOP before advancing the clock.
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(system.mock.getSnapshot().state, 'STOPPING')
  system.clock.advanceBy(200)
  await stopping; await rejected
  system.clock.advanceBy(60_000)
  assert.equal(system.mock.getSnapshot().state, 'IDLE')
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  assert.equal(system.mockStartCalls, 1)
  assert.equal(system.mockStopCalls, 1)
  system.lifecycle.dispose(); system.coordinator.dispose()
})

test('fault stays locked and never recovers or starts another Mock operation', async () => {
  const system = createSystem()
  await selectAndStart(system)
  system.clock.advanceBy(1_500)
  system.mock.simulateFault('SIMULATED_FAULT')
  assert.equal(system.lifecycle.getSnapshot().phase, 'FAULT')
  assert.equal(system.lifecycle.getSnapshot().faultCode, 'SIMULATED_FAULT')
  await system.lifecycle.reportMediaFailure('late-media-error')
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

for (const completionMs of [30_000, 32_000]) {
  test('formal Cooldown starts only at confirmed completion + 3s ('+completionMs+')', async () => {
    const system = createSystem(completionMs)
    await selectAndStart(system)
    system.clock.advanceBy(29_999)
    assert.equal(system.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
    system.clock.advanceBy(completionMs-29_999)
    assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
    assert.equal(EXHIBITION_TIMING.cooldownMs,3_000)
    system.clock.advanceBy(2_999)
    assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
    await assert.rejects(system.lifecycle.start({type:'START',mode:'mock',requestId:'early',operationId:'early'}),/cannot START during COOLDOWN/)
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase,'READY')
    assert.equal(system.clock.now(),completionMs+3_000)
    assert.equal(system.mockStartCalls,1)
    system.lifecycle.dispose();system.coordinator.dispose()
  })
}

// Step 4B: the Electron composition root always enables this gate.
const projectorStart = { type: 'START' as const, mode: 'mock' as const, requestId: 'start-link', operationId: 'link-round' }
function mediaReport(system: ReturnType<typeof createSystem>, event: 'ready' | 'playing' | 'ended' | 'error', extra = {}) {
  return system.lifecycle.reportProjectorMedia({ event, experienceId: 'WIND', operationId: projectorStart.operationId,
    occurredAtMs: system.clock.now(), durationSeconds: 25, currentTime: event === 'ended' ? 25 : 0, ...extra })
}
async function selectLinked(system: ReturnType<typeof createSystem>, experienceId: 'WIND' | 'WAVE' | 'BUBBLE' = 'WIND') {
  await system.lifecycle.select({ type: 'SELECT', mode: 'mock', experienceId, requestId: 'select-link' })
}
for (const mode of ['WIND', 'WAVE', 'BUBBLE'] as const) test('linked '+mode+': readiness gate, one START, ACK 0/10/25/30/33-second stages', async () => {
  const system = createSystem(30_000, undefined, true)
  try {
    await selectLinked(system, mode)
    const pending = system.lifecycle.start(projectorStart)
    assert.equal(system.lifecycle.getSnapshot().operationId, 'link-round')
    assert.equal(system.mockStartCalls, 0)
    system.clock.advanceBy(1_000)
    assert.equal(system.lifecycle.getSnapshot().phase, 'STARTING')
    assert.equal(await mediaReport(system, 'ready', { experienceId: mode }), true)
    assert.equal((await pending).accepted, true)
    const ack = system.clock.now()
    assert.equal(system.lifecycle.getSnapshot().startAcknowledgedAtMs, ack)
    assert.equal(system.mockStartCalls, 1)
    assert.equal(await mediaReport(system, 'ready', { experienceId: mode }), false)
    assert.equal(await mediaReport(system, 'playing', { experienceId: mode }), true)
    assert.equal(await mediaReport(system, 'playing', { experienceId: mode }), false)
    system.clock.advanceBy(9_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'WAITING')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'EXPERIENCE')
    system.clock.advanceBy(15_000)
    assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
    assert.equal(await mediaReport(system, 'ended', { experienceId: mode }), true)
    assert.equal(await mediaReport(system, 'ended', { experienceId: mode }), false)
    await assert.rejects(system.lifecycle.start({ ...projectorStart, operationId: 'repeat' }))
    assert.equal(system.mock.getSnapshot().state, 'RUNNING')
    system.clock.advanceBy(4_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'AWAIT_COMPLETION')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
    system.clock.advanceBy(2_999)
    assert.equal(system.lifecycle.getSnapshot().phase, 'COOLDOWN')
    system.clock.advanceBy(1)
    assert.equal(system.lifecycle.getSnapshot().phase, 'READY')
    assert.equal(system.mockStartCalls, 1)
  } finally { system.lifecycle.dispose();system.coordinator.dispose() }
})
test('linked duplicate pending START shares one request; stale/wrong-mode ready cannot release gate', async () => {
  const system=createSystem(30_000, undefined, true)
  await selectLinked(system)
  const first=system.lifecycle.start(projectorStart)
  assert.equal(system.lifecycle.start({ ...projectorStart, requestId:'duplicate' }), first)
  assert.equal(await mediaReport(system,'ready',{operationId:'old-round'}),false)
  assert.equal(await mediaReport(system,'ready',{experienceId:'BUBBLE'}),false)
  assert.equal(system.mockStartCalls,0)
  await mediaReport(system,'ready');await first
  assert.equal(system.mockStartCalls,1)
  system.lifecycle.dispose();system.coordinator.dispose()
})
for (const cause of ['timeout','load-error','invalid-duration','closed','disconnect','fault'] as const) test('linked preparation '+cause+' never STARTs or revives from late ready',async()=>{
  const system=createSystem(30_000, undefined, true)
  await selectLinked(system)
  const pending=system.lifecycle.start(projectorStart)
  const rejected=assert.rejects(pending)
  if(cause==='timeout') system.clock.advanceBy(15_000)
  else if(cause==='load-error') await mediaReport(system,'error')
  else if(cause==='invalid-duration') await mediaReport(system,'ready',{durationSeconds:15})
  else if(cause==='closed') await system.lifecycle.reportMediaFailure('PROJECTOR_CLOSED')
  else if(cause==='disconnect') system.mock.simulateConnectionLoss()
  else system.mock.simulateFault('fixture')
  await rejected
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  assert.equal(system.mockStartCalls,0)
  assert.equal(system.mockStopCalls,0)
  assert.equal(await mediaReport(system,'ready'),false)
  await assert.rejects(system.lifecycle.start(projectorStart))
  system.clock.advanceBy(60_000)
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  system.lifecycle.dispose();system.coordinator.dispose()
})
test('linked media failure while START ACK is pending stops the late operation exactly once',async()=>{
  let acknowledge!:()=>void
  const gate=new Promise<void>(resolve=>{acknowledge=resolve})
  const system=createSystem(30_000,gate,true)
  await selectLinked(system)
  const pending=system.lifecycle.start(projectorStart)
  const rejected=assert.rejects(pending)
  await mediaReport(system,'ready')
  await Promise.resolve();await Promise.resolve()
  const stopping=system.lifecycle.reportMediaFailure('PROJECTOR_CLOSED')
  acknowledge()
  for(let i=0;i<20;i++)await Promise.resolve()
  system.clock.advanceBy(200)
  await stopping;await rejected
  assert.equal(system.mockStartCalls,1)
  assert.equal(system.mockStopCalls,1)
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  assert.equal(await mediaReport(system,'ready'),false)
  system.lifecycle.dispose();system.coordinator.dispose()
})
for(const stage of [1_000,11_000,26_000]) test('linked playback error at '+stage+' latches FAULT and stops once',async()=>{
  const system=createSystem(30_000,undefined,true)
  await selectLinked(system)
  const pending=system.lifecycle.start(projectorStart)
  await mediaReport(system,'ready');await pending;await mediaReport(system,'playing')
  system.clock.advanceBy(stage)
  const failure=mediaReport(system,'error')
  for(let i=0;i<20;i++)await Promise.resolve()
  system.clock.advanceBy(200)
  await failure
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  assert.equal(system.mockStartCalls,1);assert.equal(system.mockStopCalls,1)
  assert.equal(await mediaReport(system,'ready'),false)
  system.clock.advanceBy(60_000)
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  system.lifecycle.dispose();system.coordinator.dispose()
})
for(const failure of ['no-playing','early-ended','missing-ended']) test('linked '+failure+' does not report a successful exhibition',async()=>{
  const system=createSystem(30_000,undefined,true)
  await selectLinked(system)
  const pending=system.lifecycle.start(projectorStart)
  await mediaReport(system,'ready');await pending
  if(failure!=='no-playing')await mediaReport(system,'playing')
  let report:Promise<unknown>|undefined
  if(failure==='early-ended') report=mediaReport(system,'ended')
  else system.clock.advanceBy(failure==='no-playing'?10_000:30_000)
  for(let i=0;i<20;i++)await Promise.resolve()
  system.clock.advanceBy(200)
  await report
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  assert.equal(system.mockStartCalls,1)
  system.lifecycle.dispose();system.coordinator.dispose()
})

test('linked close wins ready resolution before the device START microtask',async()=>{
  const system=createSystem(30_000,undefined,true)
  await selectLinked(system)
  const pending=system.lifecycle.start(projectorStart)
  const rejected=assert.rejects(pending)
  const ready=mediaReport(system,'ready')
  const closing=system.lifecycle.reportMediaFailure('PROJECTOR_CLOSED')
  await ready;await closing;await rejected
  assert.equal(system.mockStartCalls,0)
  assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
  assert.equal(await mediaReport(system,'ready'),false)
  system.lifecycle.dispose();system.coordinator.dispose()
})

test('existing lifecycle accepts injected firmware source completion, keeps 3s cooldown and rejects cross-mode START',async()=>{
 const system=createSystem(25_000,undefined,false,'firmware')
 await system.lifecycle.select({type:'SELECT',mode:'firmware',experienceId:'WAVE',requestId:'f-select'})
 await assert.rejects(system.lifecycle.start({type:'START',mode:'mock',requestId:'bad',operationId:'bad'}),/mode mismatch/)
 const starting=system.lifecycle.start({type:'START',mode:'firmware',requestId:'f-start',operationId:'f-op'})
 system.clock.advanceBy(800);await starting
 system.clock.advanceBy(24_999);assert.equal(system.lifecycle.getSnapshot().phase,'EXPERIENCE')
 system.clock.advanceBy(1);assert.equal(system.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
 system.clock.advanceBy(4_999);assert.equal(system.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
 system.clock.advanceBy(1);assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
 system.clock.advanceBy(2_999);assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
 system.clock.advanceBy(1);assert.equal(system.lifecycle.getSnapshot().phase,'READY')
 system.lifecycle.dispose();system.coordinator.dispose()
})

test('trusted firmware source routes existing audience intents and STATUS without renderer selecting device',async()=>{
 const system=createSystem(25_000,undefined,false,'firmware')
 let starts=0;const realStart=system.firmware.start.bind(system.firmware)
 system.firmware.start=(r,o)=>{starts++;return realStart(r,o)}
 await system.invoke(IPC_CHANNELS.experienceDispatch,{type:'SELECT',mode:'mock',experienceId:'WIND',requestId:'select-ui'})
 assert.equal(system.firmware.getSnapshot().selectedExperienceId,'WIND')
 assert.equal(system.mock.getSnapshot().selectedExperienceId,null)
 const visible=await system.invoke(IPC_CHANNELS.experienceGetSnapshot,'mock') as {mode:string;deviceSource:string}
 assert.equal(visible.mode,'mock');assert.equal(visible.deviceSource,'firmware')
 await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch,{type:'START',mode:'firmware',requestId:'bypass',operationId:'bypass'}),/unavailable/)
 const starting=system.invoke(IPC_CHANNELS.experienceDispatch,{type:'START',mode:'mock',requestId:'ui-start',operationId:'ui-op'})
 system.clock.advanceBy(800);await starting
 const status=await system.invoke(IPC_CHANNELS.experienceDispatch,{type:'STATUS',mode:'mock',requestId:'ui-status'}) as {snapshot:{state:string}}
 assert.equal(status.snapshot.state,'RUNNING');assert.equal(starts,1);assert.equal(system.mockStartCalls,0)
 system.clock.advanceBy(29_999);assert.equal(system.lifecycle.getSnapshot().phase,'AWAIT_COMPLETION')
 system.clock.advanceBy(1);assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
 await assert.rejects(system.invoke(IPC_CHANNELS.experienceDispatch,{type:'START',mode:'mock',requestId:'repeat',operationId:'repeat'}),/COOLDOWN/)
 system.clock.advanceBy(3_000);assert.equal(system.lifecycle.getSnapshot().phase,'READY');assert.equal(starts,1)
 system.lifecycle.dispose();system.coordinator.dispose()
})

test('firmware START waits for the reviewed 500ms pump-off and 300ms valve-settle window',async()=>{
 const system=createSystem(30_000,undefined,true,'firmware')
 let starts=0;const realStart=system.firmware.start.bind(system.firmware)
 system.firmware.start=(requestId,operationId)=>{starts++;return realStart(requestId,operationId)}
 await system.lifecycle.select({type:'SELECT',mode:'firmware',experienceId:'WIND',requestId:'settle-select'})
 const operationId='settle-operation'
 const pending=system.lifecycle.start({type:'START',mode:'firmware',requestId:'settle-start',operationId})
 assert.equal(await system.lifecycle.reportProjectorMedia({
   event:'ready',experienceId:'WIND',operationId,occurredAtMs:system.clock.now(),durationSeconds:25,currentTime:0,
 }),true)
 await Promise.resolve()
 assert.equal(starts,0)
 assert.equal(system.lifecycle.getSnapshot().phase,'STARTING')
 system.clock.advanceBy(799);await Promise.resolve()
 assert.equal(starts,0)
 system.clock.advanceBy(1)
 assert.equal((await pending).accepted,true)
 assert.equal(starts,1)
 assert.equal(system.lifecycle.getSnapshot().phase,'WAITING')
 assert.equal(system.lifecycle.getSnapshot().startAcknowledgedAtMs,800)
 system.lifecycle.dispose();system.coordinator.dispose()
})

test('a second iPad-style firmware selection is accepted immediately after the 3s cooldown',async()=>{
 const system=createSystem(30_000,undefined,true,'firmware')
 let starts=0;const realStart=system.firmware.start.bind(system.firmware)
 system.firmware.start=(requestId,operationId)=>{starts++;return realStart(requestId,operationId)}
 const runRound=async(experienceId:'WIND'|'WAVE',operationId:string)=>{
   await system.lifecycle.select({type:'SELECT',mode:'firmware',experienceId,requestId:`select-${operationId}`})
   const pending=system.lifecycle.start({type:'START',mode:'firmware',requestId:`start-${operationId}`,operationId})
   await system.lifecycle.reportProjectorMedia({event:'ready',experienceId,operationId,
     occurredAtMs:system.clock.now(),durationSeconds:25,currentTime:0})
   system.clock.advanceBy(800);await pending
   await system.lifecycle.reportProjectorMedia({event:'playing',experienceId,operationId,
     occurredAtMs:system.clock.now(),currentTime:0})
   system.clock.advanceBy(25_000)
   await system.lifecycle.reportProjectorMedia({event:'ended',experienceId,operationId,
     occurredAtMs:system.clock.now(),currentTime:25})
   system.clock.advanceBy(5_000)
   assert.equal(system.lifecycle.getSnapshot().phase,'COOLDOWN')
   system.clock.advanceBy(3_000)
   assert.equal(system.lifecycle.getSnapshot().phase,'READY')
 }
 await runRound('WIND','first-round')
 assert.equal(starts,1)

 // No visitor-facing wait is required after READY.  The new SELECT succeeds
 // immediately; only the internal pre-START guard remains in STARTING.
 await system.lifecycle.select({type:'SELECT',mode:'firmware',experienceId:'WAVE',requestId:'second-select'})
 assert.equal(system.lifecycle.getSnapshot().phase,'STARTING')
 const pending=system.lifecycle.start({type:'START',mode:'firmware',requestId:'second-start',operationId:'second-round'})
 await system.lifecycle.reportProjectorMedia({event:'ready',experienceId:'WAVE',operationId:'second-round',
   occurredAtMs:system.clock.now(),durationSeconds:25,currentTime:0})
 system.clock.advanceBy(799);await Promise.resolve()
 assert.equal(starts,1)
 system.clock.advanceBy(1);await pending
 assert.equal(starts,2)
 assert.equal(system.lifecycle.getSnapshot().phase,'WAITING')
 system.lifecycle.dispose();system.coordinator.dispose()
})

test('operator recovery is explicit, requires inactive device and never STARTs',async()=>{
 const system=createSystem()
 await selectAndStart(system)
 system.mock.simulateFault('operator-test')
 assert.throws(()=>system.lifecycle.resetAfterOperatorRecovery(),/inactive/)
 system.mock.recover('manual-recover')
 assert.equal(system.lifecycle.getSnapshot().phase,'FAULT')
 system.lifecycle.resetAfterOperatorRecovery()
 assert.equal(system.lifecycle.getSnapshot().phase,'READY');assert.equal(system.mockStartCalls,1)
 system.clock.advanceBy(60_000);assert.equal(system.lifecycle.getSnapshot().phase,'READY');assert.equal(system.mockStartCalls,1)
 system.lifecycle.dispose();system.coordinator.dispose()
})

test('unconnected or wrong-version device refuses selection without faulting READY',async()=>{
 const system=createSystem()
 const locked=new ExhibitionLifecycleController(system.coordinator,system.mock,system.clock,{canSelect:()=>false})
 await assert.rejects(locked.select({type:'SELECT',mode:'mock',experienceId:'WIND',requestId:'locked'}),/Device is not ready/)
 assert.equal(locked.getSnapshot().phase,'READY');assert.equal(system.mockStartCalls,0)
 locked.dispose();system.lifecycle.dispose();system.coordinator.dispose()
})
