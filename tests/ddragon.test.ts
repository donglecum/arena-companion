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
  assert.equal(wukong.name, 'Wukong');
  assert.equal(wukong.image, 'MonkeyKing.png');
});

test('parseChampions rejects empty payload', () => {
  assert.throws(() => parseChampions({ data: {} }), /champion/i);
  assert.throws(() => parseChampions(null), /champion/i);
});
