# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的 Electron 桌面壳。它以独立 Node 进程（sidecar）运行
"dsh web" profile，并把官方 Web UI 承载到原生窗口中，让用户获得一个可双击启动的
桌面应用，而不是浏览器标签页。

## 状态

开发者预览，Windows 优先。打包、托盘与自动更新在后续里程碑中落地。

## 架构

- Electron 主进程以后端参数启动：web --no-open --port 0
- 后端就绪后打印带认证的 URL；桌面壳将其加载进 BrowserWindow。
- 后端保持独立 Node 进程，因此原生模块（node-pty、koffi、landlock）不会跨越
  Electron ABI 边界。
- 外链走系统浏览器；页面导航被锁定在认证来源内。

## 前置条件

- Node 22.19+（或 24+）与 pnpm。
- 已构建的仓库。在仓库根目录执行：

    pnpm run build

## 开发

    pnpm install
    pnpm run build
    pnpm desktop:dev

## 测试

    pnpm --filter @deepseek-ai/dsh-desktop run test

## 已知限制

- Windows 上使用 taskkill /T /F 清理后端进程树，因此退出是强杀而非优雅信号。
  Harness 的持久化（JSONL/SQLite）被设计为能承受这种终止。
- 启动 URL 携带进程 token，与 dsh web 一致；桌面壳仅加载一次，绝不打印。
- electron-builder 打包与应用图标在打包里程碑中添加。
