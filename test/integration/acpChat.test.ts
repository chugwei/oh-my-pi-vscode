import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { OmpExtensionApi } from '../../src/host/extension.js';

const EXT_ID = 'omp-dev.oh-my-pi-vscode';

suite('omp acp chat integration smoke', () => {
  test('activates extension and initializes acp client', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    const api = (await ext.activate()) as OmpExtensionApi;
    assert.ok(api.acpClient, 'activate() must return { acpClient }');

    const init = await api.acpClient.initialize();
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.agentInfo?.name, 'oh-my-pi');

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const session = await api.acpClient.newSession(cwd);
    assert.ok(session.sessionId);

    // Test mode switch
    const setMode = await api.acpClient.setConfigOption(session.sessionId, 'mode', 'plan');
    const modeVal = setMode.configOptions.find((x) => x.id === 'mode')?.currentValue;
    assert.equal(modeVal, 'plan');
  }).timeout(30_000);
});
