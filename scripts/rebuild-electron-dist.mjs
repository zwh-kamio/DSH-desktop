// Rebuild the standalone Electron distribution that apps/desktop/electron-builder.yml
// points at via electronDist. The electron npm package's postinstall re-download is
// unreliable (it often exits without extracting electron.exe), so instead of relying on
// node_modules, we unpack the @electron/get cache zip into a directory that `pnpm install`
// cannot touch.
//
// Usage: node scripts/rebuild-electron-dist.mjs [dest]
//   dest defaults to F:/DeepSeek_Harness/electron-dist on win32, else electron-dist/.
//
// Env: DSH_ELECTRON_VERSION overrides the version read from the workspace's electron package.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const electronPkgJson = require.resolve('electron/package.json', {
  paths: [join(repoRoot, 'apps', 'desktop')],
});
const version = process.env.DSH_ELECTRON_VERSION ?? require(electronPkgJson).version;
const platform = process.platform === 'win32' ? 'win32' : process.platform;
const arch = process.arch === 'ia32' ? 'ia32' : 'x64';
const dest = resolve(
  process.argv[2] ??
    (process.platform === 'win32' ? 'F:/DeepSeek_Harness/electron-dist' : join(repoRoot, 'electron-dist')),
);

const cacheDir = join(homedir(), 'AppData', 'Local', 'electron', 'Cache');
const zipName = 'electron-v' + version + '-' + platform + '-' + arch + '.zip';

function findZip(root) {
  if (!existsSync(root)) return null;
  const out = execFileSync('cmd', ['/c', 'dir', '/s', '/b', root + '\\' + zipName], {
    encoding: 'utf8', shell: true,
  });
  return out.split(/\r?\n/).find((line) => line.endsWith(zipName)) ?? null;
}

const zip = process.platform === 'win32' ? findZip(cacheDir) : join(cacheDir, '**', zipName);

if (!zip || !existsSync(zip)) {
  console.error('electron zip not found in cache: ' + cacheDir + ' (' + zipName + ')');
  process.exit(1);
}

console.log('extracting ' + zip + ' -> ' + dest);
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
execFileSync('powershell', ['-NoProfile', '-Command', "Expand-Archive -Path '" + zip + "' -DestinationPath '" + dest + "' -Force"], {
  stdio: 'inherit', shell: true,
});

const exe = join(dest, process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!existsSync(exe)) {
  console.error('electron binary missing after extraction: ' + exe);
  process.exit(1);
}
console.log('electron ' + version + ' ready at ' + dest);
