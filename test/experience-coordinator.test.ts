import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import type { ExperienceClock } from '../desktop/experience/experience-clock'
import { ExperienceCoordinator, type CoordinatedExperienceService } from '../desktop/electron/experience-coordinator'
import { createExperienceIpcHandlers } from '../desktop/electron/experience-ipc-handlers'
import { IPC_CHANNELS } from '../desktop/shared/ipc'
import { EXPERIENCE_DEFINITIONS } from '../desktop/shared/experience-definitions'
import type {
  ExperienceAcknowledgement,
  ExperienceSnapshot as DeviceExperienceSnapshot,
  ExperienceStatusResponse,
} from '../desktop/shared/experience-control-protocol'
import {
  isExperienceSnapshot,
  type ExperienceCommand,
  type ExperienceMode,
} from '../desktop/shared/experience-application-contract'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

class FakeClock implements ExperienceClock {
  private currentTime = 0
  private readonly timers: Array<{ dueAt: number; callback: () => void }> = []

  now(): number { return this.currentTime }

  schedule(callback: () => void, delayMs: number): () => void {
    const timer = { dueAt: this.currentTime + delayMs, callback }
    this.timers.push(timer)
    return () => {
      const index = this.timers.indexOf(timer)
      if (index >= 0) this.timers.splice(index, 1)
    }
  }

  advanceBy(milliseconds: number): void {
    const target = this.currentTime + milliseconds
    while (true) {
      this.timers.sort((left, right) => left.dueAt - right.dueAt)
      const timer = this.timers[0]
      if (!timer || timer.dueAt > target) break
      this.timers.shift()
      this.currentTime = timer.dueAt
      timer.callback()
    }
    this.currentTime = target
  }
}

function snapshot(
  state: DeviceExperienceSnapshot['state'] = 'IDLE',
  operationId: string | null = null,
  selectedExperienceId: DeviceExperienceSnapshot['selectedExperienceId'] = 'WAVE',
): DeviceExperienceSnapshot {
  return {
    state,
    selectedExperienceId,
    operationId,
    elapsedMs: 0,
    durationMs: state === 'RUNNING' ? 30_000 : null,
    progress: 0,
    faultCode: null,
  }
}

function ack(
  type: 'SELECT' | 'START' | 'STOP' | 'RECOVER',
  requestId: string,
  accepted = true,
  state: DeviceExperienceSnapshot['state'] = 'IDLE',
  operationId?: string,
): ExperienceAcknowledgement {
  return {
    type: accepted ? 'ACK' : 'NACK',
    requestId,
    command: type,
    accepted,
    state,
    ...(operationId ? { operationId } : {}),
    ...(!accepted ? { code: 'INVALID_STATE' } : {}),
  }
}

class FakeExperienceService implements CoordinatedExperienceService {
  current = snapshot()
  ready = true
  starts = 0
  stops = 0
  recoveries = 0
  stopAccepted = true
  statusAccepted = true
  selects: string[] = []
  actions: string[] = []
  startDeferred: ReturnType<typeof deferred<ExperienceAcknowledgement>> | undefined
  stopDeferred: ReturnType<typeof deferred<ExperienceAcknowledgement>> | undefined
  private readonly listeners = new Set<() => void>()

  getExperienceSnapshot(): DeviceExperienceSnapshot { return { ...this.current } }
  canStart(): boolean { return this.ready }
  onStateChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  selectExperience(requestId: string, experienceId: 'WIND' | 'WAVE' | 'BUBBLE'): ExperienceAcknowledgement {
    this.actions.push('SELECT')
    this.selects.push(experienceId)
    this.current = snapshot('IDLE', null, experienceId)
    this.emit()
    return ack('SELECT', requestId)
  }
  start(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    this.actions.push('START')
    this.starts++
    if (this.startDeferred) return this.startDeferred.promise
    this.current = snapshot('RUNNING', operationId, this.current.selectedExperienceId)
    this.emit()
    return Promise.resolve(ack('START', requestId, true, 'RUNNING', operationId))
  }
  stop(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    this.actions.push('STOP')
    this.stops++
    if (this.stopDeferred) return this.stopDeferred.promise
    if (!this.stopAccepted) return Promise.resolve(ack('STOP', requestId, false, this.current.state, operationId))
    if (this.current.state !== 'RUNNING' || this.current.operationId !== operationId) {
      return Promise.resolve(ack('STOP', requestId, false, this.current.state, operationId))
    }
    this.current = snapshot('IDLE', null, this.current.selectedExperienceId)
    this.emit()
    return Promise.resolve(ack('STOP', requestId, true, 'IDLE', operationId))
  }
  queryStatus(requestId: string): ExperienceStatusResponse {
    return {
      type: 'STATUS',
      requestId,
      acknowledgement: {
        type: this.statusAccepted ? 'ACK' : 'NACK',
        requestId,
        command: 'STATUS_QUERY',
        accepted: this.statusAccepted,
        state: this.current.state,
        ...(!this.statusAccepted ? { code: 'STATUS_UNAVAILABLE' } : {}),
      },
      snapshot: this.getExperienceSnapshot(),
    }
  }
  recover(requestId: string): ExperienceAcknowledgement {
    this.recoveries++
    this.actions.push('RECOVER')
    if (this.current.state !== 'FAULT') return ack('RECOVER', requestId, false, this.current.state)
    this.current = snapshot('IDLE', null, null)
    this.emit()
    return ack('RECOVER', requestId, true, 'IDLE')
  }
  setState(value: DeviceExperienceSnapshot['state'], ready = this.ready, faultCode: string | null = null): void {
    this.current = snapshot(value, value === 'RUNNING' || value === 'STOPPING' || value === 'COMPLETED'
      ? this.current.operationId : null,
      this.current.selectedExperienceId)
    this.current.faultCode = faultCode
    this.ready = ready
    this.emit()
  }
  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function setup() {
  const mock = new FakeExperienceService()
  const firmware = new FakeExperienceService()
  const coordinator = new ExperienceCoordinator({ mock, firmware })
  return { coordinator, mock, firmware }
}

function select(mode: ExperienceMode = 'mock', id: 'WIND' | 'WAVE' | 'BUBBLE' = 'WAVE'): ExperienceCommand {
  return { type: 'SELECT', mode, experienceId: id, requestId: 'select-1' }
}

function start(mode: ExperienceMode = 'mock', operationId = 'operation-1'): ExperienceCommand {
  return { type: 'START', mode, requestId: 'start-1', operationId }
}

function stop(mode: ExperienceMode = 'mock', operationId = 'operation-1'): ExperienceCommand {
  return { type: 'STOP', mode, requestId: 'stop-1', operationId }
}

test('select and start coordinate through the injected service', async () => {
  const { coordinator, mock } = setup()
  assert.equal((await coordinator.select(select())).accepted, true)
  assert.equal((await coordinator.start(start())).accepted, true)
  assert.deepEqual(mock.selects, ['WAVE'])
  assert.equal(mock.starts, 1)
  assert.equal(coordinator.getSnapshot('mock').experience.operationId, 'operation-1')
  coordinator.dispose()
})

test('switching a RUNNING experience confirms STOP before selecting the next mode', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')

  const result = await coordinator.select(select('mock', 'WIND'))

  assert.equal(result.accepted, true)
  assert.deepEqual(mock.actions, ['STOP', 'SELECT'])
  assert.equal(mock.stops, 1)
  assert.equal(mock.selects.length, 1)
  assert.equal(coordinator.getSnapshot('mock').experience.selectedExperienceId, 'WIND')
  coordinator.dispose()
})

test('switching during pending START waits for its ACK, stops it, then selects', async () => {
  const { coordinator, mock } = setup()
  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const starting = coordinator.start(start())
  const selecting = coordinator.select(select('mock', 'WIND'))

  assert.equal(mock.starts, 1)
  assert.equal(mock.stops, 0)
  assert.deepEqual(mock.selects, [])
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.startDeferred.resolve(ack('START', 'start-1', true, 'RUNNING', 'operation-1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mock.stops, 1)
  assert.deepEqual(mock.selects, [])

  mock.setState('IDLE')
  mock.stopDeferred.resolve(ack('STOP', 'internal-stop', true, 'IDLE', 'operation-1'))
  assert.equal((await selecting).accepted, true)
  await assert.rejects(starting, /cancelled/)
  assert.deepEqual(mock.actions, ['START', 'STOP', 'SELECT'])
  coordinator.dispose()
})

test('real MockController STOPPING transition is observed before selection', async () => {
  const mockController = new MockExperienceController({ stopDelayMs: 20 })
  const firmware = new FakeExperienceService()
  const mockService: CoordinatedExperienceService & {
    recover(requestId: string): ExperienceAcknowledgement
  } = {
    selectExperience: (requestId, experienceId) =>
      mockController.selectExperience(requestId, experienceId),
    start: (requestId, operationId) => mockController.start(requestId, operationId),
    stop: (requestId, operationId) => mockController.stop(requestId, operationId),
    queryStatus: requestId => mockController.queryStatus(requestId),
    recover: requestId => mockController.recover(requestId),
    getExperienceSnapshot: () => mockController.getSnapshot(),
    canStart: () => true,
    onStateChange: listener => mockController.onStateChange(() => listener()),
  }
  const coordinator = new ExperienceCoordinator({ mock: mockService, firmware })
  await coordinator.select(select('mock', 'WAVE'))
  await coordinator.start(start())

  const selected = await coordinator.select({
    ...select('mock', 'BUBBLE'),
    requestId: 'select-bubble',
  })

  assert.equal(selected.accepted, true)
  assert.equal(mockController.getSnapshot().state, 'IDLE')
  assert.equal(mockController.getSnapshot().selectedExperienceId, 'BUBBLE')
  coordinator.dispose()
})

test('failed or unconfirmed STOP prevents selection', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.stopAccepted = false

  await assert.rejects(coordinator.select(select('mock', 'WIND')), /STOP rejected/)

  assert.deepEqual(mock.actions, ['STOP'])
  assert.equal(mock.selects.length, 0)
  assert.equal(coordinator.getSnapshot('mock').experience.state, 'RUNNING')
  coordinator.dispose()
})

test('an uncertain stop state does not allow selection to proceed', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const selecting = coordinator.select(select('mock', 'WIND'))
  mock.setState('FAULT', false, 'HOST_TIMEOUT')
  mock.stopDeferred.resolve(ack('STOP', 'internal-stop', true, 'IDLE', 'operation-1'))

  await assert.rejects(selecting, /safe experience switch/)
  assert.equal(mock.selects.length, 0)
  coordinator.dispose()
})

test('a rejected STATUS cannot confirm an inactive snapshot or permit switching', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.statusAccepted = false

  await assert.rejects(coordinator.select(select('mock', 'WIND')), /STATUS rejected/)

  assert.equal(mock.stops, 1)
  assert.equal(mock.selects.length, 0)
  coordinator.dispose()
})

test('an explicit Mock selection after FAULT performs Mock RECOVER then SELECT', async () => {
  const { coordinator, mock, firmware } = setup()
  mock.setState('FAULT', false, 'SIMULATED_FAULT')

  const result = await coordinator.select(select('mock', 'BUBBLE'))

  assert.equal(result.accepted, true)
  assert.deepEqual(mock.actions, ['RECOVER', 'SELECT'])
  assert.equal(mock.recoveries, 1)
  assert.equal(firmware.recoveries, 0)
  coordinator.dispose()
})

test('duplicate concurrent selection does not repeat STOP or SELECT', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const first = coordinator.select(select('mock', 'WIND'))
  await assert.rejects(coordinator.select({ ...select('mock', 'BUBBLE'), requestId: 'select-2' }),
    /selection is already pending/)
  assert.equal(mock.stops, 1)
  assert.equal(mock.selects.length, 0)

  mock.setState('IDLE')
  mock.stopDeferred.resolve(ack('STOP', 'internal-stop', true, 'IDLE', 'operation-1'))
  assert.equal((await first).accepted, true)
  assert.deepEqual(mock.selects, ['WIND'])
  coordinator.dispose()
})

test('Firmware FAULT never invokes Mock recovery or firmware auto-recovery', async () => {
  const { coordinator, mock, firmware } = setup()
  firmware.setState('FAULT', false, 'HOST_TIMEOUT')

  await assert.rejects(coordinator.select(select('firmware', 'WIND')))

  assert.equal(mock.recoveries, 0)
  assert.equal(firmware.recoveries, 0)
  assert.equal(firmware.selects.length, 0)
  coordinator.dispose()
})

test('concurrent duplicate START for one operation shares one underlying request', async () => {
  const { coordinator, mock } = setup()
  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  const first = coordinator.start(start())
  const duplicate = coordinator.start({ ...start(), requestId: 'start-2' })
  assert.equal(mock.starts, 1)
  assert.equal(first, duplicate)
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.startDeferred.resolve(ack('START', 'start-1', true, 'RUNNING', 'operation-1'))
  assert.equal((await duplicate).accepted, true)
  coordinator.dispose()
})

test('rejects START unless the service is ready and the authoritative state is selected IDLE', async () => {
  const { coordinator, mock, firmware } = setup()
  mock.ready = false
  await assert.rejects(coordinator.start(start()), /Cannot start/)
  assert.equal(mock.starts, 0)
  mock.ready = true
  mock.current = snapshot('FAULT', null)
  await assert.rejects(coordinator.start(start()), /Cannot start/)
  firmware.ready = false
  await assert.rejects(coordinator.start(start('firmware')), /Cannot start/)
  assert.equal(firmware.starts, 0)
  coordinator.dispose()
})

test('STOP during pending START waits for ACK then stops the same operation once', async () => {
  const { coordinator, mock } = setup()
  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const starting = coordinator.start(start())
  const stopping = coordinator.stop(stop())
  assert.equal(mock.starts, 1)
  assert.equal(mock.stops, 0)

  mock.current = snapshot('RUNNING', 'operation-1')
  mock.startDeferred.resolve(ack('START', 'start-1', true, 'RUNNING', 'operation-1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mock.stops, 1)

  mock.current = snapshot('IDLE')
  mock.stopDeferred.resolve(ack('STOP', 'stop-1', true, 'IDLE', 'operation-1'))
  const stopResult = await stopping
  assert.ok('snapshot' in stopResult)
  assert.ok(stopResult.snapshot.state === 'IDLE' || stopResult.snapshot.state === 'COMPLETED')
  await assert.rejects(starting, /cancelled/)
  coordinator.dispose()
})

test('concurrent STOP requests for one operation share one stop and its confirmed result', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()

  const first = coordinator.stop(stop())
  const duplicate = coordinator.stop({ ...stop(), requestId: 'stop-2' })
  assert.equal(first, duplicate)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mock.stops, 1)

  mock.setState('STOPPING')
  mock.setState('IDLE')
  mock.stopDeferred.resolve(ack('STOP', 'stop-1', true, 'IDLE', 'operation-1'))
  const firstResult = await first
  const duplicateResult = await duplicate

  assert.equal(firstResult, duplicateResult)
  assert.ok('snapshot' in firstResult)
  assert.equal(firstResult.snapshot.state, 'IDLE')
  assert.equal(mock.stops, 1)
  coordinator.dispose()
})

test('STOP NACK and timeout never become confirmed inactive state', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  mock.stopAccepted = false

  const rejected = await coordinator.stop(stop())
  assert.ok('accepted' in rejected)
  assert.equal(rejected.accepted, false)
  assert.equal(coordinator.getSnapshot('mock').experience.state, 'RUNNING')

  mock.stopAccepted = true
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const timedOut = coordinator.stop({ ...stop(), requestId: 'stop-timeout' })
  await new Promise(resolve => setImmediate(resolve))
  mock.stopDeferred.reject(new Error('STOP timeout'))
  await assert.rejects(timedOut, /STOP timeout/)
  assert.equal(coordinator.getSnapshot('mock').experience.state, 'RUNNING')
  coordinator.dispose()
})

test('STOP after a rejected pending START does not send an unnecessary STOP', async () => {
  const { coordinator, mock } = setup()
  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  const starting = coordinator.start(start())
  const stopping = coordinator.stop(stop())
  mock.startDeferred.resolve(ack('START', 'start-1', false))
  const stopResult = await stopping
  assert.ok('snapshot' in stopResult)
  assert.equal(stopResult.snapshot.state, 'IDLE')
  assert.equal((await starting).accepted, false)
  assert.equal(mock.stops, 0)
  coordinator.dispose()
})

for (const [label, terminalState, ready, faultCode] of [
  ['FAULT', 'FAULT', false, 'HARDWARE_FAULT'],
  ['DEVICE_RESET', 'FAULT', false, 'DEVICE_RESET'],
  ['DISCONNECT', 'IDLE', false, null],
] as const) {
  test(`${label} invalidates a pending START and ignores its late ACK`, async () => {
    const { coordinator, mock } = setup()
    mock.startDeferred = deferred<ExperienceAcknowledgement>()
    const starting = coordinator.start(start())
    mock.setState(terminalState, ready, faultCode)
    mock.startDeferred.resolve(ack('START', 'start-1', true, 'RUNNING', 'operation-1'))
    await assert.rejects(starting, /invalidated/)
    assert.equal(coordinator.getSnapshot('mock').experience.state, terminalState)
    assert.equal(mock.starts, 1)
    coordinator.dispose()
  })
}

test('a later generation cannot be affected by an older pending START result', async () => {
  const { coordinator, mock } = setup()
  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  const starting = coordinator.start(start())
  mock.setState('FAULT', false)
  mock.current = snapshot('IDLE')
  mock.ready = true
  const selection = await coordinator.select(select('mock', 'WIND'))
  assert.equal(selection.accepted, true)
  mock.startDeferred.resolve(ack('START', 'start-1', true, 'RUNNING', 'operation-1'))
  await assert.rejects(starting, /invalidated/)
  assert.equal(coordinator.getSnapshot('mock').experience.selectedExperienceId, 'WIND')
  coordinator.dispose()
})

for (const [label, terminalState, ready] of [
  ['DEVICE_RESET', 'FAULT', false],
  ['DISCONNECT', 'IDLE', false],
] as const) {
  test(`${label} invalidates the active operation without automatic recovery`, async () => {
    const { coordinator, mock } = setup()
    mock.current = snapshot('RUNNING', 'operation-1')
    mock.setState(terminalState, ready)
    await assert.rejects(coordinator.start(start('mock', 'operation-2')), /Cannot start/)
    assert.equal(mock.starts, 0)
    assert.equal(coordinator.getSnapshot('mock').experience.state, terminalState)
    coordinator.dispose()
  })
}

test('COMPLETED wins a concurrent STOP and no device STOP is sent', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('COMPLETED', 'operation-1')
  const result = await coordinator.stop(stop())
  assert.equal('snapshot' in result, true)
  assert.equal(mock.stops, 0)
  assert.equal(coordinator.getSnapshot('mock').experience.state, 'COMPLETED')
  coordinator.dispose()
})

test('COMPLETED arriving as STOP is dispatched is resolved from service STATUS', async () => {
  const { coordinator, mock } = setup()
  mock.current = snapshot('RUNNING', 'operation-1')
  const stopService = mock.stop.bind(mock)
  mock.stop = (requestId, operationId) => {
    mock.current = snapshot('COMPLETED', operationId)
    return stopService(requestId, operationId)
  }
  const result = await coordinator.stop(stop())
  assert.equal('snapshot' in result, true)
  if (!('snapshot' in result)) throw new Error('Expected authoritative STATUS after completion.')
  assert.equal(result.snapshot.state, 'COMPLETED')
  coordinator.dispose()
})

test('Mock and Firmware modes use the same request arbitration rules', async () => {
  const { coordinator, mock, firmware } = setup()
  await coordinator.select(select('mock'))
  await coordinator.select(select('firmware'))
  const results = await Promise.all([
    coordinator.start(start('mock', 'mock-op')),
    coordinator.start(start('firmware', 'firmware-op')),
  ])
  assert.deepEqual(results.map(result => result.accepted), [true, true])
  assert.equal(mock.starts, 1)
  assert.equal(firmware.starts, 1)
  coordinator.dispose()
})

test('Coordinator publishes snapshots from the service without owning device fields', async () => {
  const { coordinator, mock } = setup()
  const events: Array<{ revision: number; state: string }> = []
  const unsubscribe = coordinator.subscribe('mock', event => {
    events.push({ revision: event.snapshot.revision, state: event.snapshot.experience.state })
  })
  mock.setState('FAULT', false)
  assert.deepEqual(events, [{ revision: 1, state: 'FAULT' }])
  assert.equal(coordinator.getSnapshot('mock').experience.faultCode, null)
  unsubscribe()
  coordinator.dispose()
})

test('Main IPC handlers route legacy and unified Mock/Firmware commands through one Coordinator', async () => {
  const { coordinator, mock, firmware } = setup()
  const handlers = createExperienceIpcHandlers({ mock, firmware }, coordinator)
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return await handler(...args)
  }

  const selected = await invoke(IPC_CHANNELS.experienceSelect, {
    experienceId: 'WAVE',
    requestId: 'legacy-select',
  })
  assert.ok(selected && typeof selected === 'object' && 'accepted' in selected)
  assert.equal(selected.accepted, true)

  mock.startDeferred = deferred<ExperienceAcknowledgement>()
  mock.stopDeferred = deferred<ExperienceAcknowledgement>()
  const legacyStart = invoke(IPC_CHANNELS.experienceStart, {
    requestId: 'legacy-start',
    operationId: 'mock-operation',
  })
  const unifiedDuplicate = invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'START',
    mode: 'mock',
    requestId: 'unified-start',
    operationId: 'mock-operation',
  })
  assert.equal(mock.starts, 1)

  const legacyStop = invoke(IPC_CHANNELS.experienceStop, {
    requestId: 'legacy-stop',
    operationId: 'mock-operation',
  })
  const unifiedStop = invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'STOP',
    mode: 'mock',
    requestId: 'unified-stop',
    operationId: 'mock-operation',
  })
  mock.current = snapshot('RUNNING', 'mock-operation')
  mock.startDeferred.resolve(ack('START', 'legacy-start', true, 'RUNNING', 'mock-operation'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mock.stops, 1)
  mock.current = snapshot('IDLE')
  mock.stopDeferred.resolve(ack('STOP', 'legacy-stop', true, 'IDLE', 'mock-operation'))
  const [legacyStopResult, unifiedStopResult] = await Promise.all([legacyStop, unifiedStop])
  assert.ok(legacyStopResult && typeof legacyStopResult === 'object' &&
    'accepted' in legacyStopResult && 'command' in legacyStopResult)
  assert.equal(legacyStopResult.command, 'STOP')
  assert.equal(legacyStopResult.accepted, true)
  assert.ok(unifiedStopResult && typeof unifiedStopResult === 'object' &&
    'acknowledgement' in unifiedStopResult && 'snapshot' in unifiedStopResult)
  const unifiedStatus = unifiedStopResult as ExperienceStatusResponse
  assert.equal(unifiedStatus.acknowledgement.accepted, true)
  assert.equal(unifiedStatus.snapshot.state, 'IDLE')
  assert.equal(mock.stops, 1)
  await assert.rejects(legacyStart, /cancelled/)
  await assert.rejects(unifiedDuplicate, /cancelled/)

  const firmwareSelected = await invoke(IPC_CHANNELS.firmwareSelect, {
    experienceId: 'WIND',
    requestId: 'firmware-select',
  })
  assert.ok(firmwareSelected && typeof firmwareSelected === 'object' && 'accepted' in firmwareSelected)
  assert.equal(firmwareSelected.accepted, true)
  const firmwareStarted = await invoke(IPC_CHANNELS.firmwareStart, {
    requestId: 'firmware-start',
    operationId: 'firmware-operation',
  })
  assert.ok(firmwareStarted && typeof firmwareStarted === 'object' && 'accepted' in firmwareStarted)
  assert.equal(firmwareStarted.accepted, true)
  assert.equal(firmware.starts, 1)
  const firmwareStopped = await invoke(IPC_CHANNELS.firmwareStop, {
    requestId: 'firmware-stop',
    operationId: 'firmware-operation',
  })
  assert.ok(firmwareStopped && typeof firmwareStopped === 'object' && 'accepted' in firmwareStopped)
  assert.equal(firmwareStopped.accepted, true)
  assert.equal(firmware.stops, 1)

  mock.setState('COMPLETED')
  const latest = await invoke(IPC_CHANNELS.experienceGetSnapshot, 'mock')
  assert.ok(isExperienceSnapshot(latest))
  assert.equal(latest.experience.state, 'COMPLETED')
  assert.ok(latest.revision > 0)
  coordinator.dispose()
})

test('natural Mock completion reaches Main IPC snapshots from the service, not local UI timing', async () => {
  const clock = new FakeClock()
  const mockController = new MockExperienceController({ clock })
  const firmware = new FakeExperienceService()
  const coordinator = new ExperienceCoordinator({
    mock: {
      selectExperience: (requestId, experienceId) =>
        mockController.selectExperience(requestId, experienceId),
      start: (requestId, operationId) => mockController.start(requestId, operationId),
      stop: (requestId, operationId) => mockController.stop(requestId, operationId),
      queryStatus: requestId => mockController.queryStatus(requestId),
      recover: requestId => mockController.recover(requestId),
      getExperienceSnapshot: () => mockController.getSnapshot(),
      canStart: () => true,
      onStateChange: listener => mockController.onStateChange(() => listener()),
    },
    firmware,
  })
  const handlers = createExperienceIpcHandlers({ mock: mockController, firmware }, coordinator)
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return await handler(...args)
  }

  await invoke(IPC_CHANNELS.experienceSelect, {
    experienceId: 'WAVE',
    requestId: 'natural-select',
  })
  await invoke(IPC_CHANNELS.experienceDispatch, {
    type: 'START',
    mode: 'mock',
    requestId: 'natural-start',
    operationId: 'natural-operation',
  })
  clock.advanceBy(EXPERIENCE_DEFINITIONS.WAVE.totalDurationMs)

  const completed = await invoke(IPC_CHANNELS.experienceGetSnapshot, 'mock')
  assert.ok(isExperienceSnapshot(completed))
  assert.equal(completed.experience.state, 'COMPLETED')
  assert.equal(completed.experience.operationId, 'natural-operation')
  coordinator.dispose()
})
