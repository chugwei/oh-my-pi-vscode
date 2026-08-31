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
