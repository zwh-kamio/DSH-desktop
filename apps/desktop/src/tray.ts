/**
 * System tray with Open/Quit and minimize-to-tray support.
 * @module @deepseek-ai/dsh-desktop/tray
 */

import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory containing this module's compiled output (apps/desktop/dist). */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The app assets directory: apps/desktop/assets in dev, resources in a build. */
const ASSETS = app.isPackaged ? process.resourcesPath : join(HERE, '..', 'assets')

/** The tray handle returned by {@link createTray}. */
export interface TrayController {
  destroy(): void
}

/** Load the tray icon, falling back to an empty image when absent. */
function trayImage(): NativeImage {
  const iconPath = join(ASSETS, 'tray.png')
  if (existsSync(iconPath)) return nativeImage.createFromPath(iconPath)
  return nativeImage.createEmpty()
}

/**
 * Create the system tray. Closing the window hides it to the tray; the Quit
 * menu item remains the way to leave.
 * @param getWindow - returns the current main window, or undefined.
 * @returns the tray controller.
 */
export function createTray(getWindow: () => BrowserWindow | undefined): TrayController {
  const image = trayImage()
  // Without a usable icon there is no tray: skip rather than create an
  // invisible or failing tray entry.
  if (image.isEmpty()) return { destroy: () => {} }
  const tray = new Tray(image)
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open DeepSeek Harness',
      click: () => {
        const window = getWindow()
        if (window !== undefined && !window.isDestroyed()) {
          window.show()
          window.focus()
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(menu)
  tray.on('click', () => {
    const window = getWindow()
    if (window !== undefined && !window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })
  return { destroy: () => tray.destroy() }
}
