// Orchestrate the desktop installer build without re-triggering `pnpm deploy`.
//
// `pnpm run desktop:build:exe` stages the backend sidecar exe by running
// `pnpm deploy --legacy --prod`, which internally re-installs the root workspace
// with --production and prunes the devDependencies (electron-builder, typescript,
// tsx) that the packaging step needs. Once the sidecar is staged in assets/, we
// skip that step so `pnpm desktop:pack` stays re-runnable after a single `pnpm install`.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sidecar = resolve(root, 'apps', 'desktop', 'assets', 'dsh-web-server.exe')
const rgSidecar = resolve(root, 'apps', 'desktop', 'assets', 'dsh-web-server-rg.exe')

function format(command, args) {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function run(command, args) {
  const printable = format(command, args)
  console.log('pack-desktop: ' + printable)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, CI: 'true' },
    })
    child.once('error', (error) => {
      reject(new Error('pack-desktop: failed to spawn ' + printable + ': ' + error.message))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? 'signal ' + (signal ?? 'unknown') : 'exit code ' + code
      reject(new Error('pack-desktop: ' + printable + ' failed (' + cause + ')'))
    })
  })
}

async function main() {
  if (existsSync(sidecar) && existsSync(rgSidecar)) {
    console.log('pack-desktop: sidecar exe present, skipping pnpm run desktop:build:exe')
  } else {
    console.log('pack-desktop: sidecar exe missing, building it first (pnpm run desktop:build:exe)')
    await run('pnpm', ['run', 'desktop:build:exe'])
  }
  await run('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'desktop:pack'])
}

await main()
