import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureScenario, fixtureScenarioName, FIXTURE_SCENARIOS } from '../src/fixture.ts';
import { aggregate } from '../src/scan.ts';
import { resolveCrowdFavorites } from '../src/server.ts';

const now = Date.UTC(2026, 8, 30, 20);

function checklist(name: string) {
  const sc = fixtureScenario(name, now);
  const { store, champions, masteries, manual } = sc.fixture;
  const result = aggregate(store, champions, masteries, manual);
  const index = new Map([...champions.map((c) => [Number(c.key), { name: c.name, image: c.image }] as const),
    ...sc.indexOnly.map((c) => [c.key, { name: c.name, image: c.image }] as const)]);
  return { sc, result, favorites: resolveCrowdFavorites(sc.crowd, result.cards, index) };
}

test('fixture scenario names: the env value, with 1 and unknown values as the idle sample', () => {
  assert.equal(fixtureScenarioName('1'), 'idle');
  assert.equal(fixtureScenarioName('champselect'), 'champselect');
  assert.equal(fixtureScenarioName('nope'), 'idle');
  assert.ok(FIXTURE_SCENARIOS.includes('complete'));
});

test('the idle sample is partial Arena God progress with wins older than match history', () => {
  const { sc, result } = checklist('idle');
  assert.equal(sc.phase, 'None');
  assert.equal(sc.event, null);
  assert.ok(result.wonCount > 0 && result.wonCount < result.total);
  assert.ok(sc.fixture.arenaGod > result.wonCount); // unrecoverable wins
});

test('crowd favorite samples: mixed, all needed, all won', () => {
  const mixed = checklist('champselect');
  assert.equal(mixed.sc.phase, 'ChampSelect');
  assert.ok(mixed.sc.pick);
  assert.deepEqual(mixed.favorites.map((f) => f.won), [true, false, false, true, null]);
  assert.equal(mixed.favorites[4].name, 'New champion');
  assert.deepEqual(checklist('crowd-needed').favorites.map((f) => f.won), [false, false, false, false, false]);
  assert.deepEqual(checklist('crowd-won').favorites.map((f) => f.won), [true, true, true, true, true]);
});

test('the first-win sample wins a needed champion and Riot’s count follows', () => {
  const idle = checklist('idle');
  const { sc, result } = checklist('first-win');
  const ev = sc.event;
  assert.ok(ev && ev.type === 'new-win');
  assert.equal(ev.previousWonCount, idle.result.wonCount);
  assert.equal(ev.wonCount, idle.result.wonCount + 1);
  assert.equal(result.wonCount, ev.wonCount);
  assert.deepEqual(ev.newChampions, [ev.champion]);
  assert.equal(ev.game?.placement, 1);
  assert.equal(ev.game?.firstWin, true);
  assert.equal(ev.arenaGodBefore, idle.sc.fixture.arenaGod);
  assert.equal(sc.fixture.arenaGod, idle.sc.fixture.arenaGod + 1);
  assert.equal(ev.at, new Date(now).toISOString());
});

test('the post-game result samples: a champion already won, and one still needed', () => {
  const done = checklist('result').sc.event;
  assert.ok(done && done.type === 'updated');
  assert.equal(done.game?.placement, 4);
  const card = checklist('result').result.cards.find((c) => c.id === done.game?.championId);
  assert.equal(card.won, true);
  const needed = checklist('result-needed');
  const ev = needed.sc.event;
  assert.equal(ev?.type, 'updated');
  assert.equal(ev?.game?.placement, 2);
  assert.equal(needed.result.cards.find((c) => c.id === ev?.game?.championId).won, false);
});

test('the complete sample has every champion won', () => {
  const { sc, result } = checklist('complete');
  assert.equal(result.wonCount, result.total);
  assert.equal(sc.fixture.arenaGod, result.total);
});
