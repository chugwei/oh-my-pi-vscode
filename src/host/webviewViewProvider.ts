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
