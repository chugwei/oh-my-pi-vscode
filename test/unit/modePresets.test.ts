import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModePresetResolver, type ModePresetConfig } from '../../src/host/acp/modePresets.js';

test('ModePresetResolver returns preset model and thinking for configured mode', () => {
  const config: ModePresetConfig = {
    default: { model: 'claude-sonnet-4-5', thinking: 'high' },
    plan: { model: 'claude-opus-4-6', thinking: 'max' }
  };
  const resolver = new ModePresetResolver(() => config);

  const planPreset = resolver.getPresetForMode('plan');
  assert.deepEqual(planPreset, { model: 'claude-opus-4-6', thinking: 'max' });

  const defaultPreset = resolver.getPresetForMode('default');
  assert.deepEqual(defaultPreset, { model: 'claude-sonnet-4-5', thinking: 'high' });

  const unknownPreset = resolver.getPresetForMode('unknown');
  assert.equal(unknownPreset, undefined);
});
