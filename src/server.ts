import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLockfile, type Lockfile } from './lockfile.ts';
import { LcuClient } from './lcu.ts';
import { makeTrackerApi } from './trackerApi.ts';
import { fetchChampionsCached } from './ddragon.ts';
import { aggregate, applyManualMark, loadStore, saveStore, update, fullScan, writeFileAtomic, matchList, type MatchRow } from './scan.ts';
import { computeInsights } from './insights.ts';
import { normalizeUpdateStatus, type UpdateStatus } from './updateStatus.ts';
import { fixtureArt, fixtureScenario, isFixtureScenario, type FixtureScenarioName } from './fixture.ts';
import { REGIONS, regionByLabel, regionFromClient } from './regions.ts';
import { applyConfigPatch, loadConfig, normalizeConfigPatch, type CompanionConfig } from './config.ts';
import { isJsonContentType, rejectRequest } from './httpGuard.ts';
import { responseBody } from './respond.ts';
import { isEntryPoint } from './entry.ts';
import { detectArenaGameEnd, computePostGameEvent, findFinishedGame, postGameStep, wonSnapshot, isStale, isArenaQueue, type PostGameEvent } from './postgame.ts';
import { LcuSubscriber, type LcuEvent } from './ws.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version ?? ''); }
  catch { return ''; }
})();
const UI_DIR = path.join(__dirname, 'ui');

const LOCKFILE_PATH = process.env.LCU_LOCKFILE ?? 'C:\\Riot Games\\League of Legends\\lockfile';
const TRACKER = process.env.ARENA_TRACKER ?? 'https://arena.scrolab.com';
const PORT = Number(process.env.ARENA_COMPANION_PORT ?? 8788);
const CACHE_DIR = process.env.ARENA_CACHE ?? 'cache';
const CONFIG_PATH = process.env.ARENA_COMPANION_CONFIG ?? 'companion-config.json';
/** Sample-data mode for UI work and screenshots: '1' (idle) or 'champselect'. No LCU or tracker access. */
const FIXTURE = process.env.ARENA_COMPANION_FIXTURE ?? '';
const OWNED_REFRESH_MS = 24 * 3600_000;
const CROWD_FAVORITES_PATH = '/lol-lobby-team-builder/champ-select/v1/crowd-favorite-champion-list';
const CROWD_FAVORITES_REFRESH_MS = 15_000;
const GAMEFLOW_PHASE_PATH = '/lol-gameflow/v1/gameflow-phase';
/** The challenges payload is large and only changes after a game; the summoner rarely changes. */
const CHALLENGES_REFRESH_MS = 5 * 60_000;
const SUMMONER_REFRESH_MS = 60_000;
/**
 * LCU event topics. Keep the catch-all: crowd favorites arrive only as an event
 * (GET on the resource is 404), and path-specific topics such as
 * OnJsonApiEvent_lol-lobby-team-builder_champ-select_v1_crowd-favorite-champion-list
 * never delivered them, which left the panel hidden (v0.2.0–v0.2.2).
 */
export const LCU_EVENT_TOPICS = ['OnJsonApiEvent'];

const state: {
  lcuConnected: boolean;
  gameflowPhase: string;
  summoner: { gameName?: string; tagLine?: string; summonerLevel?: number } | null;
  /** Region label reported by the League client; null until detected. */
  detectedRegion: string | null;
  arenaGod: number | null;
  champSelect: { available: boolean; status?: number; championId?: number; championName?: string | null; isArena?: boolean; neededOwned?: { name: string; masteryPoints: number; masteryLevel: number }[] };
  prevPhase: string;
  arenaQueueActive: boolean; // true while inside an Arena game flow
  ownedChampIds: number[];
  ownedFetchedAt: number;
  challengesFetchedAt: number;
  summonerFetchedAt: number;
  ddragonVersion: string | null;
  lastSync: string | null;
  checklist: { wonCount: number; total: number; gamesScanned: number; placements: { placement: number; count: number; percent: number }[]; cards: any[]; recent: any[] } | null;
  /** Every scanned Arena match, newest first (served by /api/matches, not /api/status). */
  matches: MatchRow[];
  scanning: boolean;
  lastScanFailedAt: number | null;
  lastEvent: PostGameEvent | null;
  config: CompanionConfig;
  queueId: number | null;
  queueGameMode: string | null;
  /** Numeric champion key → ddragon name/image, for crowd favorites without a checklist. */
  championIndex: Map<number, { name: string; image: string }>;
  /** Champion ids of this session; GET is a late-WS safety net and 404 disables it until the next session. */
  crowdFavorites: { ids: number[]; lastGetAt: number; lastEventAt: number; getUnavailable: boolean };
  /** Process-memory only: transient Crowd Favorites preview toggle; never persisted or loaded from config. */
  overlayPreview: boolean;
  /** Auto-update progress reported by the Electron shell; null when nothing is pending. */
  update: UpdateStatus | null;
} = {
  lcuConnected: false,
  gameflowPhase: '<unknown>',
  summoner: null,
  detectedRegion: null,
  arenaGod: null,
  champSelect: { available: false },
  prevPhase: '',
  arenaQueueActive: false,
  ownedChampIds: [],
  ownedFetchedAt: 0,
  challengesFetchedAt: 0,
  summonerFetchedAt: 0,
  ddragonVersion: null,
  lastSync: null,
  checklist: null,
  matches: [],
  scanning: false,
  lastScanFailedAt: null,
  lastEvent: null,
  config: loadConfig(null),
  queueId: null,
  queueGameMode: null,
  championIndex: new Map(),
  crowdFavorites: { ids: [], lastGetAt: 0, lastEventAt: 0, getUnavailable: false },
  overlayPreview: false,
  update: null,
};

try {
  // Unknown keys (e.g. the retired autoShow) and invalid values are dropped.
  state.config = loadConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
} catch {
  /* first run */
}

function saveConfig() {
  writeFileAtomic(CONFIG_PATH, JSON.stringify(state.config, null, 2));
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

let cachedLcu: { key: string; client: LcuClient } | null = null;

/** One keep-alive client per lockfile, so polls reuse a TLS connection instead of handshaking each time. */
function lcu(): LcuClient | null {
  const lockfile = readLockfile();
  if (!lockfile) {
    cachedLcu?.client.close();
    cachedLcu = null;
    return null;
  }
  const key = `${lockfile.port}:${lockfile.password}`;
  if (cachedLcu?.key !== key) {
    cachedLcu?.client.close();
    cachedLcu = { key, client: new LcuClient(lockfile) };
  }
  return cachedLcu.client;
}

/** Riot ID to scan: the Settings override when set, otherwise the logged-in summoner. */
function currentIdentity(): { gameName: string; tagLine: string } | null {
  if (state.config.gameName && state.config.tagLine) {
    return { gameName: state.config.gameName, tagLine: state.config.tagLine };
  }
  const { gameName, tagLine } = state.summoner ?? {};
  return gameName && tagLine ? { gameName, tagLine } : null;
}

/** Region to scan: the Settings override, else the client's region, else NA. */
function currentRegion() {
  return regionByLabel(state.config.regionLabel ?? state.detectedRegion ?? 'NA');
}

let unknownRegionLogged = '';

/** Ask the client which region it is logged into ({ region: "NA" | "EUW" | "LA1" | … }). */
async function detectRegion(client: LcuClient) {
  try {
    const res = await client.getJson('/riotclient/region-locale');
    const raw = res.status === 200 ? (res.json as Record<string, unknown> | null)?.region : undefined;
    const region = regionFromClient(raw);
    if (region) {
      state.detectedRegion = region.label;
      console.log(`[region] client reports ${String(raw)} → ${region.label}`);
    } else if (raw !== undefined && JSON.stringify(raw) !== unknownRegionLogged) {
      unknownRegionLogged = JSON.stringify(raw);
      console.log(`[region] unrecognized client region ${unknownRegionLogged}; using NA`);
    }
  } catch {
    /* retried on the next poll */
  }
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
  if (event.uri === GAMEFLOW_PHASE_PATH) {
    // React to phase changes right away instead of waiting for the next poll tick.
    void pollTick();
    return;
  }
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
      const { version, champions } = await fetchChampionsCached();
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

async function pollLcu() {
  // Before the first scan has produced a checklist, the startup scan handles identity.
  const keyBefore = state.checklist ? playerKey() : null;
  const client = lcu();
  if (!client) {
    state.lcuConnected = false;
    state.gameflowPhase = '<no lockfile>';
    state.detectedRegion = null; // the next client session may be another account
    state.challengesFetchedAt = 0;
    state.summonerFetchedAt = 0;
    return;
  }
  try {
    const phase = await client.getJson('/lol-gameflow/v1/gameflow-phase');
    state.lcuConnected = phase.status === 200;
    state.gameflowPhase = phase.status === 200 ? String(phase.json) : `HTTP ${phase.status}`;
  } catch {
    state.lcuConnected = false;
    state.gameflowPhase = '<unreachable>';
    state.challengesFetchedAt = 0;
    state.summonerFetchedAt = 0;
    return;
  }
  if (!state.summoner || Date.now() - state.summonerFetchedAt > SUMMONER_REFRESH_MS) {
    try {
      const s = await client.getJson('/lol-summoner/v1/current-summoner');
      if (s.status === 200 && s.json && typeof s.json === 'object') {
        const j = s.json as Record<string, unknown>;
        state.summoner = {
          gameName: String(j.gameName ?? ''),
          tagLine: String(j.tagLine ?? ''),
          summonerLevel: Number(j.summonerLevel ?? 0),
        };
        state.summonerFetchedAt = Date.now();
      }
    } catch {
      /* keep previous */
    }
  }
  if (!state.detectedRegion) await detectRegion(client);
  if (keyBefore) rescanIfPlayerChanged(keyBefore, 'client account or region changed');
  // Leaving a game refreshes it sooner: that is when the Arena God count can move.
  if (state.prevPhase !== state.gameflowPhase && ['EndOfGame', 'PreEndOfGame'].includes(state.gameflowPhase)) {
    state.challengesFetchedAt = 0;
  }
  if (Date.now() - state.challengesFetchedAt > CHALLENGES_REFRESH_MS) {
    try {
      const c = await client.getJson('/lol-challenges/v1/challenges/local-player');
      if (c.status === 200 && c.json && typeof c.json === 'object') {
        const arenaGod = (c.json as Record<string, any>)['602002'];
        if (arenaGod?.currentValue != null) state.arenaGod = Number(arenaGod.currentValue);
        state.challengesFetchedAt = Date.now();
      }
    } catch {
      /* best effort */
    }
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
    // Not awaited: a rescan can take a while and polling must keep tracking phases.
    void postGameRescan();
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
    }
    try {
      const cs = await client.getJson('/lol-champ-select/v1/session');
      if (cs.status === 200 && cs.json && typeof cs.json === 'object') {
        const session = cs.json as any;
        const myCell = session.localPlayerCellId;
        const me = (session.myTeam ?? []).find((p: any) => p.cellId === myCell);
        const championId = me?.championId || me?.championPickIntent || 0;
        state.champSelect = {
          available: true,
          championId,
          championName: state.checklist?.cards.find((c) => Number(c.key) === championId)?.name ?? null,
          isArena,
          neededOwned: neededOwnedCards(),
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

/** Needed champions you own, by mastery: the champ select suggestions. */
function neededOwnedCards() {
  const owned = new Set(state.ownedChampIds);
  return (state.checklist?.cards ?? [])
    .filter((c) => !c.won && owned.has(Number(c.key)))
    .sort((a, b) => b.masteryPoints - a.masteryPoints)
    .map((c) => ({ name: c.name, masteryPoints: c.masteryPoints, masteryLevel: c.masteryLevel, image: c.image }));
}

let postGameRun = 0;

async function postGameRescan() {
  const run = ++postGameRun;
  const leftAt = Date.now();
  const player = playerKey();
  const before = wonSnapshot(state.checklist?.cards ?? []);
  const context = { arenaGodBefore: state.arenaGod, total: state.checklist?.total ?? null };
  const lastPlayed = state.checklist?.recent?.[0]?.championName ?? null;
  let waitingEvent: PostGameEvent | null = null;
  // The waiting event stops waiting in place (same `at`, so the UI does not show it again).
  const stopWaiting = () => {
    if (waitingEvent && state.lastEvent === waitingEvent) state.lastEvent = { ...waitingEvent, pending: false };
  };
  console.log('Arena game ended — running incremental rescan');
  for (let attempt = 0; ; attempt += 1) {
    const r = await refreshChecklist(false);
    // A newer game, or another player, owns the post-game moment now.
    if (run !== postGameRun) return;
    if (playerKey() !== player) return stopWaiting();
    state.challengesFetchedAt = 0; // pick up the new Arena God count on the next poll
    if (!r.ok || !state.checklist) return stopWaiting();
    const game = findFinishedGame(state.matches, leftAt);
    // Only match-history wins are new: marking a remembered win while waiting is not a first win.
    const after = wonSnapshot(state.checklist.cards, before);
    const event = computePostGameEvent(before, after, lastPlayed, { ...context, game });
    const step = postGameStep(attempt, Boolean(game) || event.type === 'new-win');
    if (step.publish === 'final' || step.publish === 'waiting') {
      state.lastEvent = step.publish === 'waiting' ? (waitingEvent = { ...event, pending: true }) : event;
      console.log(`post-game event: ${JSON.stringify(state.lastEvent)}`);
    } else if (step.publish === 'stop-waiting') {
      console.log('[post-game] the game never reached match history; a later scan will pick it up');
      stopWaiting();
    }
    const delay = step.retryIn;
    if (delay === null) return;
    console.log(`[post-game] game not in match history yet; checking again in ${delay / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (run !== postGameRun) return;
  }
}

let pollRunning = false;

/** Interval entry point: skips a tick while the previous poll still waits on LCU. */
async function pollTick() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    await pollLcu();
  } finally {
    pollRunning = false;
  }
}

type ScanResult = { ok: true } | { ok: false; error: string };
let scanInFlight: { key: string | null; full: boolean; promise: Promise<ScanResult> } | null = null;

/**
 * One scan at a time. A request for the same player (and no fuller scan than
 * the running one) shares the running scan's result — the startup scan,
 * post-game rescan and UI buttons can all overlap. A request for a different
 * player/region, or a full scan behind an incremental one, queues after it.
 */
function refreshChecklist(full = false): Promise<ScanResult> {
  const key = playerKey();
  if (scanInFlight && scanInFlight.key === key && (scanInFlight.full || !full)) return scanInFlight.promise;
  const previous = scanInFlight?.promise ?? Promise.resolve();
  const entry = {
    key,
    full,
    promise: previous
      .catch(() => undefined)
      .then(() => runScan(full))
      .finally(() => {
        if (scanInFlight === entry) scanInFlight = null;
      }),
  };
  scanInFlight = entry;
  return entry.promise;
}

/** Drop the checklist and rescan when the player or region changed (Settings, account switch, region detection). */
function rescanIfPlayerChanged(before: string | null, reason: string) {
  const after = playerKey();
  if (after === before) return;
  console.log(`[scan] ${reason}: player ${before ?? 'none'} → ${after ?? 'none'}`);
  state.checklist = null; // belongs to the previous player
  if (after) void refreshChecklist();
}

async function runScan(full: boolean): Promise<ScanResult> {
  if (FIXTURE) return { ok: true }; // sample data never rescans
  const who = currentIdentity();
  if (!who) return { ok: false, error: 'no player identity (LCU offline and no manual Riot ID set)' };
  const { gameName, tagLine } = who;
  const region = currentRegion();
  const api = makeTrackerApi(TRACKER);
  state.scanning = true;
  try {
    let store = loadStore(CACHE_DIR, region.platform, gameName, tagLine);
    store = store && !full ? await update(api, region, store) : await fullScan(api, { region, gameName, tagLine, depth: Number.POSITIVE_INFINITY });
    saveStore(CACHE_DIR, region.platform, gameName, tagLine, store);
    const { version, champions } = await fetchChampionsCached();
    state.ddragonVersion = version;
    indexChampions(champions);
    const masteries = await api.getMasteries(region.platform, store.account.puuid);
    const manual = new Set(await api.getManualWins(playerKeyFor(region.platform, gameName, tagLine)));
    const result = aggregate(store, champions, masteries, manual);
    // The player or region may have changed while this scan ran; a queued scan covers the new one.
    if (playerKeyFor(region.platform, gameName, tagLine) !== playerKey()) return { ok: false, error: 'player changed during scan' };
    state.checklist = result;
    state.matches = matchList(store, champions);
    state.lastScanFailedAt = null;
    if (store.pending?.length) console.log(`[scan] ${store.pending.length} match(es) could not be fetched; retrying on the next scan`);
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

function playerKeyFor(platform: string, gameName: string, tagLine: string): string {
  return `${platform}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

function playerKey(): string | null {
  const who = currentIdentity();
  return who ? playerKeyFor(currentRegion().platform, who.gameName, who.tagLine) : null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/** Cards with ownership resolved (everything counts as owned until the client reports otherwise). */
function cardsWithOwnership() {
  const owned = new Set(state.ownedChampIds);
  return (state.checklist?.cards ?? []).map((c) => ({ ...c, owned: owned.size === 0 || owned.has(Number(c.key)) }));
}

let fixtureScenarioActive: FixtureScenarioName | null = null;

/** Load the sample player in a scenario (a fresh copy each time, so switching scenarios resets manual marks). */
function loadFixture(name: string) {
  const sc = fixtureScenario(name, Date.now());
  const fx = sc.fixture;
  const masteries = Object.fromEntries(Object.entries(fx.masteries));
  state.checklist = aggregate(fx.store, fx.champions, masteries, fx.manual);
  state.matches = matchList(fx.store, fx.champions);
  indexChampions(fx.champions);
  for (const c of sc.indexOnly) state.championIndex.set(c.key, { name: c.name, image: c.image });
  state.ddragonVersion = 'fixture';
  state.ownedChampIds = fx.owned;
  state.ownedFetchedAt = Date.now();
  state.arenaGod = fx.arenaGod;
  state.summoner = fx.summoner;
  state.detectedRegion = 'NA';
  state.lcuConnected = true;
  state.lastSync = new Date(Date.now() - (sc.event ? 1 : 12) * 60_000).toISOString();
  state.gameflowPhase = sc.phase;
  state.champSelect = { available: false };
  if (sc.phase === 'ChampSelect') {
    const cards = state.checklist.cards;
    const current = cards.find((c) => c.name === sc.pick) ?? cards[0];
    state.champSelect = { available: true, championId: Number(current.key), championName: current.name, isArena: true, neededOwned: neededOwnedCards() };
  }
  state.crowdFavorites.ids = sc.crowd;
  state.lastEvent = sc.event;
  fixtureScenarioActive = sc.name;
  console.log(`[fixture] sample data loaded (${state.matches.length} matches, scenario ${sc.name})`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (code: number, body: unknown, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(responseBody(body, type));
  };
  const readBody = () =>
    new Promise<string>((r) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => r(d));
    });
  /** Parse a JSON request body; null when it is not JSON (the caller answers 400/415). */
  const readJson = async (): Promise<{ value: unknown } | null> => {
    if (!isJsonContentType(req.headers['content-type'])) return null;
    try {
      return { value: JSON.parse((await readBody()) || '{}') };
    } catch {
      return null;
    }
  };
  const rejected = rejectRequest(req, PORT);
  if (rejected) {
    console.log(`[http] rejected ${req.method} ${url.pathname}: ${rejected}`);
    return send(403, { error: rejected });
  }
  try {
    if (FIXTURE && url.pathname.startsWith('/fixture-art/') && url.pathname.endsWith('.svg')) {
      const id = decodeURIComponent(url.pathname.slice('/fixture-art/'.length, -'.svg'.length));
      if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return send(404, { error: 'not found' });
      return send(200, fixtureArt(id), 'image/svg+xml');
    }
    // Static UI
    if (url.pathname === '/' || MIME[path.extname(url.pathname)]) {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      // Favicon assets live in ../assets; everything else is the UI bundle.
      const dir = rel === 'icon.svg' || rel === 'icon-32.png' ? path.join(__dirname, '..', 'assets') : UI_DIR;
      const file = path.join(dir, rel);
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return send(404, { error: 'not found' });
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }
    if (url.pathname === '/api/matches' && req.method === 'GET') {
      return send(200, { matches: state.matches });
    }
    if (url.pathname === '/api/insights' && req.method === 'GET') {
      if (!state.checklist) return send(200, null);
      return send(200, computeInsights(state.matches, cardsWithOwnership(), {
        total: state.checklist.total,
        // Same count as the dashboard headline: Riot's official number when the
        // client reports it (it includes wins older than match history).
        wonCount: Math.max(state.arenaGod ?? 0, state.checklist.wonCount),
        now: Date.now(),
      }));
    }
    if (url.pathname === '/api/status') {
      const cards = cardsWithOwnership();
      const crowdFavoritesActiveNow = crowdFavoritesActive();
      const winDataKnown = state.checklist !== null && state.lastScanFailedAt === null;
      const crowdFavorites = crowdFavoritesActiveNow
        ? resolveCrowdFavorites(state.crowdFavorites.ids, winDataKnown ? state.checklist?.cards : null, state.championIndex)
        : [];
      return send(200, {
        fixture: Boolean(FIXTURE),
        app: { version: APP_VERSION, dataDir: path.dirname(path.resolve(CONFIG_PATH)) },
        lcuConnected: state.lcuConnected,
        gameflowPhase: state.gameflowPhase,
        player: playerKey(),
        summoner: state.summoner,
        arenaGod: state.arenaGod,
        champSelect: state.champSelect,
        crowdFavorites,
        crowdFavoritesActive: crowdFavoritesActiveNow,
        overlayPreview: state.overlayPreview,
        update: state.update,
        lastSync: state.lastSync,
        stale: isStale(state.lastSync, Date.now()),
        scanning: state.scanning,
        lastEvent: state.lastEvent,
        ddragonVersion: state.ddragonVersion,
        fixtureScenario: fixtureScenarioActive,
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
        region: {
          label: currentRegion().label,
          detected: state.detectedRegion,
          override: state.config.regionLabel ?? null,
          options: REGIONS.map((r) => r.label),
        },
      });
    }
    if (FIXTURE && url.pathname === '/api/fixture/scenario' && req.method === 'POST') {
      const body = await readJson();
      if (!body) return send(415, { error: 'expected a JSON body' });
      const name = (body.value as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !isFixtureScenario(name)) return send(400, { error: 'unknown scenario' });
      loadFixture(name);
      return send(200, { ok: true, scenario: name });
    }
    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      const body = await readJson();
      if (!body) return send(415, { error: 'expected a JSON body' });
      const full = Boolean((body.value as { full?: unknown } | null)?.full);
      return send(200, await refreshChecklist(full));
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(200, state.config);
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const body = await readJson();
      if (!body) return send(415, { error: 'expected a JSON body' });
      const patch = normalizeConfigPatch(body.value);
      if (!patch.ok) return send(400, { error: patch.error });
      const before = playerKey();
      state.config = applyConfigPatch(state.config, patch);
      saveConfig();
      rescanIfPlayerChanged(before, 'settings changed');
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/update-status' && req.method === 'POST') {
      const body = await readJson();
      const status = body ? normalizeUpdateStatus(body.value) : undefined;
      if (status === undefined) return send(400, { error: 'invalid update status' });
      state.update = status;
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/overlay-preview' && req.method === 'POST') {
      const body = await readJson();
      if (!body) return send(400, { error: 'invalid JSON body' });
      const parsed = body.value as { enabled?: unknown } | null;
      if (typeof parsed?.enabled !== 'boolean') return send(400, { error: 'enabled must be a boolean' });
      state.overlayPreview = parsed.enabled;
      return send(200, { enabled: state.overlayPreview });
    }
    if (url.pathname.startsWith('/api/manual/')) {
      const champion = decodeURIComponent(url.pathname.slice('/api/manual/'.length));
      const key = playerKey();
      if (!key) return send(400, { error: 'no player identity' });
      const api = makeTrackerApi(TRACKER);
      if (req.method !== 'POST' && req.method !== 'DELETE') return send(405, { error: 'method not allowed' });
      if (!FIXTURE) {
        if (req.method === 'POST') await api.addManualWin(key, champion);
        else await api.removeManualWin(key, champion);
      }
      if (state.checklist) applyManualMark(state.checklist, champion, req.method === 'POST');
      if (state.crowdFavorites.ids.length) setCrowdFavorites(state.crowdFavorites.ids, 'manual win changed', true);
      return send(200, { ok: true });
    }
    send(404, { error: 'not found' });
  } catch (err) {
    send(500, { error: String(err).slice(0, 300) });
  }
});

// Tests import the exported helpers without starting the server or LCU sockets.
if (isEntryPoint(import.meta.url) && FIXTURE) {
  loadFixture(FIXTURE);
  server.listen(PORT, '127.0.0.1', () => console.log(`Arena Companion UI (sample data): http://localhost:${PORT}`));
} else if (isEntryPoint(import.meta.url)) {
  const crowdFavoritesWs = new LcuSubscriber({
    resolveLockfile: readLockfile,
    reconnectDelayMs: 5000,
    topics: LCU_EVENT_TOPICS,
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

  // Loopback only: the API can change manual wins and config, so it must not
  // be reachable from the LAN.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Arena Companion UI: http://localhost:${PORT}`);
    setInterval(pollTick, 3000);
    crowdFavoritesWs.start();
    void loadChampionIndex();
    // Wait for the first LCU poll so the player identity and region are known before scanning.
    pollTick()
      .then(() => refreshChecklist())
      .then((r) => {
        if (!r.ok) console.log(`initial scan skipped: ${r.error}`);
      });
  });
}
