import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCrowdFavoriteIds, resolveCrowdFavorites, LCU_EVENT_TOPICS } from '../src/server.ts';
import { isStaleSocketError } from '../src/lcu.ts';
import { isArenaQueue } from '../src/postgame.ts';

test('parseCrowdFavoriteIds accepts the LCU payload shapes', () => {
  assert.deepEqual(parseCrowdFavoriteIds([166, 119, 42, 163, 115]), [166, 119, 42, 163, 115]);
  assert.deepEqual(parseCrowdFavoriteIds([{ championId: 166 }, { id: 119 }, { key: '42' }]), [166, 119, 42]);
  assert.deepEqual(parseCrowdFavoriteIds(166), [166]);
  assert.deepEqual(parseCrowdFavoriteIds(['166', 119]), [166, 119]);
  assert.deepEqual(parseCrowdFavoriteIds([166, 166]), [166]);
});

test('parseCrowdFavoriteIds distinguishes an empty list from an unparsable payload', () => {
  assert.deepEqual(parseCrowdFavoriteIds([]), []);
  assert.equal(parseCrowdFavoriteIds(null), null);
  assert.equal(parseCrowdFavoriteIds(undefined), null);
  assert.equal(parseCrowdFavoriteIds({ nope: true }), null);
  assert.equal(parseCrowdFavoriteIds(['nope']), null);
  assert.deepEqual(parseCrowdFavoriteIds([0, -5, 166]), [166]);
  assert.equal(parseCrowdFavoriteIds([0, -5]), null);
});

test('resolveCrowdFavorites maps ids to card name/image and win state', () => {
  const cards = [
    { key: '166', name: 'Akshan', image: 'Akshan.png', won: true },
    { key: '119', name: 'Draven', image: 'Draven.png', won: false },
  ];
  assert.deepEqual(resolveCrowdFavorites([166, 119], cards), [
    { id: 166, name: 'Akshan', image: 'Akshan.png', won: true },
    { id: 119, name: 'Draven', image: 'Draven.png', won: false },
  ]);
});

test('resolveCrowdFavorites reports unknown, never not-won, without a checklist', () => {
  const fallback = new Map([[166, { name: 'Akshan', image: 'Akshan.png' }]]);
  assert.deepEqual(resolveCrowdFavorites([166], null, fallback), [
    { id: 166, name: 'Akshan', image: 'Akshan.png', won: null },
  ]);
  assert.deepEqual(resolveCrowdFavorites([166], undefined), [{ id: 166, name: 'Champion 166', image: '', won: null }]);
});

test('resolveCrowdFavorites keeps unknown for ids missing from a loaded checklist', () => {
  const cards = [{ key: '166', name: 'Akshan', image: 'Akshan.png', won: true }];
  assert.deepEqual(resolveCrowdFavorites([166, 999], cards), [
    { id: 166, name: 'Akshan', image: 'Akshan.png', won: true },
    { id: 999, name: 'Champion 999', image: '', won: null },
  ]);
});

test('isArenaQueue accepts queue 1700/1750 and the CHERRY game mode', () => {
  assert.equal(isArenaQueue(1700), true);
  assert.equal(isArenaQueue(1750, 'CHERRY'), true);
  assert.equal(isArenaQueue(0, 'CHERRY'), true);
  assert.equal(isArenaQueue(1700, null), true);
  assert.equal(isArenaQueue('1700', 'CLASSIC'), true);
  assert.equal(isArenaQueue(420, 'CLASSIC'), false);
  assert.equal(isArenaQueue(null, null), false);
  assert.equal(isArenaQueue(undefined, undefined), false);
});

test('the LCU event socket subscribes to every JSON API event', () => {
  // Crowd favorites only arrive through the catch-all topic; a path-specific
  // subscription never delivered them and the panel stayed hidden.
  assert.deepEqual(LCU_EVENT_TOPICS, ['OnJsonApiEvent']);
});

test('only closed keep-alive sockets are retried', () => {
  assert.equal(isStaleSocketError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), true);
  assert.equal(isStaleSocketError(new Error('socket hang up')), true);
  assert.equal(isStaleSocketError(new Error('LCU request timed out: /x')), false);
  assert.equal(isStaleSocketError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })), false);
});
