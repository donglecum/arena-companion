// Read-only Win32 window discovery. Koffi ships prebuilt Node-API binaries;
// no compiler or League process injection is needed.

const MIN_WIDTH = 244;
const MIN_HEIGHT = 48;

// Pure dock-target selection over enumerated top-level windows: keep visible,
// non-minimized windows whose client area is big enough to be a real client
// UI; largest client area wins. Candidates carry
// { source, visible, minimized, x, y, width, height }.
function pickBestWindow(candidates) {
  let best = null;
  for (const win of candidates) {
    if (!win.visible || win.minimized) continue;
    if (win.width < MIN_WIDTH || win.height < MIN_HEIGHT) continue;
    if (!best || win.width * win.height > best.width * best.height) best = win;
  }
  return best;
}

// Win32 bindings are built lazily so tests can load this module off-Windows
// (koffi.load('user32.dll') throws there) and exercise pickBestWindow.
let api = null;
function bindings() {
  if (api) return api;
  const koffi = require('koffi');
  const kernel = koffi.load('kernel32.dll');
  const user = koffi.load('user32.dll');
  const HWND = koffi.pointer('HWND', koffi.opaque());
  const RECT = koffi.struct('DOCK_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const POINT = koffi.struct('DOCK_POINT', { x: 'long', y: 'long' });
  const EnumProc = koffi.proto('int __stdcall DockEnumProc(HWND hwnd, intptr_t data)');
  api = {
    EnumWindows: user.func('int __stdcall EnumWindows(DockEnumProc *callback, intptr_t data)'),
    IsWindowVisible: user.func('int __stdcall IsWindowVisible(HWND hwnd)'),
    IsIconic: user.func('int __stdcall IsIconic(HWND hwnd)'),
    GetWindowThreadProcessId: user.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)'),
    GetClientRect: user.func('int __stdcall GetClientRect(HWND hwnd, _Out_ DOCK_RECT *rect)'),
    ClientToScreen: user.func('int __stdcall ClientToScreen(HWND hwnd, _Inout_ DOCK_POINT *point)'),
    EnumProcesses: kernel.func('int __stdcall K32EnumProcesses(_Out_ uint32_t *pids, uint32_t bytes, _Out_ uint32_t *used)'),
    OpenProcess: kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    QueryImage: kernel.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)'),
    CloseHandle: kernel.func('int __stdcall CloseHandle(void *handle)'),
  };
  return api;
}

function processNames(names) {
  const w = bindings();
  const found = new Map(names.map((name) => [name.toLowerCase(), new Set()]));
  const pids = Buffer.alloc(64 * 1024);
  const used = [0];
  if (!w.EnumProcesses(pids, pids.length, used)) return found;
  for (let i = 0; i < used[0]; i += 4) {
    const pid = pids.readUInt32LE(i);
    if (!pid) continue;
    const handle = w.OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (!handle) continue;
    try {
      const name = Buffer.alloc(2048);
      const size = [name.length / 2];
      if (!w.QueryImage(handle, 0, name, size)) continue;
      const full = name.toString('utf16le', 0, size[0] * 2);
      const base = full.slice(full.lastIndexOf('\\') + 1).toLowerCase();
      found.get(base)?.add(pid);
    } finally {
      w.CloseHandle(handle);
    }
  }
  return found;
}

// extraTargets: additional process names accepted as dock targets. Needed
// because LeagueClientUx.exe owns the actual client UI window (champ select,
// lobby) in current builds, while LeagueClient.exe — the lockfile pid — owns
// no visible windows. Never pass 'League of Legends.exe' (the game window).
function inspect(target = 'LeagueClient.exe', extraTargets = []) {
  const w = bindings();
  const names = processNames([target, ...extraTargets, 'League of Legends.exe']);
  const gameRunning = (names.get('league of legends.exe')?.size ?? 0) > 0;
  const pidToSource = new Map();
  for (const name of [target, ...extraTargets]) {
    for (const pid of names.get(name.toLowerCase()) ?? []) {
      pidToSource.set(pid, name);
    }
  }
  const candidates = [];
  if (pidToSource.size) {
    w.EnumWindows((hwnd) => {
      const pid = [0];
      w.GetWindowThreadProcessId(hwnd, pid);
      if (!pidToSource.has(pid[0])) return 1;
      const client = {};
      const origin = { x: 0, y: 0 };
      if (!w.GetClientRect(hwnd, client) || !w.ClientToScreen(hwnd, origin)) return 1;
      candidates.push({
        source: pidToSource.get(pid[0]),
        visible: !!w.IsWindowVisible(hwnd),
        minimized: !!w.IsIconic(hwnd),
        x: origin.x,
        y: origin.y,
        width: client.right - client.left,
        height: client.bottom - client.top,
      });
      return 1;
    }, 0);
  }
  const best = pickBestWindow(candidates);
  return {
    gameRunning,
    rect: best ? { x: best.x, y: best.y, width: best.width, height: best.height } : null,
    source: best ? best.source : null,
  };
}

module.exports = { inspect, pickBestWindow };
