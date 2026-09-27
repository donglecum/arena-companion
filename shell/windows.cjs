// Read-only Win32 window discovery. Koffi ships prebuilt Node-API binaries;
// no compiler or League process injection is needed.
const koffi = require('koffi');
const kernel = koffi.load('kernel32.dll');
const user = koffi.load('user32.dll');
const HWND = koffi.pointer('HWND', koffi.opaque());
const RECT = koffi.struct('DOCK_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const POINT = koffi.struct('DOCK_POINT', { x: 'long', y: 'long' });
const EnumProc = koffi.proto('int __stdcall DockEnumProc(HWND hwnd, intptr_t data)');
const EnumWindows = user.func('int __stdcall EnumWindows(DockEnumProc *callback, intptr_t data)');
const IsWindowVisible = user.func('int __stdcall IsWindowVisible(HWND hwnd)');
const IsIconic = user.func('int __stdcall IsIconic(HWND hwnd)');
const GetWindowThreadProcessId = user.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)');
const GetClientRect = user.func('int __stdcall GetClientRect(HWND hwnd, _Out_ DOCK_RECT *rect)');
const ClientToScreen = user.func('int __stdcall ClientToScreen(HWND hwnd, _Inout_ DOCK_POINT *point)');
const EnumProcesses = kernel.func('int __stdcall K32EnumProcesses(_Out_ uint32_t *pids, uint32_t bytes, _Out_ uint32_t *used)');
const OpenProcess = kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)');
const QueryImage = kernel.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)');
const CloseHandle = kernel.func('int __stdcall CloseHandle(void *handle)');

function processNames(names) {
  const found = new Map(names.map((name) => [name.toLowerCase(), new Set()]));
  const pids = Buffer.alloc(64 * 1024);
  const used = [0];
  if (!EnumProcesses(pids, pids.length, used)) return found;
  for (let i = 0; i < used[0]; i += 4) {
    const pid = pids.readUInt32LE(i);
    if (!pid) continue;
    const handle = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (!handle) continue;
    try {
      const name = Buffer.alloc(2048);
      const size = [name.length / 2];
      if (!QueryImage(handle, 0, name, size)) continue;
      const full = name.toString('utf16le', 0, size[0] * 2);
      const base = full.slice(full.lastIndexOf('\\') + 1).toLowerCase();
      found.get(base)?.add(pid);
    } finally {
      CloseHandle(handle);
    }
  }
  return found;
}

function inspect(target = 'LeagueClient.exe') {
  const names = processNames([target, 'League of Legends.exe']);
  const gameRunning = (names.get('league of legends.exe')?.size ?? 0) > 0;
  const targetPids = names.get(target.toLowerCase());
  let rect = null;
  if (targetPids?.size) {
    EnumWindows((hwnd) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (!targetPids.has(pid[0])) return 1;
      const client = {};
      const origin = { x: 0, y: 0 };
      if (!GetClientRect(hwnd, client) || !ClientToScreen(hwnd, origin)) return 1;
      if (client.right - client.left < 244 || client.bottom - client.top < 48) return 1;
      if (!rect || (client.right - client.left) * (client.bottom - client.top) > rect.width * rect.height) {
        rect = { x: origin.x, y: origin.y, width: client.right - client.left, height: client.bottom - client.top };
      }
      return 1;
    }, 0);
  }
  return { gameRunning, rect };
}

module.exports = { inspect };
