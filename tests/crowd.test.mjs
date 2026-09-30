import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/ui/js/crowd.js';

const { crowdModel, portraitUrl, SAMPLE_CARDS } = globalThis.ArenaCrowd;

const fav = (id, name, won) => ({ id, name, image: `${name}.png`, won });
const live = (crowdFavorites, extra = {}) => ({ crowdFavoritesActive: true, crowdFavorites, ddragonVersion: '16.19.1', ...extra });

test('mixed favorites keep the lobby order and mark needed, won and unknown rows', () => {
  const m = crowdModel(live([fav(86, 'Garen', true), fav(99, 'Lux', false), fav(254, 'Vi', false), fav(222, 'Jinx', true), fav(201, 'Braum', null)]));
  assert.equal(m.active, true);
  assert.equal(m.preview, false);
  assert.deepEqual(m.rows.map((r) => [r.name, r.state]), [['Garen', 'won'], ['Lux', 'needed'], ['Vi', 'needed'], ['Jinx', 'won'], ['Braum', 'unknown']]);
  assert.deepEqual(m.counts, { needed: 2, won: 2, unknown: 1 });
  assert.equal(m.tone, 'need');
  assert.equal(m.summary, '2 needed');
  assert.equal(m.rows[1].label, 'Lux — still needed');
  assert.equal(m.rows[1].key, 'id:99');
  assert.equal(m.rows[1].initials, 'LU');
  assert.equal(m.rows[1].portrait, 'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/Lux.png');
});

test('the header answers "do I need any?" for all-needed, all-won and unknown lobbies', () => {
  const needed = crowdModel(live([fav(1, 'A', false), fav(2, 'B', false), fav(3, 'C', false)]));
  assert.deepEqual([needed.tone, needed.summary], ['need', '3 needed']);
  const won = crowdModel(live([fav(1, 'A', true), fav(2, 'B', true)]));
  assert.deepEqual([won.tone, won.summary], ['won', 'All won']);
  const unknown = crowdModel(live([fav(1, 'A', null), fav(2, 'B', undefined)]));
  assert.deepEqual([unknown.tone, unknown.summary], ['unknown', 'No win data']);
  const partial = crowdModel(live([fav(1, 'A', true), fav(2, 'B', null)]));
  assert.deepEqual([partial.tone, partial.summary], ['unknown', '1 unknown']);
});

test('the panel shows only during a real Arena champ select with favorites, or the preview', () => {
  assert.equal(crowdModel(live([])).active, false); // real champ select, list not in yet
  assert.equal(crowdModel({ crowdFavoritesActive: false, crowdFavorites: [fav(1, 'A', false)] }).active, false);
  assert.equal(crowdModel(null).active, false);
  const preview = crowdModel({ overlayPreview: true });
  assert.equal(preview.active, true);
  assert.equal(preview.preview, true);
  assert.equal(preview.title, 'Crowd Favorites · preview');
  assert.equal(preview.heading, 'Crowd Favorites');
  assert.deepEqual([preview.tone, preview.summary], ['preview', 'Preview']); // sample counts would mislead
  assert.equal(preview.rows.length, SAMPLE_CARDS.length);
  assert.deepEqual(new Set(preview.rows.map((r) => r.state)), new Set(['needed', 'won', 'unknown']));
  assert.ok(preview.rows.every((r) => r.portrait === '' && r.name.startsWith('Sample')));
  // A real Arena champ select supersedes the preview, even while its list is empty.
  const real = crowdModel({ overlayPreview: true, crowdFavoritesActive: true, crowdFavorites: [] });
  assert.deepEqual([real.active, real.preview, real.title], [false, false, 'Crowd Favorites']);
});

test('rows tolerate odd payloads without breaking the list', () => {
  const m = crowdModel(live([null, { id: 'x', name: 5, won: 'yes' }, fav(7, 'Nunu & Willump', false)]));
  assert.deepEqual(m.rows.map((r) => [r.key, r.name, r.state]), [['i:0', '', 'unknown'], ['i:1', '', 'unknown'], ['id:7', 'Nunu & Willump', 'needed']]);
  assert.equal(m.rows[2].initials, 'NW');
});

test('portraits come from Data Dragon, or the generated art in sample mode', () => {
  assert.equal(portraitUrl({ ddragonVersion: '16.19.1' }, 'MonkeyKing.png'), 'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/champion/MonkeyKing.png');
  assert.equal(portraitUrl({ fixture: true, ddragonVersion: 'fixture' }, 'MonkeyKing.png'), '/fixture-art/MonkeyKing.svg');
  assert.equal(portraitUrl({}, 'Ahri.png'), '');
  assert.equal(portraitUrl({ ddragonVersion: '16.19.1' }, ''), '');
});
