import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import { SerialDiagnosticService } from './serial/serial-diagnostic-service'
import { NativeSerialTransport } from './serial/native-serial-transport'
import { ArduinoFirmwareService } from './serial/arduino-firmware-service'
import { MockExperienceController } from '../experience/mock-experience-controller'
import {
  type ExperienceCommandServices,
} from './experience-command-dispatcher'
import { ExperienceCoordinator, type ExperienceCoordinatorServices } from './experience-coordinator'
import { createExperienceIpcHandlers } from './experience-ipc-handlers'
import { IPC_CHANNELS, type RuntimeInfo } from '../shared/ipc'
import { EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import type { ExperienceSnapshot as DeviceExperienceSnapshot } from '../shared/experience-control-protocol'
import type { SerialStateSnapshot } from '../shared/serial-protocol'
import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'

declare const __NATURE_TOUCH_DEV_CSP_NONCE__: string

const serialService = new SerialDiagnosticService(new NativeSerialTransport())
// Source-level deployment permission. Never set by renderer input or dev mode.
// Remains false until shutdown/power/pressure provisions and deployment are approved.
const REAL_HARDWARE_DEPLOYMENT_REVIEWED = false
// User-confirmed airbag-disconnected, open nonpressurizing bench ONLY. Normal
// launches remain read-only; the renderer cannot enable this process profile.
const OPEN_AIR_BENCH_UI_REVIEWED = true
const OPEN_AIR_BENCH_SESSION = OPEN_AIR_BENCH_UI_REVIEWED && process.argv.includes('--open-air-bench')
const REAL_CONTROL_PERMITTED = REAL_HARDWARE_DEPLOYMENT_REVIEWED || OPEN_AIR_BENCH_SESSION
const benchEvidence = join(__dirname, '../../../docs/evidence', `real-react-bench-${Date.now()}.jsonl`)
function benchLog(kind: string, value: unknown): void {
  if (!OPEN_AIR_BENCH_SESSION) return
  mkdirSync(join(__dirname, '../../../docs/evidence'), { recursive: true })
  appendFileSync(benchEvidence, JSON.stringify({ at: new Date().toISOString(), kind, value }) + '\n')
}
const firmwareTransport = new NativeSerialTransport()
if (OPEN_AIR_BENCH_SESSION) {
  const open = firmwareTransport.open.bind(firmwareTransport)
  firmwareTransport.open = async (path, baud) => {
    const connection = await open(path, baud)
    const write = connection.write.bind(connection)
    connection.write = async line => { benchLog('TX', JSON.parse(line)); await write(line) }
    let buffer = ''
    connection.onData(chunk => {
      buffer += chunk
      for (let cut; (cut = buffer.indexOf('\n')) >= 0;) {
        benchLog('RX', buffer.slice(0, cut).trim()); buffer = buffer.slice(cut + 1)
      }
    })
    return connection
  }
}
const firmwareService = new ArduinoFirmwareService(firmwareTransport, {
  readOnly: !REAL_CONTROL_PERMITTED,
  allowSimulationTest: !app.isPackaged && !OPEN_AIR_BENCH_SESSION,
  allowRealHardwareControl: REAL_CONTROL_PERMITTED,
})
function realControlEligible(snapshot: FirmwareControlSnapshot): boolean {
  return (REAL_HARDWARE_DEPLOYMENT_REVIEWED || OPEN_AIR_BENCH_SESSION) &&
    snapshot.identified && snapshot.connectionState === 'connected' &&
    snapshot.firmware === 'nature-touch-unified-real' && snapshot.hardwareOutputsEnabled === true
}

function rendererFirmwareSnapshot(snapshot = firmwareService.getSnapshot()): FirmwareControlSnapshot {
  benchLog('STATE', snapshot)
  return {
    ...snapshot,
    openAirBenchSession: OPEN_AIR_BENCH_SESSION,
    realControlEligible: realControlEligible(snapshot),
  }
}
const mockExperienceController = new MockExperienceController()
const experienceCommandServices: ExperienceCommandServices = {
  mock: mockExperienceController,
  firmware: firmwareService,
}
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
      const simulationReady = state.simulationTestArmed === true && state.hardwareOutputsEnabled === false
      const reviewedRealControl = realControlEligible(state)
      return state.identified && state.connectionState === 'connected' &&
        (simulationReady || reviewedRealControl)
    },
    onStateChange: listener => firmwareService.onStateChange(() => listener()),
  },
}
const experienceCoordinator = new ExperienceCoordinator(coordinatorServices)
let mainWindow: BrowserWindow | undefined
let serialPortOwner: 'diagnostic' | 'firmware' | null = null
let serialPortOperationQueue: Promise<void> = Promise.resolve()

function serializeSerialPortOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = serialPortOperationQueue.then(operation, operation)
  serialPortOperationQueue = result.then(() => undefined, () => undefined)
  return result
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
  for (const mode of ['mock', 'firmware'] as const) {
    experienceCoordinator.subscribe(mode, event => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.experienceEvent, event)
      }
    })
  }
  for (const [channel, handler] of Object.entries(
    createExperienceIpcHandlers(experienceCommandServices, experienceCoordinator),
  )) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(...args))
  }

  ipcMain.handle(IPC_CHANNELS.runtimeInfo, (): RuntimeInfo => ({
    appVersion: app.getVersion(),
    platform: process.platform,
  }))

  ipcMain.handle(IPC_CHANNELS.experienceGetState, () => mockExperienceController.getSnapshot())
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
  firmwareService.onStateChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.firmwareState, rendererFirmwareSnapshot(snapshot))
    }
  })
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

app.whenReady().then(() => {
  installContentSecurityPolicy()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (serialService.getState().state === 'disconnected' &&
      firmwareService.getSnapshot().connectionState === 'disconnected') return
  event.preventDefault()
  void Promise.allSettled([serialService.disconnect(), firmwareService.disconnect()])
    .then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') console.error('Serial shutdown failed:', result.reason)
      }
      app.quit()
    })
})
