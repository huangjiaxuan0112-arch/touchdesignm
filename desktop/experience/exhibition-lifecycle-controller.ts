import { randomUUID } from 'node:crypto'
import { PROJECTOR_DURATION_MS, PROJECTOR_DURATION_TOLERANCE_SECONDS, type ProjectorMediaReport } from '../shared/projector'
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

// The reviewed actuator path needs 500ms with both pumps off, followed by
// 300ms for the valve to settle after SELECT.  This is a pre-START guard, not
// part of the 30s device timeline: T=0 remains the accepted START ACK.
const FIRMWARE_START_PREPARATION_MS = 800

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
  private deviceStartRequested = false
  private selectionAcknowledgedAtMs: number | undefined
  private startAcknowledgedAtMs: number | undefined
  private projectorPreparation: { operationId: string; resolve: () => void; reject: (error: Error) => void } | undefined
  private actuatorPreparation: { operationId: string; cancel: () => void; reject: (error: Error) => void } | undefined
  private projectorPlaying = false
  private projectorEnded = false
  private readonly unsubscribe: () => void

  constructor(
    private readonly coordinator: ExperienceCoordinator,
    private readonly device: Pick<MockExperienceController, 'getSnapshot'>,
    private readonly clock: ExperienceClock = systemExperienceClock,
    private readonly options: { requireProjectorMedia?: boolean; mediaReadyTimeoutMs?: number; mode?: 'mock' | 'firmware'; canSelect?: () => boolean } = {},
  ) {
    this.unsubscribe = coordinator.subscribe(options.mode ?? 'mock', event => this.handleDeviceSnapshot(event.snapshot.experience))
  }

  getMode(): 'mock' | 'firmware' { return this.options.mode ?? 'mock' }

  resetAfterOperatorRecovery(): void {
    if (this.snapshot.phase !== 'FAULT') throw new Error('Operator recovery requires FAULT.')
    if (this.pendingStart || this.pendingSelection ||
        (this.options.canSelect && !this.options.canSelect()) ||
        !['IDLE','COMPLETED'].includes(this.device.getSnapshot().state)) throw new Error('Recovery requires verified inactive device and no pending request.')
    this.cancelTimer?.(); this.cancelTimer = undefined
    this.activeOperationId = null; this.deviceCompleted = false; this.deviceStartRequested = false
    this.selectionAcknowledgedAtMs = undefined; this.startAcknowledgedAtMs = undefined
    this.projectorPlaying = false; this.projectorEnded = false
    this.transition('READY', null, null, null)
  }

  getSnapshot(): ExhibitionLifecycleSnapshot {
    return { ...this.snapshot }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async select(command: Extract<ExperienceCommand, { type: 'SELECT' }>) {
    if (command.mode !== (this.options.mode ?? 'mock')) throw new Error('Lifecycle device mode mismatch.')
    if (this.options.canSelect && !this.options.canSelect()) throw new Error('Device is not ready: connect and verify the approved firmware first.')
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
        this.deviceStartRequested = false
        this.selectionAcknowledgedAtMs = this.clock.now()
        this.startAcknowledgedAtMs = undefined
        this.projectorPlaying = false
        this.projectorEnded = false
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
    if (command.mode !== (this.options.mode ?? 'mock')) return Promise.reject(new Error('Lifecycle device mode mismatch.'))
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
    const startDevice = () => {
      if (this.snapshot.phase !== 'STARTING' || this.activeOperationId !== command.operationId) {
        throw new Error('Exhibition preparation was invalidated.')
      }
      this.deviceStartRequested = true
      return this.coordinator.start(command)
    }
    // Only the Electron composition root enables this gate. Headless lifecycle tests have no renderer.
    const preparation = this.options.requireProjectorMedia
      ? new Promise<void>((resolve, reject) => {
          this.projectorPreparation = { operationId: command.operationId, resolve, reject }
          this.schedule(this.options.mediaReadyTimeoutMs ?? 15_000, () => this.fail('PROJECTOR_MEDIA_TIMEOUT'))
        })
      : null
    const actuatorPreparationMs = this.getRemainingActuatorPreparationMs()
    const actuatorPreparation = actuatorPreparationMs > 0
      ? new Promise<void>((resolve, reject) => {
          const cancel = this.clock.schedule(() => {
            if (this.actuatorPreparation?.operationId !== command.operationId) return
            this.actuatorPreparation = undefined
            resolve()
          }, actuatorPreparationMs)
          this.actuatorPreparation = { operationId: command.operationId, cancel, reject }
        })
      : null
    const prerequisites = [preparation, actuatorPreparation].filter(
      (item): item is Promise<void> => item !== null,
    )
    const deviceStart = prerequisites.length > 0
      ? Promise.all(prerequisites).then(startDevice)
      : startDevice()
    const promise = deviceStart.then(acknowledgement => {
      if (!acknowledgement.accepted) {
        this.fail(acknowledgement.code ?? 'START_REJECTED')
        return acknowledgement
      }
      if (this.snapshot.phase === 'FAULT' || this.activeOperationId !== command.operationId) {
        throw new Error('Exhibition START was invalidated by a device fault.')
      }
      this.startAcknowledgedAtMs = this.clock.now()
      this.transition('WAITING', this.snapshot.experienceId, command.operationId, null)
      this.schedule(EXHIBITION_TIMING.waitingMs, () => {
        if (this.snapshot.phase !== 'WAITING' || this.activeOperationId !== command.operationId) return
        if (this.options.requireProjectorMedia && !this.projectorPlaying) {
          void this.reportMediaFailure('PROJECTOR_NOT_PLAYING').catch(() => { /* FAULT remains latched. */ })
          return
        }
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
    if (preparation) this.transition('STARTING', this.snapshot.experienceId, command.operationId, null)
    return promise
  }

  async reportProjectorMedia(report: ProjectorMediaReport): Promise<boolean> {
    if (!this.options.requireProjectorMedia || report.operationId !== this.activeOperationId ||
        report.experienceId !== this.snapshot.experienceId ||
        !['STARTING', 'WAITING', 'EXPERIENCE', 'AWAIT_COMPLETION'].includes(this.snapshot.phase)) return false
    if (report.event === 'error') {
      await this.reportMediaFailure('PROJECTOR_MEDIA_ERROR')
      return true
    }
    if (report.event === 'ready') {
      if (this.snapshot.phase !== 'STARTING' || this.projectorPreparation?.operationId !== report.operationId) return false
      if (report.durationSeconds === undefined ||
          Math.abs(report.durationSeconds - PROJECTOR_DURATION_MS / 1_000) > PROJECTOR_DURATION_TOLERANCE_SECONDS ||
          report.currentTime !== 0) {
        await this.reportMediaFailure('PROJECTOR_INVALID_MEDIA')
        return false
      }
      const preparation = this.projectorPreparation
      this.projectorPreparation = undefined
      this.cancelTimer?.()
      this.cancelTimer = undefined
      preparation.resolve()
      return true
    }
    if (this.startAcknowledgedAtMs === undefined || this.snapshot.phase === 'STARTING') return false
    if (report.event === 'playing') {
      if (this.projectorPlaying || this.projectorEnded) return false
      this.projectorPlaying = true
      return true
    }
    if (this.projectorEnded) return false
    if (!this.projectorPlaying || report.currentTime === undefined ||
        report.currentTime < PROJECTOR_DURATION_MS / 1_000 - PROJECTOR_DURATION_TOLERANCE_SECONDS ||
        this.clock.now() - this.startAcknowledgedAtMs < PROJECTOR_DURATION_MS - 1_000) {
      await this.reportMediaFailure('PROJECTOR_EARLY_END')
      return false
    }
    this.projectorEnded = true
    return true
  }

  async reportMediaFailure(code: string): Promise<void> {
    if (!['STARTING', 'WAITING', 'EXPERIENCE', 'AWAIT_COMPLETION'].includes(this.snapshot.phase)) return

    const operationId = this.activeOperationId
    const device = this.device.getSnapshot()
    this.fail(code)
    if (!operationId || !this.deviceStartRequested || (this.pendingStart?.operationId !== operationId &&
        (device.state !== 'RUNNING' || device.operationId !== operationId))) return

    this.internalStopOperationId = operationId
    try {
      const result = await this.coordinator.stop({
        type: 'STOP',
        mode: this.options.mode ?? 'mock',
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
    this.projectorPreparation?.reject(new Error('Exhibition disposed.'))
    this.projectorPreparation = undefined
    this.actuatorPreparation?.cancel()
    this.actuatorPreparation?.reject(new Error('Exhibition disposed.'))
    this.actuatorPreparation = undefined
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
    this.deviceCompleted ||= this.device.getSnapshot().state === 'COMPLETED'
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
    if (this.options.requireProjectorMedia && !this.projectorEnded) {
      void this.reportMediaFailure('PROJECTOR_NOT_COMPLETED').catch(() => { /* FAULT remains latched. */ })
      return
    }
    this.transition('COOLDOWN', this.snapshot.experienceId, operationId, null)
    this.schedule(EXHIBITION_TIMING.cooldownMs, () => {
      if (this.snapshot.phase !== 'COOLDOWN' || this.snapshot.operationId !== operationId) return
      if (this.device.getSnapshot().state !== 'COMPLETED') {
        this.fail('COMPLETION_STATE_LOST')
        return
      }
      this.deviceCompleted = false
      this.activeOperationId = null
      this.selectionAcknowledgedAtMs = undefined
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

  private getRemainingActuatorPreparationMs(): number {
    if ((this.options.mode ?? 'mock') !== 'firmware' || this.selectionAcknowledgedAtMs === undefined) return 0
    return Math.max(0, this.selectionAcknowledgedAtMs + FIRMWARE_START_PREPARATION_MS - this.clock.now())
  }

  private fail(code: string): void {
    if (this.snapshot.phase === 'FAULT') return // Preserve the first fault; repeated device status cannot change the latched round.
    this.projectorPreparation?.reject(new Error(code))
    this.projectorPreparation = undefined
    this.actuatorPreparation?.cancel()
    this.actuatorPreparation?.reject(new Error(code))
    this.actuatorPreparation = undefined
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
      ...(this.options.requireProjectorMedia && this.startAcknowledgedAtMs !== undefined
        ? { startAcknowledgedAtMs: this.startAcknowledgedAtMs } : {}),
    }
    for (const listener of this.listeners) listener(this.getSnapshot())
  }
}
