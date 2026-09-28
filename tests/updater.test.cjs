const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldAutoUpdate } = require('../shell/updater.cjs');

test('shouldAutoUpdate runs only for packaged builds', () => {
  assert.equal(shouldAutoUpdate(true, {}), true);
  assert.equal(shouldAutoUpdate(false, {}), false);
});

test('shouldAutoUpdate skips the portable build (no NSIS updater)', () => {
  assert.equal(shouldAutoUpdate(true, { PORTABLE_EXECUTABLE_DIR: 'C:\\tmp' }), false);
});
