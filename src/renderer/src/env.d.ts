/// <reference types="vite/client" />
import type { TagTermApi } from '@shared/api'

declare global {
  interface Window {
    tagterm: TagTermApi
  }
}

export {}
