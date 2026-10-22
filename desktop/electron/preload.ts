import { contextBridge, ipcRenderer } from 'electron'
import type { NatureTouchApi } from '../shared/ipc'
import type { SerialStateSnapshot } from '../shared/serial-protocol'

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
}

contextBridge.exposeInMainWorld('natureTouch', api)