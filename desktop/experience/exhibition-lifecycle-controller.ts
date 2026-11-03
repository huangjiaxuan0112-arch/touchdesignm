import { randomUUID } from 'node:crypto'
import type { ExperienceClock } from './experience-clock'
import { systemExperienceClock } from './experience-clock'
import type { MockExperienceController } from './mock-experience-controller'
import type { ExperienceCommand } from '../shared/experience-application-contract'
import {
  EXHIBITION_TIMING,
  type ExhibitionLifecycleSnapshot,
  type ExhibitionPhase,
} from '../shared/exhibition-lifecycle'
import type { ExperienceCoordinator } from '../electron/experience-coordinator'

type Listener = (snapshot: ExhibitionLifecycleSnapshot) => void

export class ExhibitionLifecycleController {
  private snapshot: ExhibitionLifecycleSnapshot = {
    revision: 0,
    phase: 'READY',
    experienceId: null,
    operationId: null,
    faultCode: null,
  }
  private readonly listeners = new Set<Listener>()
  private cancelTimer: (() => void) | undefined
  private pendingStart: { operationId: string; promise: ReturnType<ExperienceCoordinator['start']> } | undefined
  private pendingSelection = false
  private activeOperationId: string | null = null
  private internalStopOperationId: string | null = null
  private deviceCompleted = false
  private readonly unsubscribe: () => void

  constructor(
    private readonly coordinator: ExperienceCoordinator,
    private readonly mock: MockExperienceController,
    private readonly clock: ExperienceClock = systemExperienceClock,
  ) {
    this.unsubscribe = coordinator.subscribe('mock', event => this.handleDeviceSnapshot(event.snapshot.experience))
  }

  getSnapshot(): ExhibitionLifecycleSnapshot {
    return { ...this.snapshot }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async select(command: Extract<ExperienceCommand, { type: 'SELECT' }>) {
    if (this.pendingSelection) {
      throw new Error('Another exhibition selection is already pending.')
    }
    this.assertPhase('READY', 'An exhibition experience is already in progress or cooling down.')
    this.pendingSelection = true
    try {
      const acknowledgement = await this.coordinator.select(command)
      if (acknowledgement.accepted) {
        if (this.snapshot.phase !== 'READY') {
          throw new Error('Exhibition selection was invalidated by a device fault.')
        }
        this.deviceCompleted = false
        this.activeOperationId = null
        this.transition('STARTING', command.experienceId, null, null)
      }
      return acknowledgement
    } catch (error) {
      if (this.snapshot.phase !== 'FAULT') this.fail('SELECT_FAILED')
      throw error
    } finally {
      this.pendingSelection = false
    }
  }

  start(command: Extract<ExperienceCommand, { type: 'START' }>) {
    if (this.pendingSelection) {
      return Promise.reject(new Error('An exhibition selection is still pending.'))
    }
    if (this.pendingStart) {
      if (this.pendingStart.operationId === command.operationId) return this.pendingStart.promise
      return Promise.reject(new Error('Another exhibition START is already pending.'))
    }
    if (this.snapshot.phase !== 'STARTING' || !this.snapshot.experienceId) {
      return Promise.reject(new Error(`An exhibition cannot START during ${this.snapshot.phase}.`))
    }

    this.activeOperationId = command.operationId
    const promise = this.coordinator.start(command).then(acknowledgement => {
      if (!acknowledgement.accepted) {
        this.fail(acknowledgement.code ?? 'START_REJECTED')
        return acknowledgement
      }
      if (this.snapshot.phase === 'FAULT' || this.activeOperationId !== command.operationId) {
        throw new Error('Exhibition START was invalidated by a device fault.')
      }
      this.transition('WAITING', this.snapshot.experienceId, command.operationId, null)
      this.schedule(EXHIBITION_TIMING.waitingMs, () => {
        if (this.snapshot.phase !== 'WAITING' || this.snapshot.operationId !== command.operationId) return
        this.transition('EXPERIENCE', this.snapshot.experienceId, command.operationId, null)
        this.schedule(EXHIBITION_TIMING.experienceMs, () => this.finishExperience(command.operationId))
      })
      return acknowledgement
    }).catch(error => {
      if (this.snapshot.phase !== 'FAULT') this.fail('START_FAILED')
      throw error
    }).finally(() => {
      if (this.pendingStart?.operationId === command.operationId) this.pendingStart = undefined
    })
    this.pendingStart = { operationId: command.operationId, promise }
    return promise
  }

  async reportMediaFailure(code: string): Promise<void> {
    const operationId = this.activeOperationId
    const device = this.mock.getSnapshot()
    this.fail(code)
    if (!operationId || device.state !== 'RUNNING' || device.operationId !== operationId) return

    this.internalStopOperationId = operationId
    try {
      const result = await this.coordinator.stop({
        type: 'STOP',
        mode: 'mock',
        requestId: randomUUID().replace(/-/g, '').slice(0, 16),
        operationId,
      })
      const stopped = 'snapshot' in result
        ? result.snapshot.state === 'IDLE' || result.snapshot.state === 'COMPLETED'
        : result.accepted && (result.state === 'IDLE' || result.state === 'COMPLETED')
      if (!stopped) throw new Error('Internal STOP after media failure was not confirmed.')
    } finally {
      if (this.internalStopOperationId === operationId) this.internalStopOperationId = null
    }
  }

  dispose(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.unsubscribe()
    this.listeners.clear()
  }

  private handleDeviceSnapshot(device: ReturnType<MockExperienceController['getSnapshot']>): void {
    const operationId = this.activeOperationId
    if (device.state === 'FAULT') {
      this.fail(device.faultCode ?? 'DEVICE_FAULT')
      return
    }
    if (!operationId || device.operationId !== operationId || this.snapshot.phase === 'FAULT') return
    if (device.state === 'COMPLETED') {
      this.deviceCompleted = true
      if (this.snapshot.phase === 'AWAIT_COMPLETION') this.confirmCompleted(operationId)
    } else if (device.state === 'STOPPING' && this.internalStopOperationId === operationId) {
      return
    } else if (device.state === 'IDLE' || device.state === 'STOPPING') {
      this.fail('EXPERIENCE_INTERRUPTED')
    }
  }

  private finishExperience(operationId: string): void {
    if (this.snapshot.phase !== 'EXPERIENCE' || this.snapshot.operationId !== operationId) return
    this.deviceCompleted ||= this.mock.getSnapshot().state === 'COMPLETED'
    this.transition('AWAIT_COMPLETION', this.snapshot.experienceId, operationId, null)
    if (this.deviceCompleted) this.confirmCompleted(operationId)
  }

  private confirmCompleted(operationId: string): void {
    this.schedule(0, () => {
      if (this.snapshot.phase === 'AWAIT_COMPLETION' &&
          this.snapshot.operationId === operationId && this.deviceCompleted) {
        this.startCooldown(operationId)
      }
    })
  }

  private startCooldown(operationId: string): void {
    if (this.snapshot.phase === 'COOLDOWN' || this.snapshot.phase === 'FAULT') return
    this.transition('COOLDOWN', this.snapshot.experienceId, operationId, null)
    this.schedule(EXHIBITION_TIMING.cooldownMs, () => {
      if (this.snapshot.phase !== 'COOLDOWN' || this.snapshot.operationId !== operationId) return
      if (this.mock.getSnapshot().state !== 'COMPLETED') {
        this.fail('COMPLETION_STATE_LOST')
        return
      }
      this.deviceCompleted = false
      this.activeOperationId = null
      this.transition('READY', null, null, null)
    })
  }

  private schedule(delayMs: number, callback: () => void): void {
    this.cancelTimer?.()
    this.cancelTimer = this.clock.schedule(() => {
      this.cancelTimer = undefined
      callback()
    }, delayMs)
  }

  private assertPhase(phase: ExhibitionPhase, message: string): void {
    if (this.snapshot.phase !== phase) throw new Error(message)
  }

  private fail(code: string): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.transition('FAULT', this.snapshot.experienceId, this.activeOperationId, code)
  }

  private transition(
    phase: ExhibitionPhase,
    experienceId: ExhibitionLifecycleSnapshot['experienceId'],
    operationId: string | null,
    faultCode: string | null,
  ): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      phase,
      experienceId,
      operationId,
      faultCode,
    }
    for (const listener of this.listeners) listener(this.getSnapshot())
  }
}
