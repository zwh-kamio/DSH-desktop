/**
 * Native window hosting the DeepSeek Harness Web UI. Navigation stays pinned
 * to the backend authenticated origin; any external link opens in the system
 * browser instead of the sandboxed renderer.
 * @module @deepseek-ai/dsh-desktop/window
 */

import { BrowserWindow, shell } from 'electron'

/** Accept links over http(s) only; everything else is never handed to the OS. */
function isExternalLink(target: string): boolean {
  return /^https?:/u.test(target)
}

/** Open an external link in the default browser, ignoring failures. */
function openExternal(target: string): void {
  void shell.openExternal(target)
}

/** Whether two URLs share scheme + host + port (the authenticated origin). */
function sameOrigin(current: string, target: string): boolean {
  try {
    return new URL(current).origin === new URL(target).origin
  } catch {
    return false
  }
}

/**
 * Create and show the main window for the given authenticated backend URL.
 * @param url - the authenticated loopback URL reported by the backend.
 * @returns the created window.
 */
export function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: 'DeepSeek Harness',
    show: false,
    backgroundColor: '#0d1117',
    // Frameless title bar: hide the native frame but keep the native window
    // controls overlaid in the top-right corner.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#8b949e',
      height: 36,
    },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  // Popups and new-window gestures never spawn in-process windows.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isExternalLink(target)) openExternal(target)
    return { action: 'deny' }
  })

  // Keep navigation pinned to the authenticated origin; anything else leaves.
  window.webContents.on('will-navigate', (event, target) => {
    if (!sameOrigin(window.webContents.getURL(), target)) {
      event.preventDefault()
      if (isExternalLink(target)) openExternal(target)
    }
  })

  void window.loadURL(url)
  return window
}
