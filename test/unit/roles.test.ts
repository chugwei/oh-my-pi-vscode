import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OmpConfigLoader } from '../../src/host/acp/roles.js';

test('OmpConfigLoader loads roles from config.yml or returns defaults', () => {
  const roles = OmpConfigLoader.loadUserRoles();
  assert.ok(roles.length > 0);
  assert.ok(roles.some((r) => r.id === 'default'));
  const defaultRole = roles.find((r) => r.id === 'default')!;
  assert.equal(defaultRole.id, 'default');
  assert.ok(defaultRole.model);
  assert.ok(defaultRole.thinking);
});
