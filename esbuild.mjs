import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const host = {
  entryPoints: ['src/host/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'node-pty'],
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const terminalWebview = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outdir: 'dist/webview',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const chatWebview = {
  entryPoints: ['src/webview/chat/main.ts'],
  bundle: true,
  outdir: 'dist/webview/chat',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

// Create placeholder for chat entrypoint if it doesn't exist yet
import * as fs from 'node:fs';
if (!fs.existsSync('src/webview/chat/main.ts')) {
  fs.mkdirSync('src/webview/chat', { recursive: true });
  fs.writeFileSync('src/webview/chat/main.ts', '// chat main placeholder\n');
}

if (watch) {
  const ctx1 = await context(host);
  const ctx2 = await context(terminalWebview);
  const ctx3 = await context(chatWebview);
  await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch()]);
} else {
  await build(host);
  await build(terminalWebview);
  await build(chatWebview);
}
