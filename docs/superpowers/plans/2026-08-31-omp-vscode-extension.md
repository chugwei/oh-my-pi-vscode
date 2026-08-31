# Oh My Pi for VS Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code 插件，在侧边栏 webview 内以 xterm.js + node-pty 完整运行 omp TUI，支持多会话标签页、恢复会话、编辑器区大窗终端与 Ctrl+P 键位透传。

**Architecture:** Extension host 侧 `SessionManager`（vscode-free，可注入假 pty 测试）经 node-pty 启动 omp；`OmpViewProvider` 在侧边栏 webview view 与 manager 之间按 postMessage 协议中转字节流；webview 侧 vanilla TS + xterm.js 渲染多标签终端。webview 销毁不杀进程，环形缓冲（4 MB/会话）支持重放重连。

**Tech Stack:** TypeScript、esbuild、`@xterm/xterm` + `@xterm/addon-fit`、`node-pty`（external，不打包）、`tsx` + `node:test`（单测）、`@vscode/test-cli`（集成 smoke）。

**环境事实（已验证）：**
- 本机 VS Code：`C:\Users\Administrator\AppData\Local\Programs\Microsoft VS Code\Code.exe`（v1.122.1）
- omp 18.0.11 在 PATH（`C:\Users\Administrator\AppData\Local\omp\omp.exe`）
- Node v24.14.1 / npm 11.11.0 / git 可用；`code` CLI 不在 PATH
- Spec：`docs/superpowers/specs/2026-08-31-omp-vscode-extension-design.md`

**约定：** 所有命令的工作目录均为仓库根 `F:/Code/oh-my-pi-vscode`。命令 ID 前缀 `omp-vscode.`；上下文键 `ompSidebarFocused`；扩展 ID `omp-dev.oh-my-pi-vscode`。

---

### Task 1: 项目脚手架（可编译的空扩展）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.mjs`
- Create: `media/icon.svg`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `.vscode/launch.json`
- Create: `src/host/extension.ts`（占位激活入口，Task 8 充实）

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "oh-my-pi-vscode",
  "displayName": "Oh My Pi",
  "description": "Run omp (Oh My Pi) TUI sessions in the VS Code sidebar",
  "version": "0.1.0",
  "publisher": "omp-dev",
  "license": "MIT",
  "type": "commonjs",
  "engines": {
    "vscode": "^1.94.0"
  },
  "categories": ["AI", "Other"],
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "omp-sidebar",
          "title": "Oh My Pi",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "omp-sidebar": [
        {
          "type": "webview",
          "id": "omp.sidebarTerminal",
          "name": "Sessions"
        }
      ]
    },
    "commands": [
      { "command": "omp-vscode.newSession", "title": "OMP: New Session", "icon": "$(add)" },
      { "command": "omp-vscode.openInEditor", "title": "OMP: Open in Editor Tab", "icon": "media/icon.svg" },
      { "command": "omp-vscode.focus", "title": "OMP: Focus Sidebar" },
      { "command": "omp-vscode.forwardKey", "title": "OMP: Forward Key (internal)" }
    ],
    "menus": {
      "view/title": [
        { "command": "omp-vscode.newSession", "group": "navigation", "when": "view == omp.sidebarTerminal" }
      ],
      "editor/title": [
        { "command": "omp-vscode.openInEditor", "group": "navigation" }
      ]
    },
    "keybindings": [
      { "command": "omp-vscode.focus", "key": "ctrl+alt+o", "mac": "cmd+alt+o" },
      { "command": "omp-vscode.openInEditor", "key": "ctrl+alt+shift+o", "mac": "cmd+alt+shift+o" },
      {
        "command": "omp-vscode.forwardKey",
        "args": ["ctrl+p"],
        "key": "ctrl+p",
        "when": "ompSidebarFocused"
      }
    ],
    "configuration": {
      "title": "Oh My Pi",
      "properties": {
        "omp.executablePath": {
          "type": "string",
          "default": "omp",
          "description": "Path to the omp executable. Leave 'omp' to use PATH; %LOCALAPPDATA%\\omp\\omp.exe is auto-detected on Windows."
        },
        "omp.defaultArgs": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Extra CLI args for every new omp session, e.g. [\"--thinking\",\"high\"]"
        },
        "omp.fontFamily": {
          "type": "string",
          "default": "",
          "description": "Terminal font family. Empty = follow terminal.integrated.fontFamily, then editor font."
        },
        "omp.scrollback": {
          "type": "number",
          "default": 5000,
          "description": "xterm.js scrollback lines per session"
        },
        "omp.passThroughKeys": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["ctrl+p"],
          "description": "Keys forwarded to the omp terminal when the sidebar is focused. Only pre-declared chords (currently 'ctrl+p') take effect; others fall back to VS Code defaults."
        }
      }
    }
  },
  "scripts": {
    "compile": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test:unit": "tsx --test test/unit/*.test.ts",
    "test:integration": "vscode-test"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.94.0",
    "@vscode/test-cli": "^0.0.10",
    "esbuild": "^0.24.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: 写 `esbuild.mjs`**

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
const webview = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outdir: 'dist/webview',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(host);
  const ctx2 = await context(webview);
  await Promise.all([ctx.watch(), ctx2.watch()]);
} else {
  await build(host);
  await build(webview);
}
```

- [ ] **Step 4: 写 `media/icon.svg`**（活动栏单色图标，π 双腿字形，用 currentColor）

```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 5h16v2.5h-4.8V19h-2.4V7.5H9.2V19H6.8V7.5H4V5z" fill="currentColor"/>
</svg>
```

- [ ] **Step 5: 写 `.gitignore` / `.vscodeignore` / `.vscode/launch.json`**

`.gitignore`:
```
node_modules/
dist/
out/
*.vsix
.vscode-test/
```

`.vscodeignore`:
```
.vscode/**
src/**
test/**
node_modules/@types/**
node_modules/.bin/**
node_modules/typescript/**
node_modules/esbuild/**
node_modules/tsx/**
esbuild.mjs
tsconfig.json
docs/**
```

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

同时建 `.vscode/tasks.json`（launch 依赖的 `npm: watch`）:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "npm: watch",
      "type": "npm",
      "script": "watch",
      "isBackground": true,
      "problemMatcher": "$esbuild-watch"
    }
  ]
}
```

- [ ] **Step 6: 写占位 `src/host/extension.ts`**

```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
  // wired up in Task 8
}

export function deactivate(): void {
  // wired up in Task 8
}
```

占位 `src/webview/main.ts`（让 esbuild webview 入口存在，Task 9 替换为完整实现）：

```ts
console.log('omp webview placeholder');
```

- [ ] **Step 7: 安装依赖并验证原生模块**

Run: `npm install`
Expected: 正常结束。随后运行 `node -e "require('node-pty'); console.log('node-pty OK')"`
Expected: 输出 `node-pty OK`。
若失败（缺 VS Build Tools / node-gyp 报错）：安装 Visual Studio Build Tools 2022（含 "Desktop development with C++" 工作负载与 Windows SDK）后重试 `npm rebuild node-pty`。此为本计划唯一原生依赖风险点。

- [ ] **Step 8: 编译 + 类型检查**

Run: `npm run compile && npm run typecheck`
Expected: esbuild 输出 `dist/extension.js` 与 `dist/webview/main.js`；tsc 无错误。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold omp vscode extension (manifest, esbuild, tsconfig)"
```

---

### Task 2: 共享协议类型

**Files:**
- Create: `src/webview/protocol.ts`

无运行时逻辑，纯类型；宿主与 webview 共同导入。类型一致性由 Task 5/8/9 的使用处与 typecheck 保证。

- [ ] **Step 1: 写 `src/webview/protocol.ts`**

```ts
export interface SessionInfo {
  id: string;
  title: string;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

export interface SnapshotPayload {
  sessions: SessionInfo[];
  activeId: string | null;
  replay: { sessionId: string; data: string }[];
}

export interface ConfigPayload {
  fontFamily: string;
  scrollback: number;
}

/** webview -> extension host */
export type HostMessage =
  | { type: 'ready' }
  | { type: 'new'; args?: string[] }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'close'; sessionId: string }
  | { type: 'switch'; sessionId: string }
  | { type: 'restart'; sessionId: string }
  | { type: 'focus'; value: boolean }
  | { type: 'openSettings' }
  | { type: 'key'; chord: string };

/** extension host -> webview */
export type WebviewMessage =
  | { type: 'snapshot' } & SnapshotPayload
  | { type: 'created'; session: SessionInfo; activeId: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'exit'; sessionId: string; code: number | null }
  | { type: 'closed'; sessionId: string }
  | { type: 'config' } & ConfigPayload
  | { type: 'error'; message: string };
```

- [ ] **Step 2: 验证 + Commit**

Run: `npm run typecheck`
Expected: 无错误。

```bash
git add src/webview/protocol.ts
git commit -m "feat: shared webview/host message protocol types"
```

---

### Task 3: omp 可执行文件解析（TDD）

**Files:**
- Create: `src/host/executable.ts`
- Test: `test/unit/executable.test.ts`

- [ ] **Step 1: 写失败测试 `test/unit/executable.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOmpExecutable } from '../../src/host/executable.js';

function deps(exists: string[], env: Record<string, string | undefined> = {}) {
  return {
    existsSync: (p: string) => exists.includes(p),
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', ...env },
    platform: 'win32' as const,
  };
}

test('settings override wins when the file exists', () => {
  const p = resolveOmpExecutable('D:\\tools\\omp.exe', deps(['D:\\tools\\omp.exe']));
  assert.equal(p, 'D:\\tools\\omp.exe');
});

test('settings override that does not exist throws', () => {
  assert.throws(() => resolveOmpExecutable('D:\\missing.exe', deps([])), /executablePath/);
});

test('default sentinel "omp" falls through to autodetect/PATH', () => {
  const p = resolveOmpExecutable('omp', deps([]));
  assert.equal(p, 'omp');
});

test('falls back to %LOCALAPPDATA% detection on win32', () => {
  const p = resolveOmpExecutable(undefined, deps(['C:\\Users\\x\\AppData\\Local\\omp\\omp.exe']));
  assert.equal(p, 'C:\\Users\\x\\AppData\\Local\\omp\\omp.exe');
});

test('no candidates -> bare "omp" for PATH resolution', () => {
  const p = resolveOmpExecutable(undefined, deps([]));
  assert.equal(p, 'omp');
});

test('non-win32 skips LOCALAPPDATA probing', () => {
  const p = resolveOmpExecutable(undefined, { ...deps(['C:\\Users\\x\\AppData\\Local\\omp\\omp.exe']), platform: 'linux' });
  assert.equal(p, 'omp');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit`
Expected: FAIL，`Cannot find module .../src/host/executable.js`。

- [ ] **Step 3: 写 `src/host/executable.ts`**

```ts
import * as path from 'node:path';

export interface ExecutableDeps {
  existsSync(p: string): boolean;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/**
 * Resolution order: settings override (must exist) -> %LOCALAPPDATA%\omp\omp.exe (win32)
 * -> bare "omp" (delegated to PATH at spawn time; a PATH miss surfaces as spawn error).
 */
export function resolveOmpExecutable(configured: string | undefined, deps: ExecutableDeps): string {
  const configuredPath = configured?.trim();
  if (configuredPath && configuredPath !== 'omp') {
    if (deps.existsSync(configuredPath)) {
      return configuredPath;
    }
    throw new Error(
      `omp.executablePath points to a file that does not exist: ${configuredPath}`,
    );
  }
  if (deps.platform === 'win32' && deps.env.LOCALAPPDATA) {
    const candidate = path.join(deps.env.LOCALAPPDATA, 'omp', 'omp.exe');
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'omp';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:unit`
Expected: 5 个测试全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/host/executable.ts test/unit/executable.test.ts
git commit -m "feat: omp executable resolver with settings/path/localappdata fallback"
```

---

### Task 4: 环形缓冲（TDD）

**Files:**
- Create: `src/host/ring.ts`
- Test: `test/unit/ring.test.ts`

- [ ] **Step 1: 写失败测试 `test/unit/ring.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RingBuffer } from '../../src/host/ring.js';

test('accumulates chunks in order', () => {
  const r = new RingBuffer(1000);
  r.push('a'); r.push('b');
  assert.equal(r.data(), 'ab');
});

test('drops oldest chunks once over capacity (chunk granularity)', () => {
  const r = new RingBuffer(10);
  r.push('aaaaa'); r.push('bbbbb'); r.push('ccccc');
  assert.equal(r.data(), 'bbbbbccccc');
});

test('always keeps the newest chunk even if larger than capacity', () => {
  const r = new RingBuffer(3);
  r.push('old'); r.push('0123456789');
  assert.equal(r.data(), '0123456789');
});

test('size reports byte length', () => {
  const r = new RingBuffer(100);
  r.push('hello');
  assert.equal(r.size(), 5);
});

test('empty push does not evict retained data', () => {
  const r = new RingBuffer(3);
  r.push('0123456789');
  r.push('');
  assert.equal(r.data(), '0123456789');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit`
Expected: 新增 4 个 FAIL（`Cannot find module .../ring.js`），Task 3 的仍然 PASS。

- [ ] **Step 3: 写 `src/host/ring.ts`**

```ts
/** Bounded byte buffer for terminal replay; eviction is chunk-granular (never splits a chunk). */
export class RingBuffer {
  private chunks: string[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  push(s: string): void {
    if (!s) return;
    this.chunks.push(s);
    this.total += s.length;
    while (this.total > this.maxBytes && this.chunks.length > 1) {
      this.total -= this.chunks[0].length;
      this.chunks.shift();
    }
  }

  data(): string {
    return this.chunks.join('');
  }

  size(): number {
    return this.total;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:unit`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/host/ring.ts test/unit/ring.test.ts
git commit -m "feat: chunk-granular ring buffer for session replay"
```

---

### Task 5: 会话管理器（TDD，核心模块）

**Files:**
- Create: `src/host/sessionManager.ts`
- Test: `test/unit/sessionManager.test.ts`

- [ ] **Step 1: 写失败测试 `test/unit/sessionManager.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  SessionManager,
  type PtyLike,
  type PtyFactory,
  type PtySpawnOptions,
} from '../../src/host/sessionManager.js';

class FakePty implements PtyLike {
  pid = 1;
  killed = false;
  written: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  spawnedWith: PtySpawnOptions | null = null;
  private dataCbs = new Set<(d: string) => void>();
  private exitCbs = new Set<(e: { exitCode: number; signal?: number }) => void>();

  write(d: string): void { this.written.push(d); }
  kill(): void {
    this.killed = true;
    this.exitCbs.forEach((cb) => cb({ exitCode: 0 }));
  }
  resize(cols: number, rows: number): void { this.resized.push({ cols, rows }); }
  onData(cb: (d: string) => void): { dispose(): void } {
    this.dataCbs.add(cb);
    return { dispose: () => this.dataCbs.delete(cb) };
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitCbs.add(cb);
    return { dispose: () => this.exitCbs.delete(cb) };
  }
  emitData(d: string): void { this.dataCbs.forEach((cb) => cb(d)); }
  emitExit(code: number): void { this.exitCbs.forEach((cb) => cb({ exitCode: code })); }
}

class FakeFactory implements PtyFactory {
  ptys: FakePty[] = [];
  spawn(opts: PtySpawnOptions): PtyLike {
    const p = new FakePty();
    p.spawnedWith = opts;
    this.ptys.push(p);
    return p;
  }
}

function makeManager(overrides: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}) {
  const factory = new FakeFactory();
  const manager = new SessionManager({
    factory,
    executable: 'omp',
    cwd: () => '/ws',
    defaultArgs: () => [],
    env: () => ({ PATH: '/bin' }),
    ringBytes: 1024,
    ...overrides,
  });
  return { factory, manager };
}

test('create spawns omp, emits created, becomes active', () => {
  const { factory, manager } = makeManager();
  const events: string[] = [];
  manager.onCreated(() => events.push('created'));
  const s = manager.create();
  assert.equal(factory.ptys.length, 1);
  assert.equal(factory.ptys[0].spawnedWith?.file, 'omp');
  assert.equal(factory.ptys[0].spawnedWith?.cwd, '/ws');
  assert.equal(factory.ptys[0].spawnedWith?.env.TERM, 'xterm-256color');
  assert.equal(manager.active, s.id);
  assert.deepEqual(events, ['created']);
});

test('default args and extra args are merged; -r title reflects resume', () => {
  const { manager } = makeManager({ defaultArgs: () => ['--thinking', 'high'] });
  const a = manager.create();
  const b = manager.create(['-r']);
  assert.equal(a.title, 'omp');
  assert.equal(b.title, 'omp (resume)');
  const snap = manager.snapshot();
  const resumed = snap.sessions.find((x) => x.id === b.id)!;
  assert.ok(resumed);
});

test('output events route to the right session and accumulate in ring', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const b = manager.create();
  const got: Array<{ sessionId: string; data: string }> = [];
  manager.onOutput((e) => got.push(e));
  factory.ptys[0].emitData('hello ');
  factory.ptys[1].emitData('world');
  assert.deepEqual(got, [
    { sessionId: a.id, data: 'hello ' },
    { sessionId: b.id, data: 'world' },
  ]);
  const replay = manager.snapshot().replay.find((r) => r.sessionId === a.id)!;
  assert.equal(replay.data, 'hello ');
});

test('write and resize route to the owning pty', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  manager.create();
  manager.write(a.id, 'ls\r');
  manager.resize(a.id, 120, 40);
  assert.deepEqual(factory.ptys[0].written, ['ls\r']);
  assert.deepEqual(factory.ptys[0].resized, [{ cols: 120, rows: 40 }]);
  assert.deepEqual(factory.ptys[1].resized, []);
});

test('exit marks session exited and emits exit event', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const exits: Array<{ sessionId: string; code: number | null }> = [];
  manager.onExit((e) => exits.push(e));
  factory.ptys[0].emitExit(3);
  assert.deepEqual(exits, [{ sessionId: a.id, code: 3 }]);
  const info = manager.snapshot().sessions.find((s) => s.id === a.id)!;
  assert.equal(info.exited, true);
  assert.equal(info.exitCode, 3);
});

test('close kills pty, removes session, active moves to remaining one', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const b = manager.create();
  const closed: string[] = [];
  manager.onClosed((e) => closed.push(e.sessionId));
  manager.close(a.id);
  assert.ok(factory.ptys[0].killed);
  assert.deepEqual(closed, [a.id]);
  assert.equal(manager.active, b.id);
  assert.equal(manager.snapshot().sessions.length, 1);
});

test('restart respawns with the same args under a new id', () => {
  const { factory, manager } = makeManager();
  const a = manager.create(['-r']);
  factory.ptys[0].emitExit(1);
  const b = manager.restart(a.id);
  assert.notEqual(b.id, a.id);
  assert.equal(b.title, 'omp (resume)');
  assert.equal(factory.ptys[1].spawnedWith?.args.includes('-r'), true);
  assert.equal(manager.snapshot().sessions.length, 1);
});

test('snapshot replay honors ring capacity', () => {
  const { factory, manager } = makeManager({ ringBytes: 10 });
  const a = manager.create();
  factory.ptys[0].emitData('aaaaa');
  factory.ptys[0].emitData('bbbbb');
  factory.ptys[0].emitData('ccccc');
  const replay = manager.snapshot().replay.find((r) => r.sessionId === a.id)!;
  assert.equal(replay.data, 'bbbbbccccc');
});

test('setActive only switches to known ids', () => {
  const { manager } = makeManager();
  manager.create();
  const second = manager.create(); // second create becomes active
  manager.setActive('nope');
  assert.equal(manager.active, second.id);
});

test('disposeAll kills everything', () => {
  const { factory, manager } = makeManager();
  manager.create();
  manager.create();
  manager.disposeAll();
  assert.ok(factory.ptys.every((p) => p.killed));
  assert.equal(manager.snapshot().sessions.length, 0);
});
```


- [ ] **Step 2: 运行确认失败**

Run: `npm run test:unit`
Expected: 新增用例 FAIL（模块不存在）。

- [ ] **Step 3: 写 `src/host/sessionManager.ts`**

```ts
import { EventEmitter } from 'node:events';
import { RingBuffer } from './ring.js';
import type { SessionInfo, SnapshotPayload } from '../webview/protocol.js';

export interface PtyLike {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface PtySpawnOptions {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  name: string;
}

export interface PtyFactory {
  spawn(opts: PtySpawnOptions): PtyLike;
}

export interface SessionManagerOptions {
  factory: PtyFactory;
  executable: string;
  cwd: () => string;
  defaultArgs: () => string[];
  env: () => Record<string, string>;
  ringBytes?: number;
}

interface InternalSession {
  info: SessionInfo;
  pty: PtyLike;
  ring: RingBuffer;
  args: string[];
}

interface ManagerEvents {
  created: { session: SessionInfo; activeId: string };
  output: { sessionId: string; data: string };
  exit: { sessionId: string; code: number | null };
  closed: { sessionId: string };
}

export class SessionManager {
  private readonly events = new EventEmitter();
  private readonly sessions = new Map<string, InternalSession>();
  private activeId: string | null = null;
  private nextId = 1;

  constructor(private readonly opts: SessionManagerOptions) {
    this.events.setMaxListeners(50);
  }

  get active(): string | null {
    return this.activeId;
  }

  onCreated(cb: (e: ManagerEvents['created']) => void): void { this.events.on('created', cb); }
  onOutput(cb: (e: ManagerEvents['output']) => void): void { this.events.on('output', cb); }
  onExit(cb: (e: ManagerEvents['exit']) => void): void { this.events.on('exit', cb); }
  onClosed(cb: (e: ManagerEvents['closed']) => void): void { this.events.on('closed', cb); }

  create(args: string[] = [], size?: { cols: number; rows: number }): SessionInfo {
    const id = `s${this.nextId++}`;
    const mergedArgs = [...this.opts.defaultArgs(), ...args];
    const pty = this.opts.factory.spawn({
      file: this.opts.executable,
      args: mergedArgs,
      cwd: this.opts.cwd(),
      cols: size?.cols ?? 80,
      rows: size?.rows ?? 24,
      env: { ...this.opts.env(), TERM: 'xterm-256color' },
      name: 'xterm-256color',
    });
    const isResume = mergedArgs.includes('-r') || mergedArgs.includes('--resume') || mergedArgs.includes('--continue') || mergedArgs.includes('-c');
    const session: InternalSession = {
      info: { id, title: isResume ? 'omp (resume)' : 'omp', exited: false, exitCode: null, createdAt: Date.now() },
      pty,
      ring: new RingBuffer(this.opts.ringBytes ?? 4 * 1024 * 1024),
      args,
    };
    pty.onData((d) => {
      session.ring.push(d);
      this.events.emit('output', { sessionId: id, data: d });
    });
    pty.onExit((e) => {
      session.info.exited = true;
      session.info.exitCode = e.exitCode ?? null;
      this.events.emit('exit', { sessionId: id, code: session.info.exitCode });
    });
    this.sessions.set(id, session);
    this.activeId = id;
    this.events.emit('created', { session: session.info, activeId: id });
    return session.info;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.pty.resize(cols, rows);
    } catch {
      // resizing an exited pty throws on some platforms; safe to ignore
    }
  }

  setActive(id: string): void {
    if (this.sessions.has(id)) {
      this.activeId = id;
    }
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) {
      return;
    }
    this.sessions.delete(id);
    try {
      s.pty.kill();
    } catch {
      // already dead
    }
    if (this.activeId === id) {
      this.activeId = [...this.sessions.keys()].pop() ?? null;
    }
    this.events.emit('closed', { sessionId: id });
  }

  restart(id: string): SessionInfo | null {
    const s = this.sessions.get(id);
    if (!s) {
      return null;
    }
    const args = s.args;
    this.close(id);
    return this.create(args);
  }

  snapshot(): SnapshotPayload {
    return {
      sessions: [...this.sessions.values()].map((s) => ({ ...s.info })),
      activeId: this.activeId,
      replay: [...this.sessions.values()].map((s) => ({ sessionId: s.info.id, data: s.ring.data() })),
    };
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) {
      try {
        s.pty.kill();
      } catch {
        // already dead
      }
    }
    this.sessions.clear();
    this.activeId = null;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:unit`
Expected: Task 3–5 全部 PASS（`node:test` 汇总 ~19 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/host/sessionManager.ts test/unit/sessionManager.test.ts
git commit -m "feat: session manager with lifecycle, routing, replay ring, restart"
```

---

### Task 6: node-pty 工厂（真实实现）

**Files:**
- Create: `src/host/pty.ts`

无独立单测（纯适配层，行为由集成 smoke 与手动验收覆盖）；`NodePtyFactory` 构造函数吞加载失败并记录，激活侧据此展示错误态。

- [ ] **Step 1: 写 `src/host/pty.ts`**

```ts
import type * as nodePtyModule from 'node-pty';
import type { PtyFactory, PtyLike, PtySpawnOptions } from './sessionManager.js';

type NodePty = typeof nodePtyModule;

export class NodePtyFactory implements PtyFactory {
  readonly loadError: string | null;
  private readonly mod: NodePty | null;

  constructor() {
    let mod: NodePty | null = null;
    let loadError: string | null = null;
    try {
      mod = require('node-pty') as NodePty;
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
    this.mod = mod;
    this.loadError = loadError;
  }

  spawn(opts: PtySpawnOptions): PtyLike {
    if (!this.mod) {
      throw new Error(`node-pty failed to load: ${this.loadError}`);
    }
    return this.mod.spawn(opts.file, opts.args, {
      name: opts.name,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
    });
  }
}
```

- [ ] **Step 2: 验证 + Commit**

Run: `npm run typecheck && npm run compile`
Expected: 均无错误。

```bash
git add src/host/pty.ts
git commit -m "feat: node-pty adapter with lazy load and error capture"
```

---

### Task 7: webview view provider + 编辑器终端 + 键位透传

**Files:**
- Create: `src/host/webviewViewProvider.ts`
- Create: `src/host/editorTerminal.ts`
- Create: `src/host/keyForwarder.ts`

vscode 依赖模块，不单测；行为由 Task 10 集成 smoke 与手动验收覆盖。

- [ ] **Step 1: 写 `src/host/webviewViewProvider.ts`**

```ts
import * as vscode from 'vscode';
import type { SessionManager } from './sessionManager.js';
import type { HostMessage, WebviewMessage, ConfigPayload } from '../webview/protocol.js';

export class OmpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'omp.sidebarTerminal';
  private view?: vscode.WebviewView;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly manager: SessionManager,
    private readonly spawnError: string | null,
    private readonly getConfig: () => ConfigPayload,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: HostMessage) => this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined; // sessions intentionally stay alive in the manager
    });
    this.view = view;
  }

  post(msg: WebviewMessage): void {
    void this.view?.webview.postMessage(msg);
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${OmpViewProvider.viewId}.focus`);
  }

  private onMessage(m: HostMessage): void {
    try {
      switch (m.type) {
        case 'ready':
          if (this.spawnError) {
            this.post({ type: 'error', message: this.spawnError });
          }
          this.post({ type: 'config', ...this.getConfig() });
          this.post({ type: 'snapshot', ...this.manager.snapshot() });
          break;
        case 'new':
          this.manager.create(m.args ?? []);
          break;
        case 'input':
          this.manager.write(m.sessionId, m.data);
          break;
        case 'resize':
          this.manager.resize(m.sessionId, m.cols, m.rows);
          break;
        case 'close':
          this.manager.close(m.sessionId);
          break;
        case 'switch':
          this.manager.setActive(m.sessionId);
          break;
        case 'restart':
          this.manager.restart(m.sessionId);
          break;
        case 'focus':
          void vscode.commands.executeCommand('setContext', 'ompSidebarFocused', m.value);
          break;
        case 'openSettings':
          void vscode.commands.executeCommand('workbench.action.openSettings', 'omp.executablePath');
          break;
        case 'key':
          // webview-originated key echo (reserved); chord forwarding lives in keyForwarder.ts
          break;
      }
    } catch (e) {
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID();
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'main.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview', 'main.css'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
```

注：`crypto.randomUUID()` 在扩展宿主 Node 20 全局可用。

- [ ] **Step 2: 写 `src/host/editorTerminal.ts`**

```ts
import * as vscode from 'vscode';

export function openOmpInEditor(ctx: vscode.ExtensionContext, executable: string, extraArgs: string[]): vscode.Terminal {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folders?.[0]?.uri.fsPath;
  const args = cwd ? extraArgs : [...extraArgs, '--allow-home'];
  const term = vscode.window.createTerminal({
    name: 'omp',
    location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    cwd,
    iconPath: {
      light: vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.svg'),
      dark: vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.svg'),
    },
  });
  term.show();
  term.sendText([executable, ...args].join(' '), true);
  return term;
}
```

- [ ] **Step 3: 写 `src/host/keyForwarder.ts`**

```ts
import * as vscode from 'vscode';
import type { OmpViewProvider } from './webviewViewProvider.js';

/** Chords we are willing to steal while the omp sidebar is focused. */
const FALLBACK_COMMANDS: Record<string, string> = {
  'ctrl+p': 'workbench.action.quickOpen',
};

export async function forwardKey(chord: string, provider: OmpViewProvider): Promise<void> {
  const configured = vscode.workspace
    .getConfiguration('omp')
    .get<string[]>('passThroughKeys', ['ctrl+p']);
  if (configured.includes(chord)) {
    provider.post({ type: 'key', chord } as never);
    return;
  }
  const fallback = FALLBACK_COMMANDS[chord];
  if (fallback) {
    await vscode.commands.executeCommand(fallback);
  }
}
```

注：`{ type: 'key', chord }` 对应协议 `WebviewMessage` 的保留分支（webview 收到后忽略——实际按键由 webview 内部 xterm 处理，见 Task 9 Step 3 的说明）。此函数的作用域是「被 keybinding 拦截时决定：透传设置命中则通知 webview、否则回放 VS Code 原命令」。为类型整洁，把协议 `WebviewMessage` 联合中补上 `| { type: 'key'; chord: string }`（修改 `src/webview/protocol.ts`）。

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run compile`
Expected: 无错误。

```bash
git add src/host/webviewViewProvider.ts src/host/editorTerminal.ts src/host/keyForwarder.ts src/webview/protocol.ts
git commit -m "feat: webview view provider, editor terminal, key forwarding"
```

---

### Task 8: 扩展激活装配

**Files:**
- Modify: `src/host/extension.ts`（整文件替换）

- [ ] **Step 1: 重写 `src/host/extension.ts`**

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

export interface OmpExtensionApi {
  manager: SessionManager;
}

export function activate(context: vscode.ExtensionContext): OmpExtensionApi {
  const config = () => vscode.workspace.getConfiguration('omp');

  // pty availability (native module)
  const factory = new NodePtyFactory();
  const ptyError = factory.loadError
    ? `node-pty could not be loaded (${factory.loadError}). The sidebar terminal is unavailable; "OMP: Open in Editor Tab" still works.`
    : null;

  // omp executable
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

  const provider = new OmpViewProvider(
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

  // manager events -> webview
  manager.onCreated((e) => provider.post({ type: 'created', session: e.session, activeId: e.activeId }));
  manager.onOutput((e) => provider.post({ type: 'output', sessionId: e.sessionId, data: e.data }));
  manager.onExit((e) => provider.post({ type: 'exit', sessionId: e.sessionId, code: e.code }));
  manager.onClosed((e) => provider.post({ type: 'closed', sessionId: e.sessionId }));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OmpViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('omp-vscode.newSession', () => {
      provider.reveal();
      try {
        manager.create();
      } catch (e) {
        provider.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }),
    vscode.commands.registerCommand('omp-vscode.focus', () => provider.reveal()),
    vscode.commands.registerCommand('omp-vscode.openInEditor', () => {
      if (executableError) {
        void vscode.window.showErrorMessage(executableError);
        return;
      }
      openOmpInEditor(context, executable, config().get<string[]>('defaultArgs', []));
    }),
    vscode.commands.registerCommand('omp-vscode.forwardKey', (chord: string) => {
      void forwardKey(chord, provider);
    }),
  );

  return { manager };
}

export function deactivate(): void {
  // pty cleanup happens via SessionManager.disposeAll, wired on deactivate below
}
```

注：为在窗口关闭时清理进程，`deactivate` 无法拿到实例；改为在 `activate` 里注册 `context.subscriptions.push({ dispose: () => manager.disposeAll() })`（追加一行到 subscriptions push 列表末尾）。

- [ ] **Step 2: 验证 + Commit**

Run: `npm run typecheck && npm run compile`
Expected: 无错误。

```bash
git add src/host/extension.ts
git commit -m "feat: wire activation, commands, provider registration, cleanup"
```

---

### Task 9: Webview 客户端（多标签终端 UI）

**Files:**
- Modify: `src/webview/main.ts`（整文件替换占位实现）

- [ ] **Step 1: 写 `src/webview/main.ts`**

```ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ConfigPayload, HostMessage, SessionInfo, WebviewMessage } from './protocol.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const CHORD_BYTES: Record<string, string> = {
  'ctrl+p': '\x10',
};

interface Tab {
  info: SessionInfo;
  term: Terminal;
  fit: FitAddon;
  el: HTMLElement;
}

const app = document.getElementById('app')!;
const tabs = new Map<string, Tab>();
let config: ConfigPayload = { fontFamily: 'Consolas, monospace', scrollback: 5000 };
let activeId: string | null = null;

function post(msg: HostMessage): void {
  vscode.postMessage(msg);
}

function readTheme() {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--vscode-editor-background', '#1e1e1e'),
    foreground: v('--vscode-editor-foreground', '#cccccc'),
    cursor: v('--vscode-editorCursor-foreground', '#ffffff'),
    cursorAccent: v('--vscode-editor-background', '#1e1e1e'),
    selectionBackground: v('--vscode-editor-selection-background', '#264f78'),
    black: v('--vscode-terminal-ansiBlack', '#000000'),
    red: v('--vscode-terminal-ansiRed', '#cd3131'),
    green: v('--vscode-terminal-ansiGreen', '#0dbc79'),
    yellow: v('--vscode-terminal-ansiYellow', '#e5e510'),
    blue: v('--vscode-terminal-ansiBlue', '#2472c8'),
    magenta: v('--vscode-terminal-ansiMagenta', '#bc3fbc'),
    cyan: v('--vscode-terminal-ansiCyan', '#11a8cd'),
    white: v('--vscode-terminal-ansiWhite', '#e5e5e5'),
    brightBlack: v('--vscode-terminal-ansiBrightBlack', '#666666'),
    brightRed: v('--vscode-terminal-ansiBrightRed', '#f14c4c'),
    brightGreen: v('--vscode-terminal-ansiBrightGreen', '#23d18b'),
    brightYellow: v('--vscode-terminal-ansiBrightYellow', '#f5f543'),
    brightBlue: v('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
    brightMagenta: v('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
    brightCyan: v('--vscode-terminal-ansiBrightCyan', '#29b8db'),
    brightWhite: v('--vscode-terminal-ansiBrightWhite', '#ffffff'),
  };
}

function createTab(info: SessionInfo, replay?: string): Tab {
  const term = new Terminal({
    fontFamily: config.fontFamily,
    scrollback: config.scrollback,
    fontSize: 13,
    theme: readTheme(),
    convertEol: false,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement('div');
  el.className = 'term';
  app.appendChild(el);
  term.open(el);
  const tab: Tab = { info, term, fit, el };
  term.onData((d) => {
    if (tab.info.id === activeId) {
      post({ type: 'input', sessionId: tab.info.id, data: d });
    }
  });
  if (replay) {
    term.write(replay);
  }
  tabs.set(info.id, tab);
  return tab;
}

function label(info: SessionInfo): string {
  return info.exited ? `${info.title} [exited]` : info.title;
}

function renderTabs(): void {
  document.querySelectorAll('.tabbar button.tab').forEach((n) => n.remove());
  const bar = document.getElementById('tabbar')!;
  for (const t of tabs.values()) {
    const b = document.createElement('button');
    b.className = 'tab' + (t.info.id === activeId ? ' active' : '');
    b.textContent = label(t.info);
    b.title = t.info.exited ? 'Restart' : 'Switch';
    b.onclick = () => {
      if (t.info.exited) {
        post({ type: 'restart', sessionId: t.info.id });
      } else {
        post({ type: 'switch', sessionId: t.info.id });
      }
    };
    bar.insertBefore(b, document.getElementById('newtab'));
  }
  for (const t of tabs.values()) {
    t.el.classList.toggle('hidden', t.info.id !== activeId);
  }
  document.getElementById('welcome')!.classList.toggle('hidden', tabs.size > 0);
  const active = activeId ? tabs.get(activeId) : undefined;
  if (active) {
    active.fit.fit();
    post({ type: 'resize', sessionId: active.info.id, cols: active.term.cols, rows: active.term.rows });
    active.term.focus();
  }
}

function removeTab(id: string): void {
  const t = tabs.get(id);
  if (!t) {
    return;
  }
  t.term.dispose();
  t.el.remove();
  tabs.delete(id);
}

window.addEventListener('message', (e: MessageEvent<WebviewMessage>) => {
  const m = e.data;
  switch (m.type) {
    case 'config':
      config = { fontFamily: m.fontFamily, scrollback: m.scrollback };
      for (const t of tabs.values()) {
        t.term.options.fontFamily = config.fontFamily;
        t.term.options.scrollback = config.scrollback;
      }
      break;
    case 'snapshot':
      for (const id of [...tabs.keys()]) {
        removeTab(id);
      }
      for (const info of m.sessions) {
        const replay = m.replay.find((r) => r.sessionId === info.id)?.data ?? '';
        createTab(info, replay);
      }
      activeId = m.activeId ?? m.sessions[0]?.id ?? null;
      renderTabs();
      break;
    case 'created':
      createTab(m.session);
      activeId = m.session.id;
      renderTabs();
      break;
    case 'output': {
      const t = tabs.get(m.sessionId);
      t?.term.write(m.data);
      break;
    }
    case 'exit': {
      const t = tabs.get(m.sessionId);
      if (t) {
        t.info.exited = true;
        t.info.exitCode = m.code;
        renderTabs();
      }
      break;
    }
    case 'closed':
      removeTab(m.sessionId);
      if (activeId === m.sessionId) {
        activeId = [...tabs.keys()].pop() ?? null;
      }
      renderTabs();
      break;
    case 'error':
      showError(m.message);
      break;
    case 'key': {
      // host forwarded a stolen chord back into the terminal
      const bytes = CHORD_BYTES[m.chord];
      if (bytes && activeId) {
        post({ type: 'input', sessionId: activeId, data: bytes });
      }
      break;
    }
  }
});

function showError(message: string): void {
  const err = document.getElementById('error')!;
  err.querySelector('p')!.textContent = message;
  err.classList.remove('hidden');
}

// --- static UI skeleton + bootstrap ---
app.innerHTML = `
  <div id="error" class="hidden error">
    <p></p>
    <button id="open-settings">Open Settings</button>
  </div>
  <div class="tabbar">
    <span id="tabs-start"></span>
    <button id="newtab" class="icon" title="New Session">＋</button>
    <button id="resume" class="icon" title="Resume Session (omp -r)">↺</button>
  </div>
  <div id="welcome" class="welcome">
    <p>No omp sessions yet.</p>
    <button id="welcome-new">New Session</button>
  </div>
`;

document.getElementById('newtab')!.onclick = () => post({ type: 'new' });
document.getElementById('welcome-new')!.onclick = () => post({ type: 'new' });
document.getElementById('resume')!.onclick = () => post({ type: 'new', args: ['-r'] });
document.getElementById('open-settings')!.onclick = () => post({ type: 'openSettings' });

document.addEventListener('focusin', () => post({ type: 'focus', value: true }));
document.addEventListener('focusout', () => post({ type: 'focus', value: false }));

const ro = new ResizeObserver(() => {
  const t = activeId ? tabs.get(activeId) : undefined;
  if (t && t.el.clientHeight > 0) {
    t.fit.fit();
    post({ type: 'resize', sessionId: t.info.id, cols: t.term.cols, rows: t.term.rows });
  }
});
ro.observe(app);

const style = document.createElement('style');
style.textContent = `
  html, body, #app { height: 100%; margin: 0; padding: 0; }
  body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  #app { display: flex; flex-direction: column; }
  .tabbar { display: flex; gap: 2px; padding: 2px 4px; align-items: center; flex-wrap: wrap; }
  .tabbar .tab { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab.active { border-bottom: 1px solid var(--vscode-focusBorder); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; cursor: pointer; font-size: 11px; }
  button:hover { filter: brightness(1.15); }
  button.icon { padding: 2px 6px; }
  .term { flex: 1; min-height: 0; }
  .term .xterm { height: 100%; padding: 2px 4px; box-sizing: border-box; }
  .hidden { display: none !important; }
  .welcome { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .error { margin: 8px; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .error p { font-size: 11px; word-break: break-all; margin: 0 0 8px 0; }
`;
document.head.appendChild(style);

post({ type: 'ready' });
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile && npm run typecheck`
Expected: `dist/webview/main.js` + `dist/webview/main.css` 产出；tsc 无错误。

- [ ] **Step 3: 本地冒烟（不开 VS Code）**

Run: `node -e "const h=require('fs').readFileSync('dist/webview/main.js','utf8'); if(!h.includes('xterm')) process.exit(1); console.log('webview bundle contains xterm:', h.length, 'bytes')"`
Expected: 输出 `webview bundle contains xterm: <N> bytes`。

设计说明（实现者须知）：`keyForwarder` 的 `forwardKey` 把被拦截的 chord 以 `{type:'key'}` 发回 webview，webview 将其映射为控制字节写入活动会话（`CHORD_BYTES`），等价于用户在 xterm 里直接按下该键；`omp` 的 Ctrl+P 模型切换因此可达。

- [ ] **Step 4: Commit**

```bash
git add src/webview/main.ts
git commit -m "feat: webview client with multi-tab xterm, theme sync, focus tracking"
```

---

### Task 10: 集成 smoke 测试

**Files:**
- Create: `.vscode-test.mjs`
- Create: `test/integration/extension.test.ts`

- [ ] **Step 1: 写 `.vscode-test.mjs`**（复用本机已装 VS Code，避免下载）

```js
import { defineConfig } from '@vscode/test-cli';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const local =
  process.env.LOCALAPPDATA &&
  join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
const executablePath = local && existsSync(local) ? local : undefined;

export default defineConfig({
  files: 'test/integration/**/*.test.ts',
  useInstalledExtensionHost: false,
  ...(executablePath ? { executablePath } : {}),
});
```

注：`@vscode/test-cli` 的 `defineConfig` 透传 `executablePath` 给底层 `@vscode/test-electron`；若该版本字段名不符，以其类型报错为准调整为 `launchArgs`/`extensionTestsEnv` 支持的形式，目标不变：用本机 Code.exe。

- [ ] **Step 2: 写 `test/integration/extension.test.ts`**

```ts
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXT_ID = 'omp-dev.oh-my-pi-vscode';

suite('omp extension smoke', () => {
  test('activates and creates a session that produces output', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    const api = (await ext.activate()) as { manager: {
      create: () => { id: string };
      onOutput: (cb: (e: { sessionId: string; data: string }) => void) => void;
      close: (id: string) => void;
      disposeAll: () => void;
    } };
    assert.ok(api.manager, 'activate() must return { manager }');

    const created = api.manager.create();
    const got = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`no output within 15s, got: ${JSON.stringify(buf)}`)), 15_000);
      api.manager.onOutput((e) => {
        if (e.sessionId === created.id) {
          buf += e.data;
          if (buf.length > 0) {
            clearTimeout(timer);
            resolve(buf);
          }
        }
      });
    });
    assert.ok(got.length > 0, 'omp TUI must emit bytes on startup');

    api.manager.close(created.id);
    await new Promise((r) => setTimeout(r, 300));
  }).timeout(30_000);

  test('omp-vscode.openInEditor creates a terminal', async () => {
    const before = vscode.window.terminals.length;
    await vscode.commands.executeCommand('omp-vscode.openInEditor');
    assert.equal(vscode.window.terminals.length, before + 1);
    const t = vscode.window.terminals[vscode.window.terminals.length - 1];
    t.dispose();
  });
});
```

（若采用 mocha 默认接口无 `.timeout()` 链问题——`@vscode/test-cli` 默认跑 mocha，`test(...).timeout(30_000)` 可用。）

- [ ] **Step 3: 跑集成测试**

Run: `npm run test:integration`
Expected: VS Code 测试实例启动，2 个用例 PASS。第 1 个用例要求 PATH 中有 omp（已验证存在）；输出为 TUI 启动转义序列。

- [ ] **Step 4: Commit**

```bash
git add .vscode-test.mjs test/integration/extension.test.ts
git commit -m "test: integration smoke (activation, session spawn, editor terminal)"
```

---

### Task 11: 手动验收 + 收尾

- [ ] **Step 1: 启动开发宿主**

Run（PowerShell 或 cmd）:
```
"C:\Users\Administrator\AppData\Local\Programs\Microsoft VS Code\Code.exe" --extensionDevelopmentPath=F:\Code\oh-my-pi-vscode F:\Code\oh-my-pi-vscode
```
Expected: 新 VS Code 窗口，活动栏出现 π 图标（Oh My Pi）。

- [ ] **Step 2: 逐项验收（对照 spec §9.3）**

1. 点活动栏图标 → 侧边栏出现会话面板（欢迎态）
2. `＋` 或标题栏 + 按钮 → omp TUI 完整渲染，可直接对话
3. Ctrl+P 在面板聚焦时打开 omp 模型切换（而非 VS Code 快速打开）
4. 再开第二个会话 → 标签切换正常，两会话进程独立
5. `↺` → 出现 `omp (resume)` 标签，`-r` 选择器可用
6. 关闭一个标签 → 仅该进程终止；`Ctrl+Alt+O` 回焦侧边栏
7. 折叠侧边栏再展开 → 会话仍在、缓冲未丢
8. `Ctrl+Alt+Shift+O` → 编辑器区出现 omp 大窗终端
9. 退出会话进程（`/exit`）→ 标签显示 `[exited]`，点击标签 → 重启

发现缺陷：修复后从 Step 2 重跑相关项。

- [ ] **Step 3: 全量回归 + 最终提交**

Run: `npm run typecheck && npm run test:unit && npm run test:integration`
Expected: 全绿。

```bash
git add -A
git commit -m "chore: manual acceptance pass complete"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 面板/标签/恢复 → Task 7/9；§3.2 编辑器大窗 → Task 7/8；§3.3 键位 → Task 1(keybindings)+7(keyForwarder)+9(CHORD_BYTES)；§4 模块表 → Task 3–8 文件一一对应；§4.2 协议 → Task 2（含补充的 focus/openSettings/config/key）；§5 生命周期/重放 → Task 4/5（retainContextWhenHidden → Task 8）；§6 设置 → Task 1 configuration + Task 8 读取；§7 错误处理 → Task 6/7/8；§9 测试 → Task 3/4/5 单测、Task 10 集成、Task 11 手动。
- **占位符扫描**：无 TBD/TODO；每步含完整代码或精确命令。
- **类型一致性**：`PtyLike/PtyFactory/PtySpawnOptions`（Task 5 定义，Task 6 使用）；`SessionInfo/SnapshotPayload/HostMessage/WebviewMessage`（Task 2 定义，5/7/8/9 使用，Task 7 Step 3 补 `key` 分支到 `WebviewMessage`）；`OmpViewProvider.viewId = 'omp.sidebarTerminal'` 与 package.json `views` 一致；`omp-dev.oh-my-pi-vscode` 与集成测试 `EXT_ID` 一致。
- **已知简化**（有意为之，非占位）：`passThroughKeys` 只能过滤预声明 chord（README 级限制，设置描述已注明）；集成测试 `defineConfig` 的 `executablePath` 透传若 API 变名则就地适配。
