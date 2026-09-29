import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMatchIds, collectFreshMatchIds, aggregate, update } from '../src/scan.ts';

test('collectMatchIds pages until depth and stops on short page', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => `m${i}`),
    Array.from({ length: 40 }, (_, i) => `m${100 + i}`),
  ];
  const calls: { start: number; count: number }[] = [];
  const fetchIds = async (_cluster: string, _puuid: string, start: number, count: number) => {
    calls.push({ start, count });
    return pages[start / 100] ?? [];
  };
  const { ids, exhausted } = await collectMatchIds('americas', 'puuid-x', 500, fetchIds);
  assert.equal(ids.length, 140);
  assert.equal(exhausted, true);
  assert.deepEqual(calls[0], { start: 0, count: 100 });
  assert.deepEqual(calls[1], { start: 100, count: 100 });
});

test('collectMatchIds respects finite depth', async () => {
  const page = Array.from({ length: 100 }, (_, i) => `m${i}`);
  const fetchIds = async (_c: string, _p: string, start: number, count: number) => (start === 0 ? page.slice(0, count) : []);
  const { ids, exhausted } = await collectMatchIds('americas', 'puuid-x', 60, fetchIds);
  assert.equal(ids.length, 60);
  assert.equal(exhausted, false);
});

test('collectFreshMatchIds stops at first known id', async () => {
  const seen = { m3: 1 };
  const fetchIds = async () => ['m0', 'm1', 'm2', 'm3', 'm4'];
  const fresh = await collectFreshMatchIds('americas', 'puuid-x', seen, {}, fetchIds);
  assert.deepEqual(fresh, ['m0', 'm1', 'm2']);
});

test('aggregate counts wins per champion and marks manual-only wins', () => {
  const store = {
    matches: {
      a: { championName: 'Annie', win: true, placement: 1, gameEnd: 100 },
      b: { championName: 'Annie', win: false, placement: 4, gameEnd: 200 },
      c: { championName: 'Olaf', win: true, placement: 1, gameEnd: 300 },
    },
  };
  const champions = [
    { id: 'Annie', key: '1', name: 'Annie' },
    { id: 'Olaf', key: '2', name: 'Olaf' },
    { id: 'Galio', key: '3', name: 'Galio' },
  ];
  const result = aggregate(store, champions, {}, new Set(['Galio']));
  assert.equal(result.wonCount, 3);
  assert.equal(result.gamesScanned, 3);
  const annie = result.cards.find((c) => c.id === 'Annie');
  assert.equal(annie.games, 2);
  assert.equal(annie.wins, 1);
  assert.equal(annie.won, true);
  const galio = result.cards.find((c) => c.id === 'Galio');
  assert.equal(galio.won, true);
  assert.equal(galio.manual, true);
});

test('aggregate reports ordered placement counts and one-decimal rates over scanned games', () => {
  const store = {
    matches: {
      a: { championName: 'Annie', win: true, placement: 1, gameEnd: 100 },
      b: { championName: 'Annie', win: true, placement: 1, gameEnd: 200 },
      c: { championName: 'Olaf', win: false, placement: 2, gameEnd: 300 },
      d: { championName: 'Galio', win: false, placement: 3, gameEnd: 400 },
      e: { championName: 'Galio', win: false, placement: 3, gameEnd: 500 },
      f: { championName: 'Olaf', win: false, placement: 3, gameEnd: 600 },
      g: { championName: 'Annie', win: false, placement: 8, gameEnd: 700 },
    },
  };
  const result = aggregate(store, [], {}, new Set<string>());
  assert.deepEqual(
    result.placements.map((p) => p.placement),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    result.placements.map((p) => p.count),
    [2, 1, 3, 0, 0, 0, 0, 1],
  );
  assert.deepEqual(
    result.placements.map((p) => p.percent),
    [28.6, 14.3, 42.9, 0, 0, 0, 0, 14.3],
  );
});

test('aggregate reports zeroed placements for an empty store', () => {
  const result = aggregate({ matches: {} }, [], {}, new Set<string>());
  assert.equal(result.gamesScanned, 0);
  assert.deepEqual(result.placements, [
    { placement: 1, count: 0, percent: 0 },
    { placement: 2, count: 0, percent: 0 },
    { placement: 3, count: 0, percent: 0 },
    { placement: 4, count: 0, percent: 0 },
    { placement: 5, count: 0, percent: 0 },
    { placement: 6, count: 0, percent: 0 },
    { placement: 7, count: 0, percent: 0 },
    { placement: 8, count: 0, percent: 0 },
  ]);
});

test('aggregate leaves invalid placements uncounted while the scanned denominator still applies', () => {
  const store = {
    matches: {
      a: { championName: 'Annie', win: true, placement: 1, gameEnd: 100 },
      b: { championName: 'Olaf', win: false, placement: 8, gameEnd: 200 },
      c: { championName: 'Galio', win: false, placement: 0, gameEnd: 300 },
      d: { championName: 'Zed', win: false, placement: 9, gameEnd: 400 },
      e: { championName: 'Kayle', win: false, gameEnd: 500 },
    },
  };
  const result = aggregate(store, [], {}, new Set<string>());
  assert.equal(result.gamesScanned, 5);
  assert.equal(result.placements[0].count, 1);
  assert.equal(result.placements[7].count, 1);
  assert.equal(result.placements.reduce((n, p) => n + p.count, 0), 2);
  assert.equal(result.placements[0].percent, 20);
  assert.equal(result.placements[7].percent, 20);
});

test('update retries a failed batch that sits behind a successful newer one', async () => {
  const history = [...Array.from({ length: 60 }, (_, i) => `m${i + 1}`), 'known'];
  let failing = true;
  const api: any = {
    getMatchIds: async (_c: string, _p: string, start: number, count: number) => history.slice(start, start + count),
    getMatchSummaries: async (_c: string, ids: string[]) => {
      if (failing && ids.includes('m30')) throw new Error('tracker 503');
      return { records: {}, seen: ids };
    },
  };
  let store: any = { account: { puuid: 'p' }, matches: { known: {} }, seen: { known: 1 } };
  store = await update(api, { cluster: 'americas' }, store);
  assert.equal(store.pending.length, 25);
  failing = false;
  store = await update(api, { cluster: 'americas' }, store);
  assert.deepEqual(history.filter((id) => !(id in store.seen)), []);
  assert.deepEqual(store.pending, []);
});
