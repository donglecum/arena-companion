const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dockBounds, clampOffset } = require('../shell/dock.cjs');

test('docking places the panel outside the client right edge (9 DIP gap) and tracks moves/resizes', () => {
  const panel = { width: 244, height: 120 };
  assert.deepEqual(dockBounds({ x: -1400, y: 75, width: 1300, height: 800 }, panel, 30),
    { x: -91, y: 105, width: 244, height: 120 });
  assert.deepEqual(dockBounds({ x: 250, y: 325, width: 800, height: 600 }, panel, 30),
    { x: 1059, y: 355, width: 244, height: 120 });
});

test('with display bounds, outside is used when it fits and inside is the fallback when it does not', () => {
  const panel = { width: 244, height: 120 };
  const display = { x: 0, y: 0, width: 2752, height: 1152 };
  // Client at x=594 width=1536 -> outside end 2139+244+9 <= 2752: outside.
  assert.deepEqual(dockBounds({ x: 594, y: 117, width: 1536, height: 864 }, panel, 16, display),
    { x: 2139, y: 133, width: 244, height: 120 });
  // Narrow display: no room outside -> hug the inside edge instead of floating off-screen.
  const small = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(dockBounds({ x: 300, y: 100, width: 1700, height: 800 }, panel, 16, small),
    { x: 1747, y: 116, width: 244, height: 120 });
});

test('vertical dragging clamps to the client area even when the panel is taller', () => {
  const client = { x: 100, y: 200, width: 500, height: 300 };
  const panel = { width: 244, height: 120 };
  assert.equal(clampOffset(-500, client.height, panel.height), 0);
  assert.equal(clampOffset(500, client.height, panel.height), 180);
  assert.deepEqual(dockBounds(client, panel, 500), { x: 609, y: 380, width: 244, height: 120 });
  assert.equal(clampOffset(90, 60, 120), 0);
});
