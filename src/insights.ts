// Derived stats for the dashboard: streaks, pace toward Arena God, the latest
// play session and "play next" picks. Pure functions over the match list and
// checklist cards, so they are unit-tested without a client or tracker.
import type { MatchRow } from './scan.ts';

const DAY_MS = 24 * 3600_000;
/** A gap longer than this between games starts a new play session. */
export const SESSION_GAP_MS = 90 * 60_000;
/** Only a session that ended this recently is shown as "your last session". */
export const SESSION_RECENT_MS = 12 * 3600_000;

export interface InsightCard {
  id: string;
  key: string | number;
  name: string;
  won?: boolean;
  owned?: boolean;
  tags?: string[];
  masteryPoints?: number;
  masteryLevel?: number;
}

export interface Pace {
  /** Champions still needed for Arena God (by provable wins). */
  remaining: number;
  /** Games and new first wins in the window the pace is measured over. */
  windowGames: number;
  windowNewWins: number;
  windowDays: number | null;
  gamesPerNewWin: number | null;
  projectedGames: number | null;
}

export interface Session {
  games: number;
  wins: number;
  top4: number;
  avgPlacement: number | null;
  newWins: string[];
  startedAt: number;
  endedAt: number;
}

export interface Recommendation {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface Insights {
  games: number;
  wins: number;
  winRate: number | null;
  top4Rate: number | null;
  avgPlacement: number | null;
  currentWinStreak: number;
  bestWinStreak: number;
  currentTop4Streak: number;
  newWinsThisWeek: number;
  newWins30d: number;
  /** Placements of the last 30 placed games, oldest first. */
  trend: number[];
  pace: Pace;
  session: Session | null;
  recommendations: Recommendation[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (tag: string) => (tag === 'Marksman' ? 'Marksmen' : `${tag}s`);

function summarize(games: MatchRow[]) {
  const placed = games.filter((m) => m.placement !== null) as (MatchRow & { placement: number })[];
  const wins = placed.filter((m) => m.placement === 1).length;
  const top4 = placed.filter((m) => m.placement <= 4).length;
  return {
    placed,
    wins,
    top4,
    avgPlacement: placed.length ? round1(placed.reduce((sum, m) => sum + m.placement, 0) / placed.length) : null,
  };
}

/** Streak of games from the newest backwards that satisfy `hit`, and the best run anywhere. */
function streaks(newestFirst: MatchRow[], hit: (m: MatchRow) => boolean) {
  let current = 0;
  while (current < newestFirst.length && hit(newestFirst[current])) current += 1;
  let best = 0;
  let run = 0;
  for (const m of newestFirst) {
    run = hit(m) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}

/**
 * Pace toward Arena God: games per new first win over the last 30 days (or the
 * last 50 games when fewer than 10 were played in that time).
 */
export function computePace(newestFirst: MatchRow[], total: number, wonCount: number, now: number): Pace {
  const remaining = Math.max(0, total - wonCount);
  let windowGames = newestFirst.filter((m) => m.gameEnd >= now - 30 * DAY_MS);
  let windowDays: number | null = 30;
  if (windowGames.length < 10) {
    windowGames = newestFirst.slice(0, 50);
    windowDays = null;
  }
  const windowNewWins = windowGames.filter((m) => m.firstWin).length;
  const gamesPerNewWin = windowNewWins ? round1(windowGames.length / windowNewWins) : null;
  return {
    remaining,
    windowGames: windowGames.length,
    windowNewWins,
    windowDays,
    gamesPerNewWin,
    projectedGames: remaining === 0 ? 0 : windowNewWins ? Math.ceil((remaining * windowGames.length) / windowNewWins) : null,
  };
}

/** The latest run of games with no gap over 90 minutes, if it ended in the last 12 hours. */
export function latestSession(newestFirst: MatchRow[], now: number): Session | null {
  const newest = newestFirst[0];
  if (!newest || !newest.gameEnd || now - newest.gameEnd > SESSION_RECENT_MS) return null;
  const games = [newest];
  for (let i = 1; i < newestFirst.length; i += 1) {
    if (games[games.length - 1].gameEnd - newestFirst[i].gameEnd > SESSION_GAP_MS) break;
    games.push(newestFirst[i]);
  }
  const { wins, top4, avgPlacement } = summarize(games);
  return {
    games: games.length,
    wins,
    top4,
    avgPlacement,
    newWins: games.filter((m) => m.firstWin).map((m) => m.championName).reverse(),
    startedAt: games[games.length - 1].gameEnd,
    endedAt: newest.gameEnd,
  };
}

/**
 * Needed champions you own, ranked by mastery (comfort) and by how you place
 * on their classes. Each pick carries a one-line reason.
 */
export function recommend(cards: InsightCard[], newestFirst: MatchRow[], limit = 8): Recommendation[] {
  const tagsById = new Map(cards.map((c) => [c.id, c.tags ?? []]));
  const byClass = new Map<string, { sum: number; games: number }>();
  for (const m of newestFirst) {
    if (m.placement === null) continue;
    for (const tag of tagsById.get(m.championId) ?? []) {
      const slot = byClass.get(tag) ?? { sum: 0, games: 0 };
      slot.sum += m.placement;
      slot.games += 1;
      byClass.set(tag, slot);
    }
  }
  const classAvg = (tag: string) => {
    const slot = byClass.get(tag);
    return slot && slot.games >= 3 ? slot.sum / slot.games : null;
  };
  const maxMastery = Math.max(1, ...cards.map((c) => c.masteryPoints ?? 0));
  return cards
    .filter((c) => !c.won && c.owned !== false)
    .map((c) => {
      const mastery = Math.log10(1 + (c.masteryPoints ?? 0)) / Math.log10(1 + maxMastery);
      const classes = (c.tags ?? []).map((tag) => ({ tag, avg: classAvg(tag) })).filter((x) => x.avg !== null) as { tag: string; avg: number }[];
      const bestClass = classes.sort((a, b) => a.avg - b.avg)[0];
      // Placement 1 → 1, placement 8 → 0; unknown classes sit in the middle.
      const classScore = bestClass ? (8 - bestClass.avg) / 7 : 0.5;
      const score = round1((mastery * 0.6 + classScore * 0.4) * 100);
      const reasons: string[] = [];
      if (c.masteryLevel) reasons.push(`Mastery ${c.masteryLevel} · ${Math.round((c.masteryPoints ?? 0) / 1000)}k pts`);
      if (bestClass) reasons.push(`you average ${round1(bestClass.avg)} on ${plural(bestClass.tag)}`);
      return { id: c.id, name: c.name, score, reason: reasons.join(' · ') || 'Not yet won' };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function computeInsights(
  newestFirst: MatchRow[],
  cards: InsightCard[],
  { total, wonCount, now }: { total: number; wonCount: number; now: number },
): Insights {
  const { placed, wins, top4, avgPlacement } = summarize(newestFirst);
  const win = streaks(newestFirst, (m) => m.placement === 1);
  const top4Streak = streaks(newestFirst, (m) => m.placement !== null && m.placement <= 4);
  return {
    games: newestFirst.length,
    wins,
    winRate: placed.length ? round1((wins / placed.length) * 100) : null,
    top4Rate: placed.length ? round1((top4 / placed.length) * 100) : null,
    avgPlacement,
    currentWinStreak: win.current,
    bestWinStreak: win.best,
    currentTop4Streak: top4Streak.current,
    newWinsThisWeek: newestFirst.filter((m) => m.firstWin && m.gameEnd >= now - 7 * DAY_MS).length,
    newWins30d: newestFirst.filter((m) => m.firstWin && m.gameEnd >= now - 30 * DAY_MS).length,
    trend: placed.slice(0, 30).map((m) => m.placement).reverse(),
    pace: computePace(newestFirst, total, wonCount, now),
    session: latestSession(newestFirst, now),
    recommendations: recommend(cards, newestFirst),
  };
}
