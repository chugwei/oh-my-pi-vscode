import { defineConfig } from '@vscode/test-cli';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Reuse the locally installed VS Code instead of downloading a test copy.
// In @vscode/test-cli 0.0.10 this is `useInstallation.fromPath`, which the CLI
// maps to runTests({ vscodeExecutablePath }) from @vscode/test-electron.
const local =
  process.env.LOCALAPPDATA &&
  join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
const executablePath = local && existsSync(local) ? local : undefined;

// The extension host cannot require .ts files, so compile the integration
// tests to a single CJS bundle first ('vscode' stays external and is provided
// by the extension host at runtime). Output dir is gitignored.
await build({
  entryPoints: [
    'test/integration/extension.test.ts',
    'test/integration/acpChat.test.ts',
  ],
  outdir: '.vscode-test/integration',
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'silent',
});

export default defineConfig({
  files: '.vscode-test/integration/**/*.test.js',
  ...(executablePath ? { useInstallation: { fromPath: executablePath } } : {}),
});
