import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RingBuffer } from '../../src/host/ring.js';

test('accumulates chunks in order', () => {
  const r = new RingBuffer(1000);
  r.push('a'); r.push('b');
  assert.equal(r.data(), 'ab');
});

test('drops oldest chunks once over capacity (chunk granularity)', () => {
  const r = new RingBuffer(10);
  r.push('aaaaa'); r.push('bbbbb'); r.push('ccccc');
  assert.equal(r.data(), 'bbbbbccccc');
});

test('always keeps the newest chunk even if larger than capacity', () => {
  const r = new RingBuffer(3);
  r.push('old'); r.push('0123456789');
  assert.equal(r.data(), '0123456789');
});

test('size reports byte length', () => {
  const r = new RingBuffer(100);
  r.push('hello');
  assert.equal(r.size(), 5);
});
