import type { AoApi } from './index'

declare global {
  interface Window {
    ao: AoApi
  }
}

export {}
