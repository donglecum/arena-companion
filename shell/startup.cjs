// Start with Windows: installed builds register a login item that launches the
// app with --hidden, so it comes up in the tray (the main window only opens from
// the tray). Dev runs and the portable build never touch the login items.
const HIDDEN_ARG = '--hidden';

function managesLoginItem(isPackaged, env = process.env) {
  return Boolean(isPackaged && !env.PORTABLE_EXECUTABLE_DIR);
}

/** Bring the Windows login item in line with the setting; returns true when it changed. */
function syncLoginItem(app, enabled, env = process.env) {
  if (!managesLoginItem(app.isPackaged, env)) return false;
  const current = app.getLoginItemSettings({ args: [HIDDEN_ARG] });
  if (Boolean(current.openAtLogin) === Boolean(enabled)) return false;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: [HIDDEN_ARG] });
  return true;
}

/** A launch from the login item (or any launch asking to stay in the tray). */
const launchedHidden = (argv) => Array.isArray(argv) && argv.includes(HIDDEN_ARG);

module.exports = { HIDDEN_ARG, managesLoginItem, syncLoginItem, launchedHidden };
