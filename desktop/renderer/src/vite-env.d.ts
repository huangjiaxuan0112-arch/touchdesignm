/// <reference types="vite/client" />

import type { NatureTouchApi } from '../../shared/ipc'

declare global {
  interface Window {
    natureTouch: NatureTouchApi
  }
}