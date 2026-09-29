// Silent auto-update on startup for packaged NSIS builds (electron-updater).
// Feed comes from the publish config baked into app-update.yml at build time
// (GitHub Releases for real builds). One check per launch, no dialogs:
// download automatically, then silently install and relaunch once ready —
// but never mid champ select or mid game, where a restart would drop the
// overlay; the restart waits for a quiet phase (or happens on quit).

// Gameflow phases during which the app must not restart itself.
const BUSY_PHASES = new Set([
  'ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame',
]);

function isBusyPhase(phase) {
  return BUSY_PHASES.has(phase);
}

// Portable builds ship no NSIS updater, and dev runs have no update feed —
// both must skip entirely. Pure so it can be unit-tested.
function shouldAutoUpdate(isPackaged, env = process.env) {
  return Boolean(isPackaged && !env.PORTABLE_EXECUTABLE_DIR);
}

function startAutoUpdate(app, { log = console.log, isBusy = () => false, retryMs = 30_000 } = {}) {
  if (!shouldAutoUpdate(app.isPackaged)) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log(`[updater] electron-updater unavailable: ${err.message}`);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let installing = false; // quitAndInstall re-entrancy guard (once per session)
  autoUpdater.on('update-available', (info) => log(`[updater] v${info.version} available — downloading`));
  autoUpdater.on('update-not-available', () => log('[updater] up to date'));
  autoUpdater.on('error', (err) => log(`[updater] ${String(err).slice(0, 200)}`));
  let deferLogged = false;
  const install = () => {
    if (isBusy()) {
      if (!deferLogged) log('[updater] League is in champ select or a game — restart deferred');
      deferLogged = true;
      setTimeout(install, retryMs).unref?.();
      return;
    }
    log('[updater] restarting to install');
    try {
      autoUpdater.quitAndInstall(true, true); // silent + relaunch
    } catch (err) {
      // Fall back to install-on-quit; never crash the app over an update.
      log(`[updater] restart-to-install failed, will install on quit: ${err.message}`);
    }
  };
  autoUpdater.on('update-downloaded', (info) => {
    log(`[updater] v${info.version} downloaded`);
    if (installing) return;
    installing = true;
    install();
  });
  log('[updater] checking…');
  autoUpdater.checkForUpdates().catch((err) => log(`[updater] check failed: ${String(err).slice(0, 200)}`));
}

module.exports = { shouldAutoUpdate, isBusyPhase, startAutoUpdate };
