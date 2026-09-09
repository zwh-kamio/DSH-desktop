/**
 * Resolve the backend launch command for the current run mode: the built dsh
 * bin from this checkout in development, or the bundled single-file sidecar
 * executable in a packaged build.
 * @module @deepseek-ai/dsh-desktop/launch
 */

import { app } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The resolved command line handed to {@link BackendController}. */
export interface BackendLaunch {
  command: string
  args: string[]
  cwd: string
}

/** Directory containing this module's compiled output (apps/desktop/dist). */
const HERE = dirname(fileURLToPath(import.meta.url))
/** Repository root in development: apps/desktop/dist -> three levels up. */
const REPO_ROOT = join(HERE, '..', '..', '..')
/** The built CLI bin produced by pnpm run build (apps/cli/lib/bin.js). */
const DEV_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
/** Basename of the bundled sidecar executable produced by the packaging build. */
const SIDECAR_NAME = process.platform === 'win32' ? 'dsh-web-server.exe' : 'dsh-web-server'

/** The web profile flags that make the backend a silent sidecar for the shell. */
const SIDECAR_FLAGS = ['web', '--no-open', '--port', '0'] as const

/**
 * Compute the backend launch for this run.
 * @returns the spawn command, arguments, and working directory.
 */
export function resolveBackendLaunch(): BackendLaunch {
  if (app.isPackaged) {
    const dir = join(process.resourcesPath, 'dsh-web-server')
    return { command: join(dir, SIDECAR_NAME), args: [...SIDECAR_FLAGS], cwd: dir }
  }
  return { command: 'node', args: [DEV_BIN, ...SIDECAR_FLAGS], cwd: REPO_ROOT }
}
