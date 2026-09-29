import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFromClient } from '../src/regions.ts';

test('regionFromClient maps client labels and platform ids', () => {
  assert.equal(regionFromClient('NA')?.label, 'NA');
  assert.equal(regionFromClient('NA1')?.label, 'NA');
  assert.equal(regionFromClient('euw1')?.label, 'EUW');
  assert.equal(regionFromClient('EUNE')?.label, 'EUNE');
  assert.equal(regionFromClient('LA1')?.label, 'LAN');
  assert.equal(regionFromClient('LA2')?.label, 'LAS');
  assert.equal(regionFromClient('OC1')?.label, 'OCE');
  assert.equal(regionFromClient('KR')?.label, 'KR');
});

test('regionFromClient returns null for unknown or missing values', () => {
  assert.equal(regionFromClient('PBE'), null);
  assert.equal(regionFromClient(''), null);
  assert.equal(regionFromClient(undefined), null);
  assert.equal(regionFromClient(1), null);
});
