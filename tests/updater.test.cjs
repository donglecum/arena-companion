const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { shouldAutoUpdate, wireUpdateStatus } = require('../shell/updater.cjs');

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

test('update events become the sidebar status', () => {
  const updater = new EventEmitter();
  const seen = [];
  const status = wireUpdateStatus(updater, (s) => seen.push(s));
  updater.emit('update-available', { version: '0.2.4' });
  updater.emit('download-progress', { percent: 3 }); // under 5%: not reported
  updater.emit('download-progress', { percent: 12.7 });
  updater.emit('download-progress', { percent: 14 }); // too small a step
  updater.emit('update-downloaded', { version: '0.2.4' });
  status.restarting();
  assert.deepEqual(seen, [
    { state: 'downloading', version: '0.2.4', percent: 0 },
    { state: 'downloading', version: '0.2.4', percent: 12 },
    { state: 'ready', version: '0.2.4' },
    { state: 'restarting', version: '0.2.4' },
  ]);
});

test('a failed download clears the status', () => {
  const updater = new EventEmitter();
  const seen = [];
  wireUpdateStatus(updater, (s) => seen.push(s));
  updater.emit('update-available', { version: '0.2.4' });
  updater.emit('error', new Error('net'));
  assert.deepEqual(seen.at(-1), null);
});
