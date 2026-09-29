// Ported from arena-tracker src/lib/scan.js — localStorage replaced with a
// JSON file cache; api calls come from an injected TrackerApi instance.
import fs from 'node:fs';
import path from 'node:path';
import type { TrackerApi } from './trackerApi.ts';

const storeKey = (platform: string, gameName: string, tagLine: string) =>
  `arena:v3:${platform}:${(gameName || '').toLowerCase()}#${(tagLine || '').toLowerCase()}`;

function storePath(cacheDir: string, platform: string, gameName: string, tagLine: string) {
  return path.join(cacheDir, encodeURIComponent(storeKey(platform, gameName, tagLine)) + '.json');
}

export function loadStore(cacheDir: string, platform: string, gameName: string, tagLine: string) {
  try {
    return JSON.parse(fs.readFileSync(storePath(cacheDir, platform, gameName, tagLine), 'utf8'));
  } catch {
    return null;
  }
}

export function saveStore(cacheDir: string, platform: string, gameName: string, tagLine: string, store: unknown) {
  fs.mkdirSync(cacheDir, { recursive: true });
  writeFileAtomic(storePath(cacheDir, platform, gameName, tagLine), JSON.stringify(store));
}

/** Write via a temp file and rename, so a crash mid-write never leaves a truncated file behind. */
export function writeFileAtomic(file: string, data: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

async function fetchMatches(api: TrackerApi, cluster: string, identity: any, ids: string[], onEach?: (n: number) => void) {
  const BATCH_SIZE = 25;
  const POOL = 2;
  const arena: Record<string, any> = {};
  const seen: string[] = [];
  const failed: string[] = [];
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE) batches.push(ids.slice(start, start + BATCH_SIZE));
  let i = 0;
  async function worker() {
    while (i < batches.length) {
      const batch = batches[i++];
      try {
        const result = await api.getMatchSummaries(cluster, batch, identity);
        Object.assign(arena, result.records || {});
        seen.push(...(result.seen || []));
      } catch {
        // Recorded as pending: an incremental update stops at the first known id, so a
        // failed batch behind a successful newer one would otherwise never be retried.
        failed.push(...batch);
      }
      onEach?.(batch.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, batches.length) }, worker));
  return { arena, seen, failed };
}

export async function collectMatchIds(
  cluster: string,
  puuid: string,
  depth: number,
  fetchIds: (cluster: string, puuid: string, start: number, count: number) => Promise<string[]>,
): Promise<{ ids: string[]; exhausted: boolean }> {
  const ids: string[] = [];
  let start = 0;
  let exhausted = false;
  while (ids.length < depth) {
    const want = Math.min(100, depth - ids.length);
    const page = await fetchIds(cluster, puuid, start, want);
    if (!page.length) {
      exhausted = true;
      break;
    }
    ids.push(...page);
    if (page.length < want) {
      exhausted = true;
      break;
    }
    start += page.length;
  }
  return { ids, exhausted };
}

export async function fullScan(
  api: TrackerApi,
  { region, gameName, tagLine, depth, resolvedAccount = null }: any,
  onProgress?: (p: { phase: string; done: number; total: number }) => void,
) {
  onProgress?.({ phase: 'account', done: 0, total: 0 });
  const account = resolvedAccount || (await api.resolveAccount(region.cluster, gameName, tagLine));

  onProgress?.({ phase: 'list', done: 0, total: 0 });
  const { ids, exhausted } = await collectMatchIds(region.cluster, account.puuid, depth, api.getMatchIds);

  const identity = {
    puuid: account.puuid,
    gameName: account.gameName ?? gameName,
    tagLine: account.tagLine ?? tagLine,
  };

  let done = 0;
  const { arena, seen, failed } = await fetchMatches(api, region.cluster, identity, ids, (count) => {
    done += count;
    onProgress?.({ phase: 'matches', done, total: ids.length });
  });

  return {
    account: { ...identity, platform: region.platform, region: region.label },
    matches: arena,
    seen: seen.reduce((m: Record<string, number>, id: string) => ((m[id] = 1), m), {}),
    pending: failed,
    scanDepth: Number.isFinite(depth) ? depth : null,
    historyExhausted: exhausted,
    lastUpdated: Date.now(),
  };
}

export async function collectFreshMatchIds(
  cluster: string,
  puuid: string,
  seen: Record<string, number>,
  matches: Record<string, unknown>,
  fetchIds: (cluster: string, puuid: string, start: number, count: number) => Promise<string[]>,
): Promise<string[]> {
  const fresh: string[] = [];
  let start = 0;
  while (true) {
    const page = await fetchIds(cluster, puuid, start, 100);
    if (!page.length) break;
    const knownAt = page.findIndex((id) => id in seen || id in matches);
    if (knownAt >= 0) {
      fresh.push(...page.slice(0, knownAt));
      break;
    }
    fresh.push(...page);
    if (page.length < 100) break;
    start += page.length;
  }
  return fresh;
}

export async function update(api: TrackerApi, region: any, store: any, onProgress?: (p: any) => void) {
  const { puuid } = store.account;
  const seen = store.seen || {};
  const newest = await collectFreshMatchIds(region.cluster, puuid, seen, store.matches, api.getMatchIds);
  // Retry batches that failed on an earlier scan alongside the new matches.
  const retry = (Array.isArray(store.pending) ? store.pending : []).filter(
    (id: unknown) => typeof id === 'string' && !(id in seen) && !(id in store.matches),
  );
  const fresh = [...new Set([...newest, ...retry])];

  let done = 0;
  const { arena, seen: newlySeen, failed } = await fetchMatches(api, region.cluster, store.account, fresh, (count) => {
    done += count;
    onProgress?.({ phase: 'matches', done, total: fresh.length });
  });

  return {
    ...store,
    matches: { ...store.matches, ...arena },
    seen: { ...seen, ...newlySeen.reduce((m: Record<string, number>, id: string) => ((m[id] = 1), m), {}) },
    pending: failed,
    lastUpdated: Date.now(),
  };
}

export function aggregate(store: any, champions: any[], masteries: Record<string, any>, manualWins: Set<string>) {
  const played: Record<string, { games: number; wins: number; last: number; placed: number; placementSum: number; top4: number; firstWinAt: number }> = {};
  const placementCounts = new Array(8).fill(0);
  for (const rec of Object.values<any>(store.matches)) {
    const k = (rec.championName || '').toLowerCase();
    const slot = (played[k] ||= { games: 0, wins: 0, last: 0, placed: 0, placementSum: 0, top4: 0, firstWinAt: 0 });
    slot.games += 1;
    if (rec.win) {
      slot.wins += 1;
      if (rec.gameEnd && (!slot.firstWinAt || rec.gameEnd < slot.firstWinAt)) slot.firstWinAt = rec.gameEnd;
    }
    if (rec.gameEnd && rec.gameEnd > slot.last) slot.last = rec.gameEnd;
    if (Number.isInteger(rec.placement) && rec.placement >= 1 && rec.placement <= 8) {
      placementCounts[rec.placement - 1] += 1;
      slot.placed += 1;
      slot.placementSum += rec.placement;
      if (rec.placement <= 4) slot.top4 += 1;
    }
  }

  const cards = champions.map((c) => {
    const p = played[c.id.toLowerCase()] || { games: 0, wins: 0, last: 0, placed: 0, placementSum: 0, top4: 0, firstWinAt: 0 };
    const manual = manualWins.has(c.id);
    const mastery = masteries[c.key];
    return {
      ...c,
      games: p.games,
      wins: p.wins,
      last: p.last,
      avgPlacement: p.placed ? Math.round((p.placementSum / p.placed) * 10) / 10 : null,
      top4: p.top4,
      firstWinAt: p.firstWinAt,
      manual,
      won: p.wins > 0 || manual,
      masteryLevel: mastery?.level ?? 0,
      masteryPoints: mastery?.points ?? 0,
    };
  });

  const wonCount = cards.filter((c) => c.won).length;

  const recent = Object.values<any>(store.matches)
    .filter((m) => m.gameEnd)
    .sort((a, b) => b.gameEnd - a.gameEnd)
    .slice(0, 50)
    .map((m) => ({
      championName: m.championName,
      placement: m.placement,
      gameEnd: m.gameEnd,
    }));

  const gamesScanned = Object.keys(store.matches).length;
  const placements = placementCounts.map((count, i) => ({
    placement: i + 1,
    count,
    percent: gamesScanned === 0 ? 0 : Math.round((count / gamesScanned) * 1000) / 10,
  }));

  return {
    cards,
    recent,
    wonCount,
    total: champions.length,
    gamesScanned,
    placements,
  };
}

export interface MatchRow {
  id: string;
  /** ddragon champion id ("MonkeyKing"), or the raw match-v5 name when unknown. */
  championId: string;
  championName: string;
  placement: number | null;
  win: boolean;
  gameEnd: number;
  /** True for the game that first won this champion. */
  firstWin: boolean;
}

/** Every stored Arena match, newest first, matched to ddragon champions. */
export function matchList(store: any, champions: ReadonlyArray<{ id: string; name: string }>): MatchRow[] {
  const byId = new Map(champions.map((c) => [c.id.toLowerCase(), c]));
  const rows: MatchRow[] = Object.entries<any>(store?.matches ?? {}).map(([id, rec]) => {
    const champion = byId.get(String(rec?.championName ?? '').toLowerCase());
    return {
      id,
      championId: champion?.id ?? String(rec?.championName ?? ''),
      championName: champion?.name ?? String(rec?.championName ?? ''),
      placement: Number.isInteger(rec?.placement) && rec.placement >= 1 && rec.placement <= 8 ? rec.placement : null,
      win: Boolean(rec?.win),
      gameEnd: Number(rec?.gameEnd) || 0,
      firstWin: false,
    };
  });
  rows.sort((a, b) => a.gameEnd - b.gameEnd || a.id.localeCompare(b.id));
  const won = new Set<string>();
  for (const row of rows) {
    if (row.win && !won.has(row.championId)) {
      won.add(row.championId);
      row.firstWin = true;
    }
  }
  return rows.reverse();
}
