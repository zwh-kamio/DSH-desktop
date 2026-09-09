/**
 * Windows logon auto-launch via Electron login-item settings.
 * @module @deepseek-ai/dsh-desktop/autolaunch
 */

import { app } from 'electron'

/**
 * Apply the auto-launch preference. Development runs are a no-op: they execute
 * under the Electron binary, not the installed app, so registering them would
 * point the logon item at the wrong executable.
 * @param enabled - whether to launch at logon.
 */
export function configureAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled })
}
