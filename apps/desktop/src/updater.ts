/**
 * electron-updater wiring, active only when a publish feed is configured.
 * Auto-update also requires a signed build for NSIS differential updates to
 * apply; without signing the download still happens but installation may
 * fail. Updates are therefore opt-in via DSH_DESKTOP_UPDATE_FEED_URL.
 * @module @deepseek-ai/dsh-desktop/updater
 */

import electronUpdater from 'electron-updater'
import { notify } from './notify.ts'

/**
 * Configure automatic updates and run the first check. A no-op when feedUrl
 * is empty. The autoUpdater singleton is a getter-backed export: touching it
 * instantiates the platform updater, so it is destructured lazily only when
 * updates are actually enabled.
 * @param feedUrl - the generic publish feed URL, or empty to disable.
 */
export function configureUpdater(feedUrl: string): void {
  if (feedUrl === '') return
  const { autoUpdater } = electronUpdater
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  autoUpdater.autoDownload = true
  autoUpdater.on('update-available', () => {
    notify('DeepSeek Harness', 'A new version is available and will be downloaded.')
  })
  autoUpdater.on('update-downloaded', () => {
    notify('DeepSeek Harness', 'Update downloaded. It will install on the next restart.')
  })
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.error('desktop: update check failed:', error)
  })
}
