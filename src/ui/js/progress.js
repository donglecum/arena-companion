// Arena God progress: the numbers every view agrees on, what is still left,
// and what a finished game changed. Pure (no DOM, no fetch), so it is
// unit-tested in tests/progress.test.mjs.
import { CLASSES } from './util.js';

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * The headline numbers. Riot's official count leads when it is ahead: it
 * includes wins older than match history, which cannot be tied to a champion
 * ("unrecoverable" until marked by hand).
 */
export function arenaProgress(status) {
  const cl = status?.checklist ?? null;
  const total = cl?.total ?? 0;
  const provable = cl?.wonCount ?? 0;
  const official = finite(status?.arenaGod);
  const count = Math.max(official ?? 0, provable);
  const manual = (status?.cards ?? []).filter((c) => c.manual && !c.wins).length;
  return {
    known: Boolean(cl),
    total,
    official,
    provable,
    count,
    remaining: Math.max(0, total - count),
    manual,
    fromHistory: provable - manual,
    unrecoverable: cl && official !== null ? Math.max(0, official - provable) : 0,
    complete: Boolean(cl) && total > 0 && count >= total,
  };
}

/** A champion's first class ("Fighter" for Fighter/Mage); every champion lands in exactly one group. */
export const primaryClass = (card) => card?.tags?.[0] ?? 'Other';

/** Why a champion is still needed: never played in Arena, or played without a 1st place. null once won. */
export function remainingKind(card) {
  if (!card || card.won) return null;
  return card.games > 0 ? 'attempted' : 'never';
}

/** Best (lowest) placement per champion id across the scanned matches. */
export function bestPlacements(matches) {
  const best = new Map();
  for (const m of matches ?? []) {
    if (!Number.isInteger(m.placement)) continue;
    const prev = best.get(m.championId);
    if (prev === undefined || m.placement < prev) best.set(m.championId, m.placement);
  }
  return best;
}

function tally(items) {
  return {
    left: items.length,
    never: items.filter((i) => i.kind === 'never').length,
    attempted: items.filter((i) => i.kind === 'attempted').length,
    owned: items.filter((i) => i.card.owned !== false).length,
    locked: items.filter((i) => i.card.owned === false).length,
  };
}

/**
 * The champions still needed, each with why (never played / attempted), its
 * primary class and best placement, plus totals overall and per class.
 */
export function remainingSummary(cards, matches = null) {
  const all = cards ?? [];
  const best = bestPlacements(matches);
  const items = all.filter((c) => !c.won).map((card) => ({
    card,
    kind: remainingKind(card),
    cls: primaryClass(card),
    best: best.get(card.id) ?? null,
  }));
  const extra = [...new Set(all.map(primaryClass))].filter((cls) => !CLASSES.includes(cls)).sort();
  const byClass = [...CLASSES, ...extra].map((cls) => {
    const inClass = all.filter((c) => primaryClass(c) === cls);
    const left = items.filter((i) => i.cls === cls);
    return { cls, total: inClass.length, won: inClass.length - left.length, ...tally(left) };
  }).filter((g) => g.total > 0);
  return { items, ...tally(items), byClass };
}

export const REMAINING_SORTS = [
  ['name', 'Name'],
  ['closest', 'Closest to a win'],
  ['mastery', 'Mastery'],
  ['played', 'Most played'],
];

/** kind: 'never' | 'attempted'; own: 'owned' | 'locked'; cls: a class; search: name or title. Empty means any. */
export function filterRemaining(items, { kind = '', own = '', cls = '', search = '' } = {}) {
  const q = String(search).trim().toLowerCase();
  return items.filter((i) =>
    (!kind || i.kind === kind) &&
    (!own || (own === 'locked' ? i.card.owned === false : i.card.owned !== false)) &&
    (!cls || i.cls === cls) &&
    (!q || i.card.name.toLowerCase().includes(q) || String(i.card.title ?? '').toLowerCase().includes(q)));
}

export function sortRemaining(items, key = 'name') {
  const byName = (a, b) => a.card.name.localeCompare(b.card.name);
  const order = {
    // Best placement first (a 2nd is one step away), then average, then experience.
    closest: (a, b) => (a.best ?? 9) - (b.best ?? 9) || (a.card.avgPlacement ?? 9) - (b.card.avgPlacement ?? 9) || b.card.games - a.card.games || byName(a, b),
    mastery: (a, b) => (b.card.masteryPoints || 0) - (a.card.masteryPoints || 0) || byName(a, b),
    played: (a, b) => b.card.games - a.card.games || byName(a, b),
  }[key] ?? byName;
  return [...items].sort(order);
}

/** Items in class order ([{ cls, items }]), skipping empty classes. */
export function groupByClass(items, classes) {
  return classes.map((cls) => ({ cls, items: items.filter((i) => i.cls === cls) })).filter((g) => g.items.length);
}

/**
 * Arena God before → after for a post-game event. Riot's number is used once
 * it has moved. Before that, recorded wins stand in for it only while Riot
 * counted nothing extra: when Riot is ahead, a "new" recorded win may be an
 * old one Riot already had, so no delta is claimed (before/after are null).
 */
export function postGameProgress(ev, status) {
  if (!ev) return null;
  const total = status?.checklist?.total ?? finite(ev.total) ?? 0;
  const gained = Array.isArray(ev.newChampions) ? ev.newChampions.length : ev.type === 'new-win' ? 1 : 0;
  const provableBefore = finite(ev.previousWonCount);
  const officialBefore = finite(ev.arenaGodBefore);
  const officialNow = finite(status?.arenaGod);
  if (officialBefore !== null && officialNow !== null && officialNow > officialBefore) {
    return { gained: officialNow - officialBefore, before: officialBefore, after: officialNow, remaining: Math.max(0, total - officialNow) };
  }
  if (provableBefore !== null && (officialBefore === null || officialBefore <= provableBefore)) {
    const after = provableBefore + gained;
    return { gained, before: provableBefore, after, remaining: Math.max(0, total - after) };
  }
  return { gained, before: null, after: null, remaining: arenaProgress(status).remaining };
}

/**
 * The quiet post-game card for a game that won nothing new: which game it
 * was, whether its champion was already done, and where that leaves you.
 */
export function postGameResult(ev, status, insights) {
  const game = ev?.game;
  if (!game) return null;
  const card = (status?.cards ?? []).find((c) => c.id === game.championId) ?? null;
  const verdict = game.firstWin ? 'first-win' : !card ? 'unknown' : card.won ? 'already-won' : 'still-needed';
  const session = insights?.session;
  return {
    championId: game.championId,
    name: card?.name ?? game.championName,
    placement: finite(game.placement),
    verdict,
    remaining: arenaProgress(status).remaining,
    session: session ? { games: session.games, newWins: session.newWins?.length ?? 0 } : null,
  };
}

/** The manual-mark button on a champion page: only a manual mark can be removed; a match-history win has nothing to toggle. */
export function manualAction(card) {
  if (!card) return null;
  if (card.manual) return 'remove';
  return card.won ? null : 'add';
}

/**
 * A champion's personal Arena record: totals from its checklist card, plus
 * best, last and recent placements from its games (newest first).
 */
export function championRecord(card, games = []) {
  const placed = games.filter((m) => Number.isInteger(m.placement));
  return {
    games: card?.games ?? games.length,
    wins: card?.wins ?? games.filter((m) => m.win).length,
    avg: finite(card?.avgPlacement),
    top4: card?.top4 ?? placed.filter((m) => m.placement <= 4).length,
    placed: placed.length,
    best: placed.length ? Math.min(...placed.map((m) => m.placement)) : null,
    last: games[0] ?? null,
    recent: placed.slice(0, 10).map((m) => m.placement),
  };
}
