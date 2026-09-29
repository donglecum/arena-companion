import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUpdateStatus } from '../src/updateStatus.ts';

test('update statuses from the shell are validated and tidied', () => {
  assert.deepEqual(normalizeUpdateStatus({ state: 'downloading', version: '0.2.4', percent: 41.6 }), { state: 'downloading', version: '0.2.4', percent: 42 });
  assert.deepEqual(normalizeUpdateStatus({ state: 'ready', version: '0.2.4', percent: 100 }), { state: 'ready', version: '0.2.4' });
  assert.deepEqual(normalizeUpdateStatus({ state: 'downloading', version: '1.0.0', percent: 250 }), { state: 'downloading', version: '1.0.0', percent: 100 });
  assert.equal(normalizeUpdateStatus(null), null);
});

test('anything else is rejected', () => {
  assert.equal(normalizeUpdateStatus({ state: 'hacked', version: '0.2.4' }), undefined);
  assert.equal(normalizeUpdateStatus({ state: 'ready', version: '<script>' }), undefined);
  assert.equal(normalizeUpdateStatus({ state: 'ready' }), undefined);
  assert.equal(normalizeUpdateStatus([]), undefined);
  assert.equal(normalizeUpdateStatus('ready'), undefined);
});
