// Wrapper for electron-builder: pin the binaries cache to the workspace so
// the pre-downloaded nsis / winCodeSign artifacts are reused and no GitHub
// download is attempted during packaging.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
process.env.ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE ?? 'F:/DeepSeek_Harness/eb-cache'

const result = spawnSync('electron-builder', ['--config', 'electron-builder.yml'], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
