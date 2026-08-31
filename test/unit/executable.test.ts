import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOmpExecutable } from '../../src/host/executable.js';

function deps(exists: string[], env: Record<string, string | undefined> = {}) {
  return {
    existsSync: (p: string) => exists.includes(p),
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', ...env },
    platform: 'win32' as const,
  };
}

test('settings override wins when the file exists', () => {
  const p = resolveOmpExecutable('D:\\tools\\omp.exe', deps(['D:\\tools\\omp.exe']));
  assert.equal(p, 'D:\\tools\\omp.exe');
});

test('settings override that does not exist throws', () => {
  assert.throws(() => resolveOmpExecutable('D:\\missing.exe', deps([])), /executablePath/);
});

test('falls back to %LOCALAPPDATA% detection on win32', () => {
  const p = resolveOmpExecutable(undefined, deps(['C:\\Users\\x\\AppData\\Local\\omp\\omp.exe']));
  assert.equal(p, 'C:\\Users\\x\\AppData\\Local\\omp\\omp.exe');
});

test('no candidates -> bare "omp" for PATH resolution', () => {
  const p = resolveOmpExecutable(undefined, deps([]));
  assert.equal(p, 'omp');
});

test('non-win32 skips LOCALAPPDATA probing', () => {
  const p = resolveOmpExecutable(undefined, { ...deps(['C:\\Users\\x\\AppData\\Local\\omp\\omp.exe']), platform: 'linux' });
  assert.equal(p, 'omp');
});
