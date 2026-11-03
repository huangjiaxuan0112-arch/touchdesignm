import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type NatureTouchApi } from '../shared/ipc'
import type { SerialStateSnapshot } from '../shared/serial-protocol'
import type { FirmwareControlSnapshot } from '../shared/firmware-control-protocol'
import {
  isExperienceEvent,
  isExperienceSnapshot,
  reconcileExperienceEvents,
  type ExperienceCommand,
  type ExperienceEvent,
} from '../shared/experience-application-contract'

const api: NatureTouchApi = {
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInfo),
  listSerialPorts: () => ipcRenderer.invoke(IPC_CHANNELS.serialListPorts),
  getSerialState: () => ipcRenderer.invoke(IPC_CHANNELS.serialGetState),
  connectSerial: (portPath, baudRate) =>
    ipcRenderer.invoke(IPC_CHANNELS.serialConnect, { portPath, baudRate }),
  disconnectSerial: () => ipcRenderer.invoke(IPC_CHANNELS.serialDisconnect),
  pingSerial: () => ipcRenderer.invoke(IPC_CHANNELS.serialPing),
  getDiagnosticStatus: () => ipcRenderer.invoke(IPC_CHANNELS.serialStatus),
  onSerialState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SerialStateSnapshot) => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.serialState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.serialState, handler)
  },
  getExperienceSnapshot: (mode) => ipcRenderer.invoke(IPC_CHANNELS.experienceGetSnapshot, mode),
  subscribeExperience: async (mode, listener) => {
    let active = true
    let initialized = false
    let lastRevision = -1
    const queued: ExperienceEvent[] = []
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!isExperienceEvent(payload)) throw new Error('Main sent an invalid experience event.')
      if (payload.snapshot.mode !== mode) return
      if (!initialized) {
        queued.push(payload)
        return
      }
      if (payload.snapshot.revision <= lastRevision) return
      lastRevision = payload.snapshot.revision
      listener(payload)
    }

    ipcRenderer.on(IPC_CHANNELS.experienceEvent, handler)
    try {
      const initial: unknown = await ipcRenderer.invoke(IPC_CHANNELS.experienceGetSnapshot, mode)
      if (!isExperienceSnapshot(initial)) throw new Error('Main returned an invalid experience snapshot.')
      if (active) {
        for (const event of reconcileExperienceEvents(
          initial,
          queued.filter(event => isExperienceEvent(event)),
        )) {
          listener(event)
          lastRevision = event.snapshot.revision
        }
        initialized = true
      }
    } catch (error) {
      active = false
      ipcRenderer.removeListener(IPC_CHANNELS.experienceEvent, handler)
      throw error
    }

    return () => {
      active = false
      ipcRenderer.removeListener(IPC_CHANNELS.experienceEvent, handler)
    }
  },
  dispatchExperienceCommand: (command: ExperienceCommand) =>
    ipcRenderer.invoke(IPC_CHANNELS.experienceDispatch, command),
  getExperienceState: () => ipcRenderer.invoke(IPC_CHANNELS.experienceGetState),
  onExperienceState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.experienceState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.experienceState, handler)
  },
  selectExperience: (experienceId, requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.experienceSelect, { experienceId, requestId }),
  startExperience: (requestId, operationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.experienceStart, { requestId, operationId }),
  stopExperience: (requestId, operationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.experienceStop, { requestId, operationId }),
  queryExperienceStatus: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.experienceStatus, requestId),
  simulateExperienceFault: (code) => ipcRenderer.invoke(IPC_CHANNELS.experienceSimulateFault, code),
  simulateConnectionLoss: () => ipcRenderer.invoke(IPC_CHANNELS.experienceSimulateConnectionLoss),
  recoverExperience: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.experienceRecover, requestId),
  getFirmwareState: () => ipcRenderer.invoke(IPC_CHANNELS.firmwareGetState),
  armFirmwareSimulationTest: (loadsIsolated, simulationFirmwareConfirmed) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareArmSimulation, { loadsIsolated, simulationFirmwareConfirmed }),
  disarmFirmwareSimulationTest: () => ipcRenderer.invoke(IPC_CHANNELS.firmwareDisarmSimulation),
  connectFirmware: (portPath, baudRate, loadsIsolated = false, benchFixtureConfirmed = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareConnect, { portPath, baudRate, loadsIsolated, benchFixtureConfirmed }),
  disconnectFirmware: () => ipcRenderer.invoke(IPC_CHANNELS.firmwareDisconnect),
  onFirmwareState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: FirmwareControlSnapshot) => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.firmwareState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.firmwareState, handler)
  },
  selectFirmwareExperience: (experienceId, requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareSelect, { experienceId, requestId }),
  startFirmwareExperience: (requestId, operationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareStart, { requestId, operationId }),
  stopFirmwareExperience: (requestId, operationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareStop, { requestId, operationId }),
  queryFirmwareStatus: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.firmwareStatus, requestId),
  recoverFirmware: (requestId, loadsIsolated = false, simulationFirmwareConfirmed = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.firmwareRecover, { requestId, loadsIsolated, simulationFirmwareConfirmed }),
}

contextBridge.exposeInMainWorld('natureTouch', api)
