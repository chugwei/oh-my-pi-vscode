# Oh My Pi for VS Code — 设计文档

- 日期：2026-08-31
- 状态：已获用户批准的 brainstorm 设计，待实现
- 项目根：`F:/Code/oh-my-pi-vscode`

## 1. 目标

为 omp（Oh My Pi CLI，本机已装 v18.0.11）做一个 VS Code 插件，提供与 Claude Code / OpenCode 插件同级的体验：

- 活动栏新增 **Oh My Pi** 图标，点击在侧边栏打开 omp 会话面板
- 面板内完整运行 omp 原生 TUI（配色、Ctrl+P 切模型、todo 面板、鼠标均可用）
- 支持多个并行会话（标签页切换）
- 可在编辑器区开大窗终端（OpenCode 插件同款交互）

## 2. 非目标（v1 明确不做）

- 不自绘聊天 UI（不做 Claude Code 式原生聊天界面）
- 不适配 omp 未公开的 `rpc-ui` JSON 协议
- 不做图形化历史会话列表（恢复走 `omp -r` 交互式选择器）
- 不做远程 / SSH / Web 场景
- 不上架 Marketplace 打包分发（本地开发安装优先；.vsix 打包列为后续事项）

## 3. 用户可见行为（UX 规格）

### 3.1 侧边栏面板

```
┌─ Oh My Pi (activity bar) ─────────────┐
│ [session 1×] [session 2×] [＋] [↺]    │   标签栏：切换 / 关闭 / 新建 / 恢复
│ ┌─ xterm.js ────────────────────────┐ │
│ │  omp TUI（fit-addon 自适应宽度）   │ │
│ │                                   │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

- 每个标签 = 一个独立的 `omp` 进程（独立会话）
- `＋`：在当前工作区根目录新起一个 omp 会话
- `↺`（Resume）：新标签内运行 `omp -r`，用 omp 自带的会话选择器
- 关闭标签 `×`：杀掉对应进程；面板为空时显示欢迎态（一个「新建会话」按钮 + 简短说明）
- 进程退出后标签保留并显示 `[exited]`，提供「重新开始」按钮

### 3.2 编辑器区大窗

- 命令 `OMP: Open in Editor Tab`：用 VS Code 原生 `createTerminal({ location: { viewColumn: Beside } })` 跑 omp TUI（与 sst-dev.opencode 插件相同机制）
- 编辑器标题栏放一个 omp 图标按钮触发同一命令
- 该终端由 VS Code 原生管理，与侧边栏会话互不共享

### 3.3 键位

- webview 聚焦时置上下文键 `ompSidebarFocused = true`
- 在该上下文中把 `Ctrl+P`（omp 的模型切换）透传进终端，避免被 VS Code 快速打开截获
- VS Code 自身 `Ctrl+Shift+P`（命令面板）不受影响
- 透传键清单可通过设置增删（默认 `["ctrl+p"]`）

## 4. 架构

```
┌─ Extension Host (Node) ───────┐        ┌─ Sidebar Webview View ─────┐
│ OmpSessionManager            │        │ tab bar (＋ ↺ × …)          │
│  ├─ sessions: Map<id, {      │ postMsg│ xterm.js + fit-addon (多实例)│
│  │    pty, ring, state}>     │◀──────▶│ 主题：跟随 VS Code CSS 变量 │
│  └─ spawn omp via node-pty   │ 双向   │ 欢迎态 / 错误态 UI          │
│ KeyForwarder (透传命令)       │        └────────────────────────────┘
│ ExecutableResolver           │
└──────────────────────────────┘
```

### 4.1 Extension Host 模块

| 模块 | 职责 |
|---|---|
| `extension.ts` | 激活入口：注册视图、命令、设置监听 |
| `sessionManager.ts` | 会话生命周期：spawn / write / resize / kill / 列表；每个会话维护环形缓冲（默认 4 MB）用于重连重放 |
| `ptyFactory.ts` | 封装 node-pty 的创建；可注入假实现供测试 |
| `executable.ts` | 解析 omp 可执行文件路径（设置 → PATH → `%LOCALAPPDATA%\omp\omp.exe` 探测 → `where omp`） |
| `webviewViewProvider.ts` | webview view 注册、消息路由（host ↔ webview）、上下文键维护 |
| `editorTerminal.ts` | 编辑器区终端命令（原生 createTerminal） |

### 4.2 Webview ↔ Host 消息协议（JSON-RPC 风格，postMessage）

webview → host：

| type | 字段 | 说明 |
|---|---|---|
| `ready` | — | webview 初始化完成，host 下发会话快照 |
| `new` | `args?: string[]` | 新建会话（恢复时传 `["-r"]`，其余走 `omp.defaultArgs`） |
| `input` | `sessionId, data: string` | 终端按键输入 |
| `resize` | `sessionId, cols, rows` | 尺寸变化 |
| `close` | `sessionId` | 关闭某会话 |
| `switch` | `sessionId` | 激活某标签 |
| `restart` | `sessionId` | 重启 exited 会话 |

host → webview：

| type | 字段 | 说明 |
|---|---|---|
| `snapshot` | `sessions[], activeId` | 全量会话状态（含重放缓冲） |
| `output` | `sessionId, data` | 终端输出增量 |
| `exit` | `sessionId, code` | 进程退出 |
| `created` | `session` | 新会话已建立 |
| `error` | `message` | 宿主侧错误（omp 未找到等） |

### 4.3 Webview 资源

- xterm.js（`@xterm/xterm` + `@xterm/addon-fit`）以本地文件经 `webview.asWebviewUri` 引入，运行时不依赖网络
- 无前端框架，vanilla TS/JS + esbuild 打包；CSP 严格限定本地资源
- 主题：读取 `--vscode-*-prefixed` CSS 变量映射到 xterm 主题（背景/前景/光标/16 色）

## 5. 会话生命周期与健壮性

- spawn 参数：`cwd = workspace 根目录`（多根工作区取第一个；无工作区时取 `~` 并传 `--allow-home`），`env = process.env + TERM=xterm-256color`，`name = 'omp'`，初始 cols/rows 由 webview fit-addon 上报
- 侧边栏隐藏不销毁：webview view 设 `retainContextWhenHidden: true`
- webview view 被 VS Code 销毁（拖动视图、重开窗口）：**进程不杀**，`sessionManager` 保留 pty 与环形缓冲；视图重建后 `ready → snapshot` 重放缓冲并继续增量转发
- VS Code 关闭：extension host 退出，pty 进程树随之结束（ConPTY 行为）
- 每会话崩溃/退出仅影响自身标签

## 6. 设置（contributes.configuration）

| 键 | 默认 | 说明 |
|---|---|---|
| `omp.executablePath` | `"omp"` | omp 可执行文件路径；找不到时自动探测常见安装位 |
| `omp.defaultArgs` | `[]` | 传给每个新会话的额外 CLI 参数（如 `["--thinking","high"]`） |
| `omp.fontFamily` | 跟随 `terminal.integrated.fontFamily` | xterm 字体 |
| `omp.scrollback` | `5000` | xterm 回滚行数 |
| `omp.passThroughKeys` | `["ctrl+p"]` | `ompSidebarFocused` 时透传到终端的键 |

## 7. 错误处理

| 故障 | 表现 |
|---|---|
| omp 未找到 | 面板错误态：说明 + 「打开设置」按钮（定位 `omp.executablePath`） |
| node-pty 原生模块加载失败（缺 VS Build Tools） | 激活时捕获；侧边栏显示指引；`OMP: Open in Editor Tab` 仍可用（原生终端不需要 node-pty） |
| 单个会话进程退出 | 标签 `[exited]` + 重新开始按钮，其余会话不受影响 |
| 工作区根不可用 | 退回 `~` + `--allow-home` |

## 8. 工程与打包

- TypeScript + esbuild（host 代码 bundle 到 `dist/extension.js`，webview 代码 bundle 到 `dist/webview/main.js`）
- `node-pty` 为原生模块：**external**（不进 bundle），随 `node_modules` 加载；本地开发（F5 / `--extensionDevelopmentPath`）直接可用
- 依赖：`@xterm/xterm`、`@xterm/addon-fit`、`node-pty`、`@types/vscode`、`@vscode/test-cli`、`esbuild`、`typescript`
- 最低 VS Code 版本：`^1.94.0`（与两个参考插件一致，webview view / editor terminal location 均已稳定）

## 9. 测试与验证

1. **单元测试**（node 直跑，无需 VS Code）：`sessionManager` 用注入的假 ptyFactory 验证：新建/关闭/重启、消息路由到正确会话、环形缓冲重放、exit 事件、resize 传递
2. **集成 smoke**（`@vscode/test-cli` 起 Extension Development Host）：执行 `omp.newSession` 命令 → 断言 `sessionManager` 建立会话并产生输出事件（不依赖侧边栏 webview 是否渲染）；执行 `omp.openInEditor` → 断言终端创建
3. **手动验收**（最终标准）：开发宿主中侧边栏开新会话 → TUI 完整渲染、可对话、Ctrl+P 透传、多标签并行、关闭/重启、隐藏侧边栏后回来会话仍在
