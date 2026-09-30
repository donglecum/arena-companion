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

/**
 * Won champions for the post-game diff. Given the pre-game snapshot, only a
 * match-history win makes a champion new: a manual mark made while waiting for
 * the match record is not a first win (and one removed meanwhile is ignored).
 */
export function wonSnapshot(
  cards: ReadonlyArray<{ name: string; won: boolean; wins: number }>,
  before?: ChecklistSnapshot,
): ChecklistSnapshot {
  const had = new Set(before?.wonChampNames ?? []);
  return {
    wonCount: cards.filter((c) => c.won).length,
    wonChampNames: cards.filter((c) => c.won && (!before || c.wins > 0 || had.has(c.name))).map((c) => c.name),
  };
}

/** The game that just ended, as match history records it. */
export interface FinishedGame {
  championId: string;
  championName: string;
  placement: number | null;
  gameEnd: number;
  firstWin: boolean;
}

/** What else the post-game card needs besides the before/after checklists. */
export interface PostGameContext {
  /** Riot's official Arena God count before the game; null when the client did not report it. */
  arenaGodBefore?: number | null;
  /** Champions in the checklist. */
  total?: number | null;
  /** The game that just ended, once match history has it. */
  game?: FinishedGame | null;
  /** True while follow-up scans still wait for the game to reach match history. */
  pending?: boolean;
}

interface PostGameDetails {
  /** Provable wins after the game (recorded + manual). */
  wonCount: number;
  at: string;
  /** Provable wins before the game. */
  previousWonCount: number;
  /** Every champion won for the first time, the finished game's champion first. */
  newChampions: string[];
  arenaGodBefore: number | null;
  total: number | null;
  game: FinishedGame | null;
  pending: boolean;
}

export type PostGameEvent = ({ type: 'new-win'; champion: string | null } | { type: 'updated' }) & PostGameDetails;

/** Compare pre/post rescan snapshots; celebrate only when a NEW champion was won. */
export function computePostGameEvent(
  before: ChecklistSnapshot,
  after: ChecklistSnapshot,
  lastPlayedChampion: string | null,
  context: PostGameContext = {},
  now = Date.now(),
): PostGameEvent {
  const prevWon = new Set(before.wonChampNames);
  const newChamps = after.wonChampNames.filter((n) => !prevWon.has(n));
  const game = context.game ?? null;
  // The game's own champion is the one to celebrate when it is among the new wins.
  const lead = [game?.firstWin ? game.championName : null, lastPlayedChampion].find((n) => n && newChamps.includes(n)) ?? null;
  const details: PostGameDetails = {
    wonCount: after.wonCount,
    at: new Date(now).toISOString(),
    previousWonCount: before.wonCount,
    newChampions: lead ? [lead, ...newChamps.filter((n) => n !== lead)] : newChamps,
    arenaGodBefore: context.arenaGodBefore ?? null,
    total: context.total ?? null,
    game,
    pending: context.pending === true,
  };
  if (after.wonCount > before.wonCount && newChamps.length > 0) {
    return { type: 'new-win', champion: lead ?? newChamps[0], ...details };
  }
  return { type: 'updated', ...details };
}

/**
 * Riot publishes a match only after its last team falls — minutes after an
 * eliminated player leaves — so a post-game scan that misses the game looks
 * again after each of these delays (about 15 minutes in all).
 */
export const POST_GAME_RETRY_MS: readonly number[] = [30_000, 60_000, 120_000, 240_000, 480_000];

export interface PostGameStep {
  /**
   * final: publish the event (the game or a new champion was found, or there is nothing to wait for);
   * waiting: publish it marked pending, so the UI waits for the match record;
   * stop-waiting: the retries ran out, so the pending event stops waiting;
   * none: keep the pending event as it is.
   */
  publish: 'final' | 'waiting' | 'stop-waiting' | 'none';
  /** Delay before the next scan, or null when done. */
  retryIn: number | null;
}

/** What to do after post-game scan number `attempt` (0 is the first). */
export function postGameStep(attempt: number, found: boolean, retryDelays: readonly number[] = POST_GAME_RETRY_MS): PostGameStep {
  if (found) return { publish: 'final', retryIn: null };
  const retryIn = retryDelays[attempt] ?? null;
  if (retryIn === null) return { publish: attempt === 0 ? 'final' : 'stop-waiting', retryIn: null };
  return { publish: attempt === 0 ? 'waiting' : 'none', retryIn };
}

/** Allowance for the local clock against Riot's game-end timestamps. */
export const FINISHED_GAME_SLACK_MS = 5 * 60_000;

/**
 * The game that just ended, if match history has it yet: the newest match,
 * provided it ended no earlier than we left the game (less clock slack). An
 * eliminated player leaves before the last team falls, so the match can end
 * minutes after they left, and it only reaches match history after that.
 */
export function findFinishedGame(
  newestFirst: ReadonlyArray<FinishedGame>,
  leftAt: number,
  slackMs = FINISHED_GAME_SLACK_MS,
): FinishedGame | null {
  const newest = newestFirst[0];
  if (!newest || !(newest.gameEnd >= leftAt - slackMs)) return null;
  const { championId, championName, placement, gameEnd, firstWin } = newest;
  return { championId, championName, placement, gameEnd, firstWin };
}

/** True when the last sync is missing or older than `hours` (default 24). */
export function isStale(lastSyncIso: string | null, nowMs: number, hours = 24): boolean {
  if (!lastSyncIso) return true;
  return nowMs - new Date(lastSyncIso).getTime() > hours * 3600_000;
}
