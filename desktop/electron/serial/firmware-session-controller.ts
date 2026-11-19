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
import {
  FirmwareJsonlDecoder,
  firmwareCommandMatches,
  getFirmwareJsonParseDiagnostic,
  isFirmwareAcknowledgementForRequest,
  isFirmwareOperationId,
  isFirmwareRequestId,
  isFirmwareStatusResponseForRequest,
  parseFirmwareJsonObject,
} from './firmware-protocol'
import { FirmwareSessionState } from './firmware-session-state'
import { FirmwareWireProbe, wireDiagnostic, type ObservedWireFrame, type FirmwareWireDiagnostic, type WireTx } from './firmware-wire-diagnostics'
import type { SerialConnection, SerialTransport } from './serial-transport'

export interface FirmwareServiceOptions {
  readOnly?: boolean
  allowSimulationTest?: boolean
  // Trusted deployment setting only; omitted by the shipped app (locked).
  allowRealHardwareControl?: boolean
  commandTimeoutMs?: number
  identifyTimeoutMs?: number
  connectSettleMs?: number
  maxLineLength?: number
  onDiagnostic?: (event: FirmwareDiagnosticEvent) => void
}

export interface FirmwareDiagnosticEvent {
  stage:
    | 'request.sent'
    | 'request.write-complete'
    | 'request.write-error'
    | 'response.received'
    | 'request.timeout'
    | 'transport.error'
    | 'transport.closed'
    | 'protocol.invalid'
    | 'firmware.fault'
    | 'session.failure'
    | 'response.frame'
    | 'protocol.rx-aborted'
  command?: ExperienceCommandName
  requestId?: string
  source?: string
  elapsedMs?: number
  responseType?: string
  detail?: string
  wire?: FirmwareWireDiagnostic
}

interface PendingRequest {
  requestId: string
  command: ExperienceCommandName
  source?: string
  startedAt: number
  timeout: ReturnType<typeof setTimeout>
  resolve: (response: unknown) => void
  reject: (error: Error) => void
  waitForStatus: boolean
  waitForStop: boolean
  acknowledgement?: ExperienceAcknowledgement
}

type StateListener = (snapshot: FirmwareControlSnapshot) => void

export class FirmwareSessionController {
  private snapshot: FirmwareControlSnapshot = {
    ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT,
    experience: { ...INITIAL_FIRMWARE_CONTROL_SNAPSHOT.experience },
  }
  private connection: SerialConnection | undefined
  private detachConnectionListeners: (() => void)[] = []
  private pendingRequest: PendingRequest | undefined
  private readonly listeners = new Set<StateListener>()
  private readonly session = new FirmwareSessionState()
  private readonly lineDecoder: FirmwareJsonlDecoder
  private readonly wireProbe = new FirmwareWireProbe()
  private recentTx: WireTx[] = []
  private readonly commandTimeoutMs: number
  private readonly identifyTimeoutMs: number
  private readonly connectSettleMs: number
  private cleanupPromise: Promise<void> = Promise.resolve()
  private readonly readOnly: boolean
  private readonly allowSimulationTest: boolean
  private readonly allowRealHardwareControl: boolean
  private readonly onDiagnostic: (event: FirmwareDiagnosticEvent) => void
  private statusRequest: Promise<ExperienceStatusResponse> | undefined

  constructor(
    private readonly transport: SerialTransport,
    options: FirmwareServiceOptions = {},
  ) {
    this.readOnly = options.readOnly ?? false
    this.allowSimulationTest = options.allowSimulationTest ?? false
    this.allowRealHardwareControl = options.allowRealHardwareControl ?? false
    this.onDiagnostic = options.onDiagnostic ?? (() => {})
    this.commandTimeoutMs = options.commandTimeoutMs ?? 1500
    this.identifyTimeoutMs = options.identifyTimeoutMs ?? 5000
    this.connectSettleMs = options.connectSettleMs ?? 2500
    this.lineDecoder = new FirmwareJsonlDecoder(options.maxLineLength ?? 384)
  }

  getSnapshot(): FirmwareControlSnapshot {
    const experience = { ...this.snapshot.experience }
    if (experience.state === 'RUNNING' && this.session.runStartedAt !== undefined) {
      const durationMs = experience.durationMs ?? 0
      experience.elapsedMs = Math.min(
        durationMs,
        experience.elapsedMs + (Date.now() - this.session.runStartedAt),
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

    this.lineDecoder.reset()
    this.wireProbe.reset()
    this.recentTx = []
    this.session.beginConnection()
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
        connection.onData((chunk, rawBytes) => this.consumeData(connection, chunk, rawBytes)),
        connection.onError((error) => {
          this.emitDiagnostic({
            stage: 'transport.error',
            command: this.pendingRequest?.command,
            requestId: this.pendingRequest?.requestId,
            source: this.pendingRequest?.source,
            detail: error.message,
          })
          this.failSession(connection, error)
        }),
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
        throw new Error(`Incompatible firmware: protocol v2 IDENTIFY was rejected (${code}). Disconnect and verify the installed firmware; do not upload during read-only integration.`)
      }
      const capabilities = identity.capabilities
      const isSimulation = identity.firmware === 'nature-touch-unified-simulation' &&
        identity.hardwareOutputsEnabled === false
      const isReal = identity.firmware === 'nature-touch-unified-real' &&
        typeof identity.hardwareOutputsEnabled === 'boolean' && Array.isArray(capabilities) &&
        ['WIND', 'WAVE', 'BUBBLE', 'REAL_ACTUATORS'].every(capability => capabilities.includes(capability))
      if (
        identity.type !== 'ACK' ||
        identity.command !== 'IDENTIFY' ||
        identity.protocol !== EXPERIENCE_PROTOCOL_VERSION ||
        identity.accepted !== true ||
        (!isSimulation && !isReal)
      ) {
        throw new Error('Incompatible firmware: expected output-disabled Nature Touch protocol v2. Disconnect and verify the installed firmware; do not upload during read-only integration.')
      }
      this.session.confirmRealIdentity(isReal)
      this.updateSnapshot({
        ...this.snapshot,
        identified: true,
        protocolVersion: EXPERIENCE_PROTOCOL_VERSION,
        firmware: String(identity.firmware),
        firmwareVersion: typeof identity.firmwareVersion === 'string' ? identity.firmwareVersion : null,
        timelineVersion: typeof identity.timelineVersion === 'string' ? identity.timelineVersion : null,
        sourceRevision: typeof identity.sourceRevision === 'string' ? identity.sourceRevision : null,
        hardwareOutputsEnabled: identity.hardwareOutputsEnabled === true,
      })

      this.session.confirmSimulationIdentity(
        isSimulation && identity.accepted === true && Array.isArray(capabilities) &&
          ['WIND', 'WAVE', 'BUBBLE', 'SIMULATION_ONLY'].every((capability) => capabilities.includes(capability)),
      )

      const status = await this.readStatus(this.nextRequestId(), true, 'connect')
      if (status.snapshot.state === 'RUNNING' || status.snapshot.state === 'STOPPING') {
        this.session.setRemoteState(status.snapshot.state)
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
    this.lineDecoder.reset()
    this.connection = undefined
    this.detachListeners()
    this.session.clearRun()
    const experience = this.snapshot.experience
    const interrupted = experience.state === 'RUNNING' || experience.state === 'STOPPING'
    this.updateSnapshot({
      ...this.snapshot,
      connectionState: 'disconnected',
      identified: false,
      protocolVersion: null,
      firmwareVersion: null,
      timelineVersion: null,
      sourceRevision: null,
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

  async armSimulationTest(loadsIsolated: boolean, simulationFirmwareConfirmed: boolean): Promise<FirmwareControlSnapshot> {
    this.requireIdentified()
    if (!this.allowSimulationTest || !this.readOnly || loadsIsolated !== true || simulationFirmwareConfirmed !== true ||
        !this.session.simulationIdentityConfirmed) {
      throw new Error('Simulation test arming denied: development mode, physical isolation and identified simulation firmware confirmation are required.')
    }
    const connection = this.connection
    const status = await this.readStatus()
    if (connection !== this.connection || !this.snapshot.identified ||
        !['IDLE', 'COMPLETED'].includes(status.snapshot.state) ||
        (status.snapshot as ExperienceSnapshot & { hardwareOutputsEnabled?: unknown }).hardwareOutputsEnabled !== false) {
      throw new Error('Simulation test arming denied: current device must report inactive simulation-only outputs.')
    }
    this.updateSnapshot({ ...this.snapshot, simulationTestArmed: true })
    return this.getSnapshot()
  }

  disarmSimulationTest(): FirmwareControlSnapshot {
    if (this.session.remoteState === 'RUNNING' || this.session.remoteState === 'STOPPING' || this.pendingRequest) {
      throw new Error('Finish or STOP the simulated operation before disarming.')
    }
    this.updateSnapshot({ ...this.snapshot, simulationTestArmed: false })
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
      if (this.snapshot.experience.state === 'FAULT') throw new Error('Firmware fault invalidated SELECT acknowledgement.')
      this.session.setRemoteState('IDLE')
      this.session.clearRun()
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
      if (this.snapshot.experience.state === 'FAULT') throw new Error('Firmware fault invalidated START acknowledgement.')
      const experienceId = this.snapshot.experience.selectedExperienceId
      if (!experienceId) throw new Error('Firmware accepted START without a selected experience.')
      const durationMs = EXPERIENCE_DEFINITIONS[experienceId].totalDurationMs
      this.session.setRemoteState('RUNNING')
      this.session.setRunStartedAt(Date.now())
      this.updateExperience({
        ...this.snapshot.experience,
        state: 'RUNNING',
        operationId,
        elapsedMs: 0,
        durationMs,
        progress: 0,
        faultCode: null,
      })
    }
    return response
  }

  async stop(requestId: string, operationId: string): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    this.validateOperationId(operationId)
    if (this.statusRequest) await this.statusRequest
    if (this.session.remoteState !== 'RUNNING') throw new Error('Firmware has no confirmed running operation to stop.')

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
    return this.readStatus(requestId, true, 'explicit')
  }

  async recover(requestId: string, confirmation?: { loadsIsolated: boolean; simulationFirmwareConfirmed: boolean }): Promise<ExperienceAcknowledgement> {
    this.requireIdentified()
    this.validateRequestId(requestId)
    if (this.session.realIdentityConfirmed && (this.readOnly || !this.allowRealHardwareControl)) {
      throw new Error('Real actuator control is locked: reviewed deployment permission is required.')
    }
    let confirmedRecovery = false
    if (this.readOnly) {
      if (!this.allowSimulationTest || !this.session.simulationIdentityConfirmed ||
          confirmation?.loadsIsolated !== true || confirmation?.simulationFirmwareConfirmed !== true) {
        throw new Error('Real Arduino is read-only: explicit isolated simulation recovery confirmation required.')
      }
      const connection = this.connection
      const status = await this.readStatus()
      if (connection !== this.connection || !this.snapshot.identified || status.snapshot.state !== 'FAULT' ||
          (status.snapshot as ExperienceSnapshot & { hardwareOutputsEnabled?: unknown }).hardwareOutputsEnabled !== false) {
        throw new Error('Simulation recovery denied: a confirmed output-disabled FAULT is required.')
      }
      confirmedRecovery = true
    }
    const response = await this.sendRequest<ExperienceAcknowledgement>(
      'RECOVER',
      { requestId },
      requestId,
      { confirmedRecovery },
    )
    if (response.accepted) {
      try {
        const status = await this.readStatus(this.nextRequestId(), false)
        if (response.state !== 'IDLE' || status.snapshot.state !== 'IDLE' ||
            status.snapshot.selectedExperienceId !== null || status.snapshot.operationId !== null || status.snapshot.faultCode !== null ||
            (this.readOnly && (status.snapshot as ExperienceSnapshot & { hardwareOutputsEnabled?: unknown }).hardwareOutputsEnabled !== false)) {
          throw new Error('RECOVER was acknowledged but safe idle was not confirmed.')
        }
      } catch (error) {
        this.updateSnapshot({ ...this.snapshot, simulationTestArmed: false,
          experience: { ...this.snapshot.experience, state: 'FAULT', faultCode: this.snapshot.experience.faultCode ?? 'RECOVERY_UNCONFIRMED' },
          lastError: this.errorMessage(error) })
        throw error
      }
      this.session.setRemoteState('IDLE')
      this.session.clearRun()
      this.updateSnapshot({
        ...this.snapshot,
        simulationTestArmed: false,
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

  private async readStatus(
    requestId = this.nextRequestId(),
    apply = true,
    source = 'explicit',
  ): Promise<ExperienceStatusResponse> {
    while (this.statusRequest) await this.statusRequest // Preserve request correlation while serializing explicit reads.
    const request = this.sendRequest<ExperienceStatusResponse>(
      'STATUS_QUERY',
      { requestId },
      requestId,
      { waitForStatus: true, source },
    )
    this.statusRequest = request
    try {
      const wireResponse = await request
      // Protocol v2 STATUS omits progress. Normalize at the service boundary for every API/event.
      const wire = wireResponse.snapshot
      const duration = wire.durationMs ?? 0
      const progress = Number.isFinite(wire.progress) ? wire.progress
        : duration > 0 ? Math.max(0, Math.min(1, wire.elapsedMs / duration)) : wire.state === 'COMPLETED' ? 1 : 0
      const response = { ...wireResponse, snapshot: { ...wire, progress } }
      if (this.session.realIdentityConfirmed &&
          (response.snapshot as ExperienceSnapshot & { hardwareOutputsEnabled?: unknown }).hardwareOutputsEnabled !== this.snapshot.hardwareOutputsEnabled) {
        const error = new Error('Real actuator output capability changed; reconnect and identify explicitly.')
        if (this.connection) this.failSession(this.connection, error, 'INCOMPATIBLE_FIRMWARE')
        throw error
      }
      if (this.snapshot.simulationTestArmed &&
          (response.snapshot as ExperienceSnapshot & { hardwareOutputsEnabled?: unknown }).hardwareOutputsEnabled !== false) {
        const error = new Error('Simulation-only output flag lost; test session closed.')
        if (this.connection) this.failSession(this.connection, error, 'INCOMPATIBLE_FIRMWARE')
        throw error
      }
      if (apply) this.applyStatus(response.snapshot)
      return response
    } finally { if (this.statusRequest === request) this.statusRequest = undefined }
  }

  private sendRequest<T>(
    command: ExperienceCommandName,
    payload: Record<string, string | number>,
    requestId = this.requestIdFromPayload(payload) ?? this.nextRequestId(),
    options: {
      waitForStatus?: boolean
      waitForStop?: boolean
      timeoutMs?: number
      confirmedRecovery?: boolean
      source?: string
    } = {},
  ): Promise<T> {
    if (this.session.realIdentityConfirmed && ['SELECT', 'START', 'RECOVER'].includes(command) &&
        (this.readOnly || !this.allowRealHardwareControl)) {
      return Promise.reject(new Error('Real actuator control is locked: reviewed deployment permission is required.'))
    }
    if (this.readOnly && command !== 'IDENTIFY' && command !== 'STATUS_QUERY' &&
        !(this.session.realIdentityConfirmed && command === 'STOP') &&
        !(this.snapshot.simulationTestArmed && this.snapshot.identified &&
          this.snapshot.connectionState === 'connected' && ['SELECT', 'START', 'STOP'].includes(command)) &&
        !(command === 'RECOVER' && options.confirmedRecovery && this.allowSimulationTest &&
          this.snapshot.identified && this.session.simulationIdentityConfirmed && this.snapshot.connectionState === 'connected')) {
      return Promise.reject(new Error('Hardware Integration Step 1 is read-only: only IDENTIFY and STATUS_QUERY are allowed.'))
    }
    const connection = this.connection
    if (!connection) return Promise.reject(new Error('Connect to the firmware before sending commands.'))
    if (this.pendingRequest) return Promise.reject(new Error('Wait for the current firmware request to finish.'))
    if (!isFirmwareRequestId(requestId)) {
      return Promise.reject(new Error('Firmware request IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.'))
    }

    const request: Record<string, string | number> = {
      type: command,
      ...payload,
      requestId,
    }

    return new Promise<T>((resolve, reject) => {
      const startedAt = Date.now()
      this.recentTx.push({ at: new Date(startedAt).toISOString(), command, requestId,
        bytes: Buffer.byteLength(JSON.stringify(request)) + 1, ascii: JSON.stringify(request).slice(0, 160) })
      this.recentTx = this.recentTx.slice(-4)
      this.emitDiagnostic({
        stage: 'request.sent',
        command,
        requestId,
        source: options.source,
      })
      const timeout = setTimeout(() => {
        if (this.pendingRequest?.requestId !== requestId) return
        this.emitDiagnostic({
          stage: 'request.timeout',
          command,
          requestId,
          source: options.source,
          elapsedMs: Date.now() - startedAt,
          detail: 'No matching firmware response before command timeout.',
        })
        this.failSession(
          connection,
          new Error(`Timed out waiting for ${command} response. Reconnect and identify before issuing another command.`),
          command === 'IDENTIFY' ? 'IDENTIFICATION_FAILED' : 'COMMUNICATION_FAILURE',
        )
      }, options.timeoutMs ?? this.commandTimeoutMs)
      this.pendingRequest = {
        requestId,
        command,
        source: options.source,
        startedAt,
        timeout,
        resolve: (response) => resolve(response as T),
        reject,
        waitForStatus: Boolean(options.waitForStatus),
        waitForStop: Boolean(options.waitForStop),
      }
      void connection.write(JSON.stringify(request)).then(() => {
        this.emitDiagnostic({
          stage: 'request.write-complete',
          command,
          requestId,
          source: options.source,
          elapsedMs: Date.now() - startedAt,
        })
      }).catch((error: unknown) => {
        const detail = this.errorMessage(error)
        this.emitDiagnostic({
          stage: 'request.write-error',
          command,
          requestId,
          source: options.source,
          elapsedMs: Date.now() - startedAt,
          detail,
        })
        this.failSession(connection, new Error(detail))
      })
    })
  }

  private consumeData(connection: SerialConnection, chunk: string, rawBytes?: Uint8Array): void {
    if (connection !== this.connection) return
    // Observe original native bytes before JSON parsing. String-only test transports
    // are explicitly labelled reencoded-string, never claimed as a wire capture.
    const observed = this.wireProbe.push(rawBytes ?? Buffer.from(chunk, 'utf8'), rawBytes !== undefined)
    const frames = this.lineDecoder.push(chunk)
    for (const [index, frame] of frames.entries()) {
      if (connection !== this.connection) break
      const raw = observed[index]
      if (raw) {
        const captured = wireDiagnostic(raw, frame.type === 'line' ? frame.line : undefined)
        const {prefix, suffix, before, after, position, bytePosition, ...metadata} = captured
        this.emitDiagnostic({stage:'response.frame', command:this.pendingRequest?.command,
          requestId:this.pendingRequest?.requestId, source:this.pendingRequest?.source,
          responseType:'RX_FRAME', wire:metadata})
      }
      if (frame.type === 'oversized') {
        const prefix = this.safeDiagnosticSample(frame.prefix)
        const suffix = this.safeDiagnosticSample(frame.suffix)
        const detail = `Firmware response exceeded the maximum line length (observed ${frame.observedLength} characters). RX prefix="${prefix}"; suffix="${suffix}".`
        this.emitDiagnostic({
          stage: 'protocol.invalid',
          command: this.pendingRequest?.command,
          requestId: this.pendingRequest?.requestId,
          source: this.pendingRequest?.source,
          elapsedMs: this.pendingRequest ? Date.now() - this.pendingRequest.startedAt : undefined,
          responseType: 'oversized',
          wire: raw ? {...wireDiagnostic(raw), tx:[...this.recentTx]} : undefined,
          detail,
        })
        this.failSession(connection, new Error(detail))
      } else {
        this.handleLine(connection, frame.line, raw)
      }
    }
  }

  private handleLine(connection: SerialConnection, line: string, raw?: ObservedWireFrame): void {
    const pending = this.pendingRequest
    let message: Record<string, unknown>
    try {
      message = parseFirmwareJsonObject(line)
    } catch (error) {
      const parseDiagnostic = getFirmwareJsonParseDiagnostic(line, error)
      this.emitDiagnostic({
        stage: 'protocol.invalid',
        command: pending?.command,
        requestId: pending?.requestId,
        source: pending?.source,
        wire: raw ? {...wireDiagnostic(raw, line, parseDiagnostic.position), tx:[...this.recentTx]} : undefined,
        detail: `Invalid JSON response (${line.length} characters; frameType=${parseDiagnostic.frameType}; errorPosition=${parseDiagnostic.position ?? 'unknown'}): ${parseDiagnostic.message}; context="${parseDiagnostic.context}"; before="${parseDiagnostic.before}"; after="${parseDiagnostic.after}"`,
      })
      if (!pending) return
      if (pending.command === 'IDENTIFY') {
        const incompatible = line === 'PONG' ||
          line === 'STATUS:DIAGNOSTIC_READY' ||
          line.startsWith('ERROR:')
        if (incompatible) {
          this.failSession(
            connection,
            new Error(
              'Incompatible firmware: the board returned Phase 1B text diagnostics, not protocol v2. Disconnect and verify the installed firmware; do not upload during read-only integration.',
            ),
            'INCOMPATIBLE_FIRMWARE',
          )
          return
        }
      }
      this.failSession(connection, new Error(`Invalid firmware JSON response: ${this.errorMessage(error)}`))
      return
    }

    if (message.type === 'EVENT' && message.name === 'FAULT') {
      this.emitDiagnostic({
        stage: 'firmware.fault',
        command: pending?.command,
        requestId: pending?.requestId,
        source: pending?.source,
        responseType: 'EVENT',
        detail: typeof message.code === 'string' ? message.code : 'FIRMWARE_FAULT',
      })
    } else if (pending && message.requestId === pending.requestId) {
      this.emitDiagnostic({
        stage: 'response.received',
        command: pending.command,
        requestId: pending.requestId,
        source: pending.source,
        elapsedMs: Date.now() - pending.startedAt,
        responseType: String(message.type ?? 'unknown'),
        detail: message.type === 'STATUS' && message.snapshot &&
          typeof message.snapshot === 'object' && 'state' in message.snapshot
          ? `state=${String(message.snapshot.state)}`
          : undefined,
      })
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
          'Incompatible firmware: the board rejected the protocol v2 handshake. Disconnect and verify the installed firmware; do not upload during read-only integration.',
        ),
        'INCOMPATIBLE_FIRMWARE',
      )
      return
    }
    if (!pending || message.requestId !== pending.requestId) return

    if (message.type === 'STATUS' && pending.waitForStatus) {
      if (!isFirmwareStatusResponseForRequest(message, pending.requestId)) {
        this.failSession(connection, new Error('Firmware STATUS response is missing its acknowledgement or snapshot.'))
        return
      }
      this.clearPending()
      pending.resolve(message as unknown as ExperienceStatusResponse)
      return
    }
    if (message.type !== 'ACK' && message.type !== 'NACK') return
    if (!firmwareCommandMatches(message, pending.command)) {
      this.failSession(connection, new Error(`Firmware response command did not match ${pending.command}.`))
      return
    }
    if (!isFirmwareAcknowledgementForRequest(message, pending.requestId)) {
      this.failSession(connection, new Error(`Firmware ${pending.command} acknowledgement is malformed.`))
      return
    }
    const acknowledgement = message as unknown as ExperienceAcknowledgement
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
      this.session.setRemoteState('STOPPING')
      this.updateExperience({ ...this.snapshot.experience, state: 'STOPPING' })
      return
    }
    this.clearPending()
    pending.resolve(acknowledgement)
  }

  private handleEvent(message: Record<string, unknown>): void {
    if (message.name === 'READY' && this.snapshot.identified && this.connection) {
      this.failSession(this.connection, new Error('Firmware reset detected; reconnect explicitly. START was not replayed.'), 'DEVICE_RESET')
      return
    }
    if (message.name === 'FAULT') {
      const code = typeof message.code === 'string' && message.code ? message.code : 'FIRMWARE_FAULT'
      this.session.setRemoteState('FAULT')
      this.session.clearRun()
      this.updateSnapshot({ ...this.snapshot,
        experience: { ...this.snapshot.experience, state: 'FAULT', faultCode: code },
        lastEvent: 'FAULT', lastError: 'Firmware fault: ' + code })
      // Reads remain available for explicit operator recovery. Never send recovery or START here.
      if (this.pendingRequest && !['IDENTIFY', 'STATUS_QUERY'].includes(this.pendingRequest.command)) {
        this.rejectPending(new Error('Firmware fault interrupted ' + this.pendingRequest.command + ': ' + code))
      }
      return
    }
    if (message.name === 'COMPLETED') {
      if (this.snapshot.experience.state !== 'RUNNING' || message.operationId !== this.snapshot.experience.operationId) return
      this.session.setRemoteState('COMPLETED')
      this.session.clearRun()
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
      this.session.setRemoteState('IDLE')
      this.session.clearRun()
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
    if (this.snapshot.experience.state === 'FAULT' && snapshot.state !== 'FAULT') return // Only verified explicit RECOVER/reconnect may clear a fault.
    this.session.setRemoteState(snapshot.state)
    this.session.setRunStartedAt(snapshot.state === 'RUNNING' ? Date.now() : undefined)
    this.updateExperience(snapshot)
  }

  private failSession(
    connection: SerialConnection,
    error: Error,
    faultCode = 'COMMUNICATION_FAILURE',
  ): void {
    if (connection !== this.connection) return
    const partial = this.wireProbe.partial()
    if (partial) this.emitDiagnostic({stage:'protocol.rx-aborted', command:this.pendingRequest?.command,
      requestId:this.pendingRequest?.requestId, source:this.pendingRequest?.source,
      detail:'Unterminated RX frame at session failure; no newline observed.',
      wire:{...wireDiagnostic(partial),tx:[...this.recentTx]}})
    this.emitDiagnostic({
      stage: 'session.failure',
      command: this.pendingRequest?.command,
      requestId: this.pendingRequest?.requestId,
      source: this.pendingRequest?.source,
      responseType: faultCode,
      detail: error.message,
    })
    this.rejectPending(error)
    this.connection = undefined
    this.detachListeners()
    this.lineDecoder.reset()
    this.wireProbe.reset()
    this.session.clearRun()
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
    const partial=this.wireProbe.partial()
    if(partial) this.emitDiagnostic({stage:'protocol.rx-aborted',command:this.pendingRequest?.command,
      requestId:this.pendingRequest?.requestId,source:this.pendingRequest?.source,
      detail:'Transport closed with an unterminated RX frame.',
      wire:{...wireDiagnostic(partial),tx:[...this.recentTx]}})
    this.wireProbe.reset()
    this.emitDiagnostic({
      stage: 'transport.closed',
      command: this.pendingRequest?.command,
      requestId: this.pendingRequest?.requestId,
      source: this.pendingRequest?.source,
      detail: 'Serial connection closed by transport.',
    })
    this.rejectPending(new Error('Firmware serial port disconnected.'))
    this.connection = undefined
    this.detachListeners()
    this.session.clearRun()
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

  private emitDiagnostic(event: FirmwareDiagnosticEvent): void {
    this.onDiagnostic(event)
  }

  private safeDiagnosticSample(sample: string): string {
    return [...sample]
      .map(character => {
        const code = character.charCodeAt(0)
        return code >= 0x20 && code <= 0x7e && character !== '"' && character !== '\\'
          ? character
          : '.'
      })
      .join('')
  }

  private updateSnapshot(snapshot: FirmwareControlSnapshot): void {
    if (snapshot.connectionState !== 'connected' || !snapshot.identified) this.session.invalidateIdentity()
    if (snapshot.connectionState !== 'connected' || !snapshot.identified || snapshot.experience.state === 'FAULT') {
      snapshot = { ...snapshot, simulationTestArmed: false }
    }
    snapshot = { ...snapshot, simulationTestEligible: this.allowSimulationTest && this.session.simulationIdentityConfirmed &&
      snapshot.connectionState === 'connected' && snapshot.identified }
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
    if (!isFirmwareRequestId(requestId)) {
      throw new Error('Firmware request IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.')
    }
  }

  private validateOperationId(operationId: string): void {
    if (!isFirmwareOperationId(operationId)) {
      throw new Error('Firmware operation IDs must be 1-16 ASCII letters, digits, underscores, or hyphens.')
    }
  }

  private requestIdFromPayload(payload: Record<string, string | number>): string | undefined {
    return typeof payload.requestId === 'string' ? payload.requestId : undefined
  }

  private nextRequestId(): string {
    FirmwareSessionController.requestCounter =
      (FirmwareSessionController.requestCounter + 1) % 0xfffffff
    return `r${FirmwareSessionController.requestCounter.toString(36)}`
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private static requestCounter = 0
}
