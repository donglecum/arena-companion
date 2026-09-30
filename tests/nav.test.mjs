import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NAV, parseRoute, hrefFor, viewForKey, viewMeta, activeNavView, showLiveNav } from '../src/ui/js/nav.js';

test('routes parse views and champion ids, and fall back to the Overview', () => {
  assert.deepEqual(parseRoute('#/remaining'), { view: 'remaining', param: '' });
  assert.deepEqual(parseRoute('#/champion/Kai%27Sa'), { view: 'champion', param: "Kai'Sa" });
  assert.deepEqual(parseRoute('#/champion/Nunu%20%26%20Willump'), { view: 'champion', param: 'Nunu & Willump' });
  assert.deepEqual(parseRoute('#champions'), { view: 'champions', param: '' });
  assert.deepEqual(parseRoute('#/champion/%E0%A4%A'), { view: 'champion', param: '%E0%A4%A' }); // malformed escape
  assert.deepEqual(parseRoute('#/nope'), { view: 'dashboard', param: '' });
  assert.deepEqual(parseRoute(''), { view: 'dashboard', param: '' });
  assert.equal(hrefFor('champion', 'Nunu & Willump'), '#/champion/Nunu%20%26%20Willump');
  assert.equal(hrefFor('remaining'), '#/remaining');
  assert.equal(parseRoute(hrefFor('champion', 'Nunu & Willump')).param, 'Nunu & Willump');
});

test('the sidebar order follows the Arena God task, with Settings apart and Champ Select live-only', () => {
  assert.deepEqual(NAV.filter((n) => !n.slot).map((n) => n.view), ['dashboard', 'remaining', 'champions', 'history']);
  assert.equal(NAV.find((n) => n.view === 'settings').slot, 'foot');
  assert.equal(NAV.find((n) => n.view === 'champselect').slot, 'live');
  assert.equal(viewMeta('dashboard').title, 'Overview');
  assert.deepEqual(viewMeta('champion'), { title: 'Champion', parent: 'champions' });
  assert.equal(activeNavView('champion'), 'champions');
  assert.equal(activeNavView('remaining'), 'remaining');
  assert.equal(showLiveNav(false, 'dashboard'), false);
  assert.equal(showLiveNav(true, 'dashboard'), true);
  assert.equal(showLiveNav(false, 'champselect'), true);
});

test('number keys open the views in sidebar order', () => {
  assert.deepEqual(['1', '2', '3', '4', '5', '6'].map(viewForKey), ['dashboard', 'remaining', 'champions', 'history', 'settings', 'champselect']);
  assert.equal(viewForKey('7'), null);
  assert.equal(viewForKey('0'), null);
  assert.equal(new Set(NAV.map((n) => n.key)).size, NAV.length);
});

test('index.html links every destination with its route and shortcut', () => {
  const html = fs.readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
  for (const n of NAV) {
    const link = html.match(new RegExp(`<a [^>]*data-view="${n.view}"[^>]*>`))?.[0];
    assert.ok(link, `no sidebar link for ${n.view}`);
    assert.match(link, new RegExp(`href="#/${n.view}"`));
    assert.match(link, new RegExp(`title="${n.title} \\(${n.key}\\)"`));
  }
  // The shortcut sheet documents the same keys.
  assert.match(html, /<kbd>1<\/kbd>–<kbd>5<\/kbd><\/dt><dd>Overview, Remaining, Champions, History, Settings<\/dd>/);
  assert.match(html, /<kbd>6<\/kbd><\/dt><dd>Champ select<\/dd>/);
});
