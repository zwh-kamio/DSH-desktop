/**
 * Single-instance enforcement: a second launch focuses the existing window
 * instead of spawning a second backend.
 * @module @deepseek-ai/dsh-desktop/single-instance
 */

import { app } from 'electron'

/**
 * Acquire the single-instance lock, registering the focus callback for later
 * launches. When the lock is already held, this quits the current process.
 * @param onSecond - invoked in the first instance when a second one starts.
 * @returns true when this process is the primary instance.
 */
export function installSingleInstance(onSecond: () => void): boolean {
  const primary = app.requestSingleInstanceLock()
  if (!primary) {
    app.quit()
    return false
  }
  app.on('second-instance', () => onSecond())
  return true
}
