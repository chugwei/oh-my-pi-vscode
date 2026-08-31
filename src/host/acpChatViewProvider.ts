import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AcpClient } from './acp/client.js';
import { ModePresetResolver } from './acp/modePresets.js';
import type {
  ChatHostMessage,
  ChatWebviewMessage,
  ChatMessageItem,
} from '../webview/chatProtocol.js';
import type { ContentBlock, RequestPermissionParams, ToolCallPayload } from './acp/types.js';

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
        const tc: ToolCallPayload = {
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          status: update.status,
          rawInput: update.rawInput,
          content: update.content,
        };
        this.postMessage({ type: 'toolCall', toolCall: tc });
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
      const { promise, resolve } = Promise.withResolvers<string | null>();
      const id = params.toolCall.toolCallId;
      this.pendingPermissions.set(id, resolve);
      this.postMessage({
        type: 'permissionRequest',
        toolCallId: id,
        toolCall: params.toolCall,
        options: params.options,
      });
      return promise;
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.ctx.extensionUri],
    };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage((m: ChatHostMessage) => {
      void this.handleWebviewMessage(m);
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
          await this.acp.setConfigOption(this.currentSessionId, 'mode', m.mode);
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
    const filters: Record<string, string[]> = kind === 'image'
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
