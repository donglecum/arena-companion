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

// The app runs all day from logon, so keep checking instead of only at launch.
const RECHECK_MS = 4 * 3600_000;

// Turns electron-updater events into the status the UI shows ({ state, version,
// percent }, or null when nothing is pending). Progress is reported in 5% steps.
function wireUpdateStatus(autoUpdater, onStatus) {
  let version = null;
  let lastPercent = -1;
  let ready = false;
  autoUpdater.on('update-available', (info) => {
    version = info?.version ?? null;
    lastPercent = 0;
    if (version) onStatus({ state: 'downloading', version, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.floor(Number(progress?.percent) || 0);
    if (!version || percent < lastPercent + 5) return;
    lastPercent = percent;
    onStatus({ state: 'downloading', version, percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    ready = true;
    version = info?.version ?? version;
    if (version) onStatus({ state: 'ready', version });
  });
  autoUpdater.on('error', () => {
    // A failed download clears the note; a downloaded update still installs on quit.
    if (!ready) onStatus(null);
  });
  return {
    restarting: () => { if (version) onStatus({ state: 'restarting', version }); },
  };
}

function startAutoUpdate(app, { log = console.log, isBusy = () => false, retryMs = 30_000, recheckMs = RECHECK_MS, onStatus = () => {} } = {}) {
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
  const status = wireUpdateStatus(autoUpdater, onStatus);
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
    status.restarting();
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
  const check = () => {
    if (installing) return; // already downloaded; waiting for a quiet phase
    log('[updater] checking…');
    autoUpdater.checkForUpdates().catch((err) => log(`[updater] check failed: ${String(err).slice(0, 200)}`));
  };
  check();
  setInterval(check, recheckMs).unref?.();
}

module.exports = { shouldAutoUpdate, isBusyPhase, startAutoUpdate, wireUpdateStatus };
