import type {
  ChatHostMessage,
  ChatWebviewMessage,
  ChatAttachment,
  UserRoleItem,
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
let currentThinkingEl: HTMLElement | null = null;
let currentMessageEl: HTMLElement | null = null;
let thoughtTextBuf = '';
let serverCommands: Array<{ name: string; description: string }> = [];

const BUILTIN_SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/clear', desc: '清空当前会话消息与上下文' },
  { cmd: '/plan', desc: '切换至 Plan 架构规划模式' },
  { cmd: '/default', desc: '切换至 Default 正常编程模式' },
  { cmd: '/compact', desc: '压缩当前会话上下文 (节省 Token)' },
  { cmd: '/model', desc: '打开模型与角色切换面板' },
  { cmd: '/think', desc: '调整思考与推理强度 (Off/Auto/High/Max)' },
  { cmd: '/security', desc: '执行 OMP 项目安全审计与漏洞扫描' },
  { cmd: '/init', desc: '初始化项目配置与上下文规则' },
  { cmd: '/git', desc: '打开交互式 Git 版本管理' },
  { cmd: '/commit', desc: '智能分析差异并生成 Git 提交信息' },
  { cmd: '/export', desc: '导出当前会话为 HTML / Markdown' },
  { cmd: '/share', desc: '生成加密的会话在线分享链接' },
  { cmd: '/cost', desc: '查看当前会话 Token 消耗与成本统计' },
  { cmd: '/help', desc: '查看完整帮助指南与快捷键列表' },
];

const app = document.getElementById('app')!;

function post(msg: ChatHostMessage): void {
  vscode.postMessage(msg);
}

// Render Main App Skeleton (Claude Code High-End Aesthetics)
app.innerHTML = `
  <div class="chat-container">
    <!-- Top Header -->
    <div class="chat-header">
      <div class="header-left">
        <button id="btn-history" class="header-btn" title="历史会话">≡ 历史</button>
        <button id="btn-new" class="header-btn" title="开启新会话">＋ 新建</button>
      </div>
      <div class="header-right">
        <span id="badge-cwd" class="badge-cwd" title="当前工作目录">📁 --</span>
        <span id="badge-role" class="badge-role">🎯 Default</span>
      </div>
    </div>

    <!-- History Drawer (hidden by default) -->
    <div id="history-drawer" class="drawer hidden">
      <div class="drawer-header">
        <span>📜 历史会话</span>
        <button id="btn-close-history" class="header-btn">✕</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </div>

    <!-- Messages Flow Area -->
    <div id="messages-flow" class="messages-flow">
      <div id="welcome-view" class="welcome-view">
        <div class="welcome-logo">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 5h16v2.5h-4.8V19h-2.4V7.5H9.2V19H6.8V7.5H4V5z"/>
          </svg>
        </div>
        <h2>Oh My Pi</h2>
        <p class="welcome-subtitle">Your AI coding partner in VS Code</p>
        <div class="welcome-cwd-pill" id="welcome-cwd-box">
          <span class="cwd-icon">📁</span>
          <span id="welcome-cwd-text">--</span>
        </div>
        <div class="welcome-roles-quick">
          <span class="quick-title">选择角色开始：</span>
          <div id="welcome-roles-list" class="roles-chips"></div>
        </div>
      </div>
    </div>

    <!-- Bottom Input Container (Exact Claude Code Box) -->
    <div class="input-area">
      <!-- Attachment Pills -->
      <div id="attachment-pills" class="attachment-pills hidden"></div>

      <!-- Claude-styled Input Card -->
      <div class="claude-input-card">
        <textarea id="prompt-input" rows="1" placeholder="ctrl+alt+o to focus or unfocus Oh My Pi"></textarea>

        <!-- Bottom Toolbar inside the box -->
        <div class="claude-toolbar">
          <!-- Left side vector icons: + and [/] -->
          <div class="left-actions">
            <button id="btn-attach" class="action-btn" title="添加文件或图片">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button id="btn-slash" class="action-btn slash-btn" title="快捷斜杠命令 (/)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 17L15.5 7"/></svg>
            </button>
          </div>

          <!-- Right side selectors: Role/Model, Mode, Think, and Send ↑ -->
          <div class="right-actions">
            <div class="popover-wrapper">
              <button id="btn-role" class="pill-selector" title="选择角色与模型">🎯 Role: Default▾</button>
              <div id="popover-role" class="popover role-popover hidden">
                <div class="popover-section-title">已配置的角色 (Roles)</div>
                <div id="role-list" class="role-list"></div>
                <div class="popover-divider"></div>
                <div id="btn-toggle-all-models" class="popover-item footer-toggle">🌐 搜索全部底层模型 (200+)...</div>
                <div id="raw-models-section" class="raw-models-section hidden">
                  <input type="text" id="model-search" placeholder="搜索模型名称或厂商..." />
                  <div id="model-list" class="popover-list"></div>
                </div>
              </div>
            </div>

            <div class="popover-wrapper">
              <button id="btn-mode" class="pill-selector" title="选择模式">⚡ Mode▾</button>
              <div id="popover-mode" class="popover hidden"></div>
            </div>

            <div class="popover-wrapper">
              <button id="btn-think" class="pill-selector" title="思考强度">🧠 Think▾</button>
              <div id="popover-think" class="popover hidden"></div>
            </div>

            <!-- Rich Slash commands popover -->
            <div id="popover-slash" class="popover slash-popover hidden">
              <input type="text" id="slash-search" placeholder="搜索斜杠命令 (/)..." />
              <div id="slash-list" class="slash-list"></div>
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
  } else if (text === '/model') {
    closeAllPopoversExcept(popoverRole);
    popoverRole.classList.remove('hidden');
    promptInput.value = '';
    return;
  } else if (text === '/think') {
    closeAllPopoversExcept(popoverThink);
    popoverThink.classList.remove('hidden');
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
  thoughtTextBuf = '';
  currentThinkingEl = null;
  currentMessageEl = null;
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
  thoughtTextBuf += text;
  const container = ensureAssistantMessage();
  if (!currentThinkingEl) {
    currentThinkingEl = document.createElement('div');
    currentThinkingEl.className = 'thinking-card';
    currentThinkingEl.innerHTML = `
      <div class="thinking-header">
        <span class="pulse-dot"></span>
        <span class="thinking-title">深度思考中...</span>
        <span class="thinking-toggle">展开</span>
      </div>
      <div class="thinking-body"></div>
    `;
    const header = currentThinkingEl.querySelector('.thinking-header')!;
    const body = currentThinkingEl.querySelector('.thinking-body') as HTMLElement;
    const toggle = currentThinkingEl.querySelector('.thinking-toggle')!;
    header.addEventListener('click', () => {
      body.classList.toggle('collapsed');
      toggle.textContent = body.classList.contains('collapsed') ? '展开' : '折叠';
    });
    container.appendChild(currentThinkingEl);
  }
  const body = currentThinkingEl.querySelector('.thinking-body')!;
  body.textContent = thoughtTextBuf;
  scrollToBottom();
}

function appendMessageChunk(text: string): void {
  if (currentThinkingEl) {
    const title = currentThinkingEl.querySelector('.thinking-title');
    const dot = currentThinkingEl.querySelector('.pulse-dot');
    if (title) title.textContent = '💭 深度思考过程';
    if (dot) dot.remove();
  }

  // Check for 429 rate limit error in response
  if (text.includes('rate_limit_error') || (text.includes('429') && text.includes('error'))) {
    renderRateLimitCard(text);
    return;
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

function renderRateLimitCard(rawError: string): void {
  const container = ensureAssistantMessage();
  const card = document.createElement('div');
  card.className = 'rate-limit-card';
  const resetMatch = /reset at ([^\]]+)/.exec(rawError);
  const resetHint = resetMatch ? ` (预计重置时间: ${resetMatch[1]})` : '';
  card.innerHTML = `
    <div class="rl-header">⚠️ 触发模型速率限制 (Rate Limit)</div>
    <div class="rl-body">当前模型暂时达到频率或用量上限${resetHint}。建议点击下方一键切换备用模型继续对话：</div>
    <div class="rl-actions">
      <button class="rl-btn" data-role="designer">🎨 切换到 Designer (Gemini 3.7 Flash)</button>
      <button class="rl-btn" data-role="smol">⚡ 切换到 Smol (极速模型)</button>
    </div>
  `;
  card.querySelectorAll('.rl-btn').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const roleId = btn.getAttribute('data-role')!;
      post({ type: 'setRole', roleId });
      card.remove();
    };
  });
  container.appendChild(card);
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
const popoverRole = document.getElementById('popover-role')!;
const popoverMode = document.getElementById('popover-mode')!;
const popoverThink = document.getElementById('popover-think')!;
const popoverSlash = document.getElementById('popover-slash')!;
const btnRole = document.getElementById('btn-role')!;
const btnMode = document.getElementById('btn-mode')!;
const btnThink = document.getElementById('btn-think')!;
const btnSlash = document.getElementById('btn-slash')!;

function closeAllPopoversExcept(except?: HTMLElement): void {
  [popoverRole, popoverMode, popoverThink, popoverSlash].forEach((p) => {
    if (p !== except) p.classList.add('hidden');
  });
}

btnRole.onclick = () => {
  const isHidden = popoverRole.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) popoverRole.classList.remove('hidden');
};

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

btnSlash.onclick = () => {
  const isHidden = popoverSlash.classList.contains('hidden');
  closeAllPopoversExcept();
  if (isHidden) {
    popoverSlash.classList.remove('hidden');
    renderSlashCommandsList();
    (document.getElementById('slash-search') as HTMLInputElement).focus();
  }
};

// Render Slash Commands List with Search
function renderSlashCommandsList(filterText = ''): void {
  const slashListEl = document.getElementById('slash-list')!;
  const allCmds: Array<{ cmd: string; desc: string }> = [...BUILTIN_SLASH_COMMANDS];

  // Merge dynamic commands from server
  for (const sc of serverCommands) {
    const prefixed = sc.name.startsWith('/') ? sc.name : `/${sc.name}`;
    if (!allCmds.some((c) => c.cmd === prefixed)) {
      allCmds.push({ cmd: prefixed, desc: sc.description });
    }
  }

  const filtered = allCmds.filter(
    (c) => c.cmd.toLowerCase().includes(filterText) || c.desc.toLowerCase().includes(filterText)
  );

  slashListEl.innerHTML = filtered
    .map(
      (c) => `
    <div class="popover-item slash-item" data-cmd="${escapeHtml(c.cmd)}">
      <span class="slash-cmd">${escapeHtml(c.cmd)}</span>
      <span class="slash-desc">${escapeHtml(c.desc)}</span>
    </div>
  `
    )
    .join('');

  slashListEl.querySelectorAll('.slash-item').forEach((item) => {
    (item as HTMLElement).onclick = () => {
      const cmd = item.getAttribute('data-cmd')!;
      promptInput.value = cmd;
      popoverSlash.classList.add('hidden');
      handleSend();
    };
  });
}

const slashSearch = document.getElementById('slash-search') as HTMLInputElement;
slashSearch.oninput = () => renderSlashCommandsList(slashSearch.value.trim().toLowerCase());

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

// Toggle all models search section inside Role popover
document.getElementById('btn-toggle-all-models')!.onclick = () => {
  const rawSec = document.getElementById('raw-models-section')!;
  rawSec.classList.toggle('hidden');
  if (!rawSec.classList.contains('hidden')) {
    (document.getElementById('model-search') as HTMLInputElement).focus();
  }
};

// Render Roles & Config
function renderRolesList(roles: UserRoleItem[], currentActive: string): void {
  const activeRole = roles.find((r) => r.id === currentActive) || roles[0];

  if (activeRole) {
    btnRole.textContent = `${activeRole.icon} ${activeRole.id}▾`;
    document.getElementById('badge-role')!.textContent = `${activeRole.icon} ${activeRole.id}`;
  }

  const roleListEl = document.getElementById('role-list')!;
  roleListEl.innerHTML = roles
    .map(
      (r) => `
    <div class="popover-item role-item ${r.id === currentActive ? 'active' : ''}" data-role="${r.id}">
      <div class="item-name">${r.icon} <strong>${escapeHtml(r.name)}</strong></div>
      <div class="item-desc">${escapeHtml(r.model)} · 🧠 ${escapeHtml(r.thinking)}</div>
    </div>
  `
    )
    .join('');

  roleListEl.querySelectorAll('.role-item').forEach((item) => {
    (item as HTMLElement).onclick = () => {
      const roleId = item.getAttribute('data-role')!;
      post({ type: 'setRole', roleId });
      popoverRole.classList.add('hidden');
    };
  });

  // Welcome view chips
  const welcomeChips = document.getElementById('welcome-roles-list');
  if (welcomeChips) {
    welcomeChips.innerHTML = roles
      .map(
        (r) => `
      <button class="role-chip ${r.id === currentActive ? 'active' : ''}" data-role="${r.id}">
        ${r.icon} ${escapeHtml(r.name)}
      </button>
    `
      )
      .join('');
    welcomeChips.querySelectorAll('.role-chip').forEach((chip) => {
      (chip as HTMLButtonElement).onclick = () => {
        const roleId = chip.getAttribute('data-role')!;
        post({ type: 'setRole', roleId });
      };
    });
  }
}

// Render Config Popovers
function renderConfigOptions(options: ConfigOption[]): void {
  // 1. Mode Option
  const modeOpt = options.find((x) => x.id === 'mode');
  if (modeOpt) {
    const curr = String(modeOpt.currentValue);
    const currName = modeOpt.options?.find((o) => o.value === curr)?.name || curr;
    btnMode.textContent = `⚡ ${currName}▾`;

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

    popoverThink.innerHTML = (thinkOpt.options || [
      { value: 'off', name: 'Off (关闭)' },
      { value: 'auto', name: 'Auto (自动)' },
      { value: 'low', name: 'Low (轻度)' },
      { value: 'high', name: 'High (深度)' },
      { value: 'max', name: 'Max (极限)' },
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

  // 3. Raw Models Fallback Search
  const modelOpt = options.find((x) => x.id === 'model');
  if (modelOpt) {
    const curr = String(modelOpt.currentValue);
    const modelListEl = document.getElementById('model-list')!;
    const searchInput = document.getElementById('model-search') as HTMLInputElement;

    const renderList = (filterText = '') => {
      const filtered = (modelOpt.options || []).filter(
        (o) => o.name.toLowerCase().includes(filterText) || o.value.toLowerCase().includes(filterText)
      );
      modelListEl.innerHTML = filtered
        .slice(0, 50)
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
          popoverRole.classList.add('hidden');
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
      if (m.roles && m.roles.length > 0) {
        renderRolesList(m.roles, m.activeRoleId || 'default');
      }
      if (m.configOptions && m.configOptions.length > 0) {
        renderConfigOptions(m.configOptions);
      }
      break;
    }
    case 'availableCommands': {
      serverCommands = m.commands || [];
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
      if (currentThinkingEl) {
        const title = currentThinkingEl.querySelector('.thinking-title');
        const dot = currentThinkingEl.querySelector('.pulse-dot');
        if (title) title.textContent = '💭 深度思考完成';
        if (dot) dot.remove();
      }
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
  html, body, #app { height: 100%; margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); overflow: hidden; }
  .chat-container { display: flex; flex-direction: column; height: 100%; position: relative; }
  
  .chat-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid var(--vscode-widget-border, #333); min-height: 34px; background: var(--vscode-sideBar-background); }
  .header-left, .header-right { display: flex; align-items: center; gap: 6px; }
  .header-btn { background: transparent; border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1)); color: var(--vscode-foreground); cursor: pointer; padding: 2px 8px; font-size: 11px; border-radius: 4px; }
  .header-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .badge-cwd { font-size: 11px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--vscode-descriptionForeground); cursor: help; }
  .badge-role { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }

  .drawer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 50; background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  .drawer-header { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--vscode-widget-border); font-weight: bold; }
  .history-list { flex: 1; overflow-y: auto; padding: 8px; }
  .history-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; border: 1px solid transparent; }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-color: var(--vscode-focusBorder); }
  .history-title { font-size: 12px; font-weight: 500; }
  .history-date { font-size: 10px; opacity: 0.65; margin-top: 2px; }

  .messages-flow { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; }
  
  /* Welcome View */
  .welcome-view { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); display: flex; flex-direction: column; align-items: center; max-width: 90%; }
  .welcome-logo { color: var(--vscode-foreground); opacity: 0.9; margin-bottom: 4px; }
  .welcome-view h2 { margin: 4px 0 2px; font-size: 20px; font-weight: 600; color: var(--vscode-editor-foreground); }
  .welcome-subtitle { margin: 0; font-size: 12px; opacity: 0.75; }
  .welcome-cwd-pill { margin-top: 12px; font-size: 11px; padding: 4px 12px; border-radius: 14px; background: var(--vscode-input-background, #252526); border: 1px solid var(--vscode-widget-border, #3c3c3c); word-break: break-all; color: var(--vscode-descriptionForeground); }
  
  .welcome-roles-quick { margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .quick-title { font-size: 11px; opacity: 0.7; }
  .roles-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .role-chip { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1)); border-radius: 14px; padding: 4px 10px; font-size: 11px; cursor: pointer; transition: all 0.15s ease; }
  .role-chip:hover { filter: brightness(1.2); }
  .role-chip.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); }

  /* Message Bubbles */
  .message { display: flex; flex-direction: column; gap: 4px; max-width: 96%; }
  .user-message { align-self: flex-end; background: var(--vscode-input-background, #2d2d2d); padding: 9px 14px; border-radius: 12px 12px 2px 12px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
  .user-message .msg-text { font-size: 13px; line-height: 1.5; }
  
  .assistant-message { align-self: flex-start; width: 100%; }
  .assistant-text { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--vscode-editor-foreground); padding: 2px 4px; }

  /* Thinking Box */
  .thinking-card {
    border: 1px solid var(--vscode-widget-border, #3a3a3a);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.25);
    margin: 6px 0 10px;
    overflow: hidden;
  }
  .thinking-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    user-select: none;
  }
  .thinking-header:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #007acc;
    box-shadow: 0 0 8px #007acc;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.7; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.7; }
  }
  .thinking-title { flex: 1; opacity: 0.85; }
  .thinking-toggle { font-size: 10px; opacity: 0.5; }
  .thinking-body {
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.75;
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  .thinking-body.collapsed { display: none; }

  /* Rate Limit Warning Card */
  .rate-limit-card {
    border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
    background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,0.15));
    border-radius: 8px;
    padding: 10px 12px;
    margin: 8px 0;
  }
  .rl-header { font-size: 12px; font-weight: bold; color: var(--vscode-editorWarning-foreground, #ffcc00); margin-bottom: 4px; }
  .rl-body { font-size: 11px; line-height: 1.4; opacity: 0.85; margin-bottom: 8px; }
  .rl-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .rl-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
  .rl-btn:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

  /* Tool & Permission Cards */
  .tool-card { border: 1px solid var(--vscode-widget-border, #3a3a3a); border-radius: 6px; padding: 8px 10px; margin: 6px 0; background: var(--vscode-editorWidget-background); font-size: 12px; }
  .tool-header { display: flex; justify-content: space-between; font-weight: 500; }
  .tool-status.status-completed { color: var(--vscode-testing-iconPassed); }
  .tool-status.status-failed { color: var(--vscode-testing-iconFailed); }
  .tool-input, .tool-output { background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 6px 0 0; }

  .permission-card { border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); border-radius: 8px; padding: 10px 12px; margin: 8px 0; font-size: 12px; }
  .perm-header { font-weight: bold; margin-bottom: 4px; }
  .perm-input { font-size: 11px; margin: 6px 0; background: rgba(0,0,0,0.25); padding: 6px; border-radius: 4px; }
  .perm-actions { display: flex; gap: 6px; margin-top: 8px; }
  .perm-btn { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: none; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .perm-btn.opt-allow_once, .perm-btn.opt-allow_always { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

  /* Input Area (Claude Code 1:1 Box) */
  .input-area { flex-shrink: 0; padding: 8px 12px 12px; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-widget-border, #333); }
  .attachment-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 8px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .pill-remove { background: transparent; border: none; color: inherit; cursor: pointer; padding: 0 2px; }

  .claude-input-card {
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 8px;
    background: var(--vscode-input-background, #252526);
    padding: 8px 10px 6px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
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

  .left-actions { display: flex; gap: 6px; align-items: center; }

  /* Crisp Vector Action Buttons */
  .action-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--vscode-foreground);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s ease;
  }
  .action-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.12));
    border-color: rgba(255, 255, 255, 0.25);
    transform: translateY(-1px);
  }
  .action-btn:active {
    transform: translateY(0);
  }

  .right-actions { display: flex; gap: 6px; align-items: center; position: relative; }

  .pill-selector {
    background: transparent;
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.15));
    color: var(--vscode-foreground);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.85;
    white-space: nowrap;
    transition: all 0.15s ease;
  }
  .pill-selector:hover {
    background: var(--vscode-toolbar-hoverBackground);
    opacity: 1;
    border-color: var(--vscode-focusBorder);
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
  .send-arrow-btn:hover { filter: brightness(1.15); }
  .send-arrow-btn.stop-btn { background: #d32f2f; }

  /* Popovers */
  .popover-wrapper { position: relative; }
  .popover {
    position: absolute;
    bottom: 32px;
    right: 0;
    z-index: 50;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #454545);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.45);
    min-width: 170px;
    max-height: 280px;
    overflow-y: auto;
    padding: 6px;
  }
  .popover-section-title { font-size: 10px; font-weight: bold; opacity: 0.6; padding: 4px 8px; text-transform: uppercase; }
  .popover-divider { height: 1px; background: var(--vscode-widget-border, #3a3a3a); margin: 4px 0; }
  .popover-item { padding: 6px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; }
  .popover-item:hover { background: var(--vscode-list-hoverBackground); }
  .popover-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .item-desc { font-size: 10px; opacity: 0.65; margin-top: 2px; }
  
  .role-popover { min-width: 260px; }
  .footer-toggle { font-size: 11px; opacity: 0.8; padding: 6px 8px; color: var(--vscode-textLink-foreground); }
  .raw-models-section { margin-top: 6px; border-top: 1px solid var(--vscode-widget-border); padding-top: 6px; }

  /* Slash Popover Layout */
  .slash-popover { left: 0; right: auto; min-width: 280px; max-height: 320px; }
  #slash-search { padding: 6px 8px; font-size: 11px; margin-bottom: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; width: 100%; }
  .slash-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .slash-item { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 6px 10px; border-radius: 4px; }
  .slash-cmd { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; color: #4ec9b0; font-size: 12px; white-space: nowrap; }
  .slash-desc { font-size: 11px; opacity: 0.75; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  #model-search { padding: 4px 8px; font-size: 11px; margin-bottom: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; width: 100%; }
  .popover-list { max-height: 140px; overflow-y: auto; }

  .error-card { color: var(--vscode-errorForeground); padding: 8px; font-size: 12px; background: rgba(255,0,0,0.1); border-radius: 6px; margin: 4px 0; }
  .hidden { display: none !important; }
`;
document.head.appendChild(style);

post({ type: 'ready' });
