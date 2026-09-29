// Where the backend keeps its match cache and config. The install folder is
// wrong for both: the NSIS updater deletes it on every update. Electron's
// userData folder survives updates, so data lives there, and data left in the
// app folder by older versions is copied over once (never moved, so a
// rollback to an older build still finds its files).
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'companion-config.json';
const CACHE_DIR = 'cache';

function migrateOnce(from, to, log) {
  if (fs.existsSync(to) || !fs.existsSync(from)) return;
  try {
    fs.cpSync(from, to, { recursive: true, errorOnExist: false });
    log(`[data] copied ${from} → ${to}`);
  } catch (err) {
    log(`[data] could not copy ${from}: ${err.message}`);
  }
}

// Returns the env vars that point the backend at userData, after migrating.
function dataEnv(userData, appDir, log = console.log) {
  const config = path.join(userData, CONFIG_FILE);
  const cache = path.join(userData, CACHE_DIR);
  fs.mkdirSync(userData, { recursive: true });
  migrateOnce(path.join(appDir, CONFIG_FILE), config, log);
  migrateOnce(path.join(appDir, CACHE_DIR), cache, log);
  return { ARENA_COMPANION_CONFIG: config, ARENA_CACHE: cache };
}

module.exports = { dataEnv };
