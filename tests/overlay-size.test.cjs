const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise the real shell paths without starting Electron, the backend, or LCU.
function overlayShell() {
  const filename = path.join(__dirname, '../shell/main.cjs');
  const shellRequire = createRequire(filename);
  let nativeBounds = { x: 0, y: 0, width: 244, height: 120 };
  let measuredHeight = 240;
  const requestedWidths = [];
  const display = { x: 0, y: 0, width: 2752, height: 1152 };
  const overlay = {
    getBounds: () => ({ ...nativeBounds }),
    setBounds(bounds) {
      requestedWidths.push(bounds.width);
      // Model a non-idempotent native DIP round trip. A fixed request must not
      // reuse this readback error as the next requested width.
      nativeBounds = { ...bounds, width: bounds.width + 1, height: bounds.height + 1 };
    },
    isDestroyed: () => false,
    webContents: { executeJavaScript: async () => measuredHeight },
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? {
      app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {} },
      screen: {
        screenToDipRect: (_window, rect) => rect,
        getDisplayMatching: () => ({ workArea: display }),
      },
    } : shellRequire(name),
    __dirname: path.dirname(filename),
    process,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  context.panelWindow = overlay;
  vm.runInContext(`
    overlayWin = panelWindow;
    overlayShown = true;
    win = {};
    getStatus = async () => ({
      crowdFavoritesActive: true,
      crowdFavorites: [{ id: 1, name: 'Sample champion', won: false }],
    });
  `, context);
  return {
    run: (code) => vm.runInContext(code, context),
    bounds: () => nativeBounds,
    drift: (width) => { nativeBounds.width = width; },
    measure: (height) => { measuredHeight = height; },
    requestedWidths,
  };
}

test('overlay width stays fixed through repeated docking, moves, height fits and undocking', async () => {
  const shell = overlayShell();
  for (let i = 0; i < 100; i++) {
    // Alternate outside placement and the inside fallback, with client moves
    // and resizes. Width must be stable even when native readback is biased.
    shell.run(`updateDock({ x: ${i % 2 ? 1800 : 594}, y: ${100 + i}, width: 1536, height: 864 });`);
    const once = { ...shell.bounds() };
    const requests = shell.requestedWidths.length;
    shell.run('updateDock(overlayDockClient);');
    assert.deepEqual(shell.bounds(), once, 'another dock pass must not change the bounds');
    assert.equal(shell.bounds().x, i % 2 ? 2499 : 2139, 'placement uses the intended panel width');
    assert.equal(shell.requestedWidths.length, requests, 'identical layout must not resize again after rounded readback');
    // A delayed native moved event is not a user drag and must not re-dock.
    shell.run('overlayMoved();');
    assert.equal(shell.requestedWidths.length, requests);
    shell.measure(i % 2 ? 118 : 240);
    await shell.run('pollStatus();');
    await shell.run('fitOverlayHeight();');
    assert.equal(shell.bounds().height, i % 2 ? 121 : 243, 'height comes from renderer measurement, not native readback');
    shell.run('overlayDragging = true; overlayRequestedBounds = null; overlayMoved();');
    shell.run('updateDock(null);');
  }
  assert.equal(shell.requestedWidths[0], 244);
  assert.ok(shell.requestedWidths.every((width) => width === 244), 'all native size requests must remain 244 DIP');
  assert.equal(shell.bounds().width, 245, 'native rounding must stay bounded, not accumulate');
});

test('a width-only mismatch is corrected even when position and height are unchanged', () => {
  const shell = overlayShell();
  shell.drift(700);
  shell.run('setOverlayBounds({ x: 0, y: 0, width: 244, height: 120 });');
  assert.deepEqual(shell.requestedWidths, [244]);
  assert.equal(shell.bounds().width, 245);
});

test('an undocked height fit keeps the saved free position, not the native readback', async () => {
  const shell = overlayShell();
  shell.run('overlayFreePos = { x: 40, y: 60 }; updateDock(null);');
  shell.bounds().x = 41; // native readback rounded off the requested position
  shell.measure(300);
  await shell.run('fitOverlayHeight();');
  assert.deepEqual({ ...shell.run('overlayRequestedBounds') }, { x: 40, y: 60, width: 244, height: 302 });
});
