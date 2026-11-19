/// <reference types="vite/client" />

import type { NatureTouchApi } from '../../shared/ipc'
import type { ProjectorApi } from '../../shared/projector'

declare global {
  interface Window {
    natureTouch: NatureTouchApi
    natureTouchProjector: ProjectorApi
  }
}
