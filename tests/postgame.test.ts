import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectArenaGameEnd, computePostGameEvent, isStale } from '../src/postgame.ts';

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

test('isStale flags syncs older than 24h', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime();
  assert.equal(isStale('2026-07-27T11:00:00Z', now), false);
  assert.equal(isStale('2026-07-26T10:00:00Z', now), true);
  assert.equal(isStale(null, now), true);
});
