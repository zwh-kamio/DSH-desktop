/**
 * Desktop notifications for backend lifecycle and update events.
 * @module @deepseek-ai/dsh-desktop/notify
 */

import { Notification } from 'electron'

/**
 * Show a desktop notification when the platform supports it.
 * @param title - notification title.
 * @param body - notification body.
 */
export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}
