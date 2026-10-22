import { contextBridge, ipcRenderer } from 'electron'
import type { NatureTouchApi } from '../shared/ipc'
import type { SerialStateSnapshot } from '../shared/serial-protocol'
import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'

const api: NatureTouchApi = {
  getRuntimeInfo: () => ipcRenderer.invoke('app:get-runtime-info'),
  listSerialPorts: () => ipcRenderer.invoke('serial:list-ports'),
  getSerialState: () => ipcRenderer.invoke('serial:get-state'),
  connectSerial: (portPath, baudRate) =>
    ipcRenderer.invoke('serial:connect', { portPath, baudRate }),
  disconnectSerial: () => ipcRenderer.invoke('serial:disconnect'),
  pingSerial: () => ipcRenderer.invoke('serial:ping'),
  getDiagnosticStatus: () => ipcRenderer.invoke('serial:status'),
  onSerialState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SerialStateSnapshot) => {
      listener(snapshot)
    }
    ipcRenderer.on('serial:state', handler)
    return () => ipcRenderer.removeListener('serial:state', handler)
  },
  getExperienceState: () => ipcRenderer.invoke('experience:get-state'),
  onExperienceState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => {
      listener(snapshot)
    }
    ipcRenderer.on('experience:state', handler)
    return () => ipcRenderer.removeListener('experience:state', handler)
  },
  selectExperience: (experienceId, requestId) =>
    ipcRenderer.invoke('experience:select', { experienceId, requestId }),
  startExperience: (requestId, operationId) =>
    ipcRenderer.invoke('experience:start', { requestId, operationId }),
  stopExperience: (requestId, operationId) =>
    ipcRenderer.invoke('experience:stop', { requestId, operationId }),
  queryExperienceStatus: (requestId) => ipcRenderer.invoke('experience:status', requestId),
  simulateExperienceFault: (code) => ipcRenderer.invoke('experience:simulate-fault', code),
  simulateConnectionLoss: () => ipcRenderer.invoke('experience:simulate-connection-loss'),
  recoverExperience: (requestId) => ipcRenderer.invoke('experience:recover', requestId),
  getFirmwareState: () => ipcRenderer.invoke('firmware:get-state'),
  connectFirmware: (portPath, baudRate) =>
    ipcRenderer.invoke('firmware:connect', { portPath, baudRate }),
  disconnectFirmware: () => ipcRenderer.invoke('firmware:disconnect'),
  onFirmwareState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: FirmwareControlSnapshot) => {
      listener(snapshot)
    }
    ipcRenderer.on('firmware:state', handler)
    return () => ipcRenderer.removeListener('firmware:state', handler)
  },
  selectFirmwareExperience: (experienceId, requestId) =>
    ipcRenderer.invoke('firmware:select', { experienceId, requestId }),
  startFirmwareExperience: (requestId, operationId) =>
    ipcRenderer.invoke('firmware:start', { requestId, operationId }),
  stopFirmwareExperience: (requestId, operationId) =>
    ipcRenderer.invoke('firmware:stop', { requestId, operationId }),
  queryFirmwareStatus: (requestId) => ipcRenderer.invoke('firmware:status', requestId),
  recoverFirmware: (requestId) => ipcRenderer.invoke('firmware:recover', requestId),
}

contextBridge.exposeInMainWorld('natureTouch', api)