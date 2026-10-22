import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { SerialDiagnosticService } from './serial/serial-diagnostic-service'
import { NativeSerialTransport } from './serial/native-serial-transport'
import { ArduinoFirmwareService } from './serial/arduino-firmware-service'
import { MockExperienceController } from '../experience/mock-experience-controller'
import type { RuntimeInfo } from '../shared/ipc'
import { EXPERIENCE_IDS, type ExperienceId } from '../shared/experience-definitions'
import type { ExperienceSnapshot } from '../shared/experience-control-protocol'
import type { SerialStateSnapshot } from '../shared/serial-protocol'
import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'

declare const __NATURE_TOUCH_DEV_CSP_NONCE__: string

const runtimeInfoChannel = 'app:get-runtime-info'
const serialService = new SerialDiagnosticService(new NativeSerialTransport())
const firmwareService = new ArduinoFirmwareService(new NativeSerialTransport())
const mockExperienceController = new MockExperienceController()
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
  ipcMain.handle(runtimeInfoChannel, (): RuntimeInfo => ({
    appVersion: app.getVersion(),
    platform: process.platform,
  }))

  ipcMain.handle('serial:list-ports', () => serialService.listPorts())
  ipcMain.handle('serial:get-state', () => serialService.getState())
  ipcMain.handle('serial:connect', (_event, payload: unknown): Promise<SerialStateSnapshot> => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('A port path and baud rate are required.')
    }
    const request = payload as { portPath?: unknown; baudRate?: unknown }
    if (typeof request.portPath !== 'string' || typeof request.baudRate !== 'number') {
      throw new Error('A port path and numeric baud rate are required.')
    }
    const portPath = request.portPath
    const baudRate = request.baudRate
    return serializeSerialPortOperation(async () => {
      if (serialPortOwner === 'firmware') {
        await firmwareService.disconnect()
        serialPortOwner = null
      }
      const snapshot = await serialService.connect(portPath, baudRate)
      serialPortOwner = 'diagnostic'
      return snapshot
    })
  })
  ipcMain.handle('serial:disconnect', () =>
    serializeSerialPortOperation(async () => {
      const snapshot = await serialService.disconnect()
      if (serialPortOwner === 'diagnostic') serialPortOwner = null
      return snapshot
    }),
  )
  ipcMain.handle('serial:ping', () => serialService.ping())
  ipcMain.handle('serial:status', () => serialService.getDiagnosticStatus())
  ipcMain.handle('firmware:get-state', (): FirmwareControlSnapshot => firmwareService.getSnapshot())
  ipcMain.handle('firmware:connect', (_event, payload: unknown): Promise<FirmwareControlSnapshot> => {
    if (!payload || typeof payload !== 'object') throw new Error('A port path and baud rate are required.')
    const request = payload as { portPath?: unknown; baudRate?: unknown }
    if (typeof request.portPath !== 'string' || typeof request.baudRate !== 'number') {
      throw new Error('A port path and numeric baud rate are required.')
    }
    const portPath = request.portPath
    const baudRate = request.baudRate
    return serializeSerialPortOperation(async () => {
      if (serialPortOwner === 'diagnostic') {
        await serialService.disconnect()
        serialPortOwner = null
      }
      const snapshot = await firmwareService.connect(portPath, baudRate)
      serialPortOwner = 'firmware'
      return snapshot
    })
  })
  ipcMain.handle('firmware:disconnect', () =>
    serializeSerialPortOperation(async () => {
      const snapshot = await firmwareService.disconnect()
      if (serialPortOwner === 'firmware') serialPortOwner = null
      return snapshot
    }),
  )
  ipcMain.handle('firmware:select', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Firmware selection payload is required.')
    const request = payload as { experienceId?: unknown; requestId?: unknown }
    if (!EXPERIENCE_IDS.includes(request.experienceId as ExperienceId) ||
        typeof request.requestId !== 'string') {
      throw new Error('Invalid firmware selection request.')
    }
    return firmwareService.selectExperience(request.requestId, request.experienceId as ExperienceId)
  })
  ipcMain.handle('firmware:start', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Firmware start payload is required.')
    const request = payload as { requestId?: unknown; operationId?: unknown }
    if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
      throw new Error('Invalid firmware start request.')
    }
    return firmwareService.start(request.requestId, request.operationId)
  })
  ipcMain.handle('firmware:stop', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Firmware stop payload is required.')
    const request = payload as { requestId?: unknown; operationId?: unknown }
    if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
      throw new Error('Invalid firmware stop request.')
    }
    return firmwareService.stop(request.requestId, request.operationId)
  })
  ipcMain.handle('firmware:status', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('A firmware request ID is required.')
    return firmwareService.queryStatus(requestId)
  })
  ipcMain.handle('firmware:recover', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('A firmware request ID is required.')
    return firmwareService.recover(requestId)
  })
  ipcMain.handle('experience:get-state', () => mockExperienceController.getSnapshot())
  ipcMain.handle('experience:select', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Experience selection payload is required.')
    const request = payload as { experienceId?: unknown; requestId?: unknown }
    if (!EXPERIENCE_IDS.includes(request.experienceId as ExperienceId) || typeof request.requestId !== 'string') {
      throw new Error('Invalid experience selection request.')
    }
    return mockExperienceController.selectExperience(request.requestId, request.experienceId as ExperienceId)
  })
  ipcMain.handle('experience:start', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Start payload is required.')
    const request = payload as { requestId?: unknown; operationId?: unknown }
    if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
      throw new Error('Invalid experience start request.')
    }
    return mockExperienceController.start(request.requestId, request.operationId)
  })
  ipcMain.handle('experience:stop', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Stop payload is required.')
    const request = payload as { requestId?: unknown; operationId?: unknown }
    if (typeof request.requestId !== 'string' || typeof request.operationId !== 'string') {
      throw new Error('Invalid experience stop request.')
    }
    return mockExperienceController.stop(request.requestId, request.operationId)
  })
  ipcMain.handle('experience:status', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('A request ID is required.')
    return mockExperienceController.queryStatus(requestId)
  })
  ipcMain.handle('experience:simulate-fault', (_event, code: unknown): ExperienceSnapshot => {
    if (typeof code !== 'string' || code.length > 64) throw new Error('Invalid simulation fault code.')
    return mockExperienceController.simulateFault(code)
  })
  ipcMain.handle('experience:simulate-connection-loss', () =>
    mockExperienceController.simulateConnectionLoss(),
  )
  ipcMain.handle('experience:recover', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('A request ID is required.')
    return mockExperienceController.recover(requestId)
  })

  serialService.onStateChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('serial:state', snapshot)
    }
  })
  mockExperienceController.onStateChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('experience:state', snapshot)
    }
  })
  firmwareService.onStateChange((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('firmware:state', snapshot)
    }
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
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