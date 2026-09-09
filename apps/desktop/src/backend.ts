/**
 * Sidecar supervision for the desktop shell.
 *
 * Owns spawning the dsh web backend, watching its stdout for the readiness
 * line the web-app bundle prints once the Loader tree settles, and tearing the
 * process tree down on quit. The backend runs as a separate Node process so
 * the harness native modules (node-pty, koffi, landlock) never cross the
 * Electron ABI boundary.
 * @module @deepseek-ai/dsh-desktop/backend
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** Injectable spawn seam, so tests drive a fake process without forking. */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** One readiness observation: the stdout line the backend prints when ready. */
const READY_LINE = /^dsh web: (\S+)/u

/** Keep only the tail of backend stderr for error diagnostics. */
const STDERR_TAIL_BYTES = 4000

/** Default time to wait for the backend readiness announcement. */
const DEFAULT_READY_TIMEOUT_MS = 30_000

/**
 * Parse the authenticated loopback URL from a backend stdout line, or
 * undefined when the line is not the readiness announcement.
 * @param line - one decoded stdout line.
 * @returns the URL, or undefined.
 */
export function parseReadyUrl(line: string): string | undefined {
  return READY_LINE.exec(line.trim())?.[1]
}

/** Options for {@link BackendController}. */
export interface BackendControllerOptions {
  /** Executable to spawn (node in dev, the bundled sidecar exe when packaged). */
  command: string
  /** Arguments, in order, ending with the web app flags. */
  args: string[]
  /** Working directory for the backend process. */
  cwd: string
  /** Extra environment overlaid on the desktop process environment. */
  env?: NodeJS.ProcessEnv
  /** Readiness timeout in milliseconds. */
  readyTimeoutMs?: number
  /** Called when the backend exits, with the exit code and whether stop() caused it. */
  onExit?: (code: number | null, intentional: boolean) => void
  /** Injectable spawn; defaults to node:child_process spawn. */
  spawn?: SpawnFn
  /** Platform used to pick the tree-kill command. Defaults to process.platform. */
  platform?: NodeJS.Platform
}

/**
 * Supervises one dsh web sidecar: start, readiness, restart, and process-tree
 * teardown. Not a Cordis plugin - the desktop shell is an Electron main-process
 * orchestrator, not a harness surface.
 */
export class BackendController {
  private child: ChildProcess | undefined
  private url: string | undefined
  private stderrTail = ''
  private stopping = false

  constructor(private readonly options: BackendControllerOptions) {}

  /** The authenticated URL once ready; undefined before readiness. */
  get readyUrl(): string | undefined {
    return this.url
  }

  /** Whether a child is spawned and not yet exited. */
  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  /** Start the backend and resolve with its authenticated URL once ready. */
  start(): Promise<string> {
    if (this.running) return Promise.reject(new Error('desktop: backend is already running'))
    return this.launch()
  }

  /** Stop the backend and its whole process tree, resolving when teardown is done. */
  async stop(): Promise<void> {
    if (!this.running) return
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child !== undefined) {
      await killProcessTree(child, this.options.platform ?? process.platform, this.options.spawn)
    }
    this.stopping = false
  }

  /** Stop then start again; resolves with the fresh authenticated URL. */
  async restart(): Promise<string> {
    await this.stop()
    return this.launch()
  }

  private launch(): Promise<string> {
    return new Promise((resolve, reject) => {
      const spawnFn = this.options.spawn ?? spawn
      const child = spawnFn(this.options.command, this.options.args, {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      this.url = undefined
      this.stderrTail = ''

      const timeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('desktop: backend did not report readiness within ' + String(timeoutMs) + 'ms; stderr tail:\n' + this.stderrTail))
      }, timeoutMs)

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/u)) {
          const url = parseReadyUrl(line)
          if (url === undefined) continue
          if (settled) return
          settled = true
          clearTimeout(timer)
          this.url = url
          resolve(url)
        }
      })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
      })

      child.once('error', (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code: number | null) => {
        const intentional = this.stopping
        this.child = undefined
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('desktop: backend exited before readiness (code ' + String(code) + '); stderr tail:\n' + this.stderrTail))
          return
        }
        this.options.onExit?.(code, intentional)
      })
    })
  }
}

/**
 * Kill a backend and its descendant tree. On Windows, taskkill /T /F clears
 * the whole tree (node-pty shells and subagents included); elsewhere the
 * direct child is SIGTERMed with a SIGKILL escalation.
 * @param child - the backend child process.
 * @param platform - the platform selecting the kill strategy.
 * @param spawnFn - injectable spawn for the tree-kill command.
 */
export async function killProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform,
  spawnFn: SpawnFn = spawn,
): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => {
        child.kill()
        resolve()
      })
      killer.once('exit', () => resolve())
    })
    return
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 3000).unref()
  })
}
