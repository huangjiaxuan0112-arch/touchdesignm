import { EXPERIENCE_DEFINITIONS, EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import type {
  ExperienceAcknowledgement,
  ExperienceCommandName,
  ExperienceSnapshot,
  ExperienceStatusResponse,
} from '../shared/experience-control-protocol'
import { systemExperienceClock, type ExperienceClock } from './experience-clock'

interface CachedRequest {
  signature: string
  acknowledgement: ExperienceAcknowledgement
}

interface MockControllerOptions {
  clock?: ExperienceClock
  stopDelayMs?: number
  requestCacheLimit?: number
}

type StateListener = (snapshot: ExperienceSnapshot) => void
type Transition = () => ExperienceAcknowledgement

export class MockExperienceController {
  private state: ExperienceSnapshot = {
    state: 'IDLE',
    selectedExperienceId: null,
    operationId: null,
    elapsedMs: 0,
    durationMs: null,
    progress: 0,
    faultCode: null,
  }
  private startedAtMs: number | undefined
  private cancelTimer: (() => void) | undefined
  private readonly requests = new Map<string, CachedRequest>()
  private readonly operationIds = new Set<string>()
  private readonly listeners = new Set<StateListener>()
  private readonly clock: ExperienceClock
  private readonly stopDelayMs: number
  private readonly requestCacheLimit: number

  constructor(options: MockControllerOptions = {}) {
    this.clock = options.clock ?? systemExperienceClock
    this.stopDelayMs = options.stopDelayMs ?? 200
    this.requestCacheLimit = options.requestCacheLimit ?? 256
  }

  getSnapshot(): ExperienceSnapshot {
    if (this.state.state !== 'RUNNING' || this.startedAtMs === undefined) {
      return { ...this.state }
    }

    const durationMs = this.state.durationMs ?? 0
    const elapsedMs = Math.min(durationMs, this.state.elapsedMs + (this.clock.now() - this.startedAtMs))
    return {
      ...this.state,
      elapsedMs,
      progress: durationMs === 0 ? 1 : elapsedMs / durationMs,
    }
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  selectExperience(requestId: string, experienceId: ExperienceId): ExperienceAcknowledgement {
    return this.execute('SELECT', requestId, experienceId, () => {
      if (!EXPERIENCE_IDS.includes(experienceId)) {
        return this.nack('SELECT', requestId, 'UNKNOWN_EXPERIENCE')
      }
      if (this.state.state !== 'IDLE' && this.state.state !== 'COMPLETED') {
        return this.nack('SELECT', requestId, 'INVALID_STATE')
      }

      this.startedAtMs = undefined
      this.state = {
        state: 'IDLE',
        selectedExperienceId: experienceId,
        operationId: null,
        elapsedMs: 0,
        durationMs: null,
        progress: 0,
        faultCode: null,
      }
      this.notify()
      return this.ack('SELECT', requestId)
    })
  }

  start(requestId: string, operationId: string): ExperienceAcknowledgement {
    return this.execute('START', requestId, operationId, () => {
      if (!this.validId(operationId)) return this.nack('START', requestId, 'INVALID_OPERATION_ID')
      if (this.operationIds.has(operationId)) return this.nack('START', requestId, 'OPERATION_ID_REUSED')
      if (this.state.state !== 'IDLE') return this.nack('START', requestId, 'INVALID_STATE')
      if (!this.state.selectedExperienceId) return this.nack('START', requestId, 'NO_EXPERIENCE_SELECTED')

      const experienceId = this.state.selectedExperienceId
      const durationMs = EXPERIENCE_DEFINITIONS[experienceId].totalDurationMs
      this.operationIds.add(operationId)
      this.startedAtMs = this.clock.now()
      this.state = {
        ...this.state,
        state: 'RUNNING',
        operationId,
        elapsedMs: 0,
        durationMs,
        progress: 0,
        faultCode: null,
      }
      this.cancelTimer = this.clock.schedule(() => this.complete(operationId), durationMs)
      this.notify()
      return this.ack('START', requestId, operationId)
    })
  }

  stop(requestId: string, operationId: string): ExperienceAcknowledgement {
    return this.execute('STOP', requestId, operationId, () => {
      if (this.state.state !== 'RUNNING') return this.nack('STOP', requestId, 'INVALID_STATE')
      if (this.state.operationId !== operationId) return this.nack('STOP', requestId, 'OPERATION_MISMATCH')

      const elapsed = this.getSnapshot().elapsedMs
      this.cancelScheduledWork()
      this.startedAtMs = undefined
      this.state = {
        ...this.state,
        state: 'STOPPING',
        elapsedMs: elapsed,
        progress: this.state.durationMs ? elapsed / this.state.durationMs : 0,
      }
      this.notify()
      this.cancelTimer = this.clock.schedule(() => {
        if (this.state.state !== 'STOPPING' || this.state.operationId !== operationId) return
        this.state = {
          ...this.state,
          state: 'IDLE',
          operationId: null,
          elapsedMs: 0,
          durationMs: null,
          progress: 0,
        }
        this.cancelTimer = undefined
        this.notify()
      }, this.stopDelayMs)
      return this.ack('STOP', requestId, operationId)
    })
  }

  queryStatus(requestId: string): ExperienceStatusResponse {
    const acknowledgement = this.execute('STATUS_QUERY', requestId, '', () => this.ack('STATUS_QUERY', requestId))
    return {
      type: 'STATUS',
      requestId,
      acknowledgement,
      snapshot: this.getSnapshot(),
    }
  }

  recover(requestId: string): ExperienceAcknowledgement {
    return this.execute('RECOVER', requestId, '', () => {
      if (this.state.state !== 'FAULT' && this.state.state !== 'COMPLETED') {
        return this.nack('RECOVER', requestId, 'INVALID_STATE')
      }

      this.cancelScheduledWork()
      this.startedAtMs = undefined
      this.state = {
        state: 'IDLE',
        selectedExperienceId: null,
        operationId: null,
        elapsedMs: 0,
        durationMs: null,
        progress: 0,
        faultCode: null,
      }
      this.notify()
      return this.ack('RECOVER', requestId)
    })
  }

  simulateFault(code: string): ExperienceSnapshot {
    this.enterFault(code || 'SIMULATED_FAULT')
    return this.getSnapshot()
  }

  simulateConnectionLoss(): ExperienceSnapshot {
    this.enterFault('CONNECTION_LOST')
    return this.getSnapshot()
  }

  private execute(
    command: ExperienceCommandName,
    requestId: string,
    payloadSignature: string,
    transition: Transition,
  ): ExperienceAcknowledgement {
    if (!this.validId(requestId)) return this.nack(command, requestId, 'INVALID_REQUEST_ID')

    const signature = `${command}:${payloadSignature}`
    const cached = this.requests.get(requestId)
    if (cached) {
      if (cached.signature === signature) return { ...cached.acknowledgement }
      return this.nack(command, requestId, 'REQUEST_ID_REUSED')
    }

    const acknowledgement = transition()
    this.requests.set(requestId, { signature, acknowledgement })
    if (this.requests.size > this.requestCacheLimit) {
      const oldestRequestId = this.requests.keys().next().value
      if (oldestRequestId !== undefined) this.requests.delete(oldestRequestId)
    }
    return acknowledgement
  }

  private complete(operationId: string): void {
    if (this.state.state !== 'RUNNING' || this.state.operationId !== operationId) return
    this.cancelTimer = undefined
    this.startedAtMs = undefined
    this.state = {
      ...this.state,
      state: 'COMPLETED',
      elapsedMs: this.state.durationMs ?? 0,
      progress: 1,
    }
    this.notify()
  }

  private enterFault(code: string): void {
    this.cancelScheduledWork()
    const elapsedMs = this.state.state === 'RUNNING' ? this.getSnapshot().elapsedMs : this.state.elapsedMs
    this.startedAtMs = undefined
    this.state = {
      ...this.state,
      state: 'FAULT',
      elapsedMs,
      progress: this.state.durationMs ? elapsedMs / this.state.durationMs : 0,
      faultCode: code,
    }
    this.notify()
  }

  private cancelScheduledWork(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
  }

  private ack(
    command: ExperienceCommandName,
    requestId: string,
    operationId?: string,
  ): ExperienceAcknowledgement {
    return {
      type: 'ACK',
      requestId,
      command,
      accepted: true,
      state: this.state.state,
      ...(operationId ? { operationId } : {}),
    }
  }

  private nack(
    command: ExperienceCommandName,
    requestId: string,
    code: string,
  ): ExperienceAcknowledgement {
    return {
      type: 'NACK',
      requestId,
      command,
      accepted: false,
      state: this.state.state,
      code,
    }
  }

  private validId(value: string): boolean {
    return typeof value === 'string' && value.length > 0 && value.length <= 64
  }

  private notify(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}