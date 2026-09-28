const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickBestWindow } = require('../shell/windows.cjs');

test('pickBestWindow picks the largest visible window across candidate processes', () => {
  const best = pickBestWindow([
    { source: 'LeagueClient.exe', visible: true, minimized: false, x: 0, y: 0, width: 800, height: 600 },
    { source: 'LeagueClientUx.exe', visible: true, minimized: false, x: 715, y: 144, width: 1920, height: 1080 },
  ]);
  assert.equal(best.source, 'LeagueClientUx.exe');
  assert.deepEqual({ x: best.x, y: best.y, width: best.width, height: best.height },
    { x: 715, y: 144, width: 1920, height: 1080 });
});

test('pickBestWindow skips invisible, minimized, and undersized windows', () => {
  assert.equal(pickBestWindow([
    { source: 'a.exe', visible: false, minimized: false, x: 0, y: 0, width: 1920, height: 1080 },
    { source: 'b.exe', visible: true, minimized: true, x: 0, y: 0, width: 1920, height: 1080 },
    { source: 'c.exe', visible: true, minimized: false, x: 0, y: 0, width: 243, height: 48 },
    { source: 'd.exe', visible: true, minimized: false, x: 0, y: 0, width: 244, height: 47 },
  ]), null);
});

test('pickBestWindow accepts a window exactly at the minimum client size', () => {
  const tiny = { source: 'a.exe', visible: true, minimized: false, x: 1, y: 2, width: 244, height: 48 };
  assert.equal(pickBestWindow([tiny]), tiny);
});

test('pickBestWindow returns null with no candidates', () => {
  assert.equal(pickBestWindow([]), null);
});
