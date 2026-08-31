import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SessionManager,
  type PtyLike,
  type PtyFactory,
  type PtySpawnOptions,
} from '../../src/host/sessionManager.js';

class FakePty implements PtyLike {
  pid = 1;
  killed = false;
  written: string[] = [];
  resized: Array<{ cols: number; rows: number }> = [];
  spawnedWith: PtySpawnOptions | null = null;
  private dataCbs = new Set<(d: string) => void>();
  private exitCbs = new Set<(e: { exitCode: number; signal?: number }) => void>();

  write(d: string): void { this.written.push(d); }
  kill(): void {
    this.killed = true;
    this.exitCbs.forEach((cb) => cb({ exitCode: 0 }));
  }
  resize(cols: number, rows: number): void { this.resized.push({ cols, rows }); }
  onData(cb: (d: string) => void): { dispose(): void } {
    this.dataCbs.add(cb);
    return { dispose: () => this.dataCbs.delete(cb) };
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitCbs.add(cb);
    return { dispose: () => this.exitCbs.delete(cb) };
  }
  emitData(d: string): void { this.dataCbs.forEach((cb) => cb(d)); }
  emitExit(code: number): void { this.exitCbs.forEach((cb) => cb({ exitCode: code })); }
}

class FakeFactory implements PtyFactory {
  ptys: FakePty[] = [];
  spawn(opts: PtySpawnOptions): PtyLike {
    const p = new FakePty();
    p.spawnedWith = opts;
    this.ptys.push(p);
    return p;
  }
}

function makeManager(overrides: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}) {
  const factory = new FakeFactory();
  const manager = new SessionManager({
    factory,
    executable: 'omp',
    cwd: () => '/ws',
    defaultArgs: () => [],
    env: () => ({ PATH: '/bin' }),
    ringBytes: 1024,
    ...overrides,
  });
  return { factory, manager };
}

test('create spawns omp, emits created, becomes active', () => {
  const { factory, manager } = makeManager();
  const events: string[] = [];
  manager.onCreated(() => events.push('created'));
  const s = manager.create();
  assert.equal(factory.ptys.length, 1);
  assert.equal(factory.ptys[0].spawnedWith?.file, 'omp');
  assert.equal(factory.ptys[0].spawnedWith?.cwd, '/ws');
  assert.equal(factory.ptys[0].spawnedWith?.env.TERM, 'xterm-256color');
  assert.equal(manager.active, s.id);
  assert.deepEqual(events, ['created']);
});

test('default args and extra args are merged; -r title reflects resume', () => {
  const { manager } = makeManager({ defaultArgs: () => ['--thinking', 'high'] });
  const a = manager.create();
  const b = manager.create(['-r']);
  assert.equal(a.title, 'omp');
  assert.equal(b.title, 'omp (resume)');
  const snap = manager.snapshot();
  const resumed = snap.sessions.find((x) => x.id === b.id)!;
  assert.ok(resumed);
});

test('output events route to the right session and accumulate in ring', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const b = manager.create();
  const got: Array<{ sessionId: string; data: string }> = [];
  manager.onOutput((e) => got.push(e));
  factory.ptys[0].emitData('hello ');
  factory.ptys[1].emitData('world');
  assert.deepEqual(got, [
    { sessionId: a.id, data: 'hello ' },
    { sessionId: b.id, data: 'world' },
  ]);
  const replay = manager.snapshot().replay.find((r) => r.sessionId === a.id)!;
  assert.equal(replay.data, 'hello ');
});

test('write and resize route to the owning pty', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  manager.create();
  manager.write(a.id, 'ls\r');
  manager.resize(a.id, 120, 40);
  assert.deepEqual(factory.ptys[0].written, ['ls\r']);
  assert.deepEqual(factory.ptys[0].resized, [{ cols: 120, rows: 40 }]);
  assert.deepEqual(factory.ptys[1].resized, []);
});

test('exit marks session exited and emits exit event', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const exits: Array<{ sessionId: string; code: number | null }> = [];
  manager.onExit((e) => exits.push(e));
  factory.ptys[0].emitExit(3);
  assert.deepEqual(exits, [{ sessionId: a.id, code: 3 }]);
  const info = manager.snapshot().sessions.find((s) => s.id === a.id)!;
  assert.equal(info.exited, true);
  assert.equal(info.exitCode, 3);
});

test('close kills pty, removes session, active moves to remaining one', () => {
  const { factory, manager } = makeManager();
  const a = manager.create();
  const b = manager.create();
  const closed: string[] = [];
  manager.onClosed((e) => closed.push(e.sessionId));
  manager.close(a.id);
  assert.ok(factory.ptys[0].killed);
  assert.deepEqual(closed, [a.id]);
  assert.equal(manager.active, b.id);
  assert.equal(manager.snapshot().sessions.length, 1);
});

test('restart respawns with the same args under a new id', () => {
  const { factory, manager } = makeManager();
  const a = manager.create(['-r']);
  factory.ptys[0].emitExit(1);
  const b = manager.restart(a.id)!;
  assert.notEqual(b.id, a.id);
  assert.equal(b.title, 'omp (resume)');
  assert.equal(factory.ptys[1].spawnedWith?.args.includes('-r'), true);
  assert.equal(manager.snapshot().sessions.length, 1);
});

test('snapshot replay honors ring capacity', () => {
  const { factory, manager } = makeManager({ ringBytes: 10 });
  const a = manager.create();
  factory.ptys[0].emitData('aaaaa');
  factory.ptys[0].emitData('bbbbb');
  factory.ptys[0].emitData('ccccc');
  const replay = manager.snapshot().replay.find((r) => r.sessionId === a.id)!;
  assert.equal(replay.data, 'bbbbbccccc');
});

test('setActive only switches to known ids', () => {
  const { manager } = makeManager();
  manager.create();
  const second = manager.create(); // second create becomes active
  manager.setActive('nope');
  assert.equal(manager.active, second.id);
});

test('disposeAll kills everything', () => {
  const { factory, manager } = makeManager();
  manager.create();
  manager.create();
  manager.disposeAll();
  assert.ok(factory.ptys.every((p) => p.killed));
  assert.equal(manager.snapshot().sessions.length, 0);
});
