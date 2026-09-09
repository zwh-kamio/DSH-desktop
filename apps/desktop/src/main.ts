/**
 * Electron main entry for the DeepSeek Harness desktop shell: acquire the
 * single-instance lock, spawn the dsh web sidecar, open the native window on
 * its authenticated URL, mount the tray and native integrations, and tear the
 * backend tree down on quit.
 * @module @deepseek-ai/dsh-desktop
 */

import { app, dialog } from 'electron'
import { BackendController } from './backend.ts'
import { resolveBackendLaunch } from './launch.ts'
import { installSingleInstance } from './single-instance.ts'
import { createWindow } from './window.ts'
import { createTray, type TrayController } from './tray.ts'
import { configureAutoLaunch } from './autolaunch.ts'
import { configureUpdater } from './updater.ts'
import { startCrashReporter } from './crash.ts'
import { notify } from './notify.ts'
import { loadConfig, type DesktopConfig } from './config.ts'

/** The supervised backend, once the app is ready. */
let backend: BackendController | undefined
/** The focused main window, or undefined before it opens. */
let mainWindow: ReturnType<typeof createWindow> | undefined
/** The system tray, or undefined before it is mounted. */
let tray: TrayController | undefined
/** The resolved desktop switches. */
let config: DesktopConfig
/** True once a quit sequence has started, so close-to-tray no longer defers. */
let quitting = false

/** Focus or restore the existing window for a second launch. */
function focusMainWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Report an unexpected backend exit and let the user restart or quit. */
function onBackendExit(code: number | null): void {
  notify('DeepSeek Harness', 'The backend stopped unexpectedly (code ' + String(code) + ').')
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    app.quit()
    return
  }
  void dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'DeepSeek Harness',
    message: 'The DeepSeek Harness backend stopped unexpectedly.',
    detail: 'The backend process exited with code ' + String(code) + '. Restart it or quit the application.',
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) void restartBackend()
    else app.quit()
  })
}

/** (Re)start the backend and (re)open the window on its authenticated URL. */
async function restartBackend(): Promise<void> {
  if (backend === undefined) return
  try {
    const url = await backend.restart()
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      mainWindow = createWindow(url)
    } else {
      void mainWindow.loadURL(url)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({ type: 'error', title: 'DeepSeek Harness', message: 'Could not start the DeepSeek Harness backend.', detail })
    app.quit()
  }
}

/** Stop the backend once, then quit. Idempotent across quit paths. */
let stopping = false
async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  tray?.destroy()
  tray = undefined
  const current = backend
  backend = undefined
  if (current !== undefined) {
    try {
      await current.stop()
    } catch {
      // Teardown best-effort: the process tree may already be gone.
    }
  }
  app.quit()
}

async function main(): Promise<void> {
  if (!installSingleInstance(focusMainWindow)) return

  await app.whenReady()

  config = loadConfig()
  startCrashReporter(config.crashSubmitUrl)

  const launch = resolveBackendLaunch()
  backend = new BackendController({
    ...launch,
    onExit: (code, intentional) => {
      if (!intentional) onBackendExit(code)
    },
  })

  try {
    const url = await backend.start()
    mainWindow = createWindow(url)
    tray = createTray(() => mainWindow)
    configureAutoLaunch(config.autoLaunch)
    configureUpdater(config.updateFeedUrl)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({ type: 'error', title: 'DeepSeek Harness', message: 'Could not start the DeepSeek Harness backend.', detail })
    app.quit()
    return
  }

  // Minimize-to-tray: closing the window hides it while the tray is present.
  mainWindow.on('close', (event) => {
    if (config.minimizeToTray && !quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  app.on('window-all-closed', () => {
    if (!config.minimizeToTray) void shutdown()
  })
  app.on('before-quit', (event) => {
    quitting = true
    if (backend?.running === true) {
      event.preventDefault()
      void shutdown()
    }
  })
}

void main()
