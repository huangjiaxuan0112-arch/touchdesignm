import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockExperienceController } from '../desktop/experience/mock-experience-controller'
import type { ExperienceClock } from '../desktop/experience/experience-clock'
import type { ExperienceId } from '../desktop/shared/experience-definitions'

class FakeClock implements ExperienceClock {
  private currentTime = 0
  private nextId = 0
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>()

  now(): number {
    return this.currentTime
  }

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
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0]
      if (!next) break
      const [id, timer] = next
      this.timers.delete(id)
      this.currentTime = timer.dueAt
      timer.callback()
    }
    this.currentTime = targetTime
  }
}

function createController() {
  const clock = new FakeClock()
  const controller = new MockExperienceController({ clock, stopDelayMs: 200 })
  return { clock, controller }
}

test('selects each supported experience while idle', () => {
  for (const [requestId, experienceId] of [
    ['select-wind', 'WIND'],
    ['select-wave', 'WAVE'],
    ['select-bubble', 'BUBBLE'],
  ] as const) {
    const { controller } = createController()
    const acknowledgement = controller.selectExperience(requestId, experienceId)
    assert.equal(acknowledgement.type, 'ACK')
    assert.equal(controller.getSnapshot().selectedExperienceId, experienceId)
  }
})

test('rejects unknown experience identifiers', () => {
  const { controller } = createController()
  assert.equal(controller.selectExperience('select-invalid', 'UNKNOWN' as ExperienceId).code, 'UNKNOWN_EXPERIENCE')
})

test('starts from IDLE and reports deterministic elapsed time and progress', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select', 'WIND')
  const acknowledgement = controller.start('start', 'operation-1')
  assert.equal(acknowledgement.state, 'RUNNING')
  clock.advanceBy(12_000)
  assert.equal(controller.getSnapshot().elapsedMs, 12_000)
  assert.equal(controller.getSnapshot().progress, 0.5)
})

test('completes naturally at the definition duration', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select', 'WIND')
  controller.start('start', 'operation-1')
  clock.advanceBy(23_999)
  assert.equal(controller.getSnapshot().state, 'RUNNING')
  clock.advanceBy(1)
  assert.equal(controller.getSnapshot().state, 'COMPLETED')
  assert.equal(controller.getSnapshot().progress, 1)
})

test('STOP enters STOPPING and then returns to IDLE without resuming', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select', 'WAVE')
  controller.start('start', 'operation-1')
  clock.advanceBy(1000)

  const acknowledgement = controller.stop('stop', 'operation-1')
  assert.equal(acknowledgement.state, 'STOPPING')
  assert.equal(controller.getSnapshot().state, 'STOPPING')
  clock.advanceBy(200)
  assert.equal(controller.getSnapshot().state, 'IDLE')
  assert.equal(controller.getSnapshot().operationId, null)
  clock.advanceBy(30_000)
  assert.equal(controller.getSnapshot().state, 'IDLE')
})

test('rejects invalid state transitions', () => {
  const { controller } = createController()
  assert.equal(controller.start('start-empty', 'operation-1').code, 'NO_EXPERIENCE_SELECTED')
  assert.equal(controller.stop('stop-idle', 'operation-1').code, 'INVALID_STATE')
  controller.selectExperience('select', 'WIND')
  controller.start('start', 'operation-1')
  assert.equal(controller.selectExperience('select-running', 'WAVE').code, 'INVALID_STATE')
  assert.equal(controller.start('start-running', 'operation-2').code, 'INVALID_STATE')
})

test('duplicate request IDs are idempotent and cannot change command payload', () => {
  const { controller } = createController()
  controller.selectExperience('select', 'WIND')
  const first = controller.start('start', 'operation-1')
  const duplicate = controller.start('start', 'operation-1')
  assert.deepEqual(duplicate, first)
  assert.equal(controller.start('start', 'operation-2').code, 'REQUEST_ID_REUSED')
  assert.equal(controller.start('start-new', 'operation-2').code, 'INVALID_STATE')
})

test('does not reuse an operation ID after completion and recovery', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select-1', 'WIND')
  controller.start('start-1', 'operation-1')
  clock.advanceBy(24_000)
  controller.recover('recover-1')
  controller.selectExperience('select-2', 'WAVE')

  assert.equal(controller.start('start-2', 'operation-1').code, 'OPERATION_ID_REUSED')
})

test('simulated faults stop progress and recover only through reset', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select', 'BUBBLE')
  controller.start('start', 'operation-1')
  clock.advanceBy(800)
  controller.simulateFault('SIMULATED_FAILURE')
  assert.equal(controller.getSnapshot().state, 'FAULT')
  assert.equal(controller.getSnapshot().faultCode, 'SIMULATED_FAILURE')
  clock.advanceBy(40_000)
  assert.equal(controller.getSnapshot().state, 'FAULT')
  assert.equal(controller.recover('recover').state, 'IDLE')
  assert.equal(controller.getSnapshot().selectedExperienceId, null)
})

test('connection loss faults a running simulation and never auto-resumes', () => {
  const { clock, controller } = createController()
  controller.selectExperience('select', 'WIND')
  controller.start('start', 'operation-1')
  clock.advanceBy(500)
  controller.simulateConnectionLoss()
  assert.equal(controller.getSnapshot().state, 'FAULT')
  assert.equal(controller.getSnapshot().faultCode, 'CONNECTION_LOST')
  clock.advanceBy(25_000)
  assert.equal(controller.getSnapshot().state, 'FAULT')
  assert.equal(controller.getSnapshot().progress, 500 / 24_000)
})

test('status reports current simulation state', () => {
  const { controller } = createController()
  controller.selectExperience('select', 'WAVE')
  const status = controller.queryStatus('status-1')
  assert.equal(status.type, 'STATUS')
  assert.equal(status.acknowledgement.type, 'ACK')
  assert.equal(status.snapshot.selectedExperienceId, 'WAVE')
  assert.equal(status.snapshot.state, 'IDLE')
})