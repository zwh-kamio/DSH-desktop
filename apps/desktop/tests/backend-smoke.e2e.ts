import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { BackendController } from '../src/backend.ts'

/** Directory containing this test (apps/desktop/tests). */
const HERE = dirname(fileURLToPath(import.meta.url))
/** Repository root: apps/desktop/tests -> three levels up. */
const REPO_ROOT = join(HERE, '..', '..', '..')
/** The built CLI bin produced by pnpm run build. */
const DEV_BIN = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
/** The built frontend dist the web profile serves. */
const DIST_INDEX = join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html')

const built = existsSync(DEV_BIN) && existsSync(DIST_INDEX)

describe.skipIf(!built)('desktop backend smoke', () => {
  let controller: BackendController | undefined

  afterAll(async () => {
    await controller?.stop()
  })

  it('boots the web profile and serves the UI on the ready URL', async () => {
    controller = new BackendController({
      command: 'node',
      args: [DEV_BIN, 'web', '--no-open', '--port', '0'],
      cwd: REPO_ROOT,
      readyTimeoutMs: 60_000,
    })
    const url = await controller.start()
    // The readiness line carries the loopback host and the OS-assigned port.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)

    // The server must answer the authenticated root URL over HTTP.
    let status = 0
    try {
      const response = await fetch(url, { redirect: 'follow' })
      status = response.status
    } catch {
      status = 0
    }
    expect(status).not.toBe(0)
  }, 120_000)
})
