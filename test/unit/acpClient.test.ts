import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { AcpClient, type ProcessLike } from '../../src/host/acp/client.js';

class MockProcess implements ProcessLike {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  private exitCbs: Array<(code: number) => void> = [];

  kill(): void {
    this.killed = true;
    this.exitCbs.forEach((cb) => cb(0));
  }

  onExit(cb: (code: number) => void): void {
    this.exitCbs.push(cb);
  }

  emitServerMessage(msg: unknown): void {
    this.stdout.write(JSON.stringify(msg) + '\n');
  }
}

test('AcpClient initializes and handles request/response', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);

  const initPromise = client.initialize();

  // Mock server responds to initialize
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'initialize');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: { protocolVersion: 1, agentInfo: { name: 'omp-test' } }
    });
  });

  const res = await initPromise;
  assert.equal(res.protocolVersion, 1);
  assert.equal(res.agentInfo?.name, 'omp-test');
});

test('AcpClient handles session/new and set_config_option', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);
  void client.initialize();

  // Auto-respond to init
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    proc.emitServerMessage({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1 } });
  });
  await new Promise((r) => setTimeout(r, 10));

  const newPromise = client.newSession('/test/dir');
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'session/new');
    assert.equal(req.params.cwd, '/test/dir');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        sessionId: 'sess_1',
        configOptions: [
          { id: 'mode', name: 'Mode', type: 'select', currentValue: 'default' }
        ]
      }
    });
  });

  const session = await newPromise;
  assert.equal(session.sessionId, 'sess_1');

  // Test set_config_option
  const setPromise = client.setConfigOption('sess_1', 'mode', 'plan');
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    assert.equal(req.method, 'session/set_config_option');
    assert.equal(req.params.configId, 'mode');
    assert.equal(req.params.value, 'plan');
    proc.emitServerMessage({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'plan' }]
      }
    });
  });

  const setRes = await setPromise;
  assert.equal(setRes.configOptions[0].currentValue, 'plan');
});

test('AcpClient dispatches session updates and handles permission request', async () => {
  const proc = new MockProcess();
  const client = new AcpClient(() => proc);
  void client.initialize();
  proc.stdin.once('data', (d) => {
    const req = JSON.parse(d.toString());
    proc.emitServerMessage({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1 } });
  });
  await new Promise((r) => setTimeout(r, 10));

  const updates: unknown[] = [];
  client.onUpdate((u) => updates.push(u));

  const permRequests: unknown[] = [];
  client.onRequestPermission(async (p) => {
    permRequests.push(p);
    return 'allow_once';
  });

  // Emit an update notification
  proc.emitServerMessage({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'sess_1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' }
      }
    }
  });

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Hello' }
  });

  // Emit a permission request from server
  proc.stdin.once('data', (d) => {
    const resp = JSON.parse(d.toString());
    assert.equal(resp.id, 99);
    assert.deepEqual(resp.result, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
  });

  proc.emitServerMessage({
    jsonrpc: '2.0',
    id: 99,
    method: 'session/request_permission',
    params: {
      sessionId: 'sess_1',
      toolCall: { toolCallId: 'c1', title: 'run echo', status: 'pending' },
      options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }]
    }
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(permRequests.length, 1);
});
