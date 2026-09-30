const { test } = require('node:test');
const assert = require('node:assert/strict');
const { postGameNotification } = require('../shell/notify.cjs');

const win = (extra) => ({ type: 'new-win', champion: 'Gragas', newChampions: ['Gragas'], ...extra });

test('a first win notifies with the Arena God step when it is exact', () => {
  assert.deepEqual(postGameNotification(win({ previousWonCount: 143, wonCount: 144, arenaGodBefore: 143, total: 171 })),
    { title: 'First Arena win!', body: 'Gragas · Arena God 143 → 144 · 27 to go' });
  assert.equal(postGameNotification(win({ previousWonCount: 143, wonCount: 144, arenaGodBefore: null, total: null })).body,
    'Gragas · Arena God 143 → 144');
  // The step counts new champions: a manual mark made meanwhile does not inflate it.
  assert.equal(postGameNotification(win({ previousWonCount: 143, wonCount: 145, arenaGodBefore: 143, total: 171 })).body,
    'Gragas · Arena God 143 → 144 · 27 to go');
});

test('with older wins Riot counts, the notification claims no step', () => {
  assert.deepEqual(postGameNotification(win({ previousWonCount: 82, wonCount: 83, arenaGodBefore: 89, total: 171 })),
    { title: 'First Arena win!', body: 'Gragas · 83 champions won' });
  // Events from before the step fields existed keep the old text.
  assert.equal(postGameNotification({ type: 'new-win', champion: null, wonCount: 46 }).body, 'a new champion · 46 champions won');
});

test('ordinary results and missing events do not notify', () => {
  assert.equal(postGameNotification({ type: 'updated', wonCount: 5 }), null);
  assert.equal(postGameNotification(null), null);
});
