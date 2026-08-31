# Oh My Pi Chat (ACP 交互式聊天界面) — 设计规范文档

- 日期：2026-08-31
- 状态：已获用户批准的设计规范 (Approved Design Spec)
- 对应项目：`F:/Code/oh-my-pi-vscode`

---

## 1. 目标与定位

为 VS Code 插件 `Oh My Pi` 增加全新的 **Claude Code 风格原生聊天视图（Chat View）**，通过官方标准协议 **ACP (Agent Client Protocol v1)** 与 `omp acp` 守护进程通信：

- **主视图为 Chat 界面**：支持富文本消息流、思考折叠流、工具调用卡片、权限审批卡片与交互式问答。
- **丰富的鼠标点击交互**：
  - 模式切换按钮（`Default` / `Plan` 等），支持**模式与模型联动预设**（切 Plan 自动换成预设 Plan 模型与思考强度）。
  - 思考强度切换器（`Off` / `Auto` / `Low` / `High` / `Max`）。
  - 模型下拉选择器（支持从 200+ 可用模型中模糊搜索与切换）。
  - 文件 / 图片上传按钮（直接以 ACP `resource` / `image` ContentBlock 发送）。
- **保留现有 Terminal 视图**：在同一活动栏容器中保留 xterm.js TUI 视图作为次要备用入口。

---

## 2. 总体架构

```
┌─ VS Code Activity Bar (Oh My Pi) ──────────────────────────┐
│  ├─ View 1: "Chat" (默认/主视图)   ◀─ AcpChatViewProvider   │
│  └─ View 2: "Terminal" (备用视图) ◀─ OmpViewProvider (TUI) │
└────────────────────────────────────────────────────────────┘

┌─ Extension Host (Node.js) ─────────────────────────────────┐
│ AcpProcessManager                                          │
│  └─ spawn("omp", ["acp"]) (stdio JSON-RPC 2.0)             │
│ AcpClient (Typed RPC Client)                               │
│  ├─ initialize, session/new, session/load, session/list    │
│  ├─ session/set_config_option (mode, model, thinking)       │
│  ├─ session/prompt (text, image, resource)                 │
│  ├─ session/cancel                                         │
│  └─ request_permission 拦截分发与响应                      │
│ ModePresetResolver (读取 settings 中的 mode -> model 映射)  │
└────────────────────────────────────────────────────────────┘
                            │ postMessage (双向 JSON 协议)
                            ▼
┌─ Webview (Chat UI) ────────────────────────────────────────┐
│ ┌─ 顶部栏: [≡ 历史会话] [＋ 新建] [当前模式/思考/模型标签] ┐ │
│ ├─ 消息列表 (Message List)                                  │
│ │   ├─ User Message (文本 / 附件胶囊)                      │
│ │   ├─ Assistant Message (实时 Markdown / 代码高亮)         │
│ │   ├─ Thinking Block (流式展开 / 耗时收起 / 手动折叠)      │
│ │   ├─ Tool Call Block (状态机: pending/running/done/fail)  │
│ │   └─ Permission Card (Allow once / Always / Reject)      │
│ └─ 底部输入栏 (Claude Code 风格)                            │
│     ├─ 多行自动增高文本框                                  │
│     ├─ 附件列表预览卡片                                    │
│     └─ 交互工具条: [＋附件] [⚡模式▾] [🧠思考▾] [🤖模型▾] [➤]│
└────────────────────────────────────────────────────────────┘
```

---

## 3. ACP 通信层与数据流

### 3.1 协议规范 (ACP v1)
- 传输形式：Stdio JSON-RPC 2.0。
- 启动命令：`omp acp`。
- 握手阶段：
  - Client -> Server: `initialize` 带 `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }`。
  - Server -> Client: 返回 `agentCapabilities`（支持 `loadSession`, `sessionCapabilities.list`, `promptCapabilities.image/embeddedContext` 等）。
- 会话创建与恢复：
  - `session/new`：返回 `sessionId` 和 `configOptions`（包含 `mode`, `model`, `thinking` 的当前值与选项）。
  - `session/list`：获取历史会话元数据（`sessionId`, `cwd`, `updatedAt`, `_meta`）。
  - `session/load`：加载历史会话。

### 3.2 动态配置调整 (`session/set_config_option`)
- 客户端调用：`session/set_config_option({ sessionId, configId: "mode"|"model"|"thinking", value: string })`。
- 服务端响应：返回全量更新后的 `configOptions` 数组。

### 3.3 提示词流（Prompt Turn）与更新推送
- 客户端发送：`session/prompt({ sessionId, prompt: ContentBlock[] })`。
  - `ContentBlock` 类型：
    - `text`: `{ type: "text", text: string }`
    - `image`: `{ type: "image", mimeType: string, data: base64String }`
    - `resource`: `{ type: "resource", resource: { uri: string, mimeType: string, text: string } }`
- 服务端推送通知 `session/update`：
  - `agent_thought_chunk`: `{ content: { text }, messageId }`
  - `agent_message_chunk`: `{ content: { text } }`
  - `tool_call` & `tool_call_update`: `{ toolCallId, title, kind, status: "pending"|"in_progress"|"completed"|"failed", rawInput, rawOutput, content }`
  - `usage_update`: `{ size, used, cost: { amount, currency } }`
  - `available_commands_update`: 斜杠命令列表
- 服务端权限请求 `session/request_permission`：
  - 服务端向客户端发送请求：包含 `toolCall` 详情与 `options`（`allow_once`, `allow_always`, `reject_once`, `reject_always`）。
  - 客户端通过 UI 收集选择后回包：`{ outcome: { outcome: "selected", optionId: "allow_once" } }`。
- 中断：客户端发送通知 `session/cancel({ sessionId })`。

---

## 4. 前端组件与交互细节

### 4.1 底部输入栏（Claude Code 1:1 体验）
1. **多行文本输入框**：
   - 支持自动伸缩高度（最大 200px）。
   - 快捷键：`Enter` 发送，`Shift+Enter` 换行，`Esc` 取消焦点或停止生成。
   - Placeholder 动态提示快捷键与当前状态。
2. **`＋` 文件与附件按钮**：
   - 点击弹出菜单：`选择文件...`、`选择图片...`、`添加当前编辑器选中内容`。
   - 选中后在输入框上方显示小胶囊标签（如 `📄 sessionManager.ts [×]`、`🖼️ screenshot.png [×]`）。
   - 发送时由 Host 读入并组装为 ACP `resource` 或 `image` 块。
3. **`⚡ Mode` 模式选择器**：
   - 下拉列出 `Default`、`Plan`（及后续扩展模式）。
   - 选中模式时，触发**模式与模型联动预设**：
     - 若切换至 `Plan`，自动将模型切换为 `omp.chat.modePresets.plan.model`，思考强度设为 `plan.thinking`。
     - 若切换至 `Default`，自动切回 `omp.chat.modePresets.default.model`。
4. **`🧠 Think` 思考强度选择器**：
   - 下拉显示：`Off` / `Auto` / `Low` / `High` / `Max`。
   - 实时调用 `session/set_config_option(configId: 'thinking', value)`。
5. **`🤖 Model` 模型选择器**：
   - 下拉弹窗支持输入关键词即时过滤（从 `configOptions.find(x => x.id === 'model').options` 获取）。
   - 单击立即生效，且同步更新界面状态。
6. **`➤` 发送 / `◼` 停止按钮**：
   - 处于生成状态时变为红色停止按钮，点击发送 `session/cancel`。

### 4.2 消息流与卡片设计
1. **Thinking 思考折叠卡片**：
   - 生成中：带有呼吸灯动画，内容实时打印展开。
   - 生成完毕：自动折叠为 `💭 已思考 X 秒 [展开]`，点击可重新展开/收起。
2. **Tool Call 工具卡片**：
   - 卡片头部显示工具图标（如 bash / write / edit）、标题与耗时。
   - 状态角标：`⏳ 运行中`、`✓ 已完成`、`✕ 失败`。
   - 卡片主体可折叠输入参数与输出日志，右上角带「一键复制」按钮。
3. **Permission Request 权限卡片**：
   - 高亮警告框，展示即将执行的命令或写入的文件。
   - 三个直观按钮：`[本次允许]`、`[始终允许]`、`[拒绝]`。
   - 鼠标点击即回传，阻止界面阻塞。

### 4.3 顶部工具条与历史会话
- **`≡ 历史` 按钮**：滑出侧边或下拉展示 `session/list` 获取的历史会话列表（按时间排序），支持一键加载历史（`session/load`）与删除。
- **`＋` 新会话按钮**：开启新会话（`session/new`）。
- **状态徽章**：紧凑展示当前会话的上下文 Token 消耗与费用。

---

## 5. 配置选项（`package.json` contributes）

```json
{
  "omp.chat.modePresets": {
    "type": "object",
    "default": {
      "default": {
        "model": "google-antigravity/claude-sonnet-4-5",
        "thinking": "high"
      },
      "plan": {
        "model": "google-antigravity/claude-opus-4-6",
        "thinking": "max"
      }
    },
    "description": "Presets for models and thinking levels when switching modes in Chat UI"
  },
  "omp.chat.defaultMode": {
    "type": "string",
    "default": "default",
    "description": "Default mode for newly created chat sessions"
  },
  "omp.chat.fontSize": {
    "type": "number",
    "default": 13,
    "description": "Font size for the Chat UI"
  }
}
```

---

## 6. 非目标 (Non-Goals)

- 不删除或重写已有 Terminal 视图（作为 `Oh My Pi: Terminal` 视图在同容器中保留）。
- 不绕过 ACP 协议直接访问本地数据库（所有会话列出与恢复完全走 ACP `session/list` 与 `session/load`）。
- 不引入重型前端框架（React/Vue），使用高性能原生 TypeScript + 精简 DOM + CSS 变量实现。

---

## 7. 测试与验证策略

1. **ACP Client 单元测试**：使用假 stdio 进程，测试 JSON-RPC 消息封包、`initialize` 握手、`session/new`、`session/set_config_option`、`session/prompt`、流消息解析和 `session/request_permission` 响应。
2. **ModePresetResolver 单元测试**：验证模式切换时正确查找并派发对应的模型与思考强度设置变更。
3. **集成 Smoke 测试**：在真实 VS Code 测试宿主中启动 ACP Client，执行实际的 `session/new` -> `session/set_config_option` -> 发送 prompt -> 拦截权限请求响应 -> 验证完整 turn 返回。
4. **手动验收**：
   - 在 Chat 面板点击 `＋` 选择文件，确认胶囊标签与 prompt 正确发送。
   - 点击 `⚡ Mode: Plan`，确认模型自动切为 Opus 4.6 且思考强度切为 Max。
   - 触发一次 bash 执行，确认权限审批卡片正常弹出且点击 `Allow once` 后工具执行继续。
   - 验证思考块折叠与展开、历史会话切换。
