import {
  DEFAULT_SERIAL_BAUD_RATE,
  type SerialPortInfo,
} from '../../shared/serial-protocol'
import {
  EXPERIENCE_PROTOCOL_VERSION,
  type ExperienceAcknowledgement,
  type ExperienceCommandName,
  type ExperienceSnapshot,
  type ExperienceStatusResponse,
} from '../../shared/experience-control-protocol'
import {
  EXPERIENCE_DEFINITIONS,
  EXPERIENCE_IDS,
  type ExperienceId,
} from '../../shared/experience-definitions'
import {
  INITIAL_FIRMWARE_CONTROL_SNAPSHOT,
  type FirmwareControlSnapshot,
} from '../../shared/firmware-control-protocol'
import type { SerialConnection, SerialTransport } from './serial-transport'

interface ServiceOptions {
  commandTimeoutMs?: number
  identifyTimeoutMs?: number
  connectSettleMs?: number
  heartbeatIntervalMs?: number
  maxLineLength?: number
}

interface PendingRequest {
  requestId: string
  command: ExperienceCommandName
  timeout: ReturnType<typeof setTimeout>
  resolve: (response: unknown) => void
  reject: (error: Error) => void
  waitForStatus: boolean
  waitForStop: boolean
  acknowledgement?: ExperienceAcknowledgement
}

type StateListener = (snapshot: FirmwareControlSnapshot) => void

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/

export class ArduinoFirmwareService {
  private snapshot: FirmwareControlSnapshot = {
    ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,
    experience: { ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT.experience },
  }
  private connection: SerialConnection | undefined
  private detachConnectionListeners: (() => void)[] = []
  private pendingRequest: PendingRequest | undefined
  private readonly listeners = new Set<StateListener>()
  private inputLine = ''
  private discardingLongLine = false
  private readonly commandTimeoutMs: number
  private readonly identifyTimeoutMs: number
  private readonly connectSettleMs: number
  private readonly heartbeatIntervalMs: number
  private readonly maxLineLength: number
  private runStartedAt: number | undefined
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  private cleanupPromise: Promise<void> = Promise.resolve()
  private remoteState: ExperienceSnapshot['state'] = 'IDLE'

  constructor(
    private readonly transport: SerialTransport,
    options: ServiceOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 1500
    this.identifyTimeoutMs = options.identifyTimeoutMs ?? 5000
    this.connectSettleMs = options.connectSettleMs ?? 2500
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1000
    this.maxLineLength = options.maxLineLength ?? 384
  }

  getSnapshot(): FirmwareControlSnapshot {
    const experience = { ...this.snapshot.experience }
    if (experience.state === 'RUNNING' && this.runStartedAt !== undefined) {
      const durationMs = experience.durationMs ?? 0
      experience.elapsedMs = Math.min(
        durationMs,
        experience.elapsedMs + (Date.now() - this.runStartedAt),
      )
      experience.progress = durationMs === 0 ? 1 : experience.elapsedMs / durationMs
    }
    return { ...this.snapshot, experience }
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  listPorts(): Promise<SerialPortInfo[]> {
    return this.transport.listPorts()
  }

  async connect(portPath: string, baudRate = DEFAULT_SERIAL_BAUD_RATE): Promise<FirmwareControlSnapshot> {
    if (this.connection || this.snapshot.connectionState === 'connecting') {
      throw new Error('Disconnect the current firmware session before connecting another port.')
    }
    if (!portPath.trim()) throw new Error('Select a serial port first.')
    if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 2_000_000) {
      throw new Error('Baud rate must be an integer between 300 and 2000000.')
    }

    this.inputLine = ''
    this.discardingLongLine = false
    this.remoteState = 'IDLE'
    this.runStartedAt = undefined
    this.clearHeartbeat()
    this.updateSnapshot({
      ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,
      connectionState: 'connecting',
    })

    try {
      await this.cleanupPromise
      const ports = await this.transport.listPorts()
      if (!ports.some((port) => port.path === portPath)) {
        throw new Error(`Serial port ${portPath} is not currently available.`)
      }
      const connection = await this.transport.open(portPath, baudRate)
      this.connection = connection
      this.detachConnectionListeners = [
        connection.onData((chunk) => this.consumeData(connection, chunk)),
        connection.onError((error) => this.failSession(connection, error)),
        connection.onClose(() => this.handleConnectionClose(connection)),
      ]
      await this.delay(this.connectSettleMs)
      if (this.connection !== connection) {
        throw new Error('Serial port disconnected during firmware startup.')
      }
      this.updateSnapshot({
        ...this.snapshot,
        connectionState: 'connected',
        lastError: null,
      })

      const identity = await this.sendRequest<Record<string, unknown>>(
        'IDENTIFY',
        { protocol: EXPERIENCE_PROTOCOL_VERSION },
        undefined,
        { timeoutMs: this.identifyTimeoutMs },
      )
      if (identity.type === 'NACK') {
        const code = typeof identity.code === 'string' ? identity.code : 'PROTOCOL_REJECTED'
        throw new Error(`Incompatible firmware: protocol v2 IDENTIFY was rejected (${code}). Upload the Phase 2B simulation firmware.`)
      }
      if (
        identity.type !== 'ACK' ||
        identity.command !== 'IDENTIFY' ||
        identity.protocol !== EXPERIENCE_PROTOCOL_VERSION ||
        identity.firmware !== 'nature-touch-unified-simulation' ||
        identity.hardwareOutputsEnabled !== false
      ) {
        throw new Error('Incompatible firmware: expected output-disabled Nature Touch protocol v2. Upload the Phase 2B simulation firmware.')
      }
      this.updateSnapshot({
        ...this.snapshot,
        identified: true,
        protocolVersion: EXPERIENCE_PROTOCOL_VERSION,
        firmware: String(identity.firmware),
      })

      const status = await this.readStatus()
      if (status.snapshot.state === 'RUNNING' || status.snapshot.state === 'STOPPING') {
        this.remoteState = status.snapshot.state
        this.updateSnapshot({
          ...this.snapshot,
          experience: {
            ...status.snapshot,
            state: 'FAULT',
            faultCode: 'RECONNECTED_WHILE_ACTIVE',
          },
          lastError: 'Firmware reports an active operation after reconnect. It was not resumed.',
        })
      }
      return this.getSnapshot()
    } catch (error) {
      const message = this.errorMessage(error)
      const connection = this.connection
      this.rejectPending(new Error(message))
      if (connection) {
        this.detachListeners()
        this.connection = undefined
        this.cleanupPromise = this.closeConnection(connection, message)
      }
      await this.cleanupPromise
      this.updateSnapshot({
        ...this.snapshot,
        connectionState: 'faulted',
        identified: false,
        lastError: message,
        experience: {
          ...this.snapshot.experience,
          state: 'FAULT',
          faultCode: message.startsWith('Incompatible firmware:')
            ? 'INCOMPATIBLE_FIRMWARE'
            : this.snapshot.experience.faultCode ?? 'IDENTIFICATION_FAILED',
        },
      })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<FirmwareControlSnapshot> {
    const connection = this.connection
    this.rejectPending(new Error('Firmware serial connection was disconnected.'))
    this.inputLine = ''
    this.discardingLongLine = false
    this.connection = undefined
    this.detachListeners()
    this.runStartedAt = undefined
    this.clearHeartbeat()
    const experience = this.snapshot.experience
    const interrupted = experience.state === 'RUNNING' || experience.state === 'STOPPING'
    this.updateSnapshot({
      ...this.snapshot,
      connectionState: 'disconnected',
      identified: false,
      protocolVersion: null,
      firmware: null,
      lastError: interrupted ? 'Disconnected during an active operation; firmware stop is unconfirmed.' : null,
      experience: interrupted
        ? { ...experience, state: 'FAULT', faultCode: 'CONNECTION_LOST' }
        : experience,
    })
    if (connection) {
      this.cleanupPromise = this.closeConnection(connection)
      await this.cleanupPromise
    }
    return this.getSnapshot()
  }

  async selectExperience(requestId: string, experienceId: ExperienceId): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    if (!EXPERIENCE_IDS.includes(experienceId)) throw new Error('Unknown experience identifier.')
    const response = await this.sendRequest<ExperienceAcknowledgement>(
      'SELECT',
      { experienceId, requestId },
      requestId,
    )
    if (response.accepted) {
      this.remoteState = 'IDLE'
      this.runStartedAt = undefined
      this.updateExperience({
        state: 'IDLE',
        selectedExperienceId: experienceId,
        operationId: null,
        elapsedMs: 0,
        durationMs: null,
        progress: 0,
        faultCode: null,
      })
    }
    return response
  }

  async start(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    this.validateOperationId(operationId)
    const response = await this.sendRequest<ExperienceAcknowledgement>(
      'START',
      { operationId, requestId },
      requestId,
    )
    if (response.accepted) {
      const experienceId = this.snapshot.experience.selectedExperienceId
      if (!experienceId) throw new Error('Firmware accepted START without a selected experience.')
      const durationMs = EXPERIENCE_DEFINITIONS[experienceId].totalDurationMs
      this.remoteState = 'RUNNING'
      this.runStartedAt = Date.now()
      this.updateExperience({
        ...this.snapshot.experience,
        state: 'RUNNING',
        operationId,
        elapsedMs: 0,
        durationMs,
        progress: 0,
        faultCode: null,
      })
      this.scheduleHeartbeat()
    }
    return response
  }

  async stop(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    this.validateOperationId(operationId)
    if (this.remoteState !== 'RUNNING') throw new Error('Firmware has no confirmed running operation to stop.')
    this.clearHeartbeat()
    return this.sendRequest<ExperienceAcknowledgement>(
      'STOP',
      { operationId, requestId },
      requestId,
      { waitForStop: true },
    )
  }

  async queryStatus(requestId: string): Promise<ExperienceStatusResponse> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    return this.readStatus(requestId)
  }

  async recover(requestId: string): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    const response = await this.sendRequest<ExperienceAcknowledgement>(
      'RECOVER',
      { requestId },
      requestId,
    )
    if (response.accepted) {
      this.remoteState = 'IDLE'
      this.runStartedAt = undefined
      this.updateSnapshot({
        ...this.snapshot,
        lastError: null,
        experience: {
          state: 'IDLE',
          selectedExperienceId: null,
          operationId: null,
          elapsedMs: 0,
          durationMs: null,
          progress: 0,
          faultCode: null,
        },
      })
    }
    return response
  }

  private async readStatus(requestId = this.nextRequestId()): Promise<ExperienceStatusResponse> {
    const response = await this.sendRequest<ExperienceStatusResponse>(
      'STATUS_QUERY',
      { requestId },
      requestId,
      { waitForStatus: true },
    )
    this.applyStatus(response.snapshot)
    return response
  }

  private sendRequest<T>(
    command: ExperienceCommandName,
    payload: Record<string, string | number>,
    requestId = this.requestIdFromPayload(payload) ?? this.nextRequestId(),
    options: { waitForStatus?: boolean; waitForStop?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const connection = this.connection
    if (!connection) return Promise.reject(new Error('Connect to the firmware before sending commands.'))
    if (this.pendingRequest) return Promise.reject(new Error('Wait for the current firmware request to finish.'))
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return Promise.reject(new Error('Firmware request IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.'))
    }

    const request: Record<string, string | number> = {
      type: command,
      ...payload,
      requestId,
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequest?.requestId !== requestId) return
        this.failSession(
          connection,
          new Error(`Timed out waiting for ${command} response. Reconnect and identify before issuing another command.`),
          command === 'IDENTIFY' ? 'IDENTIFICATION_FAILED' : 'COMMUNICATION_FAILURE',
        )
      }, options.timeoutMs ?? this.commandTimeoutMs)
      this.pendingRequest = {
        requestId,
        command,
        timeout,
        resolve: (response) => resolve(response as T),
        reject,
        waitForStatus: Boolean(options.waitForStatus),
        waitForStop: Boolean(options.waitForStop),
      }
      void connection.write(JSON.stringify(request)).catch((error: unknown) => {
        this.failSession(connection, new Error(this.errorMessage(error)))
      })
    })
  }

  private consumeData(connection: SerialConnection, chunk: string): void {
    if (connection !== this.connection) return
    for (const character of chunk) {
      if (character === '\n') {
        if (this.discardingLongLine) {
          this.discardingLongLine = false
          this.inputLine = ''
          this.failSession(connection, new Error('Firmware response exceeded the maximum line length.'))
          continue
        }
        const line = this.inputLine.replace(/\r$/, '')
        this.inputLine = ''
        if (line) this.handleLine(connection, line)
        continue
      }
      if (this.discardingLongLine) continue
      this.inputLine += character
      if (this.inputLine.length > this.maxLineLength) {
        this.inputLine = ''
        this.discardingLongLine = true
      }
    }
  }

  private handleLine(connection: SerialConnection, line: string): void {
    const pending = this.pendingRequest
    let message: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Firmware response must be a JSON object.')
      }
      message = parsed as Record<string, unknown>
    } catch (error) {
      if (!pending) return
      if (pending.command === 'IDENTIFY') {
        const incompatible = line === 'PONG' ||
          line === 'STATUS:DIAGNOSTIC_READY' ||
          line.startsWith('ERROR:')
        if (incompatible) {
          this.failSession(
            connection,
            new Error(
              'Incompatible firmware: the board returned Phase 1B text diagnostics, not protocol v2. Upload the Phase 2B simulation firmware.',
            ),
            'INCOMPATIBLE_FIRMWARE',
          )
          return
        }
      }
      this.failSession(connection, new Error(`Invalid firmware JSON response: ${this.errorMessage(error)}`))
      return
    }

    if (message.type === 'EVENT') {
      this.handleEvent(message)
      return
    }
    if (
      message.type === 'ERROR' &&
      pending?.command === 'IDENTIFY' &&
      message.requestId !== pending.requestId
    ) {
      this.failSession(
        connection,
        new Error(
          'Incompatible firmware: the board rejected the protocol v2 handshake. Upload the Phase 2B simulation firmware.',
        ),
        'INCOMPATIBLE_FIRMWARE',
      )
      return
    }
    if (!pending || message.requestId !== pending.requestId) return

    if (message.type === 'STATUS' && pending.waitForStatus) {
      const response = message as unknown as ExperienceStatusResponse
      if (
        response.requestId !== pending.requestId ||
        !response.snapshot ||
        !response.acknowledgement ||
        response.acknowledgement.requestId !== pending.requestId ||
        response.acknowledgement.command !== 'STATUS_QUERY' ||
        response.acknowledgement.type !== 'ACK'
      ) {
        this.failSession(connection, new Error('Firmware STATUS response is missing its acknowledgement or snapshot.'))
        return
      }
      this.clearPending()
      pending.resolve(response)
      return
    }
    if (message.type !== 'ACK' && message.type !== 'NACK') return
    if (message.command !== pending.command) {
      this.failSession(connection, new Error(`Firmware response command did not match ${pending.command}.`))
      return
    }
    const acknowledgement = message as unknown as ExperienceAcknowledgement
    if (
      typeof acknowledgement.accepted !== 'boolean' ||
      acknowledgement.requestId !== pending.requestId ||
      acknowledgement.state === undefined
    ) {
      this.failSession(connection, new Error(`Firmware ${pending.command} acknowledgement is malformed.`))
      return
    }
    if (acknowledgement.type === 'NACK') {
      this.clearPending()
      pending.resolve(acknowledgement)
      return
    }

    if (pending.command === 'IDENTIFY') {
      this.clearPending()
      pending.resolve(message)
      return
    }
    if (pending.waitForStatus) return
    if (pending.waitForStop) {
      pending.acknowledgement = acknowledgement
      this.remoteState = 'STOPPING'
      this.clearHeartbeat()
      this.updateExperience({ ...this.snapshot.experience, state: 'STOPPING' })
      return
    }
    this.clearPending()
    pending.resolve(acknowledgement)
  }

  private handleEvent(message: Record<string, unknown>): void {
    if (message.name === 'COMPLETED') {
      if (message.operationId !== this.snapshot.experience.operationId) return
      this.remoteState = 'COMPLETED'
      this.runStartedAt = undefined
      this.clearHeartbeat()
      this.updateExperience({
        ...this.snapshot.experience,
        state: 'COMPLETED',
        elapsedMs: this.snapshot.experience.durationMs ?? this.snapshot.experience.elapsedMs,
        progress: 1,
      })
      this.updateSnapshot({ ...this.snapshot, lastEvent: 'COMPLETED' })
      return
    }
    if (message.name === 'STOPPED') {
      const pending = this.pendingRequest
      if (
        !pending ||
        !pending.waitForStop ||
        !pending.acknowledgement ||
        message.operationId !== this.snapshot.experience.operationId
      ) return
      const acknowledgement = pending.acknowledgement
      this.clearPending()
      this.remoteState = 'IDLE'
      this.runStartedAt = undefined
      this.clearHeartbeat()
      this.updateExperience({
        ...this.snapshot.experience,
        state: 'IDLE',
        operationId: null,
        elapsedMs: 0,
        durationMs: null,
        progress: 0,
      })
      this.updateSnapshot({ ...this.snapshot, lastEvent: 'STOPPED' })
      pending.resolve(acknowledgement)
      return
    }
    if (message.name === 'ACTUATOR_EVENT') {
      const eventText = `${String(message.experienceId)} ${String(message.atMs)} ms: ${String(message.action)} ${String(message.durationMs)} ms; D5=${String(message.D5)} D6=${String(message.D6)} D7=${String(message.D7)} (diagnostic only)`
      this.updateSnapshot({ ...this.snapshot, lastEvent: eventText })
      return
    }
    if (message.name === 'MARKER') {
      this.updateSnapshot({ ...this.snapshot, lastEvent: String(message.text ?? 'Marker') })
    }
  }

  private applyStatus(snapshot: ExperienceSnapshot): void {
    if (!snapshot || !['IDLE', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAULT'].includes(snapshot.state)) {
      throw new Error('Firmware returned an invalid STATUS snapshot.')
    }
    this.remoteState = snapshot.state
    this.runStartedAt = snapshot.state === 'RUNNING' ? Date.now() : undefined
    if (snapshot.state !== 'RUNNING') this.clearHeartbeat()
    this.updateExperience(snapshot)
  }

  private failSession(
    connection: SerialConnection,
    error: Error,
    faultCode = 'COMMUNICATION_FAILURE',
  ): void {
    if (connection !== this.connection) return
    this.rejectPending(error)
    this.connection = undefined
    this.detachListeners()
    this.inputLine = ''
    this.discardingLongLine = false
    this.runStartedAt = undefined
    this.clearHeartbeat()
    this.updateSnapshot({
      ...this.snapshot,
      connectionState: 'faulted',
      identified: false,
      lastError: error.message,
      experience: {
        ...this.snapshot.experience,
        state: 'FAULT',
        faultCode,
      },
    })
    this.cleanupPromise = this.closeConnection(connection, error.message)
  }

  private handleConnectionClose(connection: SerialConnection): void {
    if (connection !== this.connection) return
    this.rejectPending(new Error('Firmware serial port disconnected.'))
    this.connection = undefined
    this.detachListeners()
    this.runStartedAt = undefined
    this.clearHeartbeat()
    this.updateSnapshot({
      ...this.snapshot,
      connectionState: 'faulted',
      identified: false,
      lastError: 'Firmware serial port disconnected; firmware stop is unconfirmed.',
      experience: {
        ...this.snapshot.experience,
        state: 'FAULT',
        faultCode: 'CONNECTION_LOST',
      },
    })
  }

  private clearPending(): void {
    if (!this.pendingRequest) return
    clearTimeout(this.pendingRequest.timeout)
    this.pendingRequest = undefined
  }

  private scheduleHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined
      if (
        !this.connection ||
        this.snapshot.experience.state !== 'RUNNING' ||
        this.snapshot.connectionState !== 'connected'
      ) return
      if (this.pendingRequest) {
        this.scheduleHeartbeat()
        return
      }
      void this.readStatus()
        .then(() => {
          if (this.snapshot.experience.state === 'RUNNING') this.scheduleHeartbeat()
        })
        .catch((error: unknown) => {
          console.error('Firmware status heartbeat failed:', this.errorMessage(error))
        })
    }, this.heartbeatIntervalMs)
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingRequest
    if (!pending) return
    this.clearPending()
    pending.reject(error)
  }

  private detachListeners(): void {
    for (const detach of this.detachConnectionListeners) detach()
    this.detachConnectionListeners = []
  }

  private async closeConnection(connection: SerialConnection, cause?: string): Promise<void> {
    try {
      await connection.close()
    } catch (closeError) {
      const closeMessage = this.errorMessage(closeError)
      this.updateSnapshot({
        ...this.snapshot,
        lastError: cause
          ? `${cause} Port close failed: ${closeMessage}`
          : `Port close failed: ${closeMessage}`,
      })
    }
  }

  private updateExperience(experience: ExperienceSnapshot): void {
    this.updateSnapshot({ ...this.snapshot, experience })
  }

  private updateSnapshot(snapshot: FirmwareControlSnapshot): void {
    this.snapshot = snapshot
    const current = this.getSnapshot()
    for (const listener of this.listeners) listener(current)
  }

  private requireIdentified(): void {
    if (!this.connection || !this.snapshot.identified) {
      throw new Error('Identify the connected protocol v2 firmware before sending experience commands.')
    }
  }

  private validateRequestId(requestId: string): void {
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new Error('Firmware request IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.')
    }
  }

  private validateOperationId(operationId: string): void {
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      throw new Error('Firmware operation IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.')
    }
  }

  private requestIdFromPayload(payload: Record<string, string | number>): string | undefined {
    return typeof payload.requestId === 'string' ? payload.requestId : undefined
  }

  private nextRequestId(): string {
    ArduinoFirmwareService.requestCounter = (ArduinoFirmwareService.requestCounter + 1) % 0xfffffff
    return `r${ArduinoFirmwareService.requestCounter.toString(36)}`
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private static requestCounter = 0
}
