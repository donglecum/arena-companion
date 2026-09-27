import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseLockfile, type Lockfile } from './lockfile.ts';
import { LcuClient } from './lcu.ts';
import { makeTrackerApi } from './trackerApi.ts';
import { fetchChampions } from './ddragon.ts';
import { aggregate, loadStore, saveStore, update, fullScan } from './scan.ts';
import { regionByLabel } from './regions.ts';
import { detectArenaGameEnd, computePostGameEvent, isStale, isArenaQueue } from './postgame.ts';
import { LcuSubscriber, type LcuEvent } from './ws.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

const LOCKFILE_PATH = process.env.LCU_LOCKFILE ?? 'C:\\Riot Games\\League of Legends\\lockfile';
const TRACKER = process.env.ARENA_TRACKER ?? 'https://arena.scrolab.com';
const PORT = Number(process.env.ARENA_COMPANION_PORT ?? 8788);
const CACHE_DIR = process.env.ARENA_CACHE ?? 'cache';
const CONFIG_PATH = process.env.ARENA_COMPANION_CONFIG ?? 'companion-config.json';
const OWNED_REFRESH_MS = 24 * 3600_000;
const CROWD_FAVORITES_PATH = '/lol-lobby-team-builder/champ-select/v1/crowd-favorite-champion-list';
const CROWD_FAVORITES_REFRESH_MS = 15_000;
// The Electron shell spawns the backend with this set, so an Arena champ select
// must not also pop the backend-only Edge app window.
const ELECTRON_HOST = process.env.ARENA_COMPANION_ELECTRON === '1';

interface CompanionConfig {
  gameName?: string;
  tagLine?: string;
  regionLabel?: string;
  autoShow?: boolean; // pop window on Arena champ select (default true)
  miniMode?: boolean; // start champ-select view in mini mode
  alwaysOnTop?: boolean;
}

const DEFAULT_CONFIG: CompanionConfig = {
  regionLabel: 'NA',
  autoShow: true,
  miniMode: false,
  alwaysOnTop: false,
};

const state: {
  lcuConnected: boolean;
  gameflowPhase: string;
  summoner: { gameName?: string; tagLine?: string; summonerLevel?: number } | null;
  arenaGod: number | null;
  champSelect: { available: boolean; status?: number; championId?: number; championName?: string | null; isArena?: boolean; neededOwned?: { name: string; masteryPoints: number; masteryLevel: number }[] };
  prevPhase: string;
  arenaQueueActive: boolean; // true while inside an Arena game flow
  ownedChampIds: number[];
  ownedFetchedAt: number;
  ddragonVersion: string | null;
  lastSync: string | null;
  checklist: { wonCount: number; total: number; gamesScanned: number; placements: { placement: number; count: number; percent: number }[]; cards: any[]; recent: any[] } | null;
  scanning: boolean;
  lastScanFailedAt: number | null;
  lastEvent: unknown | null;
  config: CompanionConfig;
  queueId: number | null;
  queueGameMode: string | null;
  /** Numeric champion key → ddragon name/image, for crowd favorites without a checklist. */
  championIndex: Map<number, { name: string; image: string }>;
  /** Champion ids of this session; GET is a late-WS safety net and 404 disables it until the next session. */
  crowdFavorites: { ids: number[]; lastGetAt: number; lastEventAt: number; getUnavailable: boolean };
  /** Process-memory only: transient Crowd Favorites preview toggle; never persisted or loaded from config. */
  overlayPreview: boolean;
} = {
  lcuConnected: false,
  gameflowPhase: '<unknown>',
  summoner: null,
  arenaGod: null,
  champSelect: { available: false },
  prevPhase: '',
  arenaQueueActive: false,
  ownedChampIds: [],
  ownedFetchedAt: 0,
  ddragonVersion: null,
  lastSync: null,
  checklist: null,
  scanning: false,
  lastScanFailedAt: null,
  lastEvent: null,
  config: { ...DEFAULT_CONFIG },
  queueId: null,
  queueGameMode: null,
  championIndex: new Map(),
  crowdFavorites: { ids: [], lastGetAt: 0, lastEventAt: 0, getUnavailable: false },
  overlayPreview: false,
};

try {
  state.config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
} catch {
  /* first run */
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(state.config, null, 2));
}

function readLockfile(): Lockfile | null {
  try {
    return parseLockfile(fs.readFileSync(LOCKFILE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

interface LcuQueueInfo {
  id?: number;
  mode?: string;
  gameMode?: string;
  type?: string;
}

/** Narrow the queue block out of an LCU gameflow session payload. */
function readQueue(session: unknown): LcuQueueInfo | null {
  if (!session || typeof session !== 'object' || !('gameData' in session)) return null;
  const gameData = session.gameData;
  if (!gameData || typeof gameData !== 'object' || !('queue' in gameData)) return null;
  const queue = gameData.queue;
  if (!queue || typeof queue !== 'object') return null;
  const idValue = 'id' in queue ? queue.id : undefined;
  const id = typeof idValue === 'number' ? idValue : typeof idValue === 'string' ? Number(idValue) || undefined : undefined;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    id,
    mode: text('mode' in queue ? queue.mode : undefined),
    gameMode: text('gameMode' in queue ? queue.gameMode : undefined),
    type: text('type' in queue ? queue.type : undefined),
  };
}

function lcu(): LcuClient | null {
  const lockfile = readLockfile();
  return lockfile ? new LcuClient(lockfile) : null;
}

export interface CrowdFavorite {
  id: number;
  name: string;
  image: string;
  won: boolean | null;
}

/**
 * Parse a crowd-favorite payload (WS `data` or the GET resource) into champion ids.
 * Returns null for unrecognized shapes so callers keep the previous list.
 */
export function parseCrowdFavoriteIds(data: unknown): number[] | null {
  if (data == null) return null;
  const items = Array.isArray(data) ? data : [data];
  const ids: number[] = [];
  let unrecognized = 0;
  for (const item of items) {
    let raw: unknown = item;
    if (item && typeof item === 'object') {
      const championId = 'championId' in item ? item.championId : undefined;
      const id = 'id' in item ? item.id : undefined;
      const key = 'key' in item ? item.key : undefined;
      raw = championId ?? id ?? key;
    }
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      unrecognized += 1;
      continue;
    }
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) ids.push(id);
    else unrecognized += 1;
  }
  // An explicit empty list clears the favorites; an unparsable payload does not.
  if (ids.length === 0 && unrecognized > 0) return null;
  return [...new Set(ids)];
}

/**
 * Map favorite champion ids onto ddragon cards. `won` is null — never false — whenever
 * the win data is unavailable or the last tracker scan failed; when cards are available
 * it follows the aggregated checklist, which already includes manual wins.
 */
export function resolveCrowdFavorites(
  ids: number[],
  cards: ReadonlyArray<{ key: string | number; name: string; image: string; won?: boolean }> | null | undefined,
  ddragonFallback?: ReadonlyMap<number, { name: string; image: string }>,
): CrowdFavorite[] {
  const byKey = new Map<number, { key: string | number; name: string; image: string; won?: boolean }>();
  for (const card of cards ?? []) byKey.set(Number(card.key), card);
  return ids.map((id) => {
    const card = byKey.get(id);
    const fallback = card ? undefined : ddragonFallback?.get(id);
    return {
      id,
      name: card?.name ?? fallback?.name ?? `Champion ${id}`,
      image: card?.image ?? fallback?.image ?? '',
      won: cards ? (card ? Boolean(card.won) : null) : null,
    };
  });
}

/** True only during an Arena champ select — the crowd favorite list is session-scoped. */
function crowdFavoritesActive(): boolean {
  return state.gameflowPhase === 'ChampSelect' && state.champSelect.isArena === true;
}

/** A real gameflow phase reading, as opposed to '<unreachable>' / HTTP error placeholders. */
function isMeasuredPhase(phase: string): boolean {
  return !phase.startsWith('<') && !phase.startsWith('HTTP ');
}

function setCrowdFavorites(ids: number[], source: string, logAlways = false) {
  const changed = ids.join(',') !== state.crowdFavorites.ids.join(',');
  state.crowdFavorites.ids = ids;
  if (!changed && !logAlways) return;
  if (state.championIndex.size === 0) void loadChampionIndex();
  const cards = state.lastScanFailedAt === null ? state.checklist?.cards : null;
  const resolved = resolveCrowdFavorites(ids, cards, state.championIndex).map(
    (f) => `${f.name}(${f.id})=${f.won === null ? 'unknown' : f.won ? 'won' : 'not-won'}`,
  );
  console.log(`[crowd-favorites] ${source}: ${ids.length} favorite(s) [${resolved.join(', ')}]`);
}

function clearCrowdFavorites(reason: string) {
  state.crowdFavorites.ids = [];
  state.crowdFavorites.lastGetAt = 0; // a new session must resync immediately
  state.crowdFavorites.getUnavailable = false;
  state.crowdFavorites.lastEventAt = 0;
  console.log(`[crowd-favorites] cleared (${reason})`);
}

/** Keep Create events even when they race the 3-second phase poll; display waits for Arena confirmation. */
function handleLcuEvent(event: LcuEvent) {
  if (event.uri !== CROWD_FAVORITES_PATH) return;
  if (event.eventType === 'Delete') {
    clearCrowdFavorites('WS Delete');
    return;
  }
  if (event.eventType !== 'Create' && event.eventType !== 'Update') return;
  const ids = parseCrowdFavoriteIds(event.data);
  if (!ids) {
    console.log(`[crowd-favorites] ignoring WS ${event.eventType} with unrecognized payload`);
    return;
  }
  state.crowdFavorites.lastEventAt = Date.now();
  setCrowdFavorites(ids, `WS ${event.eventType}`);
}

/**
 * Late start / missed-WS / reconnect recovery: pull the current list straight from LCU.
 * Throttled while a session is active; `force` bypasses the throttle after a WS reconnect.
 */
async function syncCrowdFavorites(source: string, force = false) {
  if (!crowdFavoritesActive() || state.crowdFavorites.getUnavailable) return;
  if (!force && Date.now() - state.crowdFavorites.lastGetAt < CROWD_FAVORITES_REFRESH_MS) return;
  const getAt = Date.now();
  state.crowdFavorites.lastGetAt = getAt;
  const client = lcu();
  if (!client) return;
  const eventAtStart = state.crowdFavorites.lastEventAt;
  try {
    const res = await client.getJson(CROWD_FAVORITES_PATH);
    if (!crowdFavoritesActive() || state.crowdFavorites.lastEventAt !== eventAtStart ||
        state.crowdFavorites.lastGetAt !== getAt) return;
    if (res.status === 404) {
      // Current LCU sends this resource by WebSocket but does not serve GET.
      // Retain the safety net for clients that do serve it; avoid 404 every 15s.
      state.crowdFavorites.getUnavailable = true;
      return;
    }
    const ids = res.status === 200 ? parseCrowdFavoriteIds(res.json) : null;
    if (ids) setCrowdFavorites(ids, `GET ${source}`, force);
    else console.log(`[crowd-favorites] GET ${source}: ${res.status === 200 ? 'unrecognized payload' : `HTTP ${res.status}`}`);
  } catch (err) {
    console.log(`[crowd-favorites] GET ${source} failed: ${String(err).slice(0, 120)}`);
  }
}

function indexChampions(champions: ReadonlyArray<{ key: string | number; name: string; image: string }>) {
  state.championIndex = new Map(champions.map((c) => [Number(c.key), { name: c.name, image: c.image }]));
}

let championIndexLoading: Promise<void> | null = null;

/** Populate champion names/images even when no checklist is available (offline scan, no identity). */
function loadChampionIndex(): Promise<void> {
  if (state.championIndex.size > 0) return Promise.resolve();
  if (championIndexLoading) return championIndexLoading;
  championIndexLoading = (async () => {
    try {
      const { version, champions } = await fetchChampions();
      indexChampions(champions);
      state.ddragonVersion ??= version;
      console.log(`[champions] index loaded from ddragon (${champions.length})`);
      return;
    } catch (err) {
      console.log(`[champions] ddragon index unavailable: ${String(err).slice(0, 120)}`);
    }
    try {
      const client = lcu();
      const raw = client ? (await client.getJson('/lol-game-data/assets/v1/champion-summary.json')).json : null;
      const champions = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const id = 'id' in entry ? Number(entry.id) : 0;
        if (!Number.isInteger(id) || id <= 0) return [];
        const alias = 'alias' in entry && typeof entry.alias === 'string' ? entry.alias : '';
        const name = 'name' in entry && typeof entry.name === 'string' ? entry.name : alias || String(id);
        return [{ key: String(id), name, image: alias ? `${alias}.png` : '' }];
      });
      if (champions.length > 0) {
        indexChampions(champions);
        console.log(`[champions] index loaded from LCU (${champions.length})`);
      } else {
        console.log('[champions] index unavailable (ddragon and LCU both failed)');
      }
    } catch (err) {
      console.log(`[champions] LCU index unavailable: ${String(err).slice(0, 120)}`);
    }
  })().finally(() => {
    championIndexLoading = null;
  });
  return championIndexLoading;
}

function wonChampNames(): string[] {
  return (state.checklist?.cards ?? []).filter((c) => c.won).map((c) => c.name);
}

async function pollLcu() {
  const client = lcu();
  if (!client) {
    state.lcuConnected = false;
    state.gameflowPhase = '<no lockfile>';
    return;
  }
  try {
    const phase = await client.getJson('/lol-gameflow/v1/gameflow-phase');
    state.lcuConnected = phase.status === 200;
    state.gameflowPhase = phase.status === 200 ? String(phase.json) : `HTTP ${phase.status}`;
  } catch {
    state.lcuConnected = false;
    state.gameflowPhase = '<unreachable>';
    return;
  }
  try {
    const s = await client.getJson('/lol-summoner/v1/current-summoner');
    if (s.status === 200 && s.json && typeof s.json === 'object') {
      const j = s.json as Record<string, unknown>;
      state.summoner = {
        gameName: String(j.gameName ?? ''),
        tagLine: String(j.tagLine ?? ''),
        summonerLevel: Number(j.summonerLevel ?? 0),
      };
    }
  } catch {
    /* keep previous */
  }
  try {
    const c = await client.getJson('/lol-challenges/v1/challenges/local-player');
    if (c.status === 200 && c.json && typeof c.json === 'object') {
      const arenaGod = (c.json as Record<string, any>)['602002'];
      if (arenaGod?.currentValue != null) state.arenaGod = Number(arenaGod.currentValue);
    }
  } catch {
    /* best effort */
  }

  // Owned champions: server-side cache, refreshed daily while LCU is up.
  if (Date.now() - state.ownedFetchedAt > OWNED_REFRESH_MS) {
    try {
      const owned = await client.getJson('/lol-champions/v1/owned-champions-minimal');
      if (owned.status === 200 && Array.isArray(owned.json)) {
        state.ownedChampIds = owned.json.map((c: any) => Number(c.id));
        state.ownedFetchedAt = Date.now();
      }
    } catch {
      /* keep previous */
    }
  }

  // Track whether we're inside an Arena game flow (for post-game detection).
  let arenaQueue = false;
  let arenaQueueKnown = false;
  if (['ChampSelect', 'InProgress', 'WaitingForStats'].includes(state.gameflowPhase)) {
    try {
      const flow = await client.getJson('/lol-gameflow/v1/session');
      const queue = readQueue(flow.json);
      state.queueId = Number(queue?.id ?? 0) || null;
      state.queueGameMode = queue?.gameMode ?? queue?.mode ?? queue?.type ?? null;
      arenaQueue = isArenaQueue(state.queueId, state.queueGameMode);
      arenaQueueKnown = true;
      if (arenaQueue) state.arenaQueueActive = true;
    } catch {
      /* keep previous */
    }
  }

  // Post-game moment: leaving an Arena match → incremental rescan + event.
  if (
    state.arenaQueueActive &&
    detectArenaGameEnd(state.prevPhase, state.gameflowPhase, state.queueId ?? 0, state.queueGameMode)
  ) {
    state.arenaQueueActive = false;
    const before = { wonCount: state.checklist?.wonCount ?? 0, wonChampNames: wonChampNames() };
    const lastPlayed = state.checklist?.recent?.[0]?.championName ?? null;
    console.log('Arena game ended — running incremental rescan');
    const r = await refreshChecklist(false);
    if (r.ok && state.checklist) {
      const after = { wonCount: state.checklist.wonCount, wonChampNames: wonChampNames() };
      state.lastEvent = computePostGameEvent(before, after, lastPlayed);
      console.log(`post-game event: ${JSON.stringify(state.lastEvent)}`);
    }
  }
  if (state.gameflowPhase === 'None' || state.gameflowPhase === 'Lobby') {
    state.arenaQueueActive = false;
  }

  // champ select
  if (state.gameflowPhase === 'ChampSelect') {
    const justEntered = state.prevPhase !== 'ChampSelect';
    // CHERRY game mode or queue 1700/1750 → Arena. If this tick's single gameflow read
    // failed, keep the previous verdict instead of flapping isArena.
    const isArena = arenaQueueKnown ? arenaQueue : state.champSelect.isArena === true;
    if (justEntered) {
      // The WS Create can arrive before our phase poll; preserve that fresh list.
      // An older list belongs to another champ select and must not leak across sessions.
      if (Date.now() - state.crowdFavorites.lastEventAt > 30_000) {
        clearCrowdFavorites('champ select entered');
      }
      try {
        const owned = await client.getJson('/lol-champions/v1/owned-champions-minimal');
        if (owned.status === 200 && Array.isArray(owned.json)) {
          state.ownedChampIds = owned.json.map((c: any) => Number(c.id));
          state.ownedFetchedAt = Date.now();
        }
      } catch {
        /* keep previous */
      }
      if (isArena && state.config.autoShow && !ELECTRON_HOST) {
        console.log('Arena champ select detected — opening companion UI (Edge app window)');
        exec('start "" "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --app=http://localhost:8788/#/champselect');
      }
    }
    try {
      const cs = await client.getJson('/lol-champ-select/v1/session');
      if (cs.status === 200 && cs.json && typeof cs.json === 'object') {
        const session = cs.json as any;
        const myCell = session.localPlayerCellId;
        const me = (session.myTeam ?? []).find((p: any) => p.cellId === myCell);
        const championId = me?.championId || me?.championPickIntent || 0;
        const owned = new Set(state.ownedChampIds);
        const neededOwned = (state.checklist?.cards ?? [])
          .filter((c) => !c.won && owned.has(Number(c.key)))
          .sort((a, b) => b.masteryPoints - a.masteryPoints)
          .map((c) => ({ name: c.name, masteryPoints: c.masteryPoints, masteryLevel: c.masteryLevel, image: c.image }));
        state.champSelect = {
          available: true,
          championId,
          championName: state.checklist?.cards.find((c) => Number(c.key) === championId)?.name ?? null,
          isArena,
          neededOwned,
        };
      } else {
        state.champSelect = { available: false, status: cs.status };
      }
    } catch {
      state.champSelect = { available: false };
    }
    // Throttled safety net: recovers a list created before our WS subscription existed.
    if (isArena) void syncCrowdFavorites('champ-select');
  } else {
    // Only a measured phase change counts as leaving champ select; transient LCU
    // errors ('<unreachable>', HTTP …) must not wipe an in-progress list.
    if (state.prevPhase === 'ChampSelect' && isMeasuredPhase(state.gameflowPhase)) {
      clearCrowdFavorites('left champ select');
    }
    state.champSelect = { available: false };
  }
  state.prevPhase = state.gameflowPhase;
}

async function refreshChecklist(full = false) {
  const gameName = state.config.gameName ?? state.summoner?.gameName;
  const tagLine = state.config.tagLine ?? state.summoner?.tagLine;
  if (!gameName || !tagLine) return { ok: false, error: 'no player identity (LCU offline and no manual Riot ID set)' };
  const region = regionByLabel(state.config.regionLabel ?? 'NA');
  const api = makeTrackerApi(TRACKER);
  state.scanning = true;
  try {
    let store = loadStore(CACHE_DIR, region.platform, gameName, tagLine);
    store = store && !full ? await update(api, region, store) : await fullScan(api, { region, gameName, tagLine, depth: Number.POSITIVE_INFINITY });
    saveStore(CACHE_DIR, region.platform, gameName, tagLine, store);
    const { version, champions } = await fetchChampions();
    state.ddragonVersion = version;
    indexChampions(champions);
    const masteries = await api.getMasteries(region.platform, store.account.puuid);
    const manual = new Set(await api.getManualWins(`${region.platform}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`));
    const result = aggregate(store, champions, masteries, manual);
    state.checklist = result;
    state.lastScanFailedAt = null;
    if (state.crowdFavorites.ids.length) setCrowdFavorites(state.crowdFavorites.ids, 'checklist refreshed', true);
    state.lastSync = new Date().toISOString();
    return { ok: true };
  } catch (err) {
    state.lastScanFailedAt = Date.now();
    console.log(`[champions] scan failed — crowd favorites will report win state as unknown: ${String(err).slice(0, 160)}`);
    if (state.crowdFavorites.ids.length) setCrowdFavorites(state.crowdFavorites.ids, 'checklist unavailable', true);
    return { ok: false, error: String(err).slice(0, 200) };
  } finally {
    state.scanning = false;
  }
}

function playerKey(): string | null {
  const gameName = state.config.gameName ?? state.summoner?.gameName;
  const tagLine = state.config.tagLine ?? state.summoner?.tagLine;
  if (!gameName || !tagLine) return null;
  const platform = regionByLabel(state.config.regionLabel ?? 'NA').platform;
  return `${platform}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (code: number, body: unknown, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
  };
  const readBody = () =>
    new Promise<string>((r) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => r(d));
    });
  try {
    // Static UI
    if (url.pathname === '/' || MIME[path.extname(url.pathname)]) {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      // Favicon assets live in ../assets; everything else is the UI bundle.
      const dir = rel === 'icon.svg' || rel === 'icon-32.png' ? path.join(__dirname, '..', 'assets') : UI_DIR;
      const file = path.join(dir, rel);
      if (!file.startsWith(dir) || !fs.existsSync(file)) return send(404, { error: 'not found' });
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }
    if (url.pathname === '/api/status') {
      const owned = new Set(state.ownedChampIds);
      const cards = (state.checklist?.cards ?? []).map((c) => ({ ...c, owned: owned.size === 0 || owned.has(Number(c.key)) }));
      const crowdFavoritesActiveNow = crowdFavoritesActive();
      const winDataKnown = state.checklist !== null && state.lastScanFailedAt === null;
      const crowdFavorites = crowdFavoritesActiveNow
        ? resolveCrowdFavorites(state.crowdFavorites.ids, winDataKnown ? state.checklist?.cards : null, state.championIndex)
        : [];
      return send(200, {
        lcuConnected: state.lcuConnected,
        gameflowPhase: state.gameflowPhase,
        player: playerKey(),
        summoner: state.summoner,
        arenaGod: state.arenaGod,
        champSelect: state.champSelect,
        crowdFavorites,
        crowdFavoritesActive: crowdFavoritesActiveNow,
        overlayPreview: state.overlayPreview,
        lastSync: state.lastSync,
        stale: isStale(state.lastSync, Date.now()),
        scanning: state.scanning,
        lastEvent: state.lastEvent,
        ddragonVersion: state.ddragonVersion,
        ownedCount: state.ownedChampIds.length,
        checklist: state.checklist
          ? {
              wonCount: state.checklist.wonCount,
              total: state.checklist.total,
              gamesScanned: state.checklist.gamesScanned,
              placements: state.checklist.placements,
            }
          : null,
        recent: state.checklist?.recent?.slice(0, 10) ?? [],
        cards,
        config: state.config,
      });
    }
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const full = Boolean(JSON.parse((await readBody()) || '{}').full);
      return send(200, await refreshChecklist(full));
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(200, state.config);
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      state.config = { ...state.config, ...JSON.parse((await readBody()) || '{}') };
      saveConfig();
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/overlay-preview' && req.method === 'POST') {
      let parsed: { enabled?: unknown };
      try {
        parsed = JSON.parse((await readBody()) || '{}');
      } catch {
        return send(400, { error: 'invalid JSON body' });
      }
      if (typeof parsed?.enabled !== 'boolean') return send(400, { error: 'enabled must be a boolean' });
      state.overlayPreview = parsed.enabled;
      return send(200, { enabled: state.overlayPreview });
    }
    if (url.pathname.startsWith('/api/manual/')) {
      const champion = decodeURIComponent(url.pathname.slice('/api/manual/'.length));
      const key = playerKey();
      if (!key) return send(400, { error: 'no player identity' });
      const api = makeTrackerApi(TRACKER);
      if (req.method === 'POST') {
        await api.addManualWin(key, champion);
      } else if (req.method === 'DELETE') {
        await api.removeManualWin(key, champion);
      } else {
        return send(405, { error: 'method not allowed' });
      }
      if (state.checklist) {
        const card = state.checklist.cards.find((c) => c.name === champion || c.id === champion);
        if (card) {
          card.manual = req.method === 'POST';
          card.won = card.wins > 0 || card.manual;
          state.checklist.wonCount = state.checklist.cards.filter((c) => c.won).length;
        }
      }
      if (state.crowdFavorites.ids.length) setCrowdFavorites(state.crowdFavorites.ids, 'manual win changed', true);
      return send(200, { ok: true });
    }
    send(404, { error: 'not found' });
  } catch (err) {
    send(500, { error: String(err).slice(0, 300) });
  }
});

/**
 * True when this module is the process entry point (Node 22 has no import.meta.main).
 * Tests import the exported helpers without starting the server or LCU sockets.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const crowdFavoritesWs = new LcuSubscriber({
    resolveLockfile: readLockfile,
    reconnectDelayMs: 5000,
    onEvent: handleLcuEvent,
    onStatus: (status) => {
      if (status.connected) {
        console.log(`[ws] LCU event socket connected (gen ${status.generation}, port ${status.port})`);
        // Late start / reconnect: pull the current list instead of waiting for the
        // next Create event, which may have been sent before we subscribed.
        void syncCrowdFavorites('ws-connected', true);
      } else {
        console.log(`[ws] LCU event socket offline${status.error ? ` (${status.error.slice(0, 160)})` : ''} — retrying`);
      }
    },
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Arena Companion UI: http://localhost:${PORT}`);
    setInterval(pollLcu, 3000);
    crowdFavoritesWs.start();
    void loadChampionIndex();
    // Wait for the first LCU poll so the player identity is known before scanning.
    pollLcu()
      .then(() => refreshChecklist())
      .then((r) => {
        if (!r.ok) console.log(`initial scan skipped: ${r.error}`);
      });
  });
}
