/// <reference lib="es2024" />
/// <reference types="mocha" />
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXT_ID = 'omp-dev.oh-my-pi-vscode';

/** Minimal structural type of the API activate() returns. */
interface OmpApi {
  manager: {
    create: () => { id: string };
    onOutput: (cb: (e: { sessionId: string; data: string }) => void) => void;
    onClosed: (cb: (e: { sessionId: string }) => void) => void;
    close: (id: string) => void;
    disposeAll: () => void;
  };
}

suite('omp extension smoke', () => {
  test('activates and creates a session that produces output', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    const api = (await ext.activate()) as OmpApi;
    assert.ok(api.manager, 'activate() must return { manager }');

    const created = api.manager.create();
    const { promise: got, resolve: gotOutput, reject: noOutput } =
      Promise.withResolvers<string>();
    let buf = '';
    // Real platform clock: omp runs as a live ConPTY child, so completion is
    // observed via its output/exit events; the timer is only a failure guard.
    const timer = setTimeout(
      () => noOutput(new Error(`no output within 15s, got: ${JSON.stringify(buf)}`)),
      15_000,
    );
    api.manager.onOutput((e) => {
      if (e.sessionId === created.id && buf.length === 0) {
        buf += e.data;
        clearTimeout(timer);
        gotOutput(buf);
      }
    });
    assert.ok((await got).length > 0, 'omp TUI must emit bytes on startup');

    // close() emits `closed` synchronously after pty kill — await the event,
    // not a guessed settle delay.
    const { promise: closed, resolve: closedNow } = Promise.withResolvers<string>();
    api.manager.onClosed((e) => {
      if (e.sessionId === created.id) closedNow(e.sessionId);
    });
    api.manager.close(created.id);
    assert.equal(await closed, created.id);
  }).timeout(30_000);

  test('omp-vscode.openInEditor creates a terminal', async () => {
    const before = vscode.window.terminals.length;
    await vscode.commands.executeCommand('omp-vscode.openInEditor');
    assert.equal(vscode.window.terminals.length, before + 1);
    const t = vscode.window.terminals[vscode.window.terminals.length - 1];
    t.dispose();
  });
});
