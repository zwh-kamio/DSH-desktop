# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron desktop shell for DeepSeek Harness. It runs the "dsh web" profile as a
sidecar Node process and hosts the official Web UI in a native window, giving
users a double-clickable application instead of a browser tab.

## Status

Developer preview, Windows-first. Packaging and tray/auto-update land in later
milestones of the same objective.

## Architecture

- The Electron main process spawns the backend with: web --no-open --port 0
- The backend prints its authenticated URL once ready; the shell loads it in a
  BrowserWindow.
- The backend stays a separate Node process, so native modules (node-pty,
  koffi, landlock) never cross the Electron ABI boundary.
- External links open in the system browser; navigation stays pinned to the
  authenticated origin.

## Prerequisites

- Node 22.19+ (or 24+) and pnpm.
- A built checkout. Run from the repository root:

    pnpm run build

## Development

    pnpm install
    pnpm run build
    pnpm desktop:dev

## Tests

    pnpm --filter @deepseek-ai/dsh-desktop run test

## Known limitations

- On Windows the backend tree is torn down with taskkill /T /F, so quit is a
  force kill rather than a graceful signal. Harness durability (JSONL/SQLite)
  is designed to survive this.
- The startup URL carries a process token, exactly as dsh web does; the shell
  loads it once and never logs it.
- electron-builder packaging and an application icon are added in the
  packaging milestone.
