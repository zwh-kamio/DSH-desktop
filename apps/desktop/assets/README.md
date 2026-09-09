# Desktop assets

Build inputs referenced by electron-builder.yml (buildResources: assets) and by
the packaged backend launch.

- dsh-web-server.exe — the single-file dsh backend, copied here by
  scripts/copy-desktop-sidecar.mjs. Do not edit; regenerate with pnpm run build:exe.
- dsh-web-server-rg.exe — the ripgrep sidecar the backend resolves beside its
  own executable. Copied by the same script.

Application icons are optional. Drop them here to brand the app:

- icon.ico — Windows installer/app icon (electron-builder uses it when
  win.icon points at assets/icon.ico).
- tray.png — system-tray icon (16x16 or 32x32 PNG), copied to the resources
  root by electron-builder.yml so the packaged tray can load it. Without a
  loadable icon the tray is skipped entirely (no tray entry).

electron-builder builds without these; the installer and tray simply use
defaults until real icons are supplied.
