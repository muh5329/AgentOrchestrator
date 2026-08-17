import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { AppContext } from '../core/context'
import { serializeError } from '../core/errors'
import { createApi } from './api'

export const IPC_INVOKE = 'ao:invoke'
export const IPC_EVENT = 'ao:event'

export interface IpcResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: { message: string; code: string; details?: unknown }
}

/**
 * The only bridge between the renderer and the application.
 *
 * One validated channel, one handler table. The renderer cannot name a function
 * that is not in the table, and never touches Node, the filesystem or the
 * database directly.
 */
export function registerIpc(ctx: AppContext, getWindows: () => BrowserWindow[]): () => void {
  const api = createApi(ctx)

  /**
   * The native folder chooser.
   *
   * It lives here rather than in the api table because it needs a window to
   * hang the sheet off, and `createApi` deliberately knows nothing about
   * windows. Returning null for a cancelled dialog rather than throwing keeps
   * "the person changed their mind" out of the error path.
   */
  api['dialog.pickFolder'] = async (payload) => {
    const parent = getWindows()[0]
    const result = await dialog.showOpenDialog(parent, {
      title: typeof payload.title === 'string' ? payload.title : 'Choose a workspace folder',
      defaultPath: typeof payload.defaultPath === 'string' ? payload.defaultPath : undefined,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return { path: null }
    return { path: result.filePaths[0] }
  }

  ipcMain.handle(
    IPC_INVOKE,
    async (_event, method: unknown, payload: unknown): Promise<IpcResponse> => {
      if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(api, method)) {
        return {
          ok: false,
          error: { message: `Unknown method "${String(method)}"`, code: 'UNKNOWN_METHOD' }
        }
      }
      try {
        const data = await api[method]((payload ?? {}) as Record<string, unknown>)
        return { ok: true, data: data === undefined ? null : data }
      } catch (err) {
        return { ok: false, error: serializeError(err) }
      }
    }
  )

  // Live updates: every event on the bus is pushed to every open window, so the
  // UI never polls.
  const off = ctx.bus.addSink((event) => {
    for (const window of getWindows()) {
      if (window.isDestroyed()) continue
      window.webContents.send(IPC_EVENT, event)
    }
  })

  return () => {
    off()
    ipcMain.removeHandler(IPC_INVOKE)
  }
}
