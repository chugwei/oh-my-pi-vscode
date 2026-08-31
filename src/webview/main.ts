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
    b.title = t.info.exited ? 'Restart' : 'Switch';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab-label';
    labelSpan.textContent = label(t.info);
    b.appendChild(labelSpan);
    const x = document.createElement('span');
    x.className = 'tab-close';
    x.textContent = '×';
    x.title = 'Close session';
    x.onclick = (ev) => {
      ev.stopPropagation();
      post({ type: 'close', sessionId: t.info.id });
    };
    b.appendChild(x);
    b.onclick = () => {
      if (t.info.exited) {
        post({ type: 'restart', sessionId: t.info.id });
      } else {
        activeId = t.info.id;
        renderTabs();
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
  .tab { display: inline-flex; align-items: center; gap: 4px; }
  .tab-label { max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-close { padding: 0 2px; opacity: 0.7; }
  .tab-close:hover { opacity: 1; color: var(--vscode-errorForeground); }
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
