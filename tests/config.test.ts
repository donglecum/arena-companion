import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyConfigPatch, loadConfig, normalizeConfigPatch } from '../src/config.ts';

test('normalizeConfigPatch accepts known keys and ignores unknown ones', () => {
  const r = normalizeConfigPatch({ gameName: ' Scro ', tagLine: '#Scro', regionLabel: 'euw', miniMode: true, evil: 1 });
  assert.deepEqual(r, { ok: true, set: { gameName: 'Scro', tagLine: 'Scro', regionLabel: 'EUW', miniMode: true }, clear: [] });
});

test('normalizeConfigPatch clears the Riot ID and region with null or empty', () => {
  assert.deepEqual(normalizeConfigPatch({ gameName: null, tagLine: '', regionLabel: null }), {
    ok: true,
    set: {},
    clear: ['gameName', 'tagLine', 'regionLabel'],
  });
});

test('normalizeConfigPatch rejects values that would break the server', () => {
  assert.equal(normalizeConfigPatch({ gameName: 42, tagLine: 'x' }).ok, false);
  assert.equal(normalizeConfigPatch({ gameName: 'Scro' }).ok, false); // half a Riot ID
  assert.equal(normalizeConfigPatch({ regionLabel: 'MARS' }).ok, false);
  assert.equal(normalizeConfigPatch({ alwaysOnTop: 'yes' }).ok, false);
  assert.equal(normalizeConfigPatch([]).ok, false);
  assert.equal(normalizeConfigPatch('x').ok, false);
});

test('applyConfigPatch sets and removes keys without mutating the input', () => {
  const before = { gameName: 'A', tagLine: 'B', miniMode: false };
  const after = applyConfigPatch(before, { set: { miniMode: true }, clear: ['gameName', 'tagLine'] });
  assert.deepEqual(after, { miniMode: true });
  assert.deepEqual(before, { gameName: 'A', tagLine: 'B', miniMode: false });
});

test('loadConfig drops bad saved values instead of failing', () => {
  assert.deepEqual(loadConfig({ gameName: 7, tagLine: 'x', alwaysOnTop: true, autoShow: true }), {
    miniMode: false,
    alwaysOnTop: true,
  });
  assert.deepEqual(loadConfig(null), { miniMode: false, alwaysOnTop: false });
});

test('loadConfig treats a saved NA as the old implicit default and auto-detects', () => {
  assert.equal(loadConfig({ regionLabel: 'NA' }).regionLabel, undefined);
  assert.equal(loadConfig({ regionLabel: 'EUW' }).regionLabel, 'EUW');
});
