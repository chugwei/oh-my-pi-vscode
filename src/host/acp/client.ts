import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  InitializeParams,
  InitializeResult,
  SessionNewParams,
  SessionNewResult,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  SetConfigOptionParams,
  SetConfigOptionResult,
  SessionPromptParams,
  SessionPromptResult,
  ContentBlock,
  RequestPermissionParams,
  SessionUpdateNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';

export interface ProcessLike {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: string): void;
  onExit(cb: (code: number) => void): void;
}

export type PermissionHandler = (params: RequestPermissionParams) => Promise<string | null>;

export class AcpClient {
  private proc: ProcessLike | null = null;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (res: unknown) => void; reject: (err: Error) => void }>();
  private readonly events = new EventEmitter();
  private permissionHandler: PermissionHandler | null = null;
  private stdoutBuf = '';

  constructor(private readonly processFactory?: () => ProcessLike) {
    this.events.setMaxListeners(50);
  }

  private ensureProcess(): ProcessLike {
    if (this.proc) return this.proc;

    if (this.processFactory) {
      this.proc = this.processFactory();
    } else {
      const cp = spawn('omp', ['acp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      this.proc = {
        stdin: cp.stdin!,
        stdout: cp.stdout!,
        stderr: cp.stderr!,
        kill: (sig) => cp.kill(sig as NodeJS.Signals | undefined),
        onExit: (cb) => cp.on('exit', (c) => cb(c ?? 0)),
      };
    }

    this.proc.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuf += chunk.toString();
      let idx: number;
      while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
        const line = this.stdoutBuf.slice(0, idx).trim();
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (line) this.handleMessage(line);
      }
    });

    this.proc.onExit((code) => {
      this.proc = null;
      this.events.emit('exit', code);
      for (const { reject } of this.pending.values()) {
        reject(new Error(`ACP process exited with code ${code}`));
      }
      this.pending.clear();
    });

    return this.proc;
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // Response to client request
    const msgId = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    if (msgId !== null && this.pending.has(msgId)) {
      const { resolve, reject } = this.pending.get(msgId)!;
      this.pending.delete(msgId);
      if (msg.error && typeof msg.error === 'object' && msg.error !== null) {
        const errObj = msg.error as { message?: string };
        reject(new Error(errObj.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Server request (e.g. session/request_permission)
    if (typeof msg.method === 'string' && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
      void this.handleServerRequest(msg as unknown as JsonRpcRequest<unknown>);
      return;
    }

    // Server notification (e.g. session/update)
    if (msg.method === 'session/update' && msg.params && typeof msg.params === 'object') {
      const p = msg.params as { update?: unknown };
      if (p.update) this.events.emit('update', p.update);
    }
  }

  private async handleServerRequest(msg: JsonRpcRequest<unknown>): Promise<void> {
    if (msg.method === 'session/request_permission') {
      const params = msg.params as RequestPermissionParams;
      let optionId: string | null = null;
      if (this.permissionHandler) {
        try {
          optionId = await this.permissionHandler(params);
        } catch {
          optionId = null;
        }
      }
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: optionId
          ? { outcome: { outcome: 'selected', optionId } }
          : { outcome: { outcome: 'cancelled' } },
      };
      this.sendRaw(response);
    } else {
      // Unknown request - send empty ok or error
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {},
      };
      this.sendRaw(response);
    }
  }

  private sendRaw(obj: unknown): void {
    const proc = this.ensureProcess();
    proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  private request<TRes, TParams = unknown>(method: string, params?: TParams, timeoutMs = 60000): Promise<TRes> {
    const { promise, resolve, reject } = Promise.withResolvers<TRes>();
    const id = this.nextId++;
    const timer = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        reject(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    this.pending.set(id, {
      resolve: (val) => {
        clearTimeout(timer);
        resolve(val as TRes);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    this.sendRaw({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  private notify<TParams = unknown>(method: string, params?: TParams): void {
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }

  onRequestPermission(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  onUpdate(cb: (update: SessionUpdateNotification) => void): void {
    this.events.on('update', cb);
  }

  onExit(cb: (code: number) => void): void {
    this.events.on('exit', cb);
  }

  async initialize(): Promise<InitializeResult> {
    return this.request<InitializeResult, InitializeParams>('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
  }

  async newSession(cwd: string): Promise<SessionNewResult> {
    return this.request<SessionNewResult, SessionNewParams>('session/new', { cwd, mcpServers: [] });
  }

  async listSessions(cwd?: string): Promise<SessionListResult> {
    return this.request<SessionListResult, SessionListParams>('session/list', { cwd });
  }

  async loadSession(sessionId: string, cwd?: string): Promise<SessionLoadResult> {
    return this.request<SessionLoadResult, SessionLoadParams>('session/load', { sessionId, cwd });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SetConfigOptionResult> {
    return this.request<SetConfigOptionResult, SetConfigOptionParams>('session/set_config_option', {
      sessionId,
      configId,
      value,
    });
  }

  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<SessionPromptResult> {
    return this.request<SessionPromptResult, SessionPromptParams>('session/prompt', { sessionId, prompt }, 300000);
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }

  dispose(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}
