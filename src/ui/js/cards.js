// The champion card shared by the Champions grid and the Remaining view:
// artwork first, then name and mastery, classes, and one line of Arena record.
// Status reads from the art: still needed is full color with a coral edge,
// won recedes behind a teal check, a manual mark is purple, and a champion you
// do not own is grey with a lock.
import { esc, art, statusOf, dec, num, ordinal } from './util.js';
import { icon } from './icons.js';

const STATUS_TEXT = { won: 'won', manual: 'won (manual mark)', needed: 'still needed' };

/** "4 games · 3.2 avg", or "Never played". */
export function recordLine(c) {
  if (!c.games) return 'Never played';
  return `${num(c.games)} ${c.games === 1 ? 'game' : 'games'}${c.avgPlacement ? ` · ${dec(c.avgPlacement)} avg` : ''}`;
}

/** "4 games · best 2nd" — for champions still needed, how close they came. */
export const closestLine = (c, best) => (c.games ? `${num(c.games)} ${c.games === 1 ? 'game' : 'games'}${best ? ` · best ${ordinal(best)}` : ''}` : 'Never played');

export function champCard(c, { line = recordLine(c) } = {}) {
  const status = statusOf(c);
  const locked = c.owned === false;
  const classes = (c.tags ?? []).join(' · ');
  const label = `${c.name}: ${STATUS_TEXT[status]}${locked ? ', not owned' : ''}. ${line}${c.masteryLevel ? `. Mastery ${c.masteryLevel}` : ''}`;
  const badge = status === 'won' ? `<span class="cc-status won">${icon('check', 12)}Won</span>`
    : status === 'manual' ? `<span class="cc-status manual">${icon('pencil', 11)}Manual</span>` : '';
  return `<a class="champ-card ${status}${locked ? ' locked' : ''}" href="#/champion/${encodeURIComponent(c.id)}" aria-label="${esc(label)}" title="${esc(`${c.name} · ${c.games} games · ${c.wins} wins`)}">
    <span class="cc-art">${art(c, 'tile')}${locked ? `<span class="cc-lock" title="Not owned">${icon('lock', 12)}</span>` : ''}${badge}</span>
    <span class="cc-body">
      <span class="cc-name">${esc(c.name)}</span>
      <span class="cc-row"><span class="cc-classes">${esc(classes || 'Champion')}</span>${c.masteryLevel ? `<span class="cc-mastery num" title="Mastery ${c.masteryLevel} · ${num(c.masteryPoints)} pts">M${c.masteryLevel}</span>` : ''}</span>
      <span class="cc-stat">${esc(line)}</span>
    </span>
  </a>`;
}

export const cardSkeletons = (n) => `<div class="champ-grid">${'<div class="champ-card skeleton"></div>'.repeat(n)}</div>`;
