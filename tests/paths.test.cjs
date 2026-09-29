const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dataEnv } = require('../shell/paths.cjs');

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-paths-'));
  const appDir = path.join(root, 'app');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(appDir);
  return { root, appDir, userData };
}

test('dataEnv points the backend at userData', () => {
  const { root, appDir, userData } = tempDirs();
  try {
    const env = dataEnv(userData, appDir, () => {});
    assert.equal(env.ARENA_COMPANION_CONFIG, path.join(userData, 'companion-config.json'));
    assert.equal(env.ARENA_CACHE, path.join(userData, 'cache'));
    assert.ok(fs.existsSync(userData));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dataEnv copies config and cache out of the app folder once, leaving the originals', () => {
  const { root, appDir, userData } = tempDirs();
  try {
    fs.writeFileSync(path.join(appDir, 'companion-config.json'), '{"miniMode":true}');
    fs.mkdirSync(path.join(appDir, 'cache'));
    fs.writeFileSync(path.join(appDir, 'cache', 'store.json'), '{}');
    dataEnv(userData, appDir, () => {});
    assert.equal(fs.readFileSync(path.join(userData, 'companion-config.json'), 'utf8'), '{"miniMode":true}');
    assert.ok(fs.existsSync(path.join(userData, 'cache', 'store.json')));
    assert.ok(fs.existsSync(path.join(appDir, 'companion-config.json')), 'original kept for rollback');

    // Newer data in userData is never overwritten by the stale app-folder copy.
    fs.writeFileSync(path.join(userData, 'companion-config.json'), '{"miniMode":false}');
    dataEnv(userData, appDir, () => {});
    assert.equal(fs.readFileSync(path.join(userData, 'companion-config.json'), 'utf8'), '{"miniMode":false}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
