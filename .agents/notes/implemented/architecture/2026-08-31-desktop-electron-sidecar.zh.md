# Agent Note：以 sidecar 宿主形式承载 Electron 桌面壳

Status: implemented

[English](2026-08-31-desktop-electron-sidecar.md) | 中文

## 问题

DeepSeek Harness 提供的 Web UI（dsh web）会在系统浏览器中打开。用户希望得到桌面应用：
一个可双击启动、没有浏览器标签页的原生窗口，最终是一个自包含安装包。Harness 本身是
全插件的 Cordis 树，其 web profile 会启动 node:http 服务器并托管已构建的前端。把该
界面重写为原生 UI 会丢弃现有产品，因此桌面壳必须在不为 Harness 引入 Electron 运行时
依赖的前提下复用 web profile。

## 决策

新增 workspace apps/desktop（包 @deepseek-ai/dsh-desktop），在 Electron BrowserWindow
中承载官方 Web UI。主进程把 dsh web profile 作为独立 Node 进程启动（参数为
web --no-open --port 0），并解析 dsh-web-app 在 Loader 树 settle 后打印的
"dsh web: <authenticatedUrl>" 这一 stdout 行，作为就绪信号。桌面壳用 loadURL 加载该
认证 URL；前端、HTTP/SSE/WebSocket 传输与 window.__DSH_BOOT__ 引导均保持不变。

把后端作为 sidecar 而非在 Electron 进程内运行，让 Harness 的原生模块（node-pty、
koffi、landlock）继续使用它们本就构建所针对的 Node ABI，从而免去 electron-rebuild。
这也让桌面壳处于 Harness 插件图之外：它是编排者而非 Cordis 表面，且不声明任何 bin，
因此不可能成为应用启动的逃逸入口。

生命周期：单实例锁、就绪超时（30 秒，错误信息附带 stderr 尾部）、退出时的进程树清理
（Windows 用 taskkill /T /F，其它平台先 SIGTERM 再 SIGKILL 升级），以及后端异常退出
时的重启对话框。外链与来源外导航走系统浏览器；渲染进程启用沙箱与上下文隔离，不注入
Node 能力。

## 验证

单元测试通过注入的 spawn 缝合点，覆盖就绪行解析、spawn 参数、就绪前退出拒绝、就绪
超时、空转 stop，以及 Windows 与其它平台的杀进程策略。真实组合冒烟测试随打包里程碑
落地，用 --port 0 启动已构建后端，断言就绪行出现且服务可响应。打包（内置 sidecar
可执行文件与 NSIS 安装包）、托盘、开机自启、崩溃上报、通知与可选的自动更新随桌面壳
一并交付；自动更新另需发布源与签名构建。

## 备选方案

在 Electron 进程内运行 Harness。复用了 Electron 的 Node 运行时，但会把每个原生模块
逼上 Electron ABI，并把 Harness 启动与 Electron 的进程模型和生命周期纠缠在一起。已
否决，改用 sidecar。

用原生技术重写 UI。以零能力收益为代价丢弃现有 Web UI 及其客户端插件架构。已否决。

Tauri 壳。二进制更小，但会给纯 TypeScript 仓库引入 Rust 工具链和第二套构建系统，且
后端仍需作为 Node sidecar 运行。已搁置；Windows 目标并不需要它。

## 后果

打包后的应用依赖内置的后端可执行文件与已构建的前端 dist，二者均由现有构建管线产出。
启动 URL 携带进程 token，与 dsh web 一致；桌面壳将其视为敏感信息且绝不打印。Windows
上退出为强杀，这是可接受的，因为会话持久化（JSONL/SQLite）被设计为能承受突然终止。
桌面壳不修改 packages 下的任何内容，只消费稳定的 dsh web CLI 契约。
