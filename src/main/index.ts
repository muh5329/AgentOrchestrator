import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import path from 'node:path'
import { bootstrap, type BootstrappedApp } from './core/bootstrap'
import { registerIpc } from './ipc/register'

let application: BootstrappedApp | null = null
let disposeIpc: (() => void) | null = null

const isDev = !app.isPackaged

function resolveMigrations(): string {
  return isDev
    ? path.join(app.getAppPath(), 'drizzle')
    : path.join(app.getAppPath(), 'drizzle')
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#08090b',
    title: 'Agent Orchestrator',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    const isDevServer = process.env.ELECTRON_RENDERER_URL
      ? url.startsWith(process.env.ELECTRON_RENDERER_URL)
      : false
    if (target.protocol !== 'file:' && !isDevServer) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () =>
            BrowserWindow.getFocusedWindow()?.webContents.send('ao:event', {
              type: 'UI_COMMAND',
              data: { command: 'project.new' }
            })
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () =>
            BrowserWindow.getFocusedWindow()?.webContents.send('ao:event', {
              type: 'UI_COMMAND',
              data: { command: 'palette.open' }
            })
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  try {
    application = bootstrap({
      userData: app.getPath('userData'),
      migrations: resolveMigrations(),
      bridgeEntry: path.join(__dirname, 'mcp-bridge.js'),
      nodeExecPath: process.execPath,
      enableScriptedProvider: isDev
    })
    await application.start()
    disposeIpc = registerIpc(application.ctx, () => BrowserWindow.getAllWindows())
  } catch (err) {
    console.error('[agent-orchestrator] startup failed', err)
    dialog.showErrorBox(
      'Agent Orchestrator could not start',
      `${(err as Error).message}\n\nThe application database may be from a newer version.`
    )
    app.quit()
    return
  }

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown || !application) return
  // Give running agents a chance to stop cleanly and flush their state.
  event.preventDefault()
  shuttingDown = true
  void (async () => {
    try {
      disposeIpc?.()
      await application?.close()
    } finally {
      application = null
      app.quit()
    }
  })()
})
