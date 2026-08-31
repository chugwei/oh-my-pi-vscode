import type {
  ChatHostMessage,
  ChatWebviewMessage,
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

let attachments: ChatAttachment[] = [];
let isGenerating = false;
let currentThinkingEl: HTMLDetailsElement | null = null;
let currentMessageEl: HTMLElement | null = null;

const app = document.getElementById('app')!;

function post(msg: ChatHostMessage): void {
  vscode.postMessage(msg);
}

// Render Main App Skeleton (Claude Code 1:1 layout)
app.innerHTML = `
  <div class="chat-container">
    <!-- Top Header -->
    <div class="chat-header">
      <button id="btn-history" class="header-btn" title="历史会话">≡ 历史</button>
      <button id="btn-new" class="header-btn" title="新建会话">＋ 新建</button>
      <div class="spacer"></div>
      <span id="badge-cwd" class="badge badge-cwd" title="当前工作目录">📁 --</span>
      <span id="badge-mode" class="badge">Default</span>
      <span id="badge-think" class="badge">High</span>
      <span id="badge-model" class="badge">Sonnet</span>
    </div>

    <!-- History Drawer (hidden by default) -->
    <div id="history-drawer" class="drawer hidden">
      <div class="drawer-header">
        <span>历史会话</span>
        <button id="btn-close-history" class="header-btn">✕</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </div>

    <!-- Messages Flow Area -->
    <div id="messages-flow" class="messages-flow">
      <div id="welcome-view" class="welcome-view">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 5h16v2.5h-4.8V19h-2.4V7.5H9.2V19H6.8V7.5H4V5z"/>
        </svg>
        <h2>Oh My Pi</h2>
        <p>Your AI coding partner in VS Code</p>
        <div class="welcome-cwd-pill" id="welcome-cwd-box">
          <span class="cwd-icon">📁</span>
          <span id="welcome-cwd-text">--</span>
        </div>
    </div>

    <!-- Bottom Input Container (Exact Claude Code Box) -->
    <div class="input-area">
      <!-- Attachment Pills -->
      <div id="attachment-pills" class="attachment-pills hidden"></div>

      <!-- Claude-styled Box -->
      <div class="claude-input-card">
        <textarea id="prompt-input" rows="1" placeholder="ctrl+alt+o to focus or unfocus Oh My Pi"></textarea>

        <!-- Bottom Toolbar inside the box -->
        <div class="claude-toolbar">
          <!-- Left side icons: + and [/] -->
          <div class="left-actions">
            <button id="btn-attach" class="action-btn" title="添加文件或图片">＋</button>
            <button id="btn-slash" class="action-btn slash-btn" title="快捷命令">[/]</button>
          </div>

          <!-- Right side selectors: Mode, Think, Model, and Send ↑ -->
          <div class="right-actions">
            <div class="popover-wrapper">
              <button id="btn-mode" class="pill-selector" title="选择模式">⚡ Mode▾</button>
              <div id="popover-mode" class="popover hidden"></div>
            </div>

            <div class="popover-wrapper">
              <button id="btn-think" class="pill-selector" title="思考强度">🧠 Think▾</button>
              <div id="popover-think" class="popover hidden"></div>
            </div>

            <div class="popover-wrapper">
              <button id="btn-model" class="pill-selector" title="选择模型">🤖 Model▾</button>
              <div id="popover-model" class="popover model-popover hidden">
                <input type="text" id="model-search" placeholder="搜索 200+ 模型..." />
                <div id="model-list" class="popover-list"></div>
              </div>
            </div>

            <!-- Slash commands popover -->
            <div id="popover-slash" class="popover slash-popover hidden">
              <div class="popover-item" data-cmd="/clear"><span class="item-name">/clear</span><span class="item-desc">清空当前消息</span></div>
              <div class="popover-item" data-cmd="/plan"><span class="item-name">/plan</span><span class="item-desc">切换至 Plan 规划模式</span></div>
              <div class="popover-item" data-cmd="/default"><span class="item-name">/default</span><span class="item-desc">切换至 Default 编程模式</span></div>
              <div class="popover-item" data-cmd="/help"><span class="item-name">/help</span><span class="item-desc">查看帮助与说明</span></div>
            </div>

            <!-- Orange Send Button with Up Arrow -->
            <button id="btn-send" class="send-arrow-btn" title="发送 (Enter)">↑</button>
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
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
});

// Send handler
function handleSend(): void {
  const text = promptInput.value.trim();
  if (!text && attachments.length === 0) return;
  if (isGenerating) {
    post({ type: 'cancel' });
    return;
  }

  // Handle client-side slash commands
  if (text === '/clear') {
    messagesFlow.innerHTML = '';
    messagesFlow.appendChild(welcomeView);
    welcomeView.classList.remove('hidden');
    promptInput.value = '';
    promptInput.style.height = 'auto';
    return;
  } else if (text === '/plan') {
    post({ type: 'setMode', mode: 'plan' });
    promptInput.value = '';
    return;
  } else if (text === '/default') {
    post({ type: 'setMode', mode: 'default' });
    promptInput.value = '';
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
  btnSend.textContent = generating ? '◼' : '↑';
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

// Popovers
const popoverMode = document.getElementById('popover-mode')!;
const popoverThink = document.getElementById('popover-think')!;
const popoverModel = document.getElementById('popover-model')!;
const popoverSlash = document.getElementById('popover-slash')!;
const btnMode = document.getElementById('btn-mode')!;
const btnThink = document.getElementById('btn-think')!;
const btnModel = document.getElementById('btn-model')!;
const btnSlash = document.getElementById('btn-slash')!;

function closeAllPopoversExcept(except?: HTMLElement): void {
  [popoverMode, popoverThink, popoverModel, popoverSlash].forEach((p) => {
    if (p !== except) p.classList.add('hidden');
  });
}

btnMode.onclick = () => {
  const isHidden = popoverMode.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) popoverMode.classList.remove('hidden');
};

btnThink.onclick = () => {
  const isHidden = popoverThink.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) popoverThink.classList.remove('hidden');
};

btnModel.onclick = () => {
  const isHidden = popoverModel.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) {
    popoverModel.classList.remove('hidden');
    (document.getElementById('model-search') as HTMLInputElement).focus();
  }
};

btnSlash.onclick = () => {
  const isHidden = popoverSlash.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) popoverSlash.classList.remove('hidden');
};

popoverSlash.querySelectorAll('.popover-item').forEach((item) => {
  (item as HTMLElement).onclick = () => {
    const cmd = item.getAttribute('data-cmd')!;
    promptInput.value = cmd;
    popoverSlash.classList.add('hidden');
    handleSend();
  };
});

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

// Render Config Popovers
function renderConfigOptions(options: ConfigOption[]): void {

  // 1. Mode Option
  const modeOpt = options.find((x) => x.id === 'mode');
  if (modeOpt) {
    const curr = String(modeOpt.currentValue);
    const currName = modeOpt.options?.find((o) => o.value === curr)?.name || curr;
    btnMode.textContent = `⚡ ${currName}▾`;
    document.getElementById('badge-mode')!.textContent = currName;

    popoverMode.innerHTML = (modeOpt.options || [])
      .map(
        (o) => `
      <div class="popover-item ${o.value === curr ? 'active' : ''}" data-val="${o.value}">
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

  // 2. Thinking Option
  const thinkOpt = options.find((x) => x.id === 'thinking');
  if (thinkOpt) {
    const curr = String(thinkOpt.currentValue);
    btnThink.textContent = `🧠 ${curr}▾`;
    document.getElementById('badge-think')!.textContent = curr;

    popoverThink.innerHTML = (thinkOpt.options || [
      { value: 'off', name: 'Off' },
      { value: 'auto', name: 'Auto' },
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
      { value: 'max', name: 'Max' },
    ])
      .map(
        (o) => `
      <div class="popover-item ${o.value === curr ? 'active' : ''}" data-val="${o.value}">
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

  // 3. Model Option
  const modelOpt = options.find((x) => x.id === 'model');
  if (modelOpt) {
    const curr = String(modelOpt.currentValue);
    const shortName = curr.split('/').pop() || curr;
    btnModel.textContent = `🤖 ${shortName}▾`;
    document.getElementById('badge-model')!.textContent = shortName;

    const modelListEl = document.getElementById('model-list')!;
    const searchInput = document.getElementById('model-search') as HTMLInputElement;

    const renderList = (filterText = '') => {
      const filtered = (modelOpt.options || []).filter(
        (o) => o.name.toLowerCase().includes(filterText) || o.value.toLowerCase().includes(filterText)
      );
      modelListEl.innerHTML = filtered
        .slice(0, 60)
        .map(
          (o) => `
        <div class="popover-item ${o.value === curr ? 'active' : ''}" data-val="${o.value}">
          <div class="item-name">${escapeHtml(o.name)}</div>
          <div class="item-desc">${escapeHtml(o.value)}</div>
        </div>
      `
        )
        .join('');

      modelListEl.querySelectorAll('.popover-item').forEach((item) => {
        (item as HTMLElement).onclick = () => {
          const val = item.getAttribute('data-val')!;
          post({ type: 'setModel', model: val });
          popoverModel.classList.add('hidden');
        };
      });
    };

    renderList();
    searchInput.oninput = () => renderList(searchInput.value.trim().toLowerCase());
  }
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
      if (m.cwd) {
        const fullCwd = m.cwd;
        const parts = fullCwd.replace(/\\/g, '/').split('/').filter(Boolean);
        const folderName = parts.pop() || fullCwd;
        const badgeCwd = document.getElementById('badge-cwd')!;
        badgeCwd.textContent = `📁 ${folderName}`;
        badgeCwd.title = `工作目录: ${fullCwd}`;

        const welcomeCwdText = document.getElementById('welcome-cwd-text');
        if (welcomeCwdText) {
          welcomeCwdText.textContent = fullCwd;
        }
      }
      if (m.configOptions && m.configOptions.length > 0) {
        renderConfigOptions(m.configOptions);
      }
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

// Styles (Claude Code 1:1 Palette & Box)
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  html, body, #app { height: 100%; margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  .chat-container { display: flex; flex-direction: column; height: 100%; position: relative; }
  
  .chat-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border); min-height: 32px; }
  .spacer { flex: 1; }
  .header-btn { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 6px; font-size: 11px; border-radius: 4px; }
  .header-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge-cwd { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; background: var(--vscode-badge-background, rgba(255,255,255,0.1)); }

  .drawer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 50; background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  .drawer-header { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--vscode-widget-border); font-weight: bold; }
  .history-list { flex: 1; overflow-y: auto; padding: 8px; }
  .history-item { padding: 6px 10px; border-radius: 4px; cursor: pointer; margin-bottom: 4px; }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .history-title { font-size: 12px; font-weight: 500; }
  .history-date { font-size: 10px; opacity: 0.7; }

  .messages-flow { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .welcome-view { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); display: flex; flex-direction: column; align-items: center; }
  .welcome-view h2 { margin: 8px 0 4px; color: var(--vscode-editor-foreground); }
  .welcome-cwd-pill { margin-top: 10px; font-size: 11px; padding: 4px 10px; border-radius: 12px; background: var(--vscode-input-background, #252526); border: 1px solid var(--vscode-widget-border, #3c3c3c); max-width: 90%; word-break: break-all; color: var(--vscode-descriptionForeground); }
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

  /* Input Area (Claude Code 1:1 Box) */
  .input-area { padding: 8px 10px; background: var(--vscode-editor-background); }
  .attachment-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 6px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill-remove { background: transparent; border: none; color: inherit; cursor: pointer; padding: 0 2px; }

  .claude-input-card {
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 8px;
    background: var(--vscode-input-background, #252526);
    padding: 8px 10px 6px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .claude-input-card:focus-within {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  #prompt-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: 13px;
    resize: none;
    width: 100%;
    min-height: 28px;
    line-height: 1.4;
  }
  #prompt-input::placeholder {
    color: var(--vscode-input-placeholderForeground, rgba(255,255,255,0.4));
  }

  .claude-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 6px;
    padding-top: 4px;
  }

  .left-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .action-btn {
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 3px 6px;
    font-size: 14px;
    border-radius: 4px;
    opacity: 0.8;
  }
  .action-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
  }
  .slash-btn {
    font-family: monospace;
    font-size: 12px;
    font-weight: bold;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
    padding: 1px 5px;
  }

  .right-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    position: relative;
  }

  .pill-selector {
    background: transparent;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
    color: var(--vscode-foreground);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.85;
  }
  .pill-selector:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
  }

  .send-arrow-btn {
    background: #c15c25;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    width: 26px;
    height: 26px;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .send-arrow-btn:hover {
    filter: brightness(1.15);
  }
  .send-arrow-btn.stop-btn {
    background: #d32f2f;
  }

  /* Popovers */
  .popover-wrapper { position: relative; }
  .popover {
    position: absolute;
    bottom: 32px;
    right: 0;
    z-index: 50;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 150px;
    max-height: 220px;
    overflow-y: auto;
    padding: 4px;
  }
  .popover-item {
    padding: 5px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
  }
  .popover-item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .popover-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .item-desc { font-size: 10px; opacity: 0.65; }

  .slash-popover { left: 0; right: auto; min-width: 180px; }
  .model-popover { min-width: 240px; max-height: 280px; display: flex; flex-direction: column; }
  #model-search {
    padding: 4px 8px;
    font-size: 11px;
    margin-bottom: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
  }
  .popover-list { flex: 1; overflow-y: auto; }

  .error-card { color: var(--vscode-errorForeground); padding: 6px; font-size: 12px; }
  .hidden { display: none !important; }
`;
document.head.appendChild(style);

post({ type: 'ready' });
