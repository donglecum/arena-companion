import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInsights, computePace, latestSession, recommend, SESSION_GAP_MS } from '../src/insights.ts';
import { matchList, aggregate, type MatchRow } from '../src/scan.ts';
import { buildFixture, fixtureArt } from '../src/fixture.ts';

const DAY = 24 * 3600_000;
const now = 100 * DAY;
let n = 0;
function row(championId: string, placement: number | null, gameEnd: number, firstWin = false): MatchRow {
  return { id: `m${n++}`, championId, championName: championId, placement, win: placement === 1, gameEnd, firstWin };
}

test('matchList sorts newest first and flags only the first win per champion', () => {
  const store = { matches: {
    a: { championName: 'Annie', win: true, placement: 1, gameEnd: 100 },
    b: { championName: 'annie', win: true, placement: 1, gameEnd: 300 },
    c: { championName: 'MonkeyKing', win: false, placement: 9, gameEnd: 200 },
  } };
  const rows = matchList(store, [{ id: 'Annie', name: 'Annie' }, { id: 'MonkeyKing', name: 'Wukong' }]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(rows.map((r) => r.firstWin), [false, false, true]);
  assert.equal(rows[1].championName, 'Wukong');
  assert.equal(rows[1].placement, null); // out-of-range placements are dropped
});

test('aggregate adds average placement, top 4 count and first-win date per champion', () => {
  const store = { matches: {
    a: { championName: 'Annie', win: false, placement: 5, gameEnd: 100 },
    b: { championName: 'Annie', win: true, placement: 1, gameEnd: 300 },
    c: { championName: 'Annie', win: true, placement: 1, gameEnd: 200 },
  } };
  const [annie] = aggregate(store, [{ id: 'Annie', key: '1', name: 'Annie' }], {}, new Set()).cards;
  assert.equal(annie.avgPlacement, 2.3);
  assert.equal(annie.top4, 2);
  assert.equal(annie.firstWinAt, 200);
});

test('streaks count from the newest game, and the best run anywhere', () => {
  const games = [row('A', 1, 9), row('B', 1, 8), row('C', 3, 7), row('D', 1, 6), row('E', 1, 5), row('F', 1, 4)];
  const insights = computeInsights(games, [], { total: 10, wonCount: 2, now });
  assert.equal(insights.currentWinStreak, 2);
  assert.equal(insights.bestWinStreak, 3);
  assert.equal(insights.currentTop4Streak, 6);
  assert.equal(insights.winRate, 83.3);
  assert.equal(insights.avgPlacement, 1.3);
  assert.deepEqual(insights.trend, [1, 1, 1, 3, 1, 1]);
});

test('pace projects games left from recent new first wins', () => {
  const recent = Array.from({ length: 20 }, (_, i) => row(`C${i}`, i % 5 === 0 ? 1 : 4, now - i * DAY, i % 5 === 0));
  const pace = computePace(recent, 100, 90, now);
  assert.equal(pace.windowGames, 20);
  assert.equal(pace.windowNewWins, 4);
  assert.equal(pace.gamesPerNewWin, 5);
  assert.equal(pace.projectedGames, 50);
  assert.equal(computePace(recent, 90, 90, now).projectedGames, 0);
  assert.equal(computePace([row('X', 4, now)], 90, 10, now).projectedGames, null);
});

test('pace falls back to the last 50 games when the last 30 days are quiet', () => {
  const old = Array.from({ length: 60 }, (_, i) => row(`O${i}`, 2, now - (40 + i) * DAY, i < 10));
  const pace = computePace(old, 100, 50, now);
  assert.equal(pace.windowDays, null);
  assert.equal(pace.windowGames, 50);
  assert.equal(pace.windowNewWins, 10);
});

test('the latest session groups games with short gaps and expires after 12 hours', () => {
  const games = [
    row('A', 1, now - 10 * 60_000, true),
    row('B', 5, now - 40 * 60_000),
    row('C', 2, now - 40 * 60_000 - SESSION_GAP_MS + 1000),
    row('D', 1, now - 10 * 3600_000),
  ];
  const session = latestSession(games, now)!;
  assert.equal(session.games, 3);
  assert.equal(session.wins, 1);
  assert.equal(session.avgPlacement, 2.7);
  assert.deepEqual(session.newWins, ['A']);
  assert.equal(latestSession(games, now + 13 * 3600_000), null);
});

test('recommendations are needed, owned champions with a reason', () => {
  const cards = [
    { id: 'Ahri', key: 1, name: 'Ahri', won: false, owned: true, tags: ['Mage'], masteryPoints: 200_000, masteryLevel: 12 },
    { id: 'Lux', key: 2, name: 'Lux', won: false, owned: true, tags: ['Mage'], masteryPoints: 1_000, masteryLevel: 1 },
    { id: 'Zed', key: 3, name: 'Zed', won: true, owned: true, tags: ['Assassin'], masteryPoints: 900_000 },
    { id: 'Teemo', key: 4, name: 'Teemo', won: false, owned: false, tags: ['Marksman'], masteryPoints: 500_000 },
  ];
  const games = [row('Ahri', 2, 3), row('Lux', 3, 2), row('Ahri', 1, 1)];
  const picks = recommend(cards, games);
  assert.deepEqual(picks.map((p) => p.id), ['Ahri', 'Lux']);
  assert.match(picks[0].reason, /Mastery 12 · 200k pts · you average 2 on Mages/);
});

test('the fixture is deterministic and its art is a plain SVG', () => {
  const a = buildFixture(now);
  const b = buildFixture(now);
  assert.deepEqual(Object.keys(a.store.matches).slice(0, 5), Object.keys(b.store.matches).slice(0, 5));
  assert.ok(a.champions.length > 150);
  assert.ok(Object.keys(a.store.matches).length > 500);
  assert.match(fixtureArt('MonkeyKing'), /^<svg[\s\S]*>MK<\/text>/);
});
