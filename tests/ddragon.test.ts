import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChampions } from '../src/ddragon.ts';

const DDRAGON_SAMPLE = {
  type: 'champion',
  version: '16.1.1',
  data: {
    Annie: { id: 'Annie', key: '1', name: 'Annie', image: { full: 'Annie.png' } },
    Olaf: { id: 'Olaf', key: '2', name: 'Olaf', image: { full: 'Olaf.png' } },
    MonkeyKing: { id: 'MonkeyKing', key: '62', name: 'Wukong', image: { full: 'MonkeyKing.png' } },
  },
};

test('parseChampions flattens ddragon payload sorted by name', () => {
  const champs = parseChampions(DDRAGON_SAMPLE);
  assert.equal(champs.length, 3);
  assert.equal(champs[0].id, 'Annie');
  const wukong = champs.find((c) => c.key === '62');
  assert.equal(wukong?.name, 'Wukong');
  assert.equal(wukong?.image, 'MonkeyKing.png');
});

test('parseChampions rejects empty payload', () => {
  assert.throws(() => parseChampions({ data: {} }), /champion/i);
  assert.throws(() => parseChampions(null), /champion/i);
});

test('cacheChampions shares one fetch, reuses it until stale, and retries after failure', async () => {
  const { cacheChampions } = await import('../src/ddragon.ts');
  let calls = 0;
  let fail = false;
  let clock = 0;
  const fetcher = async () => {
    calls += 1;
    if (fail) throw new Error('offline');
    return { version: `v${calls}`, champions: [] };
  };
  const get = cacheChampions(fetcher, 1000, () => clock);
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  clock = 999;
  await get();
  assert.equal(calls, 1);
  clock = 1000;
  fail = true;
  await assert.rejects(get(), /offline/);
  fail = false;
  assert.equal((await get()).version, 'v3'); // the failure was not cached
});
