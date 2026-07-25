/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { EnpiistudioApi } from '../electron/preload'

declare global {
  interface Window {
    enpiistudio: EnpiistudioApi
  }
}

export {}
