const GAME_PHASES = new Set(['InProgress', 'WaitingForStats']);
const END_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'None', 'Lobby']);
/** Riot queue IDs for Arena: 1700 (classic) and 1750 (3x6 variant). */
export const ARENA_QUEUE_IDS = new Set([1700, 1750]);

/** True when a queue id or game mode identifies the Arena (CHERRY) mode. */
export function isArenaQueue(queueId?: number | string | null, gameMode?: string | null): boolean {
  if (queueId != null && ARENA_QUEUE_IDS.has(Number(queueId))) return true;
  return String(gameMode ?? '').trim().toUpperCase() === 'CHERRY';
}

/** True when a gameflow transition means an Arena match just finished. */
export function detectArenaGameEnd(prevPhase: string, newPhase: string, queueId: number, gameMode?: string | null): boolean {
  if (!isArenaQueue(queueId, gameMode)) return false;
  return GAME_PHASES.has(prevPhase) && END_PHASES.has(newPhase) && prevPhase !== newPhase;
}

export interface ChecklistSnapshot {
  wonCount: number;
  wonChampNames: string[];
}

export type PostGameEvent =
  | { type: 'new-win'; champion: string | null; wonCount: number; at: string }
  | { type: 'updated'; wonCount: number; at: string };

/** Compare pre/post rescan snapshots; celebrate only when a NEW champion was won. */
export function computePostGameEvent(
  before: ChecklistSnapshot,
  after: ChecklistSnapshot,
  lastPlayedChampion: string | null,
): PostGameEvent {
  const at = new Date().toISOString();
  const prevWon = new Set(before.wonChampNames);
  const newChamps = after.wonChampNames.filter((n) => !prevWon.has(n));
  if (after.wonCount > before.wonCount && newChamps.length > 0) {
    const champion =
      lastPlayedChampion && newChamps.includes(lastPlayedChampion) ? lastPlayedChampion : newChamps[0];
    return { type: 'new-win', champion, wonCount: after.wonCount, at };
  }
  return { type: 'updated', wonCount: after.wonCount, at };
}

/** True when the last sync is missing or older than `hours` (default 24). */
export function isStale(lastSyncIso: string | null, nowMs: number, hours = 24): boolean {
  if (!lastSyncIso) return true;
  return nowMs - new Date(lastSyncIso).getTime() > hours * 3600_000;
}
