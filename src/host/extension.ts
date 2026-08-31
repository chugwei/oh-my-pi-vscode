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
    { dispose: () => manager.disposeAll() },
  );

  return { manager };
}

export function deactivate(): void {
  // cleanup happens via the subscriptions dispose hook registered in activate
}
