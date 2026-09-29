// Arena Companion desktop shell (Electron main process).
// Spawns the existing Node backend and presents it in a native window with
// tray plus a separate always-on-top Crowd Favorites overlay for champ select
// or Settings preview. The main window opens only when requested from the tray.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, screen, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { DEFAULT_OFFSET, clampOffset, dockBounds } = require('./dock.cjs');
const { startAutoUpdate, isBusyPhase } = require('./updater.cjs');
const { dataEnv } = require('./paths.cjs');
const { syncLoginItem, launchedHidden } = require('./startup.cjs');
const { restoreBounds } = require('./windowState.cjs');
const windows = process.platform === 'win32' ? require('./windows.cjs') : null;

const APP_DIR = path.join(__dirname, '..');
const ICON_PATH = path.join(APP_DIR, 'assets', 'icon.ico');
const PORT = process.env.ARENA_COMPANION_PORT ?? 8788;
const BASE = `http://localhost:${PORT}`;
const POLL_MS = 2000;
const OVERLAY_WIDTH = 244;
const DOCK_POLL_MS = 750;
const DOCK_TARGET = process.env.ARENA_COMPANION_DOCK_TARGET || 'LeagueClient.exe';
// LeagueClientUx.exe owns the actual client UI window (champ select, lobby);
// LeagueClient.exe is the lockfile core process and owns no visible windows.
// ARENA_COMPANION_DOCK_TARGET overrides stay isolated: no aliases then.
const DOCK_ALIASES = process.env.ARENA_COMPANION_DOCK_TARGET ? [] : ['LeagueClientUx.exe'];
// Offline verification hook: when set, status is read from this JSON file
// instead of the backend, and the overlay loads from disk (no server needed).
const SMOKE_STATUS = process.env.ARENA_COMPANION_SMOKE_STATUS ?? null;

let win = null;
let tray = null;
let trayOnTopItem = null;
let server = null;
let quitting = false;

let overlayWin = null;
let overlayShown = false;
let overlayIgnoringMouse = true;
let overlayOutsideTicks = 0;
let overlayHoverTimer = null;
let overlayLoadTimer = null;
let overlaySaveTimer = null;
let overlaySavedPos = null;
let overlayFreePos = null;
let overlayOffset = DEFAULT_OFFSET;
let overlayDockClient = null;
let overlayDockTimer = null;
let overlayDragging = false;
let overlaySettingBounds = false;
let smokeErrorLogged = '';
let statusFailures = 0;
let lastGameflowPhase = null;
let lastNotifiedEvent = null;
let lastLoginItem = null;
// Latest auto-update status; the backend shows it in the sidebar.
let updateStatus = null;

function reportUpdate(status) {
  updateStatus = status;
  void postJson('/api/update-status', status);
}
const shellStartedAt = Date.now();

let serverDataEnv = null;

function startServer() {
  // Explicit env overrides still win (e.g. a test cache dir).
  serverDataEnv ??= dataEnv(app.getPath('userData'), APP_DIR);
  server = spawn(process.execPath.includes('electron') ? process.execPath : 'node', ['src/server.ts'], {
    cwd: APP_DIR,
    env: { ...serverDataEnv, ...process.env, ELECTRON_RUN_AS_NODE: '1', ARENA_COMPANION_ELECTRON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  server.on('exit', (code) => {
    console.log(`backend exited (${code}); restarting in 5s`);
    if (!quitting) setTimeout(startServer, 5000);
  });
}

function postJson(pathname, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${BASE}${pathname}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 200));
      },
    );
    req.on('error', () => resolve(false));
    req.setTimeout(2500, () => req.destroy());
    req.end(data);
  });
}

function getJson(pathname) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}${pathname}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2500, () => req.destroy());
  });
}

async function waitForServer(tries = 60) {
  if (SMOKE_STATUS) return true; // offline verification: no backend required
  for (let i = 0; i < tries; i++) {
    const s = await getJson('/api/status');
    if (s) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function readJsonFile(file, quiet = false) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (!quiet) console.error(`failed to read ${file}: ${err.message}`);
    return null;
  }
}

// Single status source: the backend, or a sample JSON file in smoke mode.
function getStatus() {
  if (!SMOKE_STATUS) return getJson('/api/status');
  try {
    return Promise.resolve(JSON.parse(fs.readFileSync(SMOKE_STATUS, 'utf8')));
  } catch (err) {
    const msg = `smoke status read failed: ${err.message}`;
    if (msg !== smokeErrorLogged) {
      smokeErrorLogged = msg;
      console.error(msg);
    }
    return Promise.resolve(null);
  }
}

// Main window size and position survive restarts (the window opens from the tray).
function mainWindowStatePath() {
  return path.join(app.getPath('userData'), 'main-window.json');
}

let mainWindowSaveTimer = null;
let maximizeOnShow = false;

function saveMainWindowState() {
  clearTimeout(mainWindowSaveTimer);
  mainWindowSaveTimer = null;
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const maximized = win.isMaximized();
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  try {
    const file = mainWindowStatePath();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error(`main window position save failed: ${err.message}`);
  }
}

function scheduleMainWindowSave() {
  clearTimeout(mainWindowSaveTimer);
  mainWindowSaveTimer = setTimeout(saveMainWindowState, 500);
}

function createWindow() {
  const bounds = restoreBounds(readJsonFile(mainWindowStatePath(), true), screen.getAllDisplays().map((d) => d.workArea));
  // maximize() would show the hidden window, so it waits for the first show.
  maximizeOnShow = bounds.maximized;
  win = new BrowserWindow({
    ...(Number.isFinite(bounds.x) ? { x: bounds.x, y: bounds.y } : {}),
    width: bounds.width,
    height: bounds.height,
    minWidth: 480,
    minHeight: 300,
    backgroundColor: '#07090d',
    autoHideMenuBar: true,
    show: false,
    title: 'Arena Companion',
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(BASE);
  // The backend may still be starting (or restarting); keep retrying instead of
  // leaving the window on an error page.
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || quitting) return;
    console.error(`main window load failed (${code} ${desc}); retrying in 3s`);
    setTimeout(() => { if (win && !win.isDestroyed() && !quitting) win.loadURL(BASE).catch(() => {}); }, 3000);
  });
  win.webContents.on('will-navigate', (e, url) => {
    // The UI is a single page on the backend; anything else opens in the browser.
    if (url.startsWith(BASE)) return;
    e.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, scheduleMainWindowSave);
  win.on('close', (e) => {
    saveMainWindowState();
    if (!quitting) {
      e.preventDefault();
      win.hide(); // minimize to tray instead of closing
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand web links to the OS; other schemes can launch local handlers.
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (maximizeOnShow) {
    maximizeOnShow = false;
    win.maximize();
  }
  win.focus();
}

function createTray() {
  // App icon from assets; fall back to the generated dot if the file is missing.
  let image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty()) {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="4" fill="#1a1d29"/><circle cx="8" cy="8" r="4.5" fill="#c8a04b"/></svg>`,
    );
    image = nativeImage.createFromBuffer(svg);
  }
  tray = new Tray(image);
  tray.setToolTip('Arena Companion');
  const menu = Menu.buildFromTemplate([
    { label: 'Show', click: showMainWindow },
    {
      id: 'always-on-top',
      label: 'Always on top',
      type: 'checkbox',
      checked: false,
      // Saved through the backend config, which pollStatus applies; setting the
      // window directly was undone by the next status poll.
      click: async (item) => {
        win.setAlwaysOnTop(item.checked);
        if (!(await postJson('/api/config', { alwaysOnTop: item.checked }))) {
          console.error('always-on-top could not be saved');
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  trayOnTopItem = menu.getMenuItemById('always-on-top');
  tray.setContextMenu(menu);
  tray.on('click', showMainWindow);
}

// --- Crowd Favorites overlay -------------------------------------------------
// Small frameless always-on-top window, independent of the main window and the
// tray. Shows the real crowd favorites during an Arena champ select, or the
// Settings position preview (sample cards) while its toggle is on and no real
// Arena champ select is active.

function overlayStatePath() {
  return path.join(app.getPath('userData'), 'overlay-window.json');
}

function defaultOverlayPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - OVERLAY_WIDTH - 16, y: workArea.y + 16 };
}

function positionOnAnyDisplay(pos) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return pos.x < a.x + a.width && pos.x + OVERLAY_WIDTH > a.x && pos.y < a.y + a.height && pos.y + 40 > a.y;
  });
}

function overlayPosition() {
  const saved = readJsonFile(overlayStatePath(), true);
  if (saved && Number.isFinite(saved.offset) && saved.offset >= 0) overlayOffset = Math.round(saved.offset);
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && positionOnAnyDisplay(saved)) return { x: saved.x, y: saved.y };
  return defaultOverlayPosition();
}

function saveOverlayPosition() {
  clearTimeout(overlaySaveTimer);
  overlaySaveTimer = setTimeout(() => {
    overlaySaveTimer = null;
    const state = { ...overlayFreePos, offset: overlayOffset };
    if (overlaySavedPos && Object.keys(state).every((key) => state[key] === overlaySavedPos[key])) return;
    try {
      const file = overlayStatePath();
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
      fs.renameSync(`${file}.tmp`, file);
      overlaySavedPos = state;
    } catch (err) {
      console.error(`overlay position save failed: ${err.message}`);
    }
  }, 500);
}

function setOverlayBounds(bounds) {
  const current = overlayWin.getBounds();
  if (current.x === bounds.x && current.y === bounds.y && current.height === bounds.height) return;
  overlaySettingBounds = true;
  try {
    overlayWin.setBounds(bounds);
  } finally {
    overlaySettingBounds = false;
  }
}

function dockOverlayBounds(bounds) {
  return dockBounds(overlayDockClient, bounds, overlayOffset, screen.getDisplayMatching(overlayDockClient).workArea);
}

function updateDock(rect) {
  if (!overlayWin || overlayWin.isDestroyed() || overlayDragging) return;
  // screenToDipRect(null, …) uses the display containing the physical client
  // rectangle, not the overlay's previous display (important across monitors).
  overlayDockClient = rect ? screen.screenToDipRect(null, rect) : null;
  if (overlayDockClient) {
    overlayOffset = clampOffset(overlayOffset, overlayDockClient.height, overlayWin.getBounds().height);
    setOverlayBounds(dockOverlayBounds(overlayWin.getBounds()));
  } else {
    const b = overlayWin.getBounds();
    setOverlayBounds({ ...b, ...overlayFreePos });
  }
}

function overlayMoved() {
  if (overlaySettingBounds || !overlayShown) return;
  overlayDragging = false;
  const b = overlayWin.getBounds();
  if (overlayDockClient) {
    overlayOffset = clampOffset(b.y - overlayDockClient.y, overlayDockClient.height, b.height);
    setOverlayBounds(dockOverlayBounds(b));
  } else {
    overlayFreePos = { x: b.x, y: b.y };
  }
  saveOverlayPosition();
}

function loadOverlayPage() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // Smoke mode loads the self-contained markup from disk, so no backend is needed.
  const url = SMOKE_STATUS ? pathToFileURL(path.join(APP_DIR, 'src', 'ui', 'overlay.html')).href : `${BASE}/overlay.html`;
  // Failures are reported (and retried) by the did-fail-load handler.
  overlayWin.loadURL(url).catch(() => {});
}

function createOverlay() {
  const pos = overlayPosition();
  overlayWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: OVERLAY_WIDTH,
    height: 120,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    title: 'Crowd Favorites',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWin.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || quitting) return;
    console.error(`overlay load failed (${code} ${desc}); retrying in 3s`);
    if (overlayLoadTimer) clearTimeout(overlayLoadTimer);
    overlayLoadTimer = setTimeout(loadOverlayPage, 3000);
  });
  // will-move is user-only on Windows; setBounds never starts a drag.
  overlayWin.on('will-move', () => { if (overlayShown) overlayDragging = true; });
  overlayWin.on('moved', overlayMoved);
  overlayFreePos = pos;
  overlaySavedPos = { ...pos, offset: overlayOffset };
  overlayWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // never close; visibility is driven by champ select state
    setOverlayShown(false, 'closed by user');
  });
  // Click-through until the cursor is over the panel, so the overlay never
  // swallows clicks; hovering re-enables input for dragging.
  overlayWin.setIgnoreMouseEvents(true);
  loadOverlayPage();
  console.log(`overlay window ready at ${pos.x},${pos.y} (${OVERLAY_WIDTH}px wide; click-through, interactive while hovered)`);
}

function overlayHoverCheck() {
  if (!overlayWin || overlayWin.isDestroyed() || !overlayWin.isVisible()) return;
  const b = overlayWin.getBounds();
  const p = screen.getCursorScreenPoint();
  const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  // Hand keyboard focus back to the game once the cursor has stayed off the
  // panel (a drag keeps the cursor on it, so the drag loop is never disturbed).
  if (inside) {
    overlayOutsideTicks = 0;
  } else if (++overlayOutsideTicks === 5 && overlayWin.isFocused()) {
    overlayWin.blur();
  }
  if (inside === !overlayIgnoringMouse) return;
  overlayIgnoringMouse = !inside;
  overlayWin.setIgnoreMouseEvents(!inside);
  console.log(`overlay input: ${inside ? 'interactive' : 'click-through'} (cursor ${p.x},${p.y}; panel ${b.x},${b.y} ${b.width}x${b.height})`);
}

let dockReadError = '';
let lastDockLog = '';
function trackOverlayDock() {
  if (!windows || !overlayShown || overlayDragging) return;
  try {
    const { gameRunning, rect, source } = windows.inspect(DOCK_TARGET, DOCK_ALIASES);
    if (gameRunning) {
      setOverlayShown(false, 'League game running');
      return;
    }
    const signature = JSON.stringify(rect);
    if (signature !== lastDockLog) {
      console.log(`overlay dock ${source ?? DOCK_TARGET}: ${signature}`);
      lastDockLog = signature;
    }
    updateDock(rect);
    dockReadError = '';
  } catch (err) {
    if (dockReadError !== String(err)) console.error(`overlay dock unavailable: ${err}`);
    dockReadError = String(err);
    updateDock(null);
  }
}

function setOverlayShown(shown, reason) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (shown === overlayShown) return;
  if (shown) {
    // Check before showInactive: a screen-saver-level panel must never flash over a match.
    if (windows) {
      try {
        const { gameRunning, rect } = windows.inspect(DOCK_TARGET, DOCK_ALIASES, { fresh: true });
        if (gameRunning) return;
        updateDock(rect);
      } catch (err) {
        if (dockReadError !== String(err)) console.error(`overlay dock unavailable: ${err}`);
        dockReadError = String(err);
      }
    }
    overlayShown = true;
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayHoverTimer = setInterval(overlayHoverCheck, 200);
    overlayDockTimer = setInterval(trackOverlayDock, DOCK_POLL_MS);
    console.log(`overlay shown (${reason})`);
  } else {
    overlayShown = false;
    if (overlayHoverTimer) {
      clearInterval(overlayHoverTimer);
      overlayHoverTimer = null;
    }
    clearInterval(overlayDockTimer);
    overlayDockTimer = null;
    overlayDragging = false;
    if (!overlayIgnoringMouse) {
      overlayIgnoringMouse = true;
      overlayWin.setIgnoreMouseEvents(true);
    }
    overlayWin.hide();
    console.log(`overlay hidden (${reason})`);
  }
}

// Hand the status to the renderer; JSON is double-encoded so the page parses a
// plain string literal (no interpolation of untrusted data into code).
function pushOverlayStatus(status) {
  if (!overlayWin || overlayWin.isDestroyed()) return Promise.resolve(false);
  const literal = JSON.stringify(JSON.stringify(status ?? null));
  return overlayWin.webContents
    .executeJavaScript(`window.__applyStatus(JSON.parse(${literal}))`)
    .then(() => true)
    .catch(() => false);
}

// Shrink/grow to fit the rendered cards (bounded), keeping the position.
async function fitOverlayHeight() {
  if (!overlayWin || overlayWin.isDestroyed() || !overlayShown) return;
  try {
    const h = await overlayWin.webContents.executeJavaScript(
      'Math.ceil(document.getElementById("panel").getBoundingClientRect().height)',
    );
    if (!overlayShown || typeof h !== 'number' || !Number.isFinite(h)) return;
    const height = Math.max(48, Math.min(560, h + 2, overlayDockClient?.height ?? Infinity));
    const b = overlayWin.getBounds();
    if (Math.abs(b.height - height) > 1) {
      if (overlayDockClient) setOverlayBounds(dockOverlayBounds({ ...b, height }));
      else setOverlayBounds({ ...b, height });
    }
  } catch {
    /* renderer not ready */
  }
}

// The main window usually stays hidden, so a first win also gets a Windows
// notification (the in-window toast alone was easy to miss).
function notifyPostGame(event) {
  if (!event || event.type !== 'new-win' || typeof event.at !== 'string' || event.at === lastNotifiedEvent) return;
  lastNotifiedEvent = event.at;
  if (Date.parse(event.at) < shellStartedAt || !Notification.isSupported()) return;
  const champion = typeof event.champion === 'string' && event.champion ? event.champion : 'a new champion';
  const count = Number.isFinite(event.wonCount) ? ` · ${event.wonCount} champions won` : '';
  const notification = new Notification({ title: 'First Arena win!', body: `${champion}${count}`, icon: ICON_PATH });
  notification.on('click', showMainWindow);
  notification.show();
}

// Reason string for the overlay-hide log line (helps diagnose champ select exits).
function overlayHideReason(s, favorites) {
  if (s.crowdFavoritesActive !== true) return 'not in arena champ select';
  return favorites.length === 0 ? 'crowd favorites empty' : 'inactive';
}

// Keep the main window where the user left it; only the overlay is automatic.
async function pollStatus() {
  const s = await getStatus();
  if (!win) return;
  if (!s) {
    // Backend unreachable: keep the last state briefly, then hide the overlay so
    // it can never outlive the champ select it belongs to.
    if (++statusFailures >= 8) setOverlayShown(false, 'status unavailable');
    return;
  }
  statusFailures = 0;
  notifyPostGame(s.lastEvent);
  // A restarted backend forgets the update status; hand it over again.
  if (JSON.stringify(s.update ?? null) !== JSON.stringify(updateStatus)) void postJson('/api/update-status', updateStatus);
  lastGameflowPhase = typeof s.gameflowPhase === 'string' ? s.gameflowPhase : null;
  if (typeof s.config?.launchAtLogin === 'boolean' && s.config.launchAtLogin !== lastLoginItem) {
    lastLoginItem = s.config.launchAtLogin;
    try {
      if (syncLoginItem(app, lastLoginItem)) console.log(`start with Windows ${lastLoginItem ? 'on' : 'off'}`);
    } catch (err) {
      console.error(`could not update the Windows login item: ${err.message}`);
    }
  }
  if (s.config?.alwaysOnTop != null) {
    if (win.isAlwaysOnTop() !== !!s.config.alwaysOnTop) win.setAlwaysOnTop(!!s.config.alwaysOnTop);
    if (trayOnTopItem) trayOnTopItem.checked = !!s.config.alwaysOnTop;
  }

  // Crowd favorites overlay — the real list during an Arena champ select
  // (which supersedes the preview, even when the real list is empty), otherwise
  // the Settings position preview while its toggle is on.
  const favorites = Array.isArray(s.crowdFavorites) ? s.crowdFavorites : [];
  const realActive = s.crowdFavoritesActive === true;
  const previewActive = s.overlayPreview === true && !realActive;
  const overlayShouldShow = realActive ? favorites.length > 0 : previewActive;
  await pushOverlayStatus(s);
  if (overlayShouldShow) {
    setOverlayShown(true, realActive ? `crowd favorites active (${favorites.length})` : 'position preview enabled');
    fitOverlayHeight();
  } else {
    setOverlayShown(false, overlayHideReason(s, favorites));
  }
}

// A second copy (logon task + shortcut, or the installer's launch) could not bind
// the backend port and would restart its backend forever; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Opening the app again brings the window forward, unless that launch was the
  // sign-in one (e.g. a second copy racing the first at login).
  app.on('second-instance', (_event, argv) => { if (!launchedHidden(argv)) showMainWindow(); });
  app.whenReady().then(start);
}

async function start() {
  app.setAppUserModelId('com.arena.companion');
  // Busy while League is in champ select/game, or while the overlay is up.
  startAutoUpdate(app, { isBusy: () => overlayShown || isBusyPhase(lastGameflowPhase), onStatus: reportUpdate });
  if (SMOKE_STATUS) console.log(`smoke mode: reading status from ${SMOKE_STATUS}`);
  else startServer();
  const up = await waitForServer();
  if (!up) console.error('backend did not come up in time; window may show an error page');
  createWindow();
  createTray();
  createOverlay();
  setInterval(pollStatus, POLL_MS);
}

app.on('before-quit', () => {
  quitting = true;
  clearInterval(overlayHoverTimer);
  clearInterval(overlayDockTimer);
  clearTimeout(overlayLoadTimer);
  clearTimeout(overlaySaveTimer);
  if (mainWindowSaveTimer) saveMainWindowState();
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  if (server && !server.killed) server.kill();
});

app.on('window-all-closed', (e) => {
  // stay alive in the tray
  e.preventDefault?.();
});
