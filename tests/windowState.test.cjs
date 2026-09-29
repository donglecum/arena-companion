const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds } = require('../shell/windowState.cjs');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

test('first launch opens at the default size', () => {
  assert.deepEqual(restoreBounds(null, [primary]), { width: 1180, height: 820, maximized: false });
  assert.deepEqual(restoreBounds({ width: 'x' }, [primary]), { width: 1180, height: 820, maximized: false });
});

test('a saved placement on a connected display is restored', () => {
  assert.deepEqual(restoreBounds({ x: 2100, y: 120, width: 1400, height: 900, maximized: true }, [primary, right]),
    { x: 2100, y: 120, width: 1400, height: 900, maximized: true });
});

test('a window left on an unplugged monitor keeps its size but not its position', () => {
  assert.deepEqual(restoreBounds({ x: 2100, y: 120, width: 1400, height: 900 }, [primary]),
    { width: 1400, height: 900, maximized: false });
});

test('a title bar pushed off the top or bottom is not restored', () => {
  assert.equal('x' in restoreBounds({ x: 100, y: -200, width: 800, height: 600 }, [primary]), false);
  assert.equal('x' in restoreBounds({ x: 100, y: 1030, width: 800, height: 600 }, [primary]), false);
});

test('sizes are clamped to the minimum and to the largest display', () => {
  assert.deepEqual(restoreBounds({ width: 100, height: 100 }, [primary]), { width: 480, height: 300, maximized: false });
  assert.deepEqual(restoreBounds({ width: 5000, height: 3000 }, [primary]), { width: 1920, height: 1040, maximized: false });
});
