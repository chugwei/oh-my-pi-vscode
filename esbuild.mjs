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
const webview = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outdir: 'dist/webview',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(host);
  const ctx2 = await context(webview);
  await Promise.all([ctx.watch(), ctx2.watch()]);
} else {
  await build(host);
  await build(webview);
}
