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

test('isBusyPhase defers restarts during champ select and games only', () => {
  const { isBusyPhase } = require('../shell/updater.cjs');
  for (const p of ['ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame']) {
    assert.equal(isBusyPhase(p), true, p);
  }
  for (const p of ['None', 'Lobby', 'Matchmaking', 'EndOfGame', null, undefined]) {
    assert.equal(isBusyPhase(p), false, String(p));
  }
});
