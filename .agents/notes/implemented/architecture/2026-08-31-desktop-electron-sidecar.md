# Agent Note: Electron desktop shell as a sidecar host

Status: implemented

English | [中文](2026-08-31-desktop-electron-sidecar.zh.md)

## Problem

DeepSeek Harness ships a Web UI (dsh web) that opens in the system browser. Users asked for a desktop application: a double-clickable native window with no browser tab, and eventually a self-contained installer. The harness is an all-plugin Cordis tree whose web profile starts a node:http server and serves the built frontend. Rebuilding that surface as a native UI would discard the existing product, so a desktop wrapper must reuse the web profile without coupling the harness to an Electron runtime.

## Decision

Add a workspace apps/desktop (package @deepseek-ai/dsh-desktop) that hosts the official Web UI in an Electron BrowserWindow. The main process runs the dsh web profile as a separate Node process, launched with web --no-open --port 0, and parses the existing "dsh web: <authenticatedUrl>" stdout line, printed by dsh-web-app once the Loader tree settles, as its readiness signal. The shell loads that authenticated URL with loadURL; the frontend, the HTTP/SSE/WebSocket transport, and the window.__DSH_BOOT__ boot remain unchanged.

Running the backend as a sidecar rather than in-process inside Electron keeps the harness native modules (node-pty, koffi, landlock) on the Node ABI they already build against and avoids an electron-rebuild step. It also keeps the desktop shell outside the harness plugin graph: it is an orchestrator, not a Cordis surface, and declares no bin, so it cannot become an application-launch escape hatch.

Lifecycle: a single-instance lock, a readiness timeout (30 seconds) whose error carries a stderr tail, process-tree teardown on quit (taskkill /T /F on Windows, SIGTERM with SIGKILL escalation elsewhere), and a restart dialog on unexpected backend exit. External links and off-origin navigation open in the system browser; the renderer is sandboxed with context isolation and no Node integration.

## Verification

Unit tests pin readiness-line parsing, spawn arguments, exit-before-readiness rejection, readiness timeout, no-op stop, and the Windows and other-platform kill strategies through an injected spawn seam. A real-composition smoke test lands with the packaging milestone and boots the built backend with --port 0, asserting the readiness line and a served response. Packaging (a bundled sidecar executable and an NSIS installer), tray, auto-launch, crash reporting, notifications, and opt-in auto-update ship with the desktop shell; auto-update additionally requires a publish feed and a signed build.

## Alternatives considered

Run the harness in-process inside Electron. This reuses the Electron Node runtime but forces every native module onto the Electron ABI and entangles the harness boot with Electron's process model and lifecycle. Rejected in favor of the sidecar.

Rebuild the UI natively. This discards the shipped Web UI and its client-plugin architecture for no capability gain. Rejected.

Tauri shell. A smaller binary, but it adds a Rust toolchain and a second build system to a TypeScript-only repository while the backend still runs as a Node sidecar. Deferred; not required for the Windows target.

## Consequences

The packaged application depends on the bundled backend executable and the built frontend dist, both produced by the existing build pipeline. The startup URL carries a process token exactly as dsh web does; the shell treats it as sensitive and never logs it. Quit is a force kill on Windows, acceptable because session durability (JSONL/SQLite) is designed to survive abrupt termination. The desktop shell changes nothing under packages; it consumes only the stable dsh web CLI contract.
