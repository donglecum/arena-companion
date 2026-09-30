import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectArenaGameEnd, computePostGameEvent, findFinishedGame, postGameStep, wonSnapshot, isStale, FINISHED_GAME_SLACK_MS, POST_GAME_RETRY_MS, type FinishedGame } from '../src/postgame.ts';

test('detectArenaGameEnd fires when leaving an Arena match', () => {
  assert.equal(detectArenaGameEnd('InProgress', 'WaitingForStats', 1700), true);
  assert.equal(detectArenaGameEnd('WaitingForStats', 'EndOfGame', 1700), true);
  assert.equal(detectArenaGameEnd('InProgress', 'None', 1700), true);
});

test('detectArenaGameEnd ignores non-Arena queues and non-game transitions', () => {
  assert.equal(detectArenaGameEnd('InProgress', 'EndOfGame', 420), false);
  assert.equal(detectArenaGameEnd('None', 'Lobby', 1700), false);
  assert.equal(detectArenaGameEnd('ChampSelect', 'InProgress', 1700), false);
  assert.equal(detectArenaGameEnd('Lobby', 'Matchmaking', 1700), false);
});

test('detectArenaGameEnd accepts queue 1750 and the CHERRY game mode', () => {
  assert.equal(detectArenaGameEnd('InProgress', 'EndOfGame', 1750), true);
  assert.equal(detectArenaGameEnd('WaitingForStats', 'PreEndOfGame', 1750, 'CHERRY'), true);
  assert.equal(detectArenaGameEnd('InProgress', 'WaitingForStats', 0, 'CHERRY'), true);
  assert.equal(detectArenaGameEnd('InProgress', 'EndOfGame', 420, 'CLASSIC'), false);
});

test('computePostGameEvent celebrates a first win on a new champion', () => {
  const ev = computePostGameEvent(
    { wonCount: 45, wonChampNames: ['Annie'] },
    { wonCount: 46, wonChampNames: ['Annie', 'Olaf'] },
    'Olaf',
  );
  assert.equal(ev.type, 'new-win');
  assert.equal(ev.champion, 'Olaf');
  assert.equal(ev.wonCount, 46);
});

test('computePostGameEvent is quiet when nothing new was won', () => {
  const ev = computePostGameEvent(
    { wonCount: 45, wonChampNames: ['Annie'] },
    { wonCount: 45, wonChampNames: ['Annie'] },
    'Olaf',
  );
  assert.equal(ev.type, 'updated');
});

test('computePostGameEvent handles first win even if last-played name mismatches', () => {
  const ev = computePostGameEvent(
    { wonCount: 45, wonChampNames: ['Annie'] },
    { wonCount: 46, wonChampNames: ['Annie', 'Galio'] },
    null,
  );
  assert.equal(ev.type, 'new-win');
  assert.equal(ev.champion, 'Galio');
});

const gragas: FinishedGame = { championId: 'Gragas', championName: 'Gragas', placement: 1, gameEnd: 1_000_000, firstWin: true };

test('computePostGameEvent carries the before counts and the finished game for the post-game card', () => {
  const ev = computePostGameEvent(
    { wonCount: 143, wonChampNames: ['Annie', 'Olaf'] },
    { wonCount: 145, wonChampNames: ['Annie', 'Olaf', 'Alistar', 'Gragas'] },
    null,
    { arenaGodBefore: 143, total: 171, game: gragas },
    Date.UTC(2026, 8, 30, 20),
  );
  assert.equal(ev.type, 'new-win');
  assert.equal(ev.champion, 'Gragas'); // the game's own champion leads, even when another is new too
  assert.deepEqual(ev.newChampions, ['Gragas', 'Alistar']);
  assert.equal(ev.previousWonCount, 143);
  assert.equal(ev.wonCount, 145);
  assert.equal(ev.arenaGodBefore, 143);
  assert.equal(ev.total, 171);
  assert.deepEqual(ev.game, gragas);
  assert.equal(ev.pending, false);
  assert.equal(ev.at, '2026-09-30T20:00:00.000Z');
});

test('computePostGameEvent reports an ordinary game, or one still missing from match history', () => {
  const shen: FinishedGame = { championId: 'Shen', championName: 'Shen', placement: 4, gameEnd: 1, firstWin: false };
  const done = computePostGameEvent({ wonCount: 5, wonChampNames: ['Shen'] }, { wonCount: 5, wonChampNames: ['Shen'] }, null, { game: shen });
  assert.equal(done.type, 'updated');
  assert.deepEqual(done.newChampions, []);
  assert.equal(done.game?.placement, 4);
  const waiting = computePostGameEvent({ wonCount: 5, wonChampNames: [] }, { wonCount: 5, wonChampNames: [] }, null, { pending: true });
  assert.equal(waiting.game, null);
  assert.equal(waiting.pending, true);
  assert.equal(waiting.arenaGodBefore, null);
});

test('findFinishedGame takes the newest match only once it ended after we left the game', () => {
  const leftAt = 10_000_000;
  const earlier = { ...gragas, championId: 'Shen', championName: 'Shen', gameEnd: leftAt - 25 * 60_000 };
  // Match history has not caught up: the newest match is the previous game.
  assert.equal(findFinishedGame([earlier], leftAt), null);
  assert.equal(findFinishedGame([], leftAt), null);
  // Eliminated early: the match ends after we left.
  assert.deepEqual(findFinishedGame([{ ...gragas, gameEnd: leftAt + 6 * 60_000 }, earlier], leftAt)?.championId, 'Gragas');
  // The winner leaves as the game ends; Riot's clock may run a little behind ours.
  assert.equal(findFinishedGame([{ ...gragas, gameEnd: leftAt - FINISHED_GAME_SLACK_MS + 1 }], leftAt)?.championId, 'Gragas');
  // Extra match fields are not copied into the event.
  assert.deepEqual(Object.keys(findFinishedGame([{ ...gragas, gameEnd: leftAt, id: 'NA1_1', win: true } as FinishedGame], leftAt) ?? {}).sort(),
    ['championId', 'championName', 'firstWin', 'gameEnd', 'placement']);
});

test('post-game scans publish once the game is found, and wait a bounded time for it', () => {
  // Found on the first scan (as before these retries existed): publish, done.
  assert.deepEqual(postGameStep(0, true), { publish: 'final', retryIn: null });
  // Not in match history yet: tell the UI to wait, look again soon.
  assert.deepEqual(postGameStep(0, false), { publish: 'waiting', retryIn: POST_GAME_RETRY_MS[0] });
  // Still missing on a follow-up: keep waiting quietly, backing off.
  assert.deepEqual(postGameStep(2, false), { publish: 'none', retryIn: POST_GAME_RETRY_MS[2] });
  // Found on a follow-up: the real event replaces the pending one.
  assert.deepEqual(postGameStep(3, true), { publish: 'final', retryIn: null });
  // Out of retries: stop waiting, leave it to a later scan.
  assert.deepEqual(postGameStep(POST_GAME_RETRY_MS.length, false), { publish: 'stop-waiting', retryIn: null });
  // With no retries at all the first scan's event is final.
  assert.deepEqual(postGameStep(0, false, []), { publish: 'final', retryIn: null });
  // The whole wait stays around a quarter of an hour.
  const total = POST_GAME_RETRY_MS.reduce((a, b) => a + b, 0);
  assert.ok(total >= 10 * 60_000 && total <= 20 * 60_000);
});

test('only a match-history win is new after the game, not a manual mark made while waiting', () => {
  const card = (name: string, won: boolean, wins = 0) => ({ name, won, wins });
  const before = wonSnapshot([card('Annie', true, 2), card('Lux', true), card('Olaf', false), card('Galio', false)]);
  assert.deepEqual(before, { wonCount: 2, wonChampNames: ['Annie', 'Lux'] });
  // Meanwhile: Galio marked by hand (a remembered win), Lux's mark removed, and Olaf won for real.
  const after = wonSnapshot([card('Annie', true, 2), card('Lux', false), card('Olaf', true, 1), card('Galio', true)], before);
  assert.deepEqual(after, { wonCount: 3, wonChampNames: ['Annie', 'Olaf'] });
  const ev = computePostGameEvent(before, after, null);
  assert.equal(ev.type, 'new-win');
  assert.deepEqual(ev.newChampions, ['Olaf']);
  // A manual mark alone is not a post-game win.
  const markedOnly = wonSnapshot([card('Annie', true, 2), card('Lux', true), card('Olaf', false), card('Galio', true)], before);
  assert.equal(computePostGameEvent(before, markedOnly, null).type, 'updated');
});

test('isStale flags syncs older than 24h', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime();
  assert.equal(isStale('2026-07-27T11:00:00Z', now), false);
  assert.equal(isStale('2026-07-26T10:00:00Z', now), true);
  assert.equal(isStale(null, now), true);
});
