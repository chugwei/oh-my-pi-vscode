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
