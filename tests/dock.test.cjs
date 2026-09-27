const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dockBounds, clampOffset } = require('../shell/dock.cjs');

test('docking tracks translated and resized clients without changing the saved offset', () => {
  const panel = { width: 244, height: 120 };
  assert.deepEqual(dockBounds({ x: -1400, y: 75, width: 1300, height: 800 }, panel, 30),
    { x: -353, y: 105, width: 244, height: 120 });
  assert.deepEqual(dockBounds({ x: 250, y: 325, width: 800, height: 600 }, panel, 30),
    { x: 797, y: 355, width: 244, height: 120 });
});

test('vertical dragging clamps to the client area even when the panel is taller', () => {
  const client = { x: 100, y: 200, width: 500, height: 300 };
  const panel = { width: 244, height: 120 };
  assert.equal(clampOffset(-500, client.height, panel.height), 0);
  assert.equal(clampOffset(500, client.height, panel.height), 180);
  assert.deepEqual(dockBounds(client, panel, 500), { x: 347, y: 380, width: 244, height: 120 });
  assert.equal(clampOffset(90, 60, 120), 0);
});
