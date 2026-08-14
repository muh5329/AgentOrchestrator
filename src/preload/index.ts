import { contextBridge, ipcRenderer } from 'electron'

const IPC_INVOKE = 'ao:invoke'
const IPC_EVENT = 'ao:event'

interface IpcResponse<T> {
  ok: boolean
  data?: T
  error?: { message: string; code: string; details?: unknown }
}

/**
 * The renderer's whole view of the outside world: one call, one subscription.
 * Node integration stays off and context isolation stays on.
 */
const api = {
  async invoke<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T> {
    const response = (await ipcRenderer.invoke(IPC_INVOKE, method, payload ?? {})) as IpcResponse<T>
    if (!response.ok) {
      const error = new Error(response.error?.message ?? 'Unknown error') as Error & {
        code?: string
        details?: unknown
      }
      error.code = response.error?.code
      error.details = response.error?.details
      throw error
    }
    return response.data as T
  },

  onEvent(listener: (event: unknown) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(IPC_EVENT, handler)
    return () => {
      ipcRenderer.off(IPC_EVENT, handler)
    }
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('ao', api)

export type AoApi = typeof api
