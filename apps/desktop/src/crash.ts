/**
 * Crash reporting for the desktop main process.
 * @module @deepseek-ai/dsh-desktop/crash
 */

import { crashReporter } from 'electron'

/**
 * Start the crash reporter. Local minidumps are always written; upload is
 * enabled only when a submit URL is configured.
 * @param submitUrl - the crash-server submit URL, or empty to disable upload.
 */
export function startCrashReporter(submitUrl: string): void {
  crashReporter.start({
    productName: 'DeepSeek Harness',
    uploadToServer: submitUrl !== '',
    compress: true,
    ...(submitUrl !== '' ? { submitURL: submitUrl } : {}),
  })
}
