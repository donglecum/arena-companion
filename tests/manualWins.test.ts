import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadManualMarks, saveManualMark, mergeManualWins, manualWinsFor } from '../src/manualWins.ts';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ac-manual-'));
const KEY = 'na1:someone#na1';

test('manual marks are saved per player and survive a reload', () => {
  const dir = tempDir();
  assert.deepEqual(loadManualMarks(dir, KEY), {});
  saveManualMark(dir, KEY, 'Nautilus', true);
  saveManualMark(dir, KEY, 'MonkeyKing', true);
  saveManualMark(dir, KEY, 'MonkeyKing', false);
  assert.deepEqual(loadManualMarks(dir, KEY), { Nautilus: true, MonkeyKing: false });
  assert.deepEqual(loadManualMarks(dir, 'euw1:other#euw'), {});
});

test('a corrupt or foreign marks file reads as no marks', () => {
  const dir = tempDir();
  saveManualMark(dir, KEY, 'Ahri', true);
  const file = fs.readdirSync(dir).find((f) => f.startsWith('manual-'))!;
  fs.writeFileSync(path.join(dir, file), '{not json');
  assert.deepEqual(loadManualMarks(dir, KEY), {});
  fs.writeFileSync(path.join(dir, file), JSON.stringify({ Ahri: 'yes', Annie: true }));
  assert.deepEqual(loadManualMarks(dir, KEY), { Annie: true });
});

test('local marks and removals apply over the tracker list', () => {
  const wins = mergeManualWins(['Galio', 'Annie'], { Nautilus: true, Annie: false });
  assert.deepEqual([...wins].sort(), ['Galio', 'Nautilus']);
});

test('manual wins come from this PC when the tracker refuses', async () => {
  const dir = tempDir();
  saveManualMark(dir, KEY, 'Nautilus', true);
  const down = { getManualWins: async () => { throw new Error('not_found'); } };
  assert.deepEqual([...(await manualWinsFor(down, dir, KEY))], ['Nautilus']);
  const up = { getManualWins: async () => ['Galio', 42 as unknown as string] };
  assert.deepEqual([...(await manualWinsFor(up, dir, KEY))].sort(), ['Galio', 'Nautilus']);
});
