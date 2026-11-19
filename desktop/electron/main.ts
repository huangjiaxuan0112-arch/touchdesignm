import { app, BrowserWindow, ipcMain, Menu, screen, session, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { LocalEventLog } from './local-event-log'
import { SerialDiagnosticService } from './serial/serial-diagnostic-service'
import { NativeSerialTransport } from './serial/native-serial-transport'
import { ArduinoFirmwareService } from './serial/arduino-firmware-service'
import { FIRMWARE_WIRE_DIAGNOSTIC_VERSION } from './serial/firmware-wire-diagnostics'
import { MockExperienceController } from '../experience/mock-experience-controller'
import { ExhibitionLifecycleController } from '../experience/exhibition-lifecycle-controller'
import {
  type ExperienceCommandServices,
} from './experience-command-dispatcher'
import { ExperienceCoordinator, type ExperienceCoordinatorServices } from './experience-coordinator'
import { createExperienceIpcHandlers } from './experience-ipc-handlers'
import { createIpadLanServer, readIpadLanServerConfig } from './ipad-lan-server'
import { IPC_CHANNELS, type RuntimeInfo } from '../shared/ipc'
import { EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import type { ExperienceSnapshot as DeviceExperienceSnapshot } from '../shared/experience-control-protocol'
import type { SerialStateSnapshot } from '../shared/serial-protocol'
import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'
import { EXHIBITION_TIMING } from '../shared/exhibition-lifecycle'
import { getProjectorPlacement } from './projector-display'
import { resolveExhibitionMode, audienceEvents, firmwareExhibitionReady } from './exhibition-routing'
import { isProjectorMediaReport } from '../shared/projector'
import type { IpadLanRuntimeStatus } from '../shared/ipad-lan-status'

declare const __NATURE_TOUCH_DEV_CSP_NONCE__: string
declare const __NATURE_TOUCH_GIT_COMMIT__: string
declare const __NATURE_TOUCH_DEVICE_SOURCE__: 'mock' | 'firmware'

app.setName('Nature Touch')
const serialService = new SerialDiagnosticService(new NativeSerialTransport())
// Source-level deployment permission. Never set by renderer input or dev mode.
// The user confirmed the on-site conditions and approved this 30s deployment gate on 2026-11-12.
const REAL_HARDWARE_DEPLOYMENT_REVIEWED = true
// User-confirmed airbag-disconnected, open nonpressurizing bench ONLY. Normal
// launches remain read-only; the renderer cannot enable this process profile.
const OPEN_AIR_BENCH_UI_REVIEWED = true
const OPEN_AIR_BENCH_SESSION = OPEN_AIR_BENCH_UI_REVIEWED && process.argv.includes('--open-air-bench')
const REAL_CONTROL_PERMITTED = REAL_HARDWARE_DEPLOYMENT_REVIEWED || OPEN_AIR_BENCH_SESSION
const HARDWARE_CONFIG_VERSION = 'USER-CONFIRMED-20261104-1200-1800-500-300'
const MEDIA_ERROR_CODES: ReadonlySet<string> = new Set([
  'audio-load-failed',
  'audio-play-failed',
  'audio-position-invalid',
  'experience-start-failed',
  'media-prepare-failed',
  'video-load-failed',
  'video-play-failed',
])
let localEventLog: LocalEventLog | undefined
function logEvent(event: string, fields: Parameters<LocalEventLog['record']>[1] = {}): void {
  localEventLog?.record(event, fields)
}

const firmwareTransport = new NativeSerialTransport()
if (OPEN_AIR_BENCH_SESSION) {
  const open = firmwareTransport.open.bind(firmwareTransport)
  firmwareTransport.open = async (path, baud) => {
    const connection = await open(path, baud)
    const write = connection.write.bind(connection)
    connection.write = async line => {
      logEvent('firmware.transport_tx')
      await write(line)
    }
    let buffer = ''
    connection.onData(chunk => {
      buffer += chunk
      for (let cut; (cut = buffer.indexOf('\n')) >= 0;) {
        logEvent('firmware.transport_rx')
        buffer = buffer.slice(cut + 1)
      }
    })
    return connection
  }
}
const firmwareService = new ArduinoFirmwareService(firmwareTransport, {
  readOnly: !REAL_CONTROL_PERMITTED,
  allowSimulationTest: !app.isPackaged && !OPEN_AIR_BENCH_SESSION,
  allowRealHardwareControl: REAL_CONTROL_PERMITTED,
  onDiagnostic: event => logEvent(`firmware.${event.stage}`, {
    level: event.stage.endsWith('error') || event.stage.endsWith('timeout') ||
      event.stage === 'session.failure' || event.stage === 'firmware.fault' ||
      event.stage === 'protocol.invalid' || event.stage === 'protocol.rx-aborted' || event.stage === 'transport.closed'
      ? 'error'
      : 'info',
    command: event.command,
    requestId: event.requestId,
    source: event.source,
    elapsedMs: event.elapsedMs,
    responseType: event.responseType,
    reason: event.detail,
    wire: event.wire,
  }),
})
function realControlEligible(snapshot: FirmwareControlSnapshot): boolean {
  return firmwareExhibitionReady(snapshot, REAL_CONTROL_PERMITTED)
}

function rendererFirmwareSnapshot(snapshot = firmwareService.getSnapshot()): FirmwareControlSnapshot {
  return {
    ...snapshot,
    openAirBenchSession: OPEN_AIR_BENCH_SESSION,
    realControlEligible: realControlEligible(snapshot),
  }
}
const mockExperienceController = new MockExperienceController({
  completionDurationMs: EXHIBITION_TIMING.mockDeviceCompletionMs,
})
const experienceCommandServices: ExperienceCommandServices = {
  mock: mockExperienceController,
  firmware: firmwareService,
}
// Source-reviewed deployment selection; a bench CLI flag cannot change this route.
const EXHIBITION_DEVICE_SOURCE = __NATURE_TOUCH_DEVICE_SOURCE__
const exhibitionMode = resolveExhibitionMode(EXHIBITION_DEVICE_SOURCE, REAL_HARDWARE_DEPLOYMENT_REVIEWED)
const exhibitionDevice = exhibitionMode === 'mock' ? mockExperienceController
  : { getSnapshot: () => firmwareService.getSnapshot().experience }
const coordinatorServices: ExperienceCoordinatorServices = {
  mock: {
    selectExperience: (requestId, experienceId) =>
      mockExperienceController.selectExperience(requestId, experienceId),
    start: (requestId, operationId) => mockExperienceController.start(requestId, operationId),
    stop: (requestId, operationId) => mockExperienceController.stop(requestId, operationId),
    queryStatus: requestId => mockExperienceController.queryStatus(requestId),
    recover: requestId => mockExperienceController.recover(requestId),
    getExperienceSnapshot: () => mockExperienceController.getSnapshot(),
    canStart: () => true,
    onStateChange: listener => mockExperienceController.onStateChange(() => listener()),
  },
  firmware: {
    selectExperience: (requestId, experienceId) => firmwareService.selectExperience(requestId, experienceId),
    start: (requestId, operationId) => firmwareService.start(requestId, operationId),
    stop: (requestId, operationId) => firmwareService.stop(requestId, operationId),
    queryStatus: requestId => firmwareService.queryStatus(requestId),
    getExperienceSnapshot: () => firmwareService.getSnapshot().experience,
    canStart: () => {
      const state = firmwareService.getSnapshot()
      if (exhibitionMode === 'firmware') return firmwareExhibitionReady(state, REAL_HARDWARE_DEPLOYMENT_REVIEWED)
      const simulationReady = state.simulationTestArmed === true && state.hardwareOutputsEnabled === false
      const reviewedRealControl = realControlEligible(state)
      return state.identified && state.connectionState === 'connected' &&
        (simulationReady || reviewedRealControl)
    },
    onStateChange: listener => firmwareService.onStateChange(() => listener()),
  },
}
const experienceCoordinator = new ExperienceCoordinator(coordinatorServices)
const exhibitionLifecycleController = new ExhibitionLifecycleController(
  experienceCoordinator,
  exhibitionDevice,
  undefined,
  { requireProjectorMedia: true, mode: exhibitionMode, canSelect: () => coordinatorServices[exhibitionMode].canStart() },
)
let mainWindow: BrowserWindow | undefined
let projectorWindow: BrowserWindow | undefined
let ipadLanServer: ReturnType<typeof createIpadLanServer> | undefined
function ipadRuntimeStatus(): IpadLanRuntimeStatus {
  if (exhibitionMode === 'mock') {
    const state = mockExperienceController.getSnapshot().state
    return { runtimeMode: 'mock', deviceSource: 'mock',
      deviceReady: ['IDLE', 'COMPLETED'].includes(state),
      device: { connectionState: 'simulated', identified: false, state,
        firmware: null, firmwareVersion: null, verified: false, hardwareOutputsEnabled: false } }
  }
  const state = firmwareService.getSnapshot()
  const verified = firmwareExhibitionReady(state, REAL_HARDWARE_DEPLOYMENT_REVIEWED)
  return { runtimeMode: 'exhibition', deviceSource: 'firmware',
    deviceReady: verified && ['IDLE', 'COMPLETED'].includes(state.experience.state),
    device: { connectionState: state.connectionState, identified: state.identified,
      state: state.experience.state, firmware: state.firmware, firmwareVersion: state.firmwareVersion ?? null,
      verified, hardwareOutputsEnabled: state.identified ? state.hardwareOutputsEnabled : null } }
}
let serialPortOwner: 'diagnostic' | 'firmware' | null = null
let serialPortOperationQueue: Promise<void> = Promise.resolve()

function serializeSerialPortOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = serialPortOperationQueue.then(operation, operation)
  serialPortOperationQueue = result.then(() => undefined, () => undefined)
  return result
}

interface ControlRequestLog {
  type: 'SELECT' | 'START' | 'STOP' | 'STATUS'
  mode: 'mock' | 'firmware'
  operationId?: string
}

function getControlRequestLog(channel: string, args: unknown[]): ControlRequestLog | undefined {
  const legacyChannels: Record<string, { type: ControlRequestLog['type']; mode: ControlRequestLog['mode'] }> = {
    [IPC_CHANNELS.experienceSelect]: { type: 'SELECT', mode: 'mock' },
    [IPC_CHANNELS.experienceStart]: { type: 'START', mode: 'mock' },
    [IPC_CHANNELS.experienceStop]: { type: 'STOP', mode: 'mock' },
    [IPC_CHANNELS.firmwareSelect]: { type: 'SELECT', mode: 'firmware' },
    [IPC_CHANNELS.firmwareStart]: { type: 'START', mode: 'firmware' },
    [IPC_CHANNELS.firmwareStop]: { type: 'STOP', mode: 'firmware' },
  }
  const payload = args[0]
  if (!payload || typeof payload !== 'object') return undefined

  const request = payload as Record<string, unknown>
  const defaults = legacyChannels[channel]
  const type = channel === IPC_CHANNELS.experienceDispatch ? request.type : defaults?.type
  const mode = channel === IPC_CHANNELS.experienceDispatch ? request.mode : defaults?.mode
  if ((type !== 'SELECT' && type !== 'START' && type !== 'STOP' && type !== 'STATUS') ||
      (mode !== 'mock' && mode !== 'firmware')) return undefined

  return {
    type,
    mode,
    operationId: typeof request.operationId === 'string' ? request.operationId : undefined,
  }
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

function logFirmwareSnapshot(snapshot: FirmwareControlSnapshot, previous: FirmwareControlSnapshot): void {
  if (snapshot.connectionState !== previous.connectionState) {
    logEvent('serial.connection', {
      phase: snapshot.connectionState,
      deviceIdentity: snapshot.firmware ?? undefined,
    })
  }
  if (snapshot.identified !== previous.identified) {
    logEvent('firmware.identify', {
      level: snapshot.identified ? 'info' : 'warn',
      phase: snapshot.identified ? 'accepted' : 'invalidated',
      deviceIdentity: snapshot.firmware ?? undefined,
      reason: !snapshot.identified && snapshot.experience.faultCode
        ? snapshot.experience.faultCode
        : undefined,
    })
  }
  if (snapshot.lastEvent !== previous.lastEvent && snapshot.lastEvent === 'STOPPED') {
    logEvent('firmware.event', {
      phase: snapshot.lastEvent,
      operationId: snapshot.experience.operationId ?? undefined,
    })
  }
  if (snapshot.experience.state === 'FAULT' &&
      (snapshot.experience.state !== previous.experience.state ||
       snapshot.experience.faultCode !== previous.experience.faultCode)) {
    logEvent('firmware.fault', {
      level: 'error',
      reason: snapshot.experience.faultCode ?? 'FIRMWARE_FAULT',
      phase: snapshot.lastError?.slice(0, 32),
    })
  } else if (snapshot.lastError && snapshot.lastError !== previous.lastError) {
    logEvent('firmware.error', {
      level: 'error',
      reason: snapshot.lastError,
    })
  }
}

function installContentSecurityPolicy(): void {
  const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL)
  const nonceSource = isDevelopment && __NATURE_TOUCH_DEV_CSP_NONCE__
    ? ` 'nonce-${__NATURE_TOUCH_DEV_CSP_NONCE__}'`
    : ''
  const developmentConnections = isDevelopment
    ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*'
    : ''
  const policy = [
    "default-src 'self'",
    `script-src 'self'${nonceSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${developmentConnections}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

function registerIpcHandlers(): void {
  const previousExperience = new Map<string, { state: string; operationId: string | null }>()
  for (const mode of ['mock', 'firmware'] as const) {
    experienceCoordinator.subscribe(mode, event => {
      const { state, operationId, faultCode } = event.snapshot.experience
      const previous = previousExperience.get(mode)
      if (!previous || previous.state !== state || previous.operationId !== operationId) {
        logEvent('experience.state', {
          level: state === 'FAULT' ? 'error' : 'info',
          mode,
          phase: state,
          operationId: operationId ?? undefined,
          reason: faultCode ?? undefined,
        })
        previousExperience.set(mode, { state, operationId })
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        for (const notification of audienceEvents(event, exhibitionMode)) {
          mainWindow.webContents.send(IPC_CHANNELS.experienceEvent, notification)
        }
      }
    })
  }
  exhibitionLifecycleController.subscribe(snapshot => {
    logEvent('exhibition.phase',{mode:exhibitionMode,phase:snapshot.phase,operationId:snapshot.operationId??undefined,reason:snapshot.faultCode??undefined})
    if (snapshot.phase === 'WAITING') logEvent('projector.start-ack', {
      operationId: snapshot.operationId ?? undefined, reason: String(snapshot.startAcknowledgedAtMs),
    })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.exhibitionEvent, snapshot)
    }
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      projectorWindow.webContents.send(IPC_CHANNELS.exhibitionEvent, snapshot)
    }
  })
  for (const [channel, handler] of Object.entries(
    createExperienceIpcHandlers(
      experienceCommandServices,
      experienceCoordinator,
      exhibitionLifecycleController,
    ),
  )) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      if (_event.sender === projectorWindow?.webContents && channel !== IPC_CHANNELS.exhibitionGetSnapshot) {
        throw new Error('Projector cannot issue experience commands.')
      }
      const request = getControlRequestLog(channel, args)
      if (!request) return handler(...args)
      const actualMode = request.mode === 'mock' ? exhibitionMode : request.mode
      const fields = {
        mode: actualMode,
        operationId: request.operationId,
        phase: request.type,
        deviceIdentity: actualMode === 'firmware'
          ? firmwareService.getSnapshot().firmware ?? undefined
          : undefined,
      }
      logEvent('experience.command.requested', fields)
      try {
        const result = await handler(...args)
        const response = result && typeof result === 'object'
          ? result as Record<string, unknown>
          : {}
        const responseType = typeof response.type === 'string' ? response.type : 'resolved'
        logEvent('experience.command.result', {
          ...fields,
          level: responseType === 'NACK' ? 'warn' : 'info',
          phase: `${request.type}:${responseType}`,
          reason: responseType === 'NACK' && typeof response.code === 'string'
            ? response.code
            : undefined,
        })
        return result
      } catch (error) {
        logEvent('experience.command.failed', {
          ...fields,
          level: 'error',
          reason: errorKind(error),
        })
        throw error
      }
    })
  }

  ipcMain.handle(IPC_CHANNELS.projectorMediaReport, async (event, payload: unknown): Promise<boolean> => {
    if (!projectorWindow || projectorWindow.isDestroyed() || event.sender !== projectorWindow.webContents ||
        event.senderFrame !== projectorWindow.webContents.mainFrame || !isProjectorMediaReport(payload)) {
      throw new Error('Invalid Projector media report or sender.')
    }
    const snapshot = exhibitionLifecycleController.getSnapshot()
    const accepted = await exhibitionLifecycleController.reportProjectorMedia(payload)
    logEvent('projector.media.' + payload.event, {
      level: payload.event === 'error' ? 'error' : 'info',
      operationId: payload.operationId, mode: payload.experienceId,
      reason: JSON.stringify({ accepted, at: payload.occurredAtMs,
        ackToPlayingMs: accepted && payload.event === 'playing' && snapshot.startAcknowledgedAtMs !== undefined
          ? payload.occurredAtMs - snapshot.startAcknowledgedAtMs : undefined, code: payload.code }),
    })
    return accepted
  })

  ipcMain.handle(IPC_CHANNELS.runtimeInfo, (): RuntimeInfo => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    exhibitionDeviceSource: exhibitionMode,
  }))
  ipcMain.handle(IPC_CHANNELS.logMediaError, async (_event, code: unknown): Promise<void> => {
    if (typeof code !== 'string' || !MEDIA_ERROR_CODES.has(code)) {
      throw new Error('Invalid media error code.')
    }
    logEvent('media.error', { level: 'error', reason: code })
    await exhibitionLifecycleController.reportMediaFailure(code)
  })

  ipcMain.handle(IPC_CHANNELS.experienceGetState, () => exhibitionDevice.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.serialListPorts, () => serialService.listPorts())
  ipcMain.handle(IPC_CHANNELS.serialGetState, () => serialService.getState())
  ipcMain.handle(IPC_CHANNELS.serialConnect, (): Promise<SerialStateSnapshot> => {
    throw new Error('Legacy serial diagnostics are disabled during read-only hardware integration.')
  })
  ipcMain.handle(IPC_CHANNELS.serialDisconnect, () =>
    serializeSerialPortOperation(async () => {
      const snapshot = await serialService.disconnect()
      if (serialPortOwner === 'diagnostic') serialPortOwner = null
      return snapshot
    }),
  )
  ipcMain.handle(IPC_CHANNELS.serialPing, () => { throw new Error('Read-only Protocol v2 mode: legacy PING is disabled.') })
  ipcMain.handle(IPC_CHANNELS.serialStatus, () => { throw new Error('Read-only Protocol v2 mode: legacy STATUS is disabled.') })
  ipcMain.handle(IPC_CHANNELS.firmwareGetState, (): FirmwareControlSnapshot => rendererFirmwareSnapshot())
  ipcMain.handle(IPC_CHANNELS.firmwareArmSimulation, (_event, payload: unknown) => {
    const confirmation = payload as { loadsIsolated?: unknown; simulationFirmwareConfirmed?: unknown } | null
    return firmwareService.armSimulationTest(confirmation?.loadsIsolated === true, confirmation?.simulationFirmwareConfirmed === true)
  })
  ipcMain.handle(IPC_CHANNELS.firmwareDisarmSimulation, () => firmwareService.disarmSimulationTest())
  ipcMain.handle(IPC_CHANNELS.firmwareConnect, (_event, payload: unknown): Promise<FirmwareControlSnapshot> => {
    if (!payload || typeof payload !== 'object') throw new Error('A port path and baud rate are required.')
    const request = payload as { portPath?: unknown; baudRate?: unknown; loadsIsolated?: unknown; benchFixtureConfirmed?: unknown }
    if (OPEN_AIR_BENCH_SESSION ? request.benchFixtureConfirmed !== true : request.loadsIsolated !== true) {
      throw new Error(OPEN_AIR_BENCH_SESSION
        ? 'Confirm airbag disconnected, gas path open/nonpressurizing and USB cutoff immediately accessible.'
        : 'Confirm pneumatic loads are physically isolated before opening USB serial.')
    }
    if (typeof request.portPath !== 'string' || typeof request.baudRate !== 'number') {
      throw new Error('A port path and numeric baud rate are required.')
    }
    const portPath = request.portPath
    const baudRate = request.baudRate
    return serializeSerialPortOperation(async () => {
      if (OPEN_AIR_BENCH_SESSION) {
        const reviewedNano = (await firmwareService.listPorts()).find(port => port.path === portPath &&
          port.vendorId?.toUpperCase() === '1A86' && port.productId?.toUpperCase() === '7523' &&
          port.serialNumber === '5&26B53364&0&9')
        if (!reviewedNano) throw new Error('Open-air bench profile is restricted to the reviewed physical Nano.')
      }
      if (serialPortOwner === 'diagnostic') {
        await serialService.disconnect()
        serialPortOwner = null
      }
      const snapshot = await firmwareService.connect(portPath, baudRate)
      serialPortOwner = 'firmware'
      return rendererFirmwareSnapshot(snapshot)
    })
  })
  ipcMain.handle(IPC_CHANNELS.firmwareDisconnect, () =>
    serializeSerialPortOperation(async () => {
      const snapshot = await firmwareService.disconnect()
      if (serialPortOwner === 'firmware') serialPortOwner = null
      return snapshot
    }),
  )
  ipcMain.handle(IPC_CHANNELS.firmwareStatus, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('A firmware request ID is required.')
    return firmwareService.queryStatus(requestId)
  })
  ipcMain.handle(IPC_CHANNELS.firmwareRecover, (_event, payload: unknown) => {
    const request = payload as { requestId?: unknown; loadsIsolated?: unknown; simulationFirmwareConfirmed?: unknown } | null
    if (typeof request?.requestId !== 'string') throw new Error('A firmware request ID is required.')
    return firmwareService.recover(request.requestId, {
      loadsIsolated: request.loadsIsolated === true, simulationFirmwareConfirmed: request.simulationFirmwareConfirmed === true,
    })
  })
  ipcMain.handle(IPC_CHANNELS.experienceSimulateFault, (_event, code: unknown): DeviceExperienceSnapshot => {
    if (typeof code !== 'string' || code.length > 64) throw new Error('Invalid simulation fault code.')
    return mockExperienceController.simulateFault(code)
  })
  ipcMain.handle(IPC_CHANNELS.experienceSimulateConnectionLoss, () =>
    mockExperienceController.simulateConnectionLoss(),
  )

  serialService.onStateChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.serialState, snapshot)
    }
  })
  let previousFirmwareSnapshot = firmwareService.getSnapshot()
  firmwareService.onStateChange((snapshot) => {
    logFirmwareSnapshot(snapshot, previousFirmwareSnapshot)
    previousFirmwareSnapshot = snapshot
    ipadLanServer?.publishStatus()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.firmwareState, rendererFirmwareSnapshot(snapshot))
    }
  })
}

function positionProjectorWindow(): void {
  if (!projectorWindow || projectorWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return
  const placement = getProjectorPlacement(screen.getAllDisplays(), screen.getPrimaryDisplay(), mainWindow.getBounds())
  projectorWindow.setFullScreen(false)
  if (placement.mainBounds) mainWindow.setBounds(placement.mainBounds)
  projectorWindow.setBounds(placement.bounds)
  projectorWindow.setFullScreen(placement.fullscreen)
}

function reportProjectorUnavailable(reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  void exhibitionLifecycleController.reportMediaFailure(reason).catch(error => {
    logEvent('projector.failure-stop', { level: 'error', reason: errorKind(error) })
  })
}

function openProjectorWindow(): void {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    positionProjectorWindow()
    projectorWindow.showInactive()
    return
  }
  const window = new BrowserWindow({
    title: 'Nature Touch — Projector', show: false,
    backgroundColor: '#101416', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      backgroundThrottling: false,
      additionalArguments: [
        '--nature-touch-projector',
        // The Windows hardware decoder can stall the BUBBLE projection clip.
        ...(process.platform === 'win32' ? ['--disable-accelerated-video-decode'] : []),
        ...(!app.isPackaged && process.argv.includes('--projector-media-preview') ? ['--nature-touch-projector-preview'] : []),
      ],
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  projectorWindow = window
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  // Invalidate before the asynchronous destruction; queued ready reports must not release START.
  window.on('close', () => reportProjectorUnavailable('PROJECTOR_CLOSED'))
  window.on('closed', () => {
    if (projectorWindow === window) {
      projectorWindow = undefined
      reportProjectorUnavailable('PROJECTOR_CLOSED')
    }
  })
  window.webContents.on('render-process-gone', () => reportProjectorUnavailable('PROJECTOR_RENDERER_GONE'))
  window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) reportProjectorUnavailable('PROJECTOR_LOAD_FAILED')
  })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace && window.webContents.getURL()) reportProjectorUnavailable('PROJECTOR_RELOADED')
  })
  window.on('unresponsive', () => reportProjectorUnavailable('PROJECTOR_UNRESPONSIVE'))
  positionProjectorWindow()
  window.once('ready-to-show', () => window.showInactive())
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) void window.loadURL(new URL('projector.html', rendererUrl).href)
  else void window.loadFile(join(__dirname, '../renderer/projector.html'))
}

async function operatorAction(action: 'connect' | 'stop' | 'recover' | 'disconnect'): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (action === 'connect') {
      if (!['READY','FAULT'].includes(exhibitionLifecycleController.getSnapshot().phase)) throw new Error('Finish or stop the current round first.')
      const ports = await firmwareService.listPorts()
      if (!ports.length) throw new Error('No USB serial ports found.')
      const chosen = await dialog.showMessageBox(mainWindow,{type:'question',message:'现场负责人：选择已核对的 Nano 端口（不固定 COM5）',buttons:[...ports.map(p=>p.path+' '+(p.manufacturer??'')+' '+(p.serialNumber??'')),'取消'],cancelId:ports.length,noLink:true})
      if (chosen.response >= ports.length) return
      const approved = await dialog.showMessageBox(mainWindow,{type:'warning',message:'确认由现场负责人操作。连接只发送 IDENTIFY / STATUS，不启动。',buttons:['取消','确认只读连接'],defaultId:0,cancelId:0})
      if (approved.response !== 1) return
      await firmwareService.disconnect()
      const state = await firmwareService.connect(ports[chosen.response].path)
      if (state.experience.faultCode === 'RECONNECTED_WHILE_ACTIVE' || !firmwareExhibitionReady(state,REAL_HARDWARE_DEPLOYMENT_REVIEWED)) {
        await firmwareService.disconnect(); throw new Error('Firmware identity/version mismatch; connection closed. Upload the verified real release manually first.')
      }
      await dialog.showMessageBox(mainWindow,{message:'已识别 '+state.firmware+' '+state.firmwareVersion+' / '+state.timelineVersion+'；状态 '+state.experience.state+'。未发送 START。'})
    } else if (action === 'stop') {
      const yes=await dialog.showMessageBox(mainWindow,{type:'warning',message:'负责人确认停止当前体验并锁定 FAULT？',buttons:['取消','STOP'],defaultId:0,cancelId:0})
      if(yes.response===1) await exhibitionLifecycleController.reportMediaFailure('OPERATOR_STOP')
    } else if (action === 'recover') {
      const yes=await dialog.showMessageBox(mainWindow,{type:'warning',message:'确认已现场排除故障、设备处于安全状态？恢复只返回 READY，不自动 SELECT/START。',buttons:['取消','确认恢复'],defaultId:0,cancelId:0})
      if(yes.response!==1)return
      if(exhibitionMode==='firmware') {
        await firmwareService.queryStatus(randomUUID().replace(/-/g,'').slice(0,16))
        if(firmwareService.getSnapshot().experience.state==='FAULT') await firmwareService.recover(randomUUID().replace(/-/g,'').slice(0,16))
      } else if(mockExperienceController.getSnapshot().state==='FAULT') mockExperienceController.recover(randomUUID().replace(/-/g,'').slice(0,16))
      exhibitionLifecycleController.resetAfterOperatorRecovery()
    } else {
      if(!['READY','FAULT'].includes(exhibitionLifecycleController.getSnapshot().phase))throw new Error('Stop the round before disconnecting.')
      await firmwareService.disconnect()
    }
  } catch(error) { await dialog.showMessageBox(mainWindow,{type:'error',message:String(error)}) }
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: OPEN_AIR_BENCH_SESSION ? 'Nature Touch — Open-air Bench' : 'Nature Touch',
    width: 960,
    height: 640,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window
  let closingAfterStop = false
  window.on('close', event => {
    if (closingAfterStop || !['STARTING','WAITING','EXPERIENCE','AWAIT_COMPLETION'].includes(exhibitionLifecycleController.getSnapshot().phase)) return
    event.preventDefault()
    closingAfterStop = true
    void exhibitionLifecycleController.reportMediaFailure('MAIN_WINDOW_CLOSED').then(() => window.close()).catch(async error => {
      closingAfterStop = false
      await dialog.showMessageBox(window,{type:'error',message:'STOP未确认，请现场负责人立即断开负载电源。'+String(error)})
    })
  })
  window.setMenu(Menu.buildFromTemplate([{
    label: '窗口', submenu: [{ label: '打开 Projector', accelerator: 'CommandOrControl+Shift+P', click: openProjectorWindow }],
  }, { label:'现场负责人', submenu:[
    {label:'连接已批准固件（只读握手）',click:()=>{void operatorAction('connect')}},
    {label:'停止并锁定',click:()=>{void operatorAction('stop')}},
    {label:'排除故障后恢复 READY',click:()=>{void operatorAction('recover')}},
    {label:'关闭串口',click:()=>{void operatorAction('disconnect')}},
    {label:'打开验收日志目录',click:()=>{void shell.openPath(join(app.getPath('userData'),'logs'))}},
  ] }]))
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined
      projectorWindow?.close()
    }
  })
  if (OPEN_AIR_BENCH_SESSION) window.on('page-title-updated', event => event.preventDefault())

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  localEventLog = new LocalEventLog(join(app.getPath('userData'), 'logs'), {
    appCommit: __NATURE_TOUCH_GIT_COMMIT__,
    hardwareConfigVersion: HARDWARE_CONFIG_VERSION,
  })
  logEvent('app.started', { phase: app.getVersion(), mode: exhibitionMode, reason: 'pid=' + process.pid })
  logEvent('app.communication-diagnostics', { phase: FIRMWARE_WIRE_DIAGNOSTIC_VERSION,
    reason: 'Bounded native RX evidence enabled; firmware and safety limits unchanged.' })
  installContentSecurityPolicy()
  registerIpcHandlers()
  const ipadConfig = readIpadLanServerConfig(process.env, undefined, join(__dirname, '../..'))
  if (ipadConfig) {
    ipadLanServer = createIpadLanServer(ipadConfig, exhibitionLifecycleController, ipadRuntimeStatus)
    mockExperienceController.onStateChange(() => ipadLanServer?.publishStatus())
    const port = await ipadLanServer.start()
    const host = ipadConfig.bindAddress.includes(':')
      ? `[${ipadConfig.bindAddress}]`
      : ipadConfig.bindAddress
    console.info(`iPad exhibition UI available at https://${host}:${port}/`)
  }
  createWindow()
  openProjectorWindow()
  screen.on('display-added', positionProjectorWindow)
  screen.on('display-removed', positionProjectorWindow)
  screen.on('display-metrics-changed', positionProjectorWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); openProjectorWindow() }
  })
}).catch(error => {
  console.error('Application startup failed:', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitCleanupStarted = false
let allowQuit = false
app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  logEvent('app.shutdown_requested')
  const isConnected = serialService.getState().state !== 'disconnected' ||
    firmwareService.getSnapshot().connectionState !== 'disconnected'
  const cleanupOperations = [
    ...(isConnected ? [serialService.disconnect(), firmwareService.disconnect()] : []),
    ...(ipadLanServer ? [ipadLanServer.close()] : []),
  ]
  const cleanup = Promise.allSettled(cleanupOperations)
  void cleanup
    .then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          logEvent('app.shutdown_cleanup_failed', { level: 'error', reason: errorKind(result.reason) })
          console.error('Serial shutdown failed:', result.reason)
        }
      }
    })
    .then(async () => {
      await localEventLog?.flush()
    })
    .catch(error => {
      console.error('Application shutdown cleanup failed:', error)
    })
    .finally(() => {
      allowQuit = true
      app.quit()
    })
})
