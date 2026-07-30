/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { EnpiistudioApi } from '../electron/preload'

declare global {
  interface Window {
    enpiistudio: EnpiistudioApi
  }
}

declare module '*.svg?raw' {
  const content: string
  export default content
}

declare module '*.svg?url' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

export {}
