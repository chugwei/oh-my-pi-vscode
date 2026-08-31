import { EventEmitter } from 'node:events';
import { RingBuffer } from './ring.js';
import type { SessionInfo, SnapshotPayload } from '../webview/protocol.js';

export interface PtyLike {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface PtySpawnOptions {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  name: string;
}

export interface PtyFactory {
  spawn(opts: PtySpawnOptions): PtyLike;
}

export interface SessionManagerOptions {
  factory: PtyFactory;
  executable: string;
  cwd: () => string;
  defaultArgs: () => string[];
  env: () => Record<string, string>;
  ringBytes?: number;
}

interface InternalSession {
  info: SessionInfo;
  pty: PtyLike;
  ring: RingBuffer;
  args: string[];
}

interface ManagerEvents {
  created: { session: SessionInfo; activeId: string };
  output: { sessionId: string; data: string };
  exit: { sessionId: string; code: number | null };
  closed: { sessionId: string };
}

export class SessionManager {
  private readonly events = new EventEmitter();
  private readonly sessions = new Map<string, InternalSession>();
  private activeId: string | null = null;
  private nextId = 1;

  constructor(private readonly opts: SessionManagerOptions) {
    this.events.setMaxListeners(50);
  }

  get active(): string | null {
    return this.activeId;
  }

  onCreated(cb: (e: ManagerEvents['created']) => void): void { this.events.on('created', cb); }
  onOutput(cb: (e: ManagerEvents['output']) => void): void { this.events.on('output', cb); }
  onExit(cb: (e: ManagerEvents['exit']) => void): void { this.events.on('exit', cb); }
  onClosed(cb: (e: ManagerEvents['closed']) => void): void { this.events.on('closed', cb); }

  create(args: string[] = [], size?: { cols: number; rows: number }): SessionInfo {
    const id = `s${this.nextId++}`;
    const mergedArgs = [...this.opts.defaultArgs(), ...args];
    const pty = this.opts.factory.spawn({
      file: this.opts.executable,
      args: mergedArgs,
      cwd: this.opts.cwd(),
      cols: size?.cols ?? 80,
      rows: size?.rows ?? 24,
      env: { ...this.opts.env(), TERM: 'xterm-256color' },
      name: 'xterm-256color',
    });
    const isResume = mergedArgs.includes('-r') || mergedArgs.includes('--resume') || mergedArgs.includes('--continue') || mergedArgs.includes('-c');
    const session: InternalSession = {
      info: { id, title: isResume ? 'omp (resume)' : 'omp', exited: false, exitCode: null, createdAt: Date.now() },
      pty,
      ring: new RingBuffer(this.opts.ringBytes ?? 4 * 1024 * 1024),
      args,
    };
    pty.onData((d) => {
      session.ring.push(d);
      this.events.emit('output', { sessionId: id, data: d });
    });
    pty.onExit((e) => {
      session.info.exited = true;
      session.info.exitCode = e.exitCode ?? null;
      this.events.emit('exit', { sessionId: id, code: session.info.exitCode });
    });
    this.sessions.set(id, session);
    this.activeId = id;
    this.events.emit('created', { session: session.info, activeId: id });
    return session.info;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.pty.resize(cols, rows);
    } catch {
      // resizing an exited pty throws on some platforms; safe to ignore
    }
  }

  setActive(id: string): void {
    if (this.sessions.has(id)) {
      this.activeId = id;
    }
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) {
      return;
    }
    this.sessions.delete(id);
    try {
      s.pty.kill();
    } catch {
      // already dead
    }
    if (this.activeId === id) {
      this.activeId = [...this.sessions.keys()].pop() ?? null;
    }
    this.events.emit('closed', { sessionId: id });
  }

  restart(id: string): SessionInfo | null {
    const s = this.sessions.get(id);
    if (!s) {
      return null;
    }
    const args = s.args;
    this.close(id);
    return this.create(args);
  }

  snapshot(): SnapshotPayload {
    return {
      sessions: [...this.sessions.values()].map((s) => ({ ...s.info })),
      activeId: this.activeId,
      replay: [...this.sessions.values()].map((s) => ({ sessionId: s.info.id, data: s.ring.data() })),
    };
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) {
      try {
        s.pty.kill();
      } catch {
        // already dead
      }
    }
    this.sessions.clear();
    this.activeId = null;
  }
}
