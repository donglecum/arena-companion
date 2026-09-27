import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayerKey, parsePlayerKey } from '../src/player.ts';

test('normalizes region + riot id to lowercase playerKey', () => {
  assert.equal(normalizePlayerKey('NA1', 'Scro#Scro'), 'na1:scro#scro');
  assert.equal(normalizePlayerKey('na1', 'scro#scro'), 'na1:scro#scro');
});

test('trims whitespace and collapses case on both halves', () => {
  assert.equal(normalizePlayerKey('  EUW1 ', ' Some Name #TAG '), 'euw1:some name #tag');
});

test('rejects riot id without tag', () => {
  assert.throws(() => normalizePlayerKey('na1', 'scro'), /tag/i);
});

test('parsePlayerKey round-trips', () => {
  const { region, gameName, tagLine } = parsePlayerKey('na1:scro#scro');
  assert.equal(region, 'na1');
  assert.equal(gameName, 'scro');
  assert.equal(tagLine, 'scro');
});
