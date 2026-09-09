/**
 * Desktop-shell runtime configuration, read from the environment with
 * defaults. The desktop shell is an Electron orchestrator, not a Cordis
 * surface, so its deployment-varying switches live in typed config rather
 * than cordis.yml.
 * @module @deepseek-ai/dsh-desktop/config
 */

/** The resolved desktop-shell switches. */
export interface DesktopConfig {
  /** Hide to the system tray on window close instead of quitting. */
  minimizeToTray: boolean
  /** Register the app to launch at Windows logon. */
  autoLaunch: boolean
  /** Generic publish feed URL for electron-updater; empty disables updates. */
  updateFeedUrl: string
  /** Crash-reporter submit URL; empty disables upload. */
  crashSubmitUrl: string
}

/** Read a boolean-ish value; a non-empty value other than 0/false is true. */
function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]
  if (value === undefined || value === '') return fallback
  return value !== '0' && value.toLowerCase() !== 'false'
}

/** Read an optional string value, trimmed. */
function stringEnv(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? ''
}

/**
 * Resolve the desktop-shell configuration.
 * @param env - the environment to read (defaults to process.env).
 * @returns the resolved configuration.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  return {
    minimizeToTray: boolEnv(env, 'DSH_DESKTOP_MINIMIZE_TO_TRAY', true),
    autoLaunch: boolEnv(env, 'DSH_DESKTOP_AUTO_LAUNCH', false),
    updateFeedUrl: stringEnv(env, 'DSH_DESKTOP_UPDATE_FEED_URL'),
    crashSubmitUrl: stringEnv(env, 'DSH_DESKTOP_CRASH_SUBMIT_URL'),
  }
}
