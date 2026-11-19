import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import { isExhibitionLifecycleSnapshot, type ExhibitionLifecycleSnapshot } from '../shared/exhibition-lifecycle'

// Shared read-only subscription for both renderer surfaces. Main owns all state.
export async function subscribeExhibition(listener: (snapshot: ExhibitionLifecycleSnapshot) => void) {
  let active = true
  let revision = -1
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (!active) return
    if (!isExhibitionLifecycleSnapshot(payload)) throw new Error('Main sent an invalid exhibition lifecycle snapshot.')
    if (payload.revision <= revision) return
    revision = payload.revision
    listener(payload)
  }
  ipcRenderer.on(IPC_CHANNELS.exhibitionEvent, handler)
  try {
    const initial: unknown = await ipcRenderer.invoke(IPC_CHANNELS.exhibitionGetSnapshot)
    if (!isExhibitionLifecycleSnapshot(initial)) throw new Error('Main returned an invalid exhibition lifecycle snapshot.')
    if (active && initial.revision > revision) {
      revision = initial.revision
      listener(initial)
    }
  } catch (error) {
    active = false
    ipcRenderer.removeListener(IPC_CHANNELS.exhibitionEvent, handler)
    throw error
  }
  return () => {
    active = false
    ipcRenderer.removeListener(IPC_CHANNELS.exhibitionEvent, handler)
  }
}
