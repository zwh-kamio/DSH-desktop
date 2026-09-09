// Copy the single-file dsh executable (produced by build-exe-for-python-sdk.ts)
// into the desktop app's assets, renaming it and its ripgrep sidecar to the
// dsh-web-server basename. tool-fs-search derives the ripgrep path from
// process.execPath (dirname/<basename-without-ext>-rg.exe), so the sidecar must
// keep the same basename and directory as the renamed executable.
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dist-exe')
const assetsDir = join(root, 'apps', 'desktop', 'assets')

// The pkg target is node24-win-x64; the tested build names products
// <deepseek-harness-sdk-runtime>-<platform>-<arch> with a -rg sidecar.
const SOURCE = 'deepseek-harness-sdk-runtime-win-x64'
const pairs = [
  [SOURCE + '.exe', 'dsh-web-server.exe'],
  [SOURCE + '-rg.exe', 'dsh-web-server-rg.exe'],
]

for (const [source] of pairs) {
  if (!existsSync(join(outDir, source))) {
    console.error('copy-desktop-sidecar: missing ' + join(outDir, source))
    console.error('copy-desktop-sidecar: run: pnpm run build:exe (or pnpm exec tsx scripts/build-exe-for-python-sdk.ts --skip-build --targets node24-win-x64)')
    process.exit(1)
  }
}

await mkdir(assetsDir, { recursive: true })
for (const [source, target] of pairs) {
  await copyFile(join(outDir, source), join(assetsDir, target))
  console.log('copy-desktop-sidecar: ' + source + ' -> apps/desktop/assets/' + target)
}
