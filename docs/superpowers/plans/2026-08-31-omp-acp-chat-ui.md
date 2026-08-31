# Oh My Pi Chat (ACP 交互式聊天界面) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 VS Code 插件 `Oh My Pi` 实现全新的 Claude Code 风格原生聊天视图（Chat View），通过 ACP v1 (Agent Client Protocol) 标准协议与 `omp acp` 交互，具备鼠标点击选择思考强度/切换模型/模式-模型联动预设/文件上传附件等丰富交互，并在同一容器中保留 Terminal 视图。

**Architecture:** 
- **Extension Host**: `AcpClient` 管理 `omp acp` 子进程并处理 JSON-RPC 2.0 stdio 协议；`ModePresetResolver` 负责模式切换时的模型与思考强度联动；`AcpChatViewProvider` 负责 Webview 与 ACP Client 之间的桥梁，支持文件选择对话框与附件封装。
- **Webview**: Vanilla TypeScript + CSS 打造的高性能现代化聊天界面，包含会话抽屉、多行输入框、附件胶囊、模式/思考/模型下拉选择器、思考折叠流、工具调用状态机卡片与权限审批卡片。
- **Packaging**: 更新 esbuild 打包配置、package.json 视图与配置声明，编译并打包为 `.vsix` 安装包。

**Tech Stack:** TypeScript, esbuild, JSON-RPC 2.0 (stdio), Agent Client Protocol v1, VS Code Webview API, Node.js `node:test` + `tsx`, `@vscode/test-cli`.

---

### Task 1: ACP 协议类型定义

**Files:**
- Create: `src/host/acp/types.ts`

- [ ] **Step 1: 创建 `src/host/acp/types.ts`**

```ts
/**
 * Agent Client Protocol (ACP v1) Type Definitions
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

// Initialize
export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    session?: { configOptions?: { boolean?: Record<string, never> } };
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: {
      list?: Record<string, never>;
      fork?: Record<string, never>;
      resume?: Record<string, never>;
      close?: Record<string, never>;
    };
    promptCapabilities?: {
      embeddedContext?: boolean;
      image?: boolean;
    };
  };
}

// Config Options
export interface ConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: 'mode' | 'model' | 'model_config' | 'thought_level' | string;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: ConfigOptionValue[];
}

// Sessions
export interface SessionNewParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface SessionNewResult {
  sessionId: string;
  configOptions?: ConfigOption[];
}

export interface SessionListParams {
  cwd?: string;
}

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  updatedAt: string;
  _meta?: {
    messageCount?: number;
    size?: number;
  };
}

export interface SessionListResult {
  sessions: SessionSummary[];
}

export interface SessionLoadParams {
  sessionId: string;
  cwd?: string;
}

export interface SessionLoadResult {
  sessionId: string;
  configOptions?: ConfigOption[];
}

export interface SetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string | boolean;
}

export interface SetConfigOptionResult {
  configOptions: ConfigOption[];
}

// Content Blocks
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } };

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface SessionPromptResult {
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedReadTokens?: number;
  };
}

// Session Updates
export interface ToolCallPayload {
  toolCallId: string;
  title?: string;
  kind?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  content?: Array<{ type: string; content?: { type: string; text?: string } }>;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCallPayload;
  options: PermissionOption[];
}

export interface RequestPermissionResult {
  outcome:
    | { outcome: 'selected'; optionId: string }
    | { outcome: 'cancelled' };
}

export type SessionUpdateNotification =
  | { sessionUpdate: 'agent_message_chunk'; content: { type: 'text'; text: string } }
  | { sessionUpdate: 'agent_thought_chunk'; content: { type: 'text'; text: string }; messageId?: string }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title?: string; kind?: string; status: 'pending'; rawInput?: Record<string, unknown>; content?: Array<{ type: string; content?: { type: string; text?: string } }> }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status: 'in_progress' | 'completed' | 'failed'; rawOutput?: unknown; content?: Array<{ type: string; content?: { type: string; text?: string } }> }
  | { sessionUpdate: 'usage_update'; size?: number; used?: number; cost?: { amount: number; currency: string } }
  | { sessionUpdate: 'session_info_update'; updatedAt: string }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description: string; input?: { hint?: string } }> };
```

- [ ] **Step 2: 验证类型检查**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/host/acp/types.ts
git commit -m "feat(acp): add complete ACP v1 protocol type definitions"
```

---

### Task 2: ACP Client 模块实现与单测 (TDD)

**Files:**
- Create: `src/host/acp/client.ts`
- Create: `test/unit/acpClient.test.ts`

- [ ] **Step 1: 编写失败的单元测试 `test/unit/acpClient.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AcpClient, type ProcessLike } from '../../src/host/acp/client.js';

class MockProcess implements ProcessLike {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  private exitCbs: Array<(code: number) => void> = [];

  kill(): void {
    this.killed = true;
    this.exitCbs.forEach((cb) => cb(0));
  }

  onExit(cb: (code: number) => void): void {
    this.exitCbs.push(cb);
  }

  emitServerMessage(msg: unknown): void {
    this.stdout.write(JSON.stringify(msg) + '\n');
  }
}

test('AcpClient initializes and handles request/response', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);

  const initPromise = client.initialize();

  // Mock server responds to initialize
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'initialize');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: { protocolVersion: 1, agentInfo: { name: 'omp-test' } }
    });
  });

  const res = await initPromise;
  assert.equal(res.protocolVersion, 1);
  assert.equal(res.agentInfo?.name, 'omp-test');
});

test('AcpClient handles session/new and set_config_option', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);
  void client.initialize();

  // Auto-respond to init
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    proc.emitServerMessage({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1 } });
  });
  await new Promise((r) => setTimeout(r, 10));

  const newPromise = client.newSession('/test/dir');
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'session/new');
    assert.equal(req.params.cwd, '/test/dir');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        sessionId: 'sess_1',
        configOptions: [
          { id: 'mode', name: 'Mode', type: 'select', currentValue: 'default' }
        ]
      }
    });
  });

  const session = await newPromise;
  assert.equal(session.sessionId, 'sess_1');

  // Test set_config_option
  const setPromise = client.setConfigOption('sess_1', 'mode', 'plan');
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'session/set_config_option');
    assert.equal(req.params.configId, 'mode');
    assert.equal(req.params.value, 'plan');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'plan' }]
      }
    });
  });

  const setRes = await setPromise;
  assert.equal(setRes.configOptions[0].currentValue, 'plan');
});

test('AcpClient dispatches session updates and handles permission request', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);

  const updates: unknown[] = [];
  client.onUpdate((u) => updates.push(u));

  const permRequests: unknown[] = [];
  client.onRequestPermission(async (p) => {
    permRequests.push(p);
    return 'allow_once';
  });

  // Emit an update notification
  proc.emitServerMessage({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'sess_1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' }
      }
    }
  });

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Hello' }
  });

  // Emit a permission request from server
  proc.stdin.once('data', (d) => {
    const resp = JSON.parse(d.toString());
    assert.equal(resp.id, 99);
    assert.deepEqual(resp.result, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
  });

  proc.emitServerMessage({
    jsonrpc: '2.0',
    id: 99,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess_1',
      toolCall: { toolCallId: 'c1', title: 'run echo', status: 'pending' },
      options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }]
    }
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(permRequests.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit`
Expected: FAIL (`Cannot find module .../acp/client.js`)

- [ ] **Step 3: 实现 `src/host/acp/client.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  InitializeParams,
  InitializeResult,
  SessionNewParams,
  SessionNewResult,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  SetConfigOptionParams,
  SetConfigOptionResult,
  SessionPromptParams,
  SessionPromptResult,
  ContentBlock,
  RequestPermissionParams,
  SessionUpdateNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from './types.js';

export interface ProcessLike {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: string): void;
  onExit(cb: (code: number) => void): void;
}

export type PermissionHandler = (params: RequestPermissionParams) => Promise<string | null>;

export class AcpClient {
  private proc: ProcessLike | null = null;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (res: any) => void; reject: (err: Error) => void }>();
  private readonly events = new EventEmitter();
  private permissionHandler: PermissionHandler | null = null;
  private stdoutBuf = '';

  constructor(private readonly processFactory?: () => ProcessLike) {
    this.events.setMaxListeners(50);
  }

  private ensureProcess(): ProcessLike {
    if (this.proc) return this.proc;

    if (this.processFactory) {
      this.proc = this.processFactory();
    } else {
      const cp = spawn('omp', ['acp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      this.proc = {
        stdin: cp.stdin!,
        stdout: cp.stdout!,
        stderr: cp.stderr!,
        kill: (sig) => cp.kill(sig),
        onExit: (cb) => cp.on('exit', (c) => cb(c ?? 0)),
      };
    }

    this.proc.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuf += chunk.toString();
      let idx: number;
      while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
        const line = this.stdoutBuf.slice(0, idx).trim();
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (line) this.handleMessage(line);
      }
    });

    this.proc.onExit((code) => {
      this.proc = null;
      this.events.emit('exit', code);
      for (const { reject } of this.pending.values()) {
        reject(new Error(`ACP process exited with code ${code}`));
      }
      this.pending.clear();
    });

    return this.proc;
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to client request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server request (e.g. session/request_permission)
    if (msg.method && msg.id !== undefined) {
      this.handleServerRequest(msg);
      return;
    }

    // Server notification (e.g. session/update)
    if (msg.method === 'session/update' && msg.params?.update) {
      this.events.emit('update', msg.params.update);
    }
  }

  private async handleServerRequest(msg: JsonRpcRequest<any>): Promise<void> {
    if (msg.method === 'session/request_permission') {
      const params = msg.params as RequestPermissionParams;
      let optionId: string | null = null;
      if (this.permissionHandler) {
        try {
          optionId = await this.permissionHandler(params);
        } catch {
          optionId = null;
        }
      }
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: optionId
          ? { outcome: { outcome: 'selected', optionId } }
          : { outcome: { outcome: 'cancelled' } },
      };
      this.sendRaw(response);
    } else {
      // Unknown request - send empty ok or error
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {},
      };
      this.sendRaw(response);
    }
  }

  private sendRaw(obj: unknown): void {
    const proc = this.ensureProcess();
    proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  private request<TRes, TParams = unknown>(method: string, params?: TParams, timeoutMs = 60000): Promise<TRes> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify<TParams = unknown>(method: string, params?: TParams): void {
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }

  onRequestPermission(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  onUpdate(cb: (update: SessionUpdateNotification) => void): void {
    this.events.on('update', cb);
  }

  onExit(cb: (code: number) => void): void {
    this.events.on('exit', cb);
  }

  async initialize(): Promise<InitializeResult> {
    return this.request<InitializeResult, InitializeParams>('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
  }

  async newSession(cwd: string): Promise<SessionNewResult> {
    return this.request<SessionNewResult, SessionNewParams>('session/new', { cwd, mcpServers: [] });
  }

  async listSessions(cwd?: string): Promise<SessionListResult> {
    return this.request<SessionListResult, SessionListParams>('session/list', { cwd });
  }

  async loadSession(sessionId: string, cwd?: string): Promise<SessionLoadResult> {
    return this.request<SessionLoadResult, SessionLoadParams>('session/load', { sessionId, cwd });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetConfigOptionResult> {
    return this.request<SetConfigOptionResult, SetConfigOptionParams>('session/set_config_option', {
      sessionId,
      configId,
      value,
    });
  }

  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<SessionPromptResult> {
    return this.request<SessionPromptResult, SessionPromptParams>('session/prompt', { sessionId, prompt }, 300000);
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }

  dispose(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}
```

- [ ] **Step 4: 运行单元测试确认通过**

Run: `npm run test:unit`
Expected: 全部测试通过 (24 pass / 0 fail)

- [ ] **Step 5: Commit**

```bash
git add src/host/acp/client.ts test/unit/acpClient.test.ts
git commit -m "feat(acp): implement AcpClient with JSON-RPC stdio protocol and unit tests"
```

---

### Task 3: 模式-模型联动预设解析器 (ModePresetResolver) 与单测

**Files:**
- Create: `src/host/acp/modePresets.ts`
- Create: `test/unit/modePresets.test.ts`

- [ ] **Step 1: 编写失败的单元测试 `test/unit/modePresets.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModePresetResolver, type ModePresetConfig } from '../../src/host/acp/modePresets.js';

test('ModePresetResolver returns preset model and thinking for configured mode', () => {
  const config: ModePresetConfig = {
    default: { model: 'claude-sonnet-4-5', thinking: 'high' },
    plan: { model: 'claude-opus-4-6', thinking: 'max' }
  };
  const resolver = new ModePresetResolver(() => config);

  const planPreset = resolver.getPresetForMode('plan');
  assert.deepEqual(planPreset, { model: 'claude-opus-4-6', thinking: 'max' });

  const defaultPreset = resolver.getPresetForMode('default');
  assert.deepEqual(defaultPreset, { model: 'claude-sonnet-4-5', thinking: 'high' });

  const unknownPreset = resolver.getPresetForMode('unknown');
  assert.equal(unknownPreset, undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit`
Expected: FAIL (`Cannot find module .../modePresets.js`)

- [ ] **Step 3: 实现 `src/host/acp/modePresets.ts`**

```ts
export interface ModePresetItem {
  model?: string;
  thinking?: string;
}

export type ModePresetConfig = Record<string, ModePresetItem>;

export class ModePresetResolver {
  constructor(private readonly getConfig: () => ModePresetConfig) {}

  getPresetForMode(mode: string): ModePresetItem | undefined {
    const cfg = this.getConfig() || {};
    return cfg[mode];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:unit`
Expected: 全部测试通过 (25 pass / 0 fail)

- [ ] **Step 5: Commit**

```bash
git add src/host/acp/modePresets.ts test/unit/modePresets.test.ts
git commit -m "feat(acp): implement ModePresetResolver for mode-to-model switching"
```

---

### Task 4: Chat 视图通信协议与 esbuild 配置

**Files:**
- Create: `src/webview/chatProtocol.ts`
- Modify: `esbuild.mjs`

- [ ] **Step 1: 创建 `src/webview/chatProtocol.ts`**

```ts
import type {
  ConfigOption,
  SessionSummary,
  ToolCallPayload,
  PermissionOption,
  ContentBlock,
} from '../host/acp/types.js';

export interface ChatAttachment {
  name: string;
  uri: string;
  kind: 'file' | 'image';
  mimeType?: string;
  content: string; // text or base64
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  thought?: string;
  thoughtDurationSec?: number;
  attachments?: Array<{ name: string; kind: 'file' | 'image' }>;
  toolCalls?: ToolCallPayload[];
  isStreaming?: boolean;
  timestamp: number;
}

/** Webview -> Host */
export type ChatHostMessage =
  | { type: 'ready' }
  | { type: 'newSession' }
  | { type: 'loadSession'; sessionId: string }
  | { type: 'listSessions' }
  | { type: 'setMode'; mode: string }
  | { type: 'setThinking'; thinking: string }
  | { type: 'setModel'; model: string }
  | { type: 'prompt'; text: string; attachments: ChatAttachment[] }
  | { type: 'cancel' }
  | { type: 'respondPermission'; toolCallId: string; optionId: string | null }
  | { type: 'pickAttachment'; kind: 'file' | 'image' };

/** Host -> Webview */
export type ChatWebviewMessage =
  | {
      type: 'sessionState';
      sessionId: string;
      configOptions: ConfigOption[];
      messages: ChatMessageItem[];
    }
  | { type: 'sessionsList'; sessions: SessionSummary[] }
  | { type: 'thoughtChunk'; text: string }
  | { type: 'messageChunk'; text: string }
  | { type: 'toolCall'; toolCall: ToolCallPayload }
  | { type: 'toolCallUpdate'; toolCallId: string; status: string; rawOutput?: unknown }
  | {
      type: 'permissionRequest';
      toolCallId: string;
      toolCall: ToolCallPayload;
      options: PermissionOption[];
    }
  | { type: 'promptDone'; stopReason?: string; usage?: { totalTokens?: number; cost?: number } }
  | { type: 'attachmentPicked'; attachment: ChatAttachment }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 更新 `esbuild.mjs` 添加 chat 视图编译入口**

```js
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const host = {
  entryPoints: ['src/host/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'node-pty'],
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const terminalWebview = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outdir: 'dist/webview',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const chatWebview = {
  entryPoints: ['src/webview/chat/main.ts'],
  bundle: true,
  outdir: 'dist/webview/chat',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

if (watch) {
  const ctx1 = await context(host);
  const ctx2 = await context(terminalWebview);
  const ctx3 = await context(chatWebview);
  await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch()]);
} else {
  await build(host);
  await build(terminalWebview);
  await build(chatWebview);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/webview/chatProtocol.ts esbuild.mjs
git commit -m "feat(chat): define chat webview protocol and update esbuild config"
```

---

### Task 5: AcpChatViewProvider 实现

**Files:**
- Create: `src/host/acpChatViewProvider.ts`

- [ ] **Step 1: 实现 `src/host/acpChatViewProvider.ts`**

```ts
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AcpClient } from './acp/client.js';
import { ModePresetResolver } from './acp/modePresets.js';
import type {
  ChatHostMessage,
  ChatWebviewMessage,
  ChatMessageItem,
  ChatAttachment,
} from '../webview/chatProtocol.js';
import type { ContentBlock, RequestPermissionParams } from './acp/types.js';

export class AcpChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'omp.chatView';
  private view?: vscode.WebviewView;
  private currentSessionId: string | null = null;
  private messages: ChatMessageItem[] = [];
  private pendingPermissions = new Map<string, (optionId: string | null) => void>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly acp: AcpClient,
    private readonly presetResolver: ModePresetResolver,
  ) {
    this.setupAcpListeners();
  }

  private setupAcpListeners(): void {
    this.acp.onUpdate((update) => {
      if (update.sessionUpdate === 'agent_thought_chunk') {
        this.postMessage({ type: 'thoughtChunk', text: update.content.text });
      } else if (update.sessionUpdate === 'agent_message_chunk') {
        this.postMessage({ type: 'messageChunk', text: update.content.text });
      } else if (update.sessionUpdate === 'tool_call') {
        this.postMessage({ type: 'toolCall', toolCall: update as any });
      } else if (update.sessionUpdate === 'tool_call_update') {
        this.postMessage({
          type: 'toolCallUpdate',
          toolCallId: update.toolCallId,
          status: update.status,
          rawOutput: update.rawOutput,
        });
      }
    });

    this.acp.onRequestPermission((params: RequestPermissionParams) => {
      return new Promise<string | null>((resolve) => {
        const id = params.toolCall.toolCallId;
        this.pendingPermissions.set(id, resolve);
        this.postMessage({
          type: 'permissionRequest',
          toolCallId: id,
          toolCall: params.toolCall,
          options: params.options,
        });
      });
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.ctx.extensionUri],
    };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((m: ChatHostMessage) => {
      this.handleWebviewMessage(m);
    });

    this.view = view;
  }

  private postMessage(msg: ChatWebviewMessage): void {
    void this.view?.webview.postMessage(msg);
  }

  private async handleWebviewMessage(m: ChatHostMessage): Promise<void> {
    try {
      switch (m.type) {
        case 'ready': {
          await this.acp.initialize();
          if (!this.currentSessionId) {
            await this.createNewSession();
          } else {
            await this.syncSessionState();
          }
          break;
        }
        case 'newSession': {
          await this.createNewSession();
          break;
        }
        case 'listSessions': {
          const cwd = this.getWorkspaceRoot();
          const res = await this.acp.listSessions(cwd);
          this.postMessage({ type: 'sessionsList', sessions: res.sessions || [] });
          break;
        }
        case 'loadSession': {
          const res = await this.acp.loadSession(m.sessionId, this.getWorkspaceRoot());
          this.currentSessionId = res.sessionId;
          this.messages = [];
          this.postMessage({
            type: 'sessionState',
            sessionId: res.sessionId,
            configOptions: res.configOptions || [],
            messages: this.messages,
          });
          break;
        }
        case 'setMode': {
          if (!this.currentSessionId) return;
          const res = await this.acp.setConfigOption(this.currentSessionId, 'mode', m.mode);
          // Apply Mode -> Model/Thinking preset
          const preset = this.presetResolver.getPresetForMode(m.mode);
          if (preset?.model) {
            await this.acp.setConfigOption(this.currentSessionId, 'model', preset.model);
          }
          if (preset?.thinking) {
            await this.acp.setConfigOption(this.currentSessionId, 'thinking', preset.thinking);
          }
          await this.syncSessionState();
          break;
        }
        case 'setThinking': {
          if (!this.currentSessionId) return;
          await this.acp.setConfigOption(this.currentSessionId, 'thinking', m.thinking);
          await this.syncSessionState();
          break;
        }
        case 'setModel': {
          if (!this.currentSessionId) return;
          await this.acp.setConfigOption(this.currentSessionId, 'model', m.model);
          await this.syncSessionState();
          break;
        }
        case 'prompt': {
          if (!this.currentSessionId) return;
          const contentBlocks: ContentBlock[] = [];
          for (const att of m.attachments) {
            if (att.kind === 'image') {
              contentBlocks.push({
                type: 'image',
                mimeType: att.mimeType || 'image/png',
                data: att.content,
                uri: att.uri,
              });
            } else {
              contentBlocks.push({
                type: 'resource',
                resource: {
                  uri: att.uri,
                  mimeType: att.mimeType || 'text/plain',
                  text: att.content,
                },
              });
            }
          }
          if (m.text) {
            contentBlocks.push({ type: 'text', text: m.text });
          }

          const res = await this.acp.prompt(this.currentSessionId, contentBlocks);
          this.postMessage({
            type: 'promptDone',
            stopReason: res.stopReason,
            usage: {
              totalTokens: res.usage?.totalTokens,
            },
          });
          break;
        }
        case 'cancel': {
          if (this.currentSessionId) {
            this.acp.cancel(this.currentSessionId);
          }
          break;
        }
        case 'respondPermission': {
          const cb = this.pendingPermissions.get(m.toolCallId);
          if (cb) {
            this.pendingPermissions.delete(m.toolCallId);
            cb(m.optionId);
          }
          break;
        }
        case 'pickAttachment': {
          await this.pickAttachment(m.kind);
          break;
        }
      }
    } catch (e) {
      this.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private async createNewSession(): Promise<void> {
    const cwd = this.getWorkspaceRoot();
    const res = await this.acp.newSession(cwd);
    this.currentSessionId = res.sessionId;
    this.messages = [];

    // Apply default mode presets
    const defaultMode = vscode.workspace.getConfiguration('omp.chat').get<string>('defaultMode', 'default');
    if (defaultMode !== 'default') {
      await this.acp.setConfigOption(res.sessionId, 'mode', defaultMode);
      const preset = this.presetResolver.getPresetForMode(defaultMode);
      if (preset?.model) await this.acp.setConfigOption(res.sessionId, 'model', preset.model);
      if (preset?.thinking) await this.acp.setConfigOption(res.sessionId, 'thinking', preset.thinking);
    }

    await this.syncSessionState();
  }

  private async syncSessionState(): Promise<void> {
    if (!this.currentSessionId) return;
    const loadRes = await this.acp.loadSession(this.currentSessionId, this.getWorkspaceRoot());
    this.postMessage({
      type: 'sessionState',
      sessionId: this.currentSessionId,
      configOptions: loadRes.configOptions || [],
      messages: this.messages,
    });
  }

  private async pickAttachment(kind: 'file' | 'image'): Promise<void> {
    const filters = kind === 'image'
      ? { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
      : { 'All Files': ['*'] };

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters,
    });

    if (uris && uris[0]) {
      const fileUri = uris[0];
      const filePath = fileUri.fsPath;
      const fileName = path.basename(filePath);

      if (kind === 'image') {
        const data = fs.readFileSync(filePath).toString('base64');
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        this.postMessage({
          type: 'attachmentPicked',
          attachment: {
            name: fileName,
            uri: fileUri.toString(),
            kind: 'image',
            mimeType,
            content: data,
          },
        });
      } else {
        const text = fs.readFileSync(filePath, 'utf8');
        this.postMessage({
          type: 'attachmentPicked',
          attachment: {
            name: fileName,
            uri: fileUri.toString(),
            kind: 'file',
            mimeType: 'text/plain',
            content: text,
          },
        });
      }
    }
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath || process.cwd();
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID();
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'chat', 'main.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'chat', 'main.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/host/acpChatViewProvider.ts
git commit -m "feat(chat): implement AcpChatViewProvider for Chat Webview View"
```

---

### Task 6: Chat Webview 前端 UI 实现 (Claude Code 风格)

**Files:**
- Create: `src/webview/chat/main.ts`

- [ ] **Step 1: 实现完整的 `src/webview/chat/main.ts`**

```ts
import type {
  ChatHostMessage,
  ChatWebviewMessage,
  ChatMessageItem,
  ChatAttachment,
} from '../chatProtocol.js';
import type { ConfigOption, PermissionOption, ToolCallPayload } from '../../host/acp/types.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// App State
let sessionId = '';
let configOptions: ConfigOption[] = [];
let messages: ChatMessageItem[] = [];
let attachments: ChatAttachment[] = [];
let isGenerating = false;
let currentThinkingEl: HTMLElement | null = null;
let currentMessageEl: HTMLElement | null = null;

const app = document.getElementById('app')!;

function post(msg: ChatHostMessage): void {
  vscode.postMessage(msg);
}

// Render Main App Skeleton
app.innerHTML = `
  <div class="chat-container">
    <!-- Header -->
    <div class="chat-header">
      <button id="btn-history" class="icon-btn" title="历史会话">≡ 历史</button>
      <button id="btn-new" class="icon-btn" title="新建会话">＋ 新建</button>
      <div class="spacer"></div>
      <span id="badge-mode" class="badge">Mode</span>
      <span id="badge-model" class="badge">Model</span>
    </div>

    <!-- History Drawer (hidden by default) -->
    <div id="history-drawer" class="drawer hidden">
      <div class="drawer-header">
        <span>历史会话</span>
        <button id="btn-close-history" class="icon-btn">✕</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </div>

    <!-- Messages Flow -->
    <div id="messages-flow" class="messages-flow">
      <div id="welcome-view" class="welcome-view">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 5h16v2.5h-4.8V19h-2.4V7.5H9.2V19H6.8V7.5H4V5z"/>
        </svg>
        <h2>Oh My Pi</h2>
        <p>Your AI coding partner in VS Code</p>
      </div>
    </div>

    <!-- Bottom Input Area -->
    <div class="input-area">
      <!-- Attachment Pills -->
      <div id="attachment-pills" class="attachment-pills hidden"></div>

      <!-- Textarea Box -->
      <div class="input-box">
        <textarea id="prompt-input" rows="1" placeholder="发送消息给 Oh My Pi... (Shift+Enter 换行)"></textarea>

        <!-- Input Toolbar -->
        <div class="input-toolbar">
          <div class="left-tools">
            <button id="btn-attach" class="tool-btn" title="添加文件或图片">＋</button>
            <div class="popover-wrapper">
              <button id="btn-mode" class="tool-btn select-btn">⚡ 模式▾</button>
              <div id="popover-mode" class="popover hidden"></div>
            </div>
            <div class="popover-wrapper">
              <button id="btn-think" class="tool-btn select-btn">🧠 思考▾</button>
              <div id="popover-think" class="popover hidden"></div>
            </div>
            <div class="popover-wrapper">
              <button id="btn-model" class="tool-btn select-btn">🤖 模型▾</button>
              <div id="popover-model" class="popover model-popover hidden">
                <input type="text" id="model-search" placeholder="搜索模型..." />
                <div id="model-list" class="popover-list"></div>
              </div>
            </div>
          </div>
          <div class="right-tools">
            <button id="btn-send" class="send-btn" title="发送 (Enter)">➤</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

// Elements
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const btnSend = document.getElementById('btn-send') as HTMLButtonElement;
const attachmentPills = document.getElementById('attachment-pills')!;
const messagesFlow = document.getElementById('messages-flow')!;
const welcomeView = document.getElementById('welcome-view')!;

// Auto-grow textarea
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
});

// Send handler
function handleSend(): void {
  const text = promptInput.value.trim();
  if (!text && attachments.length === 0) return;
  if (isGenerating) {
    post({ type: 'cancel' });
    return;
  }

  // Render User Message
  appendUserMessage(text, [...attachments]);

  post({
    type: 'prompt',
    text,
    attachments: [...attachments],
  });

  promptInput.value = '';
  promptInput.style.height = 'auto';
  attachments = [];
  renderAttachmentPills();
  setGenerating(true);
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
btnSend.onclick = handleSend;

function setGenerating(generating: boolean): void {
  isGenerating = generating;
  btnSend.textContent = generating ? '◼' : '➤';
  btnSend.classList.toggle('stop-btn', generating);
}

// User Message DOM
function appendUserMessage(text: string, atts: ChatAttachment[]): void {
  welcomeView.classList.add('hidden');
  const div = document.createElement('div');
  div.className = 'message user-message';
  let attHtml = '';
  if (atts.length > 0) {
    attHtml = `<div class="msg-attachments">${atts
      .map((a) => `<span class="pill">${a.kind === 'image' ? '🖼️' : '📄'} ${escapeHtml(a.name)}</span>`)
      .join('')}</div>`;
  }
  div.innerHTML = `${attHtml}<div class="msg-text">${escapeHtml(text)}</div>`;
  messagesFlow.appendChild(div);
  scrollToBottom();
}

// Assistant Message DOM
function ensureAssistantMessage(): HTMLElement {
  welcomeView.classList.add('hidden');
  let last = messagesFlow.lastElementChild as HTMLElement;
  if (!last || !last.classList.contains('assistant-message')) {
    last = document.createElement('div');
    last.className = 'message assistant-message';
    messagesFlow.appendChild(last);
  }
  return last;
}

function appendThoughtChunk(text: string): void {
  const container = ensureAssistantMessage();
  if (!currentThinkingEl) {
    currentThinkingEl = document.createElement('details');
    currentThinkingEl.className = 'thinking-block';
    currentThinkingEl.open = true;
    currentThinkingEl.innerHTML = `<summary>💭 正在思考...</summary><div class="thinking-content"></div>`;
    container.appendChild(currentThinkingEl);
  }
  const content = currentThinkingEl.querySelector('.thinking-content')!;
  content.textContent += text;
  scrollToBottom();
}

function appendMessageChunk(text: string): void {
  if (currentThinkingEl && currentThinkingEl.open) {
    currentThinkingEl.open = false;
    currentThinkingEl.querySelector('summary')!.textContent = '💭 思考过程 (已折叠)';
  }
  const container = ensureAssistantMessage();
  if (!currentMessageEl) {
    currentMessageEl = document.createElement('div');
    currentMessageEl.className = 'assistant-text';
    container.appendChild(currentMessageEl);
  }
  currentMessageEl.textContent += text;
  scrollToBottom();
}

function appendToolCall(toolCall: ToolCallPayload): void {
  const container = ensureAssistantMessage();
  const el = document.createElement('div');
  el.className = 'tool-card';
  el.id = `tool-${toolCall.toolCallId}`;
  el.innerHTML = `
    <div class="tool-header">
      <span class="tool-title">🛠️ ${escapeHtml(toolCall.title || toolCall.kind || 'Tool Call')}</span>
      <span class="tool-status status-${toolCall.status}">⏳ 运行中</span>
    </div>
    ${toolCall.rawInput ? `<pre class="tool-input">${escapeHtml(JSON.stringify(toolCall.rawInput, null, 2))}</pre>` : ''}
  `;
  container.appendChild(el);
  scrollToBottom();
}

function updateToolCall(toolCallId: string, status: string, rawOutput?: unknown): void {
  const el = document.getElementById(`tool-${toolCallId}`);
  if (!el) return;
  const statusEl = el.querySelector('.tool-status')!;
  statusEl.className = `tool-status status-${status}`;
  statusEl.textContent = status === 'completed' ? '✓ 完成' : status === 'failed' ? '✕ 失败' : status;
  if (rawOutput) {
    let outEl = el.querySelector('.tool-output');
    if (!outEl) {
      outEl = document.createElement('pre');
      outEl.className = 'tool-output';
      el.appendChild(outEl);
    }
    outEl.textContent = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);
  }
}

function appendPermissionCard(toolCallId: string, toolCall: ToolCallPayload, options: PermissionOption[]): void {
  const container = ensureAssistantMessage();
  const card = document.createElement('div');
  card.className = 'permission-card';
  card.id = `perm-${toolCallId}`;
  card.innerHTML = `
    <div class="perm-header">⚠️ 权限请求：${escapeHtml(toolCall.title || toolCall.kind || '执行操作')}</div>
    ${toolCall.rawInput ? `<pre class="perm-input">${escapeHtml(JSON.stringify(toolCall.rawInput, null, 2))}</pre>` : ''}
    <div class="perm-actions">
      ${options
        .map((opt) => `<button class="perm-btn opt-${opt.kind}" data-opt="${opt.optionId}">${escapeHtml(opt.name)}</button>`)
        .join('')}
    </div>
  `;

  card.querySelectorAll('.perm-btn').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const optId = btn.getAttribute('data-opt');
      post({ type: 'respondPermission', toolCallId, optionId: optId });
      card.remove();
    };
  });

  container.appendChild(card);
  scrollToBottom();
}

function renderAttachmentPills(): void {
  if (attachments.length === 0) {
    attachmentPills.classList.add('hidden');
    attachmentPills.innerHTML = '';
    return;
  }
  attachmentPills.classList.remove('hidden');
  attachmentPills.innerHTML = attachments
    .map(
      (a, i) => `
    <span class="pill">
      ${a.kind === 'image' ? '🖼️' : '📄'} ${escapeHtml(a.name)}
      <button class="pill-remove" data-idx="${i}">✕</button>
    </span>
  `
    )
    .join('');

  attachmentPills.querySelectorAll('.pill-remove').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const idx = parseInt(btn.getAttribute('data-idx')!, 10);
      attachments.splice(idx, 1);
      renderAttachmentPills();
    };
  });
}

function scrollToBottom(): void {
  messagesFlow.scrollTop = messagesFlow.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Popover Handlers
document.getElementById('btn-attach')!.onclick = () => {
  post({ type: 'pickAttachment', kind: 'file' });
};

document.getElementById('btn-new')!.onclick = () => {
  messagesFlow.innerHTML = '';
  messagesFlow.appendChild(welcomeView);
  welcomeView.classList.remove('hidden');
  currentThinkingEl = null;
  currentMessageEl = null;
  post({ type: 'newSession' });
};

// Mode Popover
const btnMode = document.getElementById('btn-mode')!;
const popoverMode = document.getElementById('popover-mode')!;
btnMode.onclick = () => {
  closeAllPopoversExcept(popoverMode);
  popoverMode.classList.toggle('hidden');
};

function renderModePopover(modeOpt: ConfigOption): void {
  btnMode.textContent = `⚡ ${modeOpt.options?.find((o) => o.value === modeOpt.currentValue)?.name || modeOpt.currentValue}▾`;
  document.getElementById('badge-mode')!.textContent = String(modeOpt.currentValue);
  popoverMode.innerHTML = (modeOpt.options || [])
    .map(
      (o) => `
    <div class="popover-item ${o.value === modeOpt.currentValue ? 'active' : ''}" data-val="${o.value}">
      <div class="item-name">${escapeHtml(o.name)}</div>
      ${o.description ? `<div class="item-desc">${escapeHtml(o.description)}</div>` : ''}
    </div>
  `
    )
    .join('');

  popoverMode.querySelectorAll('.popover-item').forEach((item) => {
    (item as HTMLElement).onclick = () => {
      const val = item.getAttribute('data-val')!;
      post({ type: 'setMode', mode: val });
      popoverMode.classList.add('hidden');
    };
  });
}

// Think Popover
const btnThink = document.getElementById('btn-think')!;
const popoverThink = document.getElementById('popover-think')!;
btnThink.onclick = () => {
  closeAllPopoversExcept(popoverThink);
  popoverThink.classList.toggle('hidden');
};

function renderThinkPopover(thinkOpt: ConfigOption): void {
  btnThink.textContent = `🧠 ${thinkOpt.currentValue}▾`;
  popoverThink.innerHTML = (thinkOpt.options || [])
    .map(
      (o) => `
    <div class="popover-item ${o.value === thinkOpt.currentValue ? 'active' : ''}" data-val="${o.value}">
      <div class="item-name">${escapeHtml(o.name || o.value)}</div>
    </div>
  `
    )
    .join('');

  popoverThink.querySelectorAll('.popover-item').forEach((item) => {
    (item as HTMLElement).onclick = () => {
      const val = item.getAttribute('data-val')!;
      post({ type: 'setThinking', thinking: val });
      popoverThink.classList.add('hidden');
    };
  });
}

// Model Popover
const btnModel = document.getElementById('btn-model')!;
const popoverModel = document.getElementById('popover-model')!;
const modelList = document.getElementById('model-list')!;
const modelSearch = document.getElementById('model-search') as HTMLInputElement;

btnModel.onclick = () => {
  closeAllPopoversExcept(popoverModel);
  popoverModel.classList.toggle('hidden');
  modelSearch.focus();
};

function renderModelPopover(modelOpt: ConfigOption): void {
  const curr = String(modelOpt.currentValue);
  const shortName = curr.split('/').pop() || curr;
  btnModel.textContent = `🤖 ${shortName}▾`;
  document.getElementById('badge-model')!.textContent = shortName;

  const renderList = (filterText = '') => {
    const filtered = (modelOpt.options || []).filter(
      (o) => o.name.toLowerCase().includes(filterText) || o.value.toLowerCase().includes(filterText)
    );
    modelList.innerHTML = filtered
      .slice(0, 50)
      .map(
        (o) => `
      <div class="popover-item ${o.value === modelOpt.currentValue ? 'active' : ''}" data-val="${o.value}">
        <div class="item-name">${escapeHtml(o.name)}</div>
        <div class="item-desc">${escapeHtml(o.value)}</div>
      </div>
    `
      )
      .join('');

    modelList.querySelectorAll('.popover-item').forEach((item) => {
      (item as HTMLElement).onclick = () => {
        const val = item.getAttribute('data-val')!;
        post({ type: 'setModel', model: val });
        popoverModel.classList.add('hidden');
      };
    });
  };

  renderList();
  modelSearch.oninput = () => renderList(modelSearch.value.trim().toLowerCase());
}

function closeAllPopoversExcept(except?: HTMLElement): void {
  [popoverMode, popoverThink, popoverModel].forEach((p) => {
    if (p !== except) p.classList.add('hidden');
  });
}

// History Drawer
const btnHistory = document.getElementById('btn-history')!;
const historyDrawer = document.getElementById('history-drawer')!;
const btnCloseHistory = document.getElementById('btn-close-history')!;
const historyList = document.getElementById('history-list')!;

btnHistory.onclick = () => {
  historyDrawer.classList.remove('hidden');
  post({ type: 'listSessions' });
};
btnCloseHistory.onclick = () => historyDrawer.classList.add('hidden');

// Window Message Listener
window.addEventListener('message', (e: MessageEvent<ChatWebviewMessage>) => {
  const m = e.data;
  switch (m.type) {
    case 'sessionState': {
      sessionId = m.sessionId;
      configOptions = m.configOptions;
      const modeOpt = configOptions.find((x) => x.id === 'mode');
      if (modeOpt) renderModePopover(modeOpt);
      const thinkOpt = configOptions.find((x) => x.id === 'thinking');
      if (thinkOpt) renderThinkPopover(thinkOpt);
      const modelOpt = configOptions.find((x) => x.id === 'model');
      if (modelOpt) renderModelPopover(modelOpt);
      break;
    }
    case 'thoughtChunk': {
      appendThoughtChunk(m.text);
      break;
    }
    case 'messageChunk': {
      appendMessageChunk(m.text);
      break;
    }
    case 'toolCall': {
      appendToolCall(m.toolCall);
      break;
    }
    case 'toolCallUpdate': {
      updateToolCall(m.toolCallId, m.status, m.rawOutput);
      break;
    }
    case 'permissionRequest': {
      appendPermissionCard(m.toolCallId, m.toolCall, m.options);
      break;
    }
    case 'promptDone': {
      setGenerating(false);
      currentThinkingEl = null;
      currentMessageEl = null;
      break;
    }
    case 'attachmentPicked': {
      attachments.push(m.attachment);
      renderAttachmentPills();
      break;
    }
    case 'sessionsList': {
      historyList.innerHTML = m.sessions
        .map(
          (s) => `
        <div class="history-item ${s.sessionId === sessionId ? 'active' : ''}" data-id="${s.sessionId}">
          <div class="history-title">${escapeHtml(s.sessionId.slice(0, 8))} (${s._meta?.messageCount || 0} msgs)</div>
          <div class="history-date">${new Date(s.updatedAt).toLocaleString()}</div>
        </div>
      `
        )
        .join('');
      historyList.querySelectorAll('.history-item').forEach((item) => {
        (item as HTMLElement).onclick = () => {
          const sid = item.getAttribute('data-id')!;
          historyDrawer.classList.add('hidden');
          post({ type: 'loadSession', sessionId: sid });
        };
      });
      break;
    }
    case 'error': {
      setGenerating(false);
      const div = document.createElement('div');
      div.className = 'error-card';
      div.textContent = `❌ ${m.message}`;
      messagesFlow.appendChild(div);
      scrollToBottom();
      break;
    }
  }
});

// Styles
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  html, body, #app { height: 100%; margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  .chat-container { display: flex; flex-direction: column; height: 100%; position: relative; }
  .chat-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border); min-height: 32px; }
  .spacer { flex: 1; }
  .icon-btn { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 6px; font-size: 11px; border-radius: 3px; }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  
  .drawer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 50; background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  .drawer-header { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--vscode-widget-border); font-weight: bold; }
  .history-list { flex: 1; overflow-y: auto; padding: 8px; }
  .history-item { padding: 6px 10px; border-radius: 4px; cursor: pointer; margin-bottom: 4px; }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .history-title { font-size: 12px; font-weight: 500; }
  .history-date { font-size: 10px; opacity: 0.7; }

  .messages-flow { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .welcome-view { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); }
  .welcome-view h2 { margin: 8px 0 4px; color: var(--vscode-editor-foreground); }

  .message { display: flex; flex-direction: column; gap: 4px; max-width: 95%; }
  .user-message { align-self: flex-end; background: var(--vscode-input-background); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--vscode-input-border); }
  .assistant-message { align-self: flex-start; width: 100%; }
  .assistant-text { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }

  .thinking-block { border-left: 2px solid var(--vscode-focusBorder); padding: 4px 8px; margin: 4px 0; background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-focusBorder)); font-size: 11px; border-radius: 0 4px 4px 0; }
  .thinking-block summary { cursor: pointer; opacity: 0.8; font-weight: 500; }
  .thinking-content { margin-top: 4px; opacity: 0.75; white-space: pre-wrap; max-height: 150px; overflow-y: auto; }

  .tool-card { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 6px 10px; margin: 6px 0; background: var(--vscode-editorWidget-background); font-size: 12px; }
  .tool-header { display: flex; justify-content: space-between; font-weight: 500; }
  .tool-status.status-completed { color: var(--vscode-testing-iconPassed); }
  .tool-status.status-failed { color: var(--vscode-testing-iconFailed); }
  .tool-input, .tool-output { background: var(--vscode-textCodeBlock-background); padding: 4px 6px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 4px 0 0; }

  .permission-card { border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 12px; }
  .perm-header { font-weight: bold; margin-bottom: 4px; }
  .perm-input { font-size: 11px; margin: 4px 0; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 3px; }
  .perm-actions { display: flex; gap: 6px; margin-top: 6px; }
  .perm-btn { padding: 3px 8px; font-size: 11px; border-radius: 3px; border: none; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .perm-btn.opt-allow_once, .perm-btn.opt-allow_always { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

  .input-area { padding: 8px 10px; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-editor-background); }
  .attachment-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 6px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill-remove { background: transparent; border: none; color: inherit; cursor: pointer; padding: 0 2px; }
  
  .input-box { border: 1px solid var(--vscode-input-border); border-radius: 8px; background: var(--vscode-input-background); padding: 6px; display: flex; flex-direction: column; }
  .input-box:focus-within { border-color: var(--vscode-focusBorder); }
  #prompt-input { background: transparent; border: none; outline: none; color: var(--vscode-input-foreground); font-family: inherit; font-size: 13px; resize: none; width: 100%; min-height: 24px; }

  .input-toolbar { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
  .left-tools { display: flex; gap: 4px; align-items: center; }
  .tool-btn { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 6px; font-size: 11px; border-radius: 4px; opacity: 0.85; }
  .tool-btn:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
  .select-btn { border: 1px solid var(--vscode-widget-border); }

  .popover-wrapper { position: relative; }
  .popover { position: absolute; bottom: 28px; left: 0; z-index: 40; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); min-width: 140px; max-height: 220px; overflow-y: auto; padding: 4px; }
  .popover-item { padding: 4px 8px; font-size: 11px; border-radius: 3px; cursor: pointer; }
  .popover-item:hover { background: var(--vscode-list-hoverBackground); }
  .popover-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .item-desc { font-size: 10px; opacity: 0.65; }

  .model-popover { min-width: 220px; max-height: 260px; display: flex; flex-direction: column; }
  #model-search { padding: 4px 6px; font-size: 11px; margin-bottom: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
  .popover-list { flex: 1; overflow-y: auto; }

  .send-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
  .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  .send-btn.stop-btn { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
  
  .error-card { color: var(--vscode-errorForeground); padding: 6px; font-size: 12px; }
  .hidden { display: none !important; }
`;
document.head.appendChild(style);

post({ type: 'ready' });
```

- [ ] **Step 2: 验证编译与构建**

Run: `npm run compile && npm run typecheck`
Expected: `dist/webview/chat/main.js` + `dist/webview/chat/main.css` 编译产出，类型检查 0 错误。

- [ ] **Step 3: Commit**

```bash
git add src/webview/chat/main.ts
git commit -m "feat(chat): implement Claude Code style interactive chat webview client"
```

---

### Task 7: package.json 声明与 extension.ts 激活装配

**Files:**
- Modify: `package.json`
- Modify: `src/host/extension.ts`

- [ ] **Step 1: 更新 `package.json`**

在 `contributes.views.omp-sidebar` 中添加 `Chat` 视图为第一项，`Terminal` 为第二项；添加 `omp.chat.modePresets` 等设置项：

```json
{
  "contributes": {
    "views": {
      "omp-sidebar": [
        {
          "type": "webview",
          "id": "omp.chatView",
          "name": "Chat"
        },
        {
          "type": "webview",
          "id": "omp.sidebarTerminal",
          "name": "Terminal"
        }
      ]
    },
    "configuration": {
      "title": "Oh My Pi",
      "properties": {
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
          "description": "Default mode for new chat sessions"
        }
      }
    }
  }
}
```

- [ ] **Step 2: 更新 `src/host/extension.ts` 注册 Chat View**

```ts
import * as vscode from 'vscode';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { SessionManager } from './sessionManager.js';
import { NodePtyFactory } from './pty.js';
import { resolveOmpExecutable } from './executable.js';
import { OmpViewProvider } from './webviewViewProvider.js';
import { openOmpInEditor } from './editorTerminal.js';
import { forwardKey } from './keyForwarder.js';
import { AcpClient } from './acp/client.js';
import { ModePresetResolver, type ModePresetConfig } from './acp/modePresets.js';
import { AcpChatViewProvider } from './acpChatViewProvider.js';

export interface OmpExtensionApi {
  manager: SessionManager;
  acpClient: AcpClient;
}

export function activate(context: vscode.ExtensionContext): OmpExtensionApi {
  const config = () => vscode.workspace.getConfiguration('omp');

  // --- ACP Chat View Setup ---
  const acpClient = new AcpClient();
  const presetResolver = new ModePresetResolver(() => {
    return vscode.workspace.getConfiguration('omp.chat').get<ModePresetConfig>('modePresets', {
      default: { model: 'google-antigravity/claude-sonnet-4-5', thinking: 'high' },
      plan: { model: 'google-antigravity/claude-opus-4-6', thinking: 'max' },
    });
  });
  const chatProvider = new AcpChatViewProvider(context, acpClient, presetResolver);

  // --- Terminal TUI Setup ---
  const factory = new NodePtyFactory();
  const ptyError = factory.loadError
    ? `node-pty could not be loaded (${factory.loadError}). The sidebar terminal is unavailable; "OMP: Open in Editor Tab" still works.`
    : null;

  let executable = 'omp';
  let executableError: string | null = null;
  try {
    executable = resolveOmpExecutable(config().get('executablePath'), {
      existsSync,
      env: process.env,
      platform: process.platform,
    });
  } catch (e) {
    executableError = e instanceof Error ? e.message : String(e);
  }

  const folders = () => vscode.workspace.workspaceFolders;
  const spawnError = executableError ?? ptyError;

  const manager = new SessionManager({
    factory,
    executable,
    cwd: () => folders()?.[0]?.uri.fsPath ?? os.homedir(),
    defaultArgs: () => {
      const extra = config().get<string[]>('defaultArgs', []);
      return folders() ? extra : [...extra, '--allow-home'];
    },
    env: () => ({ ...process.env } as Record<string, string>),
  });

  const terminalProvider = new OmpViewProvider(
    context,
    manager,
    spawnError,
    () => ({
      fontFamily:
        config().get<string>('fontFamily', '') ||
        vscode.workspace.getConfiguration('terminal.integrated').get<string>('fontFamily', '') ||
        'var(--vscode-editor-font-family), Consolas, monospace',
      scrollback: config().get<number>('scrollback', 5000),
    }),
  );

  manager.onCreated((e) => terminalProvider.post({ type: 'created', session: e.session, activeId: e.activeId }));
  manager.onOutput((e) => terminalProvider.post({ type: 'output', sessionId: e.sessionId, data: e.data }));
  manager.onExit((e) => terminalProvider.post({ type: 'exit', sessionId: e.sessionId, code: e.code }));
  manager.onClosed((e) => terminalProvider.post({ type: 'closed', sessionId: e.sessionId }));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AcpChatViewProvider.viewId, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(OmpViewProvider.viewId, terminalProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('omp-vscode.newSession', () => {
      terminalProvider.reveal();
      try {
        manager.create();
      } catch (e) {
        terminalProvider.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }),
    vscode.commands.registerCommand('omp-vscode.focus', () => {
      void vscode.commands.executeCommand('omp.chatView.focus');
    }),
    vscode.commands.registerCommand('omp-vscode.openInEditor', () => {
      if (executableError) {
        void vscode.window.showErrorMessage(executableError);
        return;
      }
      openOmpInEditor(context, executable, config().get<string[]>('defaultArgs', []));
    }),
    vscode.commands.registerCommand('omp-vscode.forwardKey', (chord: string) => {
      void forwardKey(chord, terminalProvider);
    }),
    {
      dispose: () => {
        manager.disposeAll();
        acpClient.dispose();
      },
    },
  );

  return { manager, acpClient };
}

export function deactivate(): void {}
```

- [ ] **Step 3: 运行完整构建与单测**

Run: `npm run compile && npm run typecheck && npm run test:unit`
Expected: 25/25 单元测试通过，编译与类型检查全绿。

- [ ] **Step 4: Commit**

```bash
git add package.json src/host/extension.ts
git commit -m "feat(chat): wire AcpChatViewProvider, update manifest views and presets"
```

---

### Task 8: 集成 Smoke 测试、打包与安装

**Files:**
- Create: `test/integration/acpChat.test.ts`

- [ ] **Step 1: 编写集成测试 `test/integration/acpChat.test.ts`**

```ts
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { OmpExtensionApi } from '../../src/host/extension.js';

const EXT_ID = 'omp-dev.oh-my-pi-vscode';

suite('omp acp chat integration smoke', () => {
  test('activates extension and initializes acp client', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    const api = (await ext.activate()) as OmpExtensionApi;
    assert.ok(api.acpClient, 'activate() must return { acpClient }');

    const init = await api.acpClient.initialize();
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.agentInfo?.name, 'oh-my-pi');

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const session = await api.acpClient.newSession(cwd);
    assert.ok(session.sessionId);

    // Test mode switch
    const setMode = await api.acpClient.setConfigOption(session.sessionId, 'mode', 'plan');
    const modeVal = setMode.configOptions.find((x) => x.id === 'mode')?.currentValue;
    assert.equal(modeVal, 'plan');
  }).timeout(30_000);
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npm run test:integration`
Expected: 3 passing (terminal smoke + acp chat smoke)

- [ ] **Step 3: 升级版本、重新打包 `.vsix` 并安装**

Run:
```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='0.2.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
npx vsce package --allow-missing-repository
"C:/Users/Administrator/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd" --install-extension "F:/Code/oh-my-pi-vscode/oh-my-pi-vscode-0.2.0.vsix"
```
Expected: `Extension 'oh-my-pi-vscode-0.2.0.vsix' was successfully installed.`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(release): package and install oh-my-pi-vscode v0.2.0 with ACP Chat UI"
```

---

## Self-Review Check

- **Spec 覆盖**：ACP 协议、Mode-Model 联动预设、文件/图片附件、Thinking 折叠流、工具卡片、权限审批卡片、历史会话列表全部包含在各个 Task 中。
- **无占位符**：所有文件代码完整，包含详细逻辑与错误处理。
- **类型一致性**：`src/host/acp/types.ts` 与 `src/webview/chatProtocol.ts` 严格对齐。
