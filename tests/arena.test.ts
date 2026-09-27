import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChampionStatus } from '../src/arena.ts';

const CHAMPS = [
  { id: 1, key: 'Annie', name: 'Annie' },
  { id: 2, key: 'Olaf', name: 'Olaf' },
  { id: 3, key: 'Galio', name: 'Galio' },
];

test('distinct match-history wins plus manual-only wins without double counting', () => {
  const status = buildChampionStatus({
    champions: CHAMPS,
    scannedWins: [1, 1, 2], // Annie seen twice in history, Olaf once
    manualWins: [1, 3],    // Annie also manual (dup), Galio manual-only
  });
  const byId = new Map(status.map((s) => [s.id, s]));
  assert.equal(byId.get(1).won, true);
  assert.equal(byId.get(1).source, 'match-history');
  assert.equal(byId.get(2).won, true);
  assert.equal(byId.get(2).source, 'match-history');
  assert.equal(byId.get(3).won, true);
  assert.equal(byId.get(3).source, 'manual');
});

test('unwon champions report won=false with no source', () => {
  const status = buildChampionStatus({ champions: CHAMPS, scannedWins: [1], manualWins: [] });
  const olaf = status.find((s) => s.id === 2);
  assert.equal(olaf.won, false);
  assert.equal(olaf.source, 'none');
});

test('total won count aggregates distinct champions only', () => {
  const status = buildChampionStatus({ champions: CHAMPS, scannedWins: [1, 1, 1], manualWins: [1] });
  assert.equal(status.filter((s) => s.won).length, 1);
});

test('manual wins referencing unknown champion ids are ignored, not fatal', () => {
  const status = buildChampionStatus({ champions: CHAMPS, scannedWins: [], manualWins: [999] });
  assert.equal(status.filter((s) => s.won).length, 0);
});
