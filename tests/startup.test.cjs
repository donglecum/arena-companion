const { test } = require('node:test');
const assert = require('node:assert/strict');
const { managesLoginItem, syncLoginItem, launchedHidden } = require('../shell/startup.cjs');

function fakeApp(isPackaged, openAtLogin = false) {
  const calls = [];
  return {
    isPackaged,
    calls,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => { calls.push(settings); openAtLogin = settings.openAtLogin; },
  };
}

test('only installed builds manage the Windows login item', () => {
  assert.equal(managesLoginItem(true, {}), true);
  assert.equal(managesLoginItem(false, {}), false);
  assert.equal(managesLoginItem(true, { PORTABLE_EXECUTABLE_DIR: 'C:\\x' }), false);
});

test('syncLoginItem registers a hidden launch once and removes it when turned off', () => {
  const app = fakeApp(true);
  assert.equal(syncLoginItem(app, true, {}), true);
  assert.deepEqual(app.calls, [{ openAtLogin: true, args: ['--hidden'] }]);
  assert.equal(syncLoginItem(app, true, {}), false); // already registered
  assert.equal(syncLoginItem(app, false, {}), true);
  assert.deepEqual(app.calls.at(-1), { openAtLogin: false, args: ['--hidden'] });
});

test('syncLoginItem leaves dev runs alone', () => {
  const app = fakeApp(false);
  assert.equal(syncLoginItem(app, true, {}), false);
  assert.deepEqual(app.calls, []);
});

test('launchedHidden recognizes the login-item launch', () => {
  assert.equal(launchedHidden(['Arena Companion.exe', '--hidden']), true);
  assert.equal(launchedHidden(['Arena Companion.exe']), false);
  assert.equal(launchedHidden(undefined), false);
});
