import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arenaProgress, remainingKind, remainingSummary, filterRemaining, sortRemaining, groupByClass,
  postGameProgress, postGameResult, manualAction, championRecord, primaryClass,
} from '../src/ui/js/progress.js';
import { statusOf } from '../src/ui/js/util.js';

const card = (id, over = {}) => ({ id, key: id, name: id, tags: ['Fighter'], games: 0, wins: 0, won: false, manual: false, owned: true, masteryPoints: 0, avgPlacement: null, top4: 0, ...over });

const CARDS = [
  card('Garen', { tags: ['Fighter', 'Tank'], games: 6, wins: 2, won: true, avgPlacement: 2.5 }),
  card('Darius', { tags: ['Fighter', 'Tank'], games: 4, avgPlacement: 4.2, masteryPoints: 90_000 }),
  card('Riven', { tags: ['Fighter', 'Assassin'], owned: false }),
  card('Lux', { tags: ['Mage', 'Support'], won: true, manual: true }),
  card('Annie', { tags: ['Mage'], games: 1, avgPlacement: 7, masteryPoints: 5_000 }),
  card('Braum', { tags: ['Support', 'Tank'], masteryPoints: 200_000 }),
  card('Mystery', { tags: [] }),
];
const MATCHES = [
  { championId: 'Darius', placement: 2 }, { championId: 'Darius', placement: 6 },
  { championId: 'Annie', placement: 7 }, { championId: 'Garen', placement: 1 }, { championId: 'Annie', placement: null },
];

test('arenaProgress leads with Riot’s count and keeps the provable breakdown', () => {
  const status = { arenaGod: 9, checklist: { total: 20, wonCount: 6 }, cards: [card('A', { won: true, manual: true }), card('B', { won: true, manual: true, wins: 1 })] };
  const p = arenaProgress(status);
  assert.equal(p.count, 9);
  assert.equal(p.remaining, 11);
  assert.equal(p.unrecoverable, 3);
  assert.equal(p.manual, 1); // a manual mark on a champion also won in history is not "manual"
  assert.equal(p.fromHistory, 5);
  assert.equal(p.complete, false);
  // Recorded wins lead when Riot lags (or does not report).
  assert.equal(arenaProgress({ arenaGod: 4, checklist: { total: 20, wonCount: 6 } }).count, 6);
  assert.equal(arenaProgress({ arenaGod: null, checklist: { total: 20, wonCount: 6 } }).unrecoverable, 0);
  assert.equal(arenaProgress({ arenaGod: 20, checklist: { total: 20, wonCount: 18 } }).complete, true);
  assert.equal(arenaProgress(null).known, false);
});

test('remaining champions are classified as never played or played without a win', () => {
  assert.equal(remainingKind(card('X')), 'never');
  assert.equal(remainingKind(card('X', { games: 3 })), 'attempted');
  assert.equal(remainingKind(card('X', { games: 3, won: true })), null);
  assert.equal(remainingKind(card('X', { won: true, manual: true })), null); // a manual mark completes it
  assert.equal(remainingKind(null), null);
});

test('remainingSummary counts what is left, why, ownership and best placements', () => {
  const s = remainingSummary(CARDS, MATCHES);
  assert.deepEqual(s.items.map((i) => i.card.id), ['Darius', 'Riven', 'Annie', 'Braum', 'Mystery']);
  assert.equal(s.left, 5);
  assert.equal(s.never, 3);
  assert.equal(s.attempted, 2);
  assert.equal(s.owned, 4);
  assert.equal(s.locked, 1);
  assert.equal(s.items.find((i) => i.card.id === 'Darius').best, 2);
  assert.equal(s.items.find((i) => i.card.id === 'Annie').best, 7);
  assert.equal(s.items.find((i) => i.card.id === 'Braum').best, null);
});

test('class totals group every champion once, by its primary class', () => {
  const { byClass, left } = remainingSummary(CARDS, MATCHES);
  const fighter = byClass.find((g) => g.cls === 'Fighter');
  assert.deepEqual({ ...fighter }, { cls: 'Fighter', total: 3, won: 1, left: 2, never: 1, attempted: 1, owned: 1, locked: 1 });
  assert.deepEqual(byClass.map((g) => [g.cls, g.left]), [['Fighter', 2], ['Mage', 1], ['Support', 1], ['Other', 1]]);
  // Primary classes partition the champions, so class counts add up to the total left.
  assert.equal(byClass.reduce((n, g) => n + g.left, 0), left);
  assert.equal(primaryClass(card('X', { tags: undefined })), 'Other');
});

test('Arena God completion leaves nothing to classify', () => {
  const done = CARDS.map((c) => ({ ...c, won: true }));
  const s = remainingSummary(done, MATCHES);
  assert.equal(s.left, 0);
  assert.deepEqual(s.items, []);
  assert.ok(s.byClass.every((g) => g.left === 0 && g.won === g.total));
});

test('remaining filters combine and sorting keeps a stable name order', () => {
  const { items } = remainingSummary(CARDS, MATCHES);
  const names = (list) => list.map((i) => i.card.id);
  assert.deepEqual(names(filterRemaining(items, { kind: 'never' })), ['Riven', 'Braum', 'Mystery']);
  assert.deepEqual(names(filterRemaining(items, { kind: 'never', own: 'owned' })), ['Braum', 'Mystery']);
  assert.deepEqual(names(filterRemaining(items, { own: 'locked' })), ['Riven']);
  assert.deepEqual(names(filterRemaining(items, { cls: 'Fighter', search: 'dar' })), ['Darius']);
  assert.deepEqual(names(sortRemaining(items, 'name')), ['Annie', 'Braum', 'Darius', 'Mystery', 'Riven']);
  assert.deepEqual(names(sortRemaining(items, 'closest')), ['Darius', 'Annie', 'Braum', 'Mystery', 'Riven']);
  assert.deepEqual(names(sortRemaining(items, 'mastery')), ['Braum', 'Darius', 'Annie', 'Mystery', 'Riven']);
  assert.deepEqual(names(sortRemaining(items, 'played')).slice(0, 2), ['Darius', 'Annie']);
  assert.deepEqual(groupByClass(items, ['Mage', 'Fighter', 'Tank']).map((g) => [g.cls, g.items.length]), [['Mage', 1], ['Fighter', 2]]);
});

test('post-game progress uses Riot’s count once it moves', () => {
  const ev = { type: 'new-win', previousWonCount: 82, newChampions: ['Gragas'], arenaGodBefore: 89, total: 171 };
  assert.deepEqual(postGameProgress(ev, { arenaGod: 90, checklist: { total: 171, wonCount: 83 } }),
    { gained: 1, before: 89, after: 90, remaining: 81 });
});

test('post-game progress trusts recorded wins only while Riot counted nothing extra', () => {
  const ev = { type: 'new-win', previousWonCount: 143, newChampions: ['Gragas'], arenaGodBefore: 143, total: 171 };
  const status = { arenaGod: 143, checklist: { total: 171, wonCount: 144 } };
  assert.deepEqual(postGameProgress(ev, status), { gained: 1, before: 143, after: 144, remaining: 27 });
  // No official count at all: recorded wins are the count.
  assert.deepEqual(postGameProgress({ ...ev, arenaGodBefore: null }, { ...status, arenaGod: null }).after, 144);
  // Two champions found at once (a game missed by an earlier scan).
  assert.equal(postGameProgress({ ...ev, newChampions: ['Gragas', 'Lux'] }, status).after, 145);
  // Riot is ahead (older wins): the new recorded win may be one Riot already had.
  const ahead = postGameProgress({ ...ev, arenaGodBefore: 150 }, { arenaGod: 150, checklist: { total: 171, wonCount: 144 } });
  assert.equal(ahead.before, null);
  assert.equal(ahead.after, null);
  assert.equal(ahead.remaining, 21);
  // An event from before these fields existed claims nothing.
  assert.equal(postGameProgress({ type: 'new-win', wonCount: 144 }, status).after, null);
  assert.equal(postGameProgress(null, status), null);
});

test('the ordinary post-game card says whether the champion was already done', () => {
  const status = { arenaGod: null, checklist: { total: 7, wonCount: 2 }, cards: CARDS };
  const insights = { session: { games: 6, newWins: ['Garen', 'Lux'] } };
  const game = (championId, placement, firstWin = false) => ({ type: 'updated', game: { championId, championName: championId, placement, gameEnd: 1, firstWin } });
  assert.deepEqual(postGameResult(game('Garen', 4), status, insights),
    { championId: 'Garen', name: 'Garen', placement: 4, verdict: 'already-won', remaining: 5, session: { games: 6, newWins: 2 } });
  assert.equal(postGameResult(game('Darius', 2), status, null).verdict, 'still-needed');
  assert.equal(postGameResult(game('Darius', 2), status, null).session, null);
  assert.equal(postGameResult(game('Zed', 5), status, null).verdict, 'unknown');
  assert.equal(postGameResult(game('Garen', 1, true), status, null).verdict, 'first-win');
  assert.equal(postGameResult({ type: 'updated', game: null }, status, null), null);
});

test('manual marks: add on needed champions, remove only a manual mark, nothing on history wins', () => {
  assert.equal(manualAction(card('X')), 'add');
  assert.equal(manualAction(card('X', { won: true, manual: true })), 'remove');
  assert.equal(manualAction(card('X', { won: true, manual: true, wins: 2 })), 'remove');
  assert.equal(manualAction(card('X', { won: true, wins: 2 })), null);
  assert.equal(statusOf(card('X', { won: true, manual: true })), 'manual');
  assert.equal(statusOf(card('X', { won: true, manual: true, wins: 1 })), 'won');
  assert.equal(statusOf(card('X')), 'needed');
});

test('championRecord builds the personal snapshot from the card and its games', () => {
  const games = [
    { placement: 2, win: false, gameEnd: 50 }, { placement: 1, win: true, gameEnd: 40 },
    { placement: null, win: false, gameEnd: 30 }, { placement: 6, win: false, gameEnd: 20 },
  ];
  const rec = championRecord(card('X', { games: 4, wins: 1, avgPlacement: 3, top4: 2, won: true }), games);
  assert.equal(rec.best, 1);
  assert.equal(rec.placed, 3);
  assert.equal(rec.top4, 2);
  assert.deepEqual(rec.recent, [2, 1, 6]);
  assert.equal(rec.last.gameEnd, 50);
  const empty = championRecord(card('Y'), []);
  assert.equal(empty.best, null);
  assert.equal(empty.last, null);
  assert.deepEqual(empty.recent, []);
});
