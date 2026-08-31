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
    provider.post({ type: 'key', chord });
    return;
  }
  const fallback = FALLBACK_COMMANDS[chord];
  if (fallback) {
    await vscode.commands.executeCommand(fallback);
  }
}
