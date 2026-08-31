import type * as nodePtyModule from 'node-pty';
import type { PtyFactory, PtyLike, PtySpawnOptions } from './sessionManager.js';

type NodePty = typeof nodePtyModule;

export class NodePtyFactory implements PtyFactory {
  readonly loadError: string | null;
  private readonly mod: NodePty | null;

  constructor() {
    let mod: NodePty | null = null;
    let loadError: string | null = null;
    try {
      mod = require('node-pty') as NodePty;
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
    this.mod = mod;
    this.loadError = loadError;
  }

  spawn(opts: PtySpawnOptions): PtyLike {
    if (!this.mod) {
      throw new Error(`node-pty failed to load: ${this.loadError}`);
    }
    return this.mod.spawn(opts.file, opts.args, {
      name: opts.name,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: opts.env,
    });
  }
}
