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

function chordToBytes(chord: string): string | null {
  const m = /^ctrl\+([a-z])$/i.exec(chord);
  if (!m) {
    return null;
  }
  return String.fromCharCode(m[1].toUpperCase().charCodeAt(0) - 64);
}

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
  document.getElementById('term-area')!.appendChild(el);
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

function activeTab(): Tab | undefined {
  return activeId ? tabs.get(activeId) : undefined;
}

function label(info: SessionInfo): string {
  return info.exited ? `${info.title} [exited]` : info.title;
}

function renderChrome(): void {
  const act = activeTab();
  document.getElementById('session-title')!.textContent = act ? label(act.info) : 'Oh My Pi';
  for (const t of tabs.values()) {
    t.el.classList.toggle('hidden', t.info.id !== activeId);
  }
  document.getElementById('welcome')!.classList.toggle('hidden', tabs.size > 0);
  document.getElementById('btn-exit')!.classList.toggle('disabled', !act);
  document.getElementById('btn-sessions')!.classList.toggle('disabled', tabs.size === 0);
  const ov = document.getElementById('exit-overlay')!;
  ov.classList.toggle('hidden', !(act && act.info.exited));
  if (act && act.info.exited) {
    ov.querySelector('.exit-code')!.textContent = act.info.exitCode === null ? '' : `exit ${act.info.exitCode}`;
  }
  hideMenu();
  if (act && !act.info.exited) {
    act.fit.fit();
    post({ type: 'resize', sessionId: act.info.id, cols: act.term.cols, rows: act.term.rows });
    act.term.focus();
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

function renderMenu(): void {
  const list = document.getElementById('session-list')!;
  list.textContent = '';
  for (const t of tabs.values()) {
    const row = document.createElement('div');
    row.className = 'menu-row' + (t.info.id === activeId ? ' current' : '');
    const name = document.createElement('span');
    name.className = 'menu-name';
    name.textContent = label(t.info);
    row.appendChild(name);
    const x = document.createElement('span');
    x.className = 'menu-x';
    x.textContent = '×';
    x.title = '关闭该会话';
    x.onclick = (ev) => {
      ev.stopPropagation();
      post({ type: 'close', sessionId: t.info.id });
      hideMenu();
    };
    row.appendChild(x);
    row.onclick = () => {
      if (t.info.exited) {
        post({ type: 'restart', sessionId: t.info.id });
      } else {
        activeId = t.info.id;
        renderChrome();
        post({ type: 'switch', sessionId: t.info.id });
      }
    };
    list.appendChild(row);
  }
  const resume = document.createElement('div');
  resume.className = 'menu-row footer';
  resume.textContent = '↺ 恢复历史会话 (omp -r)';
  resume.onclick = () => {
    post({ type: 'new', args: ['-r'] });
    hideMenu();
  };
  list.appendChild(resume);
}

function hideMenu(): void {
  document.getElementById('sessions-menu')!.classList.add('hidden');
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
      renderChrome();
      break;
    case 'created':
      createTab(m.session);
      activeId = m.session.id;
      renderChrome();
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
        if (t.info.id === activeId) {
          renderChrome();
        }
      }
      break;
    }
    case 'closed':
      removeTab(m.sessionId);
      if (activeId === m.sessionId) {
        activeId = [...tabs.keys()].pop() ?? null;
      }
      renderChrome();
      break;
    case 'error':
      showError(m.message);
      break;
    case 'key': {
      // host forwarded a stolen chord back into the terminal
      const bytes = chordToBytes(m.chord);
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
    <button id="open-settings">打开设置</button>
  </div>
  <div class="toolbar">
    <span id="session-title" class="title">Oh My Pi</span>
    <span class="spacer"></span>
    <button id="btn-sessions" class="tool" title="会话列表">☰</button>
    <button id="btn-new" class="tool" title="新建会话">＋</button>
    <button id="btn-exit" class="tool" title="退出当前会话">✕</button>
  </div>
  <div id="sessions-menu" class="hidden">
    <div id="session-list"></div>
  </div>
  <div id="term-area">
    <div id="exit-overlay" class="hidden">
      <p>会话已退出 <span class="exit-code"></span></p>
      <div class="row">
        <button id="btn-restart">重新开始</button>
        <button id="btn-dismiss">查看输出</button>
      </div>
      <p class="hint">会话记录保存在磁盘，可用「恢复历史会话」找回</p>
    </div>
  </div>
  <div id="welcome" class="welcome">
    <svg width="56" height="56" viewBox="0 0 24 24"><path d="M4 5h16v2.5h-4.8V19h-2.4V7.5H9.2V19H6.8V7.5H4V5z" fill="currentColor"/></svg>
    <h1>Oh My Pi</h1>
    <p>在侧边栏运行 omp 会话</p>
    <button id="welcome-new" class="primary">新建会话</button>
    <button id="welcome-resume">↺ 恢复历史会话</button>
    <p class="hint">工具栏 ✕ 退出会话 · ☰ 切换会话 · 面板内 Ctrl+P 切换模型</p>
  </div>
`;

document.getElementById('btn-new')!.onclick = () => post({ type: 'new' });
document.getElementById('welcome-new')!.onclick = () => post({ type: 'new' });
document.getElementById('welcome-resume')!.onclick = () => post({ type: 'new', args: ['-r'] });
document.getElementById('btn-exit')!.onclick = () => {
  if (activeId) {
    post({ type: 'close', sessionId: activeId });
  }
};
document.getElementById('btn-restart')!.onclick = () => {
  if (activeId) {
    post({ type: 'restart', sessionId: activeId });
  }
};
document.getElementById('btn-dismiss')!.onclick = () => {
  document.getElementById('exit-overlay')!.classList.add('hidden');
};
document.getElementById('btn-sessions')!.onclick = () => {
  const menu = document.getElementById('sessions-menu')!;
  if (menu.classList.contains('hidden')) {
    renderMenu();
    menu.classList.remove('hidden');
  } else {
    hideMenu();
  }
};
document.getElementById('open-settings')!.onclick = () => post({ type: 'openSettings' });

document.addEventListener('focusin', () => post({ type: 'focus', value: true }));
document.addEventListener('focusout', () => post({ type: 'focus', value: false }));

const ro = new ResizeObserver(() => {
  const t = activeTab();
  if (t && t.el.clientHeight > 0) {
    t.fit.fit();
    post({ type: 'resize', sessionId: t.info.id, cols: t.term.cols, rows: t.term.rows });
  }
});
ro.observe(document.getElementById('term-area')!);

const style = document.createElement('style');
style.textContent = `
  html, body, #app { height: 100%; margin: 0; padding: 0; }
  body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  #app { display: flex; flex-direction: column; position: relative; }
  .toolbar { display: flex; align-items: center; gap: 2px; padding: 3px 6px; min-height: 26px; }
  .toolbar .title { font-size: 11px; opacity: 0.9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toolbar .spacer { flex: 1; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; cursor: pointer; font-size: 11px; }
  button:hover { filter: brightness(1.15); }
  button.tool { padding: 1px 7px; font-size: 13px; line-height: 1; }
  button.tool.disabled { opacity: 0.4; pointer-events: none; }
  #sessions-menu { position: absolute; top: 30px; right: 6px; left: 6px; z-index: 30; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); box-shadow: 0 2px 8px rgba(0,0,0,.4); max-height: 60%; overflow: auto; }
  .menu-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
  .menu-row:hover { background: var(--vscode-list-hoverBackground); }
  .menu-row.current { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .menu-row .menu-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-row .menu-x { padding: 0 4px; opacity: .6; }
  .menu-row .menu-x:hover { opacity: 1; color: var(--vscode-errorForeground); }
  .menu-row.footer { border-top: 1px solid var(--vscode-widget-border); opacity: .9; }
  #term-area { flex: 1; min-height: 0; position: relative; }
  .term { position: absolute; inset: 0; }
  .term .xterm { height: 100%; padding: 2px 4px; box-sizing: border-box; }
  #exit-overlay { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent); }
  #exit-overlay .row { display: flex; gap: 8px; }
  #exit-overlay p { margin: 0; font-size: 12px; }
  #exit-overlay .hint { opacity: .7; font-size: 11px; max-width: 80%; text-align: center; }
  .hidden { display: none !important; }
  .welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--vscode-descriptionForeground); }
  .welcome h1 { font-size: 18px; margin: 8px 0 0 0; color: var(--vscode-editor-foreground); }
  .welcome p { margin: 0; font-size: 12px; }
  .welcome button { margin-top: 8px; min-width: 160px; }
  .welcome button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .welcome .hint { margin-top: 18px; font-size: 11px; opacity: .7; max-width: 82%; text-align: center; }
  .error { margin: 8px; padding: 8px; border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .error p { font-size: 11px; word-break: break-all; margin: 0 0 8px 0; }
`;
document.head.appendChild(style);

post({ type: 'ready' });
