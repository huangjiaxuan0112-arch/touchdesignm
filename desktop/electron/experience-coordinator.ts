import { randomUUID } from 'node:crypto'
import type {
  ExperienceAcknowledgement,
  ExperienceSnapshot as DeviceExperienceSnapshot,
  ExperienceStatusResponse,
} from '../shared/experience-control-protocol'
import {
  isExperienceCommand,
  type ExperienceCommand,
  type ExperienceCommandResult,
  type ExperienceEvent,
  type ExperienceMode,
  type ExperienceSnapshot,
} from '../shared/experience-application-contract'
import type { ExperienceCommandService } from './experience-command-dispatcher'

export interface CoordinatedExperienceService extends ExperienceCommandService {
  getExperienceSnapshot(): DeviceExperienceSnapshot
  canStart(): boolean
  onStateChange(listener: () => void): () => void
}

export interface ExperienceCoordinatorServices {
  mock: CoordinatedExperienceService & {
    recover(requestId: string): ExperienceAcknowledgement | Promise<ExperienceAcknowledgement>
  }
  firmware: CoordinatedExperienceService
}

interface PendingStart {
  operationId: string
  generation: number
  cancelRequestId?: string
  invalidated: boolean
  acknowledgement: Promise<ExperienceAcknowledgement>
  promise: Promise<ExperienceAcknowledgement>
  stopPromise?: Promise<ExperienceCommandResult>
}

type SnapshotListener = (event: ExperienceEvent) => void

export class ExperienceCoordinator {
  private readonly revisions: Record<ExperienceMode, number> = { mock: 0, firmware: 0 }
  private readonly generations: Record<ExperienceMode, number> = { mock: 0, firmware: 0 }
  private readonly pendingStarts: Partial<Record<ExperienceMode, PendingStart>> = {}
  private readonly pendingStops: Record<ExperienceMode, Map<string, Promise<ExperienceCommandResult>>> = {
    mock: new Map(),
    firmware: new Map(),
  }
  private readonly pendingSelects = new Set<ExperienceMode>()
  private readonly listeners = new Map<ExperienceMode, Set<SnapshotListener>>()
  private readonly detachServices: (() => void)[]
  private readonly ready: Record<ExperienceMode, boolean>

  constructor(private readonly services: ExperienceCoordinatorServices) {
    this.ready = {
      mock: services.mock.canStart(),
      firmware: services.firmware.canStart(),
    }
    this.detachServices = (['mock', 'firmware'] as const).map((mode) =>
      services[mode].onStateChange(() => this.handleServiceChange(mode)),
    )
  }

  getSnapshot(mode: ExperienceMode): ExperienceSnapshot {
    return {
      mode,
      revision: this.revisions[mode],
      experience: this.services[mode].getExperienceSnapshot(),
    }
  }

  subscribe(mode: ExperienceMode, listener: SnapshotListener): () => void {
    let listeners = this.listeners.get(mode)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(mode, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(mode)
    }
  }

  async select(command: ExperienceCommand): Promise<ExperienceAcknowledgement> {
    if (!isExperienceCommand(command) || command.type !== 'SELECT') {
      throw new Error('Invalid experience selection command.')
    }
    const { mode, experienceId, requestId } = command
    const state = this.services[mode].getExperienceSnapshot()
    if (this.pendingSelects.has(mode)) throw new Error('An experience selection is already pending.')

    this.pendingSelects.add(mode)
    try {
      if (mode === 'firmware' && !this.services.firmware.canStart()) {
        throw new Error('Firmware is not ready for an explicit experience selection.')
      }

      if (state.state === 'FAULT') {
        if (mode !== 'mock') throw new Error('Firmware FAULT requires explicit device recovery.')
        const recovered = await this.services.mock.recover(this.newRequestId())
        if (!recovered.accepted) throw new Error(`Mock recovery rejected: ${recovered.code ?? 'UNKNOWN'}`)
        const recoveredState = this.services.mock.getExperienceSnapshot()
        if (recoveredState.state !== 'IDLE' && recoveredState.state !== 'COMPLETED') {
          throw new Error(`Mock recovery did not confirm an inactive state: ${recoveredState.state}.`)
        }
      } else if (this.pendingStarts[mode] ||
          state.state === 'RUNNING' || state.state === 'STOPPING') {
        const operationId = state.operationId ?? this.pendingStarts[mode]?.operationId
        if (!operationId) throw new Error('Cannot switch experiences without a confirmed operation ID.')
        const stopped = await this.stop({
          type: 'STOP',
          mode,
          requestId: this.newRequestId(),
          operationId,
        })
        if ('accepted' in stopped && !stopped.accepted) {
          throw new Error(`STOP rejected: ${stopped.code ?? 'UNKNOWN'}`)
        }
        await this.waitForInactive(mode)
      } else if (state.state !== 'IDLE' && state.state !== 'COMPLETED') {
        throw new Error(`Cannot select an experience in ${state.state}.`)
      }

      const generation = ++this.generations[mode]
      const acknowledgement = await this.services[mode].selectExperience(requestId, experienceId)
      if (generation !== this.generations[mode]) {
        throw new Error('Experience selection was invalidated by a newer session.')
      }
      if (!acknowledgement.accepted) return acknowledgement
      return acknowledgement
    } finally {
      this.pendingSelects.delete(mode)
    }
  }

  start(command: ExperienceCommand): Promise<ExperienceAcknowledgement> {
    if (!isExperienceCommand(command) || command.type !== 'START') {
      return Promise.reject(new Error('Invalid experience start command.'))
    }
    const { mode, operationId, requestId } = command
    const pending = this.pendingStarts[mode]
    if (pending) {
      if (pending.operationId === operationId) return pending.promise
      return Promise.reject(new Error('Another experience start is already pending.'))
    }

    const service = this.services[mode]
    const state = service.getExperienceSnapshot()
    if (this.pendingSelects.has(mode) || !service.canStart() ||
        state.state !== 'IDLE' || !state.selectedExperienceId) {
      return Promise.reject(new Error(`Cannot start an experience in ${state.state}.`))
    }

    const current: PendingStart = {
      operationId,
      generation: this.generations[mode],
      invalidated: false,
      promise: Promise.resolve({
        type: 'NACK',
        requestId,
        command: 'START',
        accepted: false,
        state: state.state,
        code: 'START_NOT_DISPATCHED',
      }),
      acknowledgement: Promise.resolve({
        type: 'NACK',
        requestId,
        command: 'START',
        accepted: false,
        state: state.state,
        code: 'START_NOT_DISPATCHED',
      }),
    }
    this.pendingStarts[mode] = current
    current.acknowledgement = this.runStart(mode, requestId, current)
    current.promise = current.acknowledgement.then(async (acknowledgement) => {
      if (current.cancelRequestId && acknowledgement.accepted) {
        const stopped = await current.stopPromise
        const inactive = stopped && ('snapshot' in stopped
          ? stopped.snapshot.state === 'IDLE' || stopped.snapshot.state === 'COMPLETED'
          : stopped.accepted &&
            (stopped.state === 'IDLE' || stopped.state === 'COMPLETED'))
        if (!inactive) {
          throw new Error('START cancellation did not confirm STOP.')
        }
        throw new Error('Experience start was cancelled by STOP.')
      }
      return acknowledgement
    })
    return current.promise
  }

  stop(command: ExperienceCommand): Promise<ExperienceCommandResult> {
    if (!isExperienceCommand(command) || command.type !== 'STOP') {
      return Promise.reject(new Error('Invalid experience stop command.'))
    }
    const { mode, operationId, requestId } = command
    const active = this.pendingStops[mode].get(operationId)
    if (active) return active

    let resolveStop!: (result: ExperienceCommandResult) => void
    let rejectStop!: (error: Error) => void
    const pending = new Promise<ExperienceCommandResult>((resolve, reject) => {
      resolveStop = resolve
      rejectStop = reject
    })
    this.pendingStops[mode].set(operationId, pending)
    void this.stopOperation(mode, requestId, operationId).then(resolveStop, rejectStop)
    void pending.then(
      () => {
        if (this.pendingStops[mode].get(operationId) === pending) {
          this.pendingStops[mode].delete(operationId)
        }
      },
      () => {
        if (this.pendingStops[mode].get(operationId) === pending) {
          this.pendingStops[mode].delete(operationId)
        }
      },
    )
    return pending
  }

  private async stopOperation(
    mode: ExperienceMode,
    requestId: string,
    operationId: string,
  ): Promise<ExperienceCommandResult> {
    const pending = this.pendingStarts[mode]
    if (pending) {
      if (pending.operationId !== operationId) {
        return Promise.reject(new Error('STOP operation does not match the pending START.'))
      }
      pending.cancelRequestId ??= requestId
      pending.stopPromise ??= pending.acknowledgement.then(async (acknowledgement) => {
        if (!acknowledgement.accepted) return this.services[mode].queryStatus(requestId)
        if (pending.invalidated || pending.generation !== this.generations[mode]) {
          throw new Error('STOP was invalidated by a device fault or disconnect.')
        }
        const state = this.services[mode].getExperienceSnapshot()
        if (state.state === 'COMPLETED') return this.services[mode].queryStatus(requestId)
        if (state.state !== 'RUNNING' || state.operationId !== operationId) {
          throw new Error(`Cannot stop an operation in ${state.state}.`)
        }
        return this.stopOrObserveCompletion(mode, requestId, operationId)
      })
      return pending.stopPromise
    }

    const state = this.services[mode].getExperienceSnapshot()
    if (state.state === 'COMPLETED' || state.state === 'IDLE') {
      return Promise.resolve(this.services[mode].queryStatus(requestId))
    }
    if (state.state === 'STOPPING') return this.waitForInactive(mode)
    if (state.state !== 'RUNNING' || state.operationId !== operationId) {
      return Promise.reject(new Error(`Cannot stop an operation in ${state.state}.`))
    }

    return this.stopOrObserveCompletion(mode, requestId, operationId)
  }

  dispose(): void {
    for (const detach of this.detachServices) detach()
    this.listeners.clear()
  }

  private async stopOrObserveCompletion(
    mode: ExperienceMode,
    requestId: string,
    operationId: string,
  ): Promise<ExperienceCommandResult> {
    const acknowledgement = await this.services[mode].stop(requestId, operationId)
    if (acknowledgement.accepted) return this.waitForInactive(mode)
    const status = await this.services[mode].queryStatus(requestId)
    return status.snapshot.state === 'COMPLETED'
      ? status
      : acknowledgement
  }

  private newRequestId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 16)
  }

  private async waitForInactive(mode: ExperienceMode): Promise<ExperienceStatusResponse> {
    const service = this.services[mode]
    const current = await service.queryStatus(this.newRequestId())
    if (this.isConfirmedInactive(current)) return current
    if (!current.acknowledgement.accepted) {
      throw new Error(`Cannot confirm a safe experience switch: STATUS rejected (${current.acknowledgement.code ?? 'UNKNOWN'}).`)
    }
    if (current.snapshot.state === 'FAULT' || !service.canStart()) {
      throw new Error(`Cannot confirm a safe experience switch in ${current.snapshot.state}.`)
    }

    return new Promise<ExperienceStatusResponse>((resolve, reject) => {
      let settled = false
      let unsubscribe = () => {}
      const timeout = setTimeout(() => {
        finish(new Error('Timed out waiting for the current experience to stop.'))
      }, 5000)
      const finish = (error?: Error, status?: ExperienceStatusResponse) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        unsubscribe()
        if (error) reject(error)
        else if (status) resolve(status)
        else reject(new Error('Experience stop confirmation is missing.'))
      }
      const checkState = () => {
        const state = service.getExperienceSnapshot()
        if (state.state === 'FAULT' || !service.canStart()) {
          finish(new Error(`Experience ended without a confirmed safe stop: ${state.state}.`))
        } else if (state.state === 'IDLE' || state.state === 'COMPLETED') {
          void Promise.resolve(service.queryStatus(this.newRequestId())).then((status) => {
            if (!status.acknowledgement.accepted) {
              finish(new Error(`Cannot confirm a safe experience switch: STATUS rejected (${status.acknowledgement.code ?? 'UNKNOWN'}).`))
            } else if (this.isConfirmedInactive(status)) {
              finish(undefined, status)
            }
            else if (status.snapshot.state === 'FAULT') {
              finish(new Error('Experience faulted while confirming the stop.'))
            }
          }, error => finish(error instanceof Error ? error : new Error(String(error))))
        }
      }
      unsubscribe = service.onStateChange(checkState)
      checkState()
    })
  }

  private isConfirmedInactive(status: ExperienceStatusResponse): boolean {
    return status.acknowledgement.accepted &&
      (status.snapshot.state === 'IDLE' || status.snapshot.state === 'COMPLETED')
  }

  private async runStart(
    mode: ExperienceMode,
    requestId: string,
    pending: PendingStart,
  ): Promise<ExperienceAcknowledgement> {
    try {
      const acknowledgement = await this.services[mode].start(requestId, pending.operationId)
      if (pending.invalidated || pending.generation !== this.generations[mode]) {
        throw new Error('Experience start was invalidated by a device fault or disconnect.')
      }
      return acknowledgement
    } finally {
      if (this.pendingStarts[mode] === pending) delete this.pendingStarts[mode]
    }
  }

  private handleServiceChange(mode: ExperienceMode): void {
    const service = this.services[mode]
    const state = service.getExperienceSnapshot()
    const canStart = service.canStart()
    const pending = this.pendingStarts[mode]
    if (state.state === 'FAULT' || (!canStart && this.ready[mode])) {
      this.generations[mode] += 1
      if (pending) {
        pending.invalidated = true
        delete this.pendingStarts[mode]
      }
    }
    this.ready[mode] = canStart
    this.revisions[mode] += 1
    const event: ExperienceEvent = { type: 'SNAPSHOT', snapshot: this.getSnapshot(mode) }
    for (const listener of this.listeners.get(mode) ?? []) listener(event)
  }
}
