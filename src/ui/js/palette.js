// Command palette (Ctrl+K / Ctrl+P): fuzzy search over champions, views and commands.
import { $, esc, art, statusOf } from './util.js';
import { icon } from './icons.js';
import { state } from './store.js';

let items = [];
let results = [];
let active = 0;
let commands = () => [];

/** Subsequence match with bonuses for word starts and runs; null when it doesn't match. */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0, ti = 0, run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const wordStart = found === 0 || /[\s\-'.·]/.test(t[found - 1]);
    run = found === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 4 : 0) + run * 2 - Math.min(3, found - ti) * 0.3;
    ti = found + 1;
  }
  if (t.startsWith(query.toLowerCase())) score += 10;
  return score - t.length * 0.02;
}

function build() {
  const cards = state.status?.cards ?? [];
  return [
    ...commands(),
    ...cards.map((c) => ({
      kind: 'Champion', label: c.name, hint: `${statusOf(c) === 'needed' ? 'Needed' : statusOf(c) === 'manual' ? 'Manual' : 'Won'}${c.games ? ` · ${c.games} games` : ''}`,
      card: c, run: () => { location.hash = `#/champion/${encodeURIComponent(c.id)}`; },
    })),
  ];
}

function renderList() {
  const list = $('pal-list');
  if (!results.length) { list.innerHTML = '<div class="pal-empty">No matches</div>'; return; }
  list.innerHTML = results.map((it, i) => `<button class="pal-item ${i === active ? 'active' : ''}" data-i="${i}" role="option" aria-selected="${i === active}">
    ${it.card ? art(it.card, 'tile', 'pal-art') : `<span class="pal-icon">${icon(it.icon ?? 'command', 16)}</span>`}
    <span class="pal-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
    ${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : `<span class="pal-kind">${esc(it.kind)}</span>`}
  </button>`).join('');
  list.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
}

function search(q) {
  const scored = q.trim()
    ? items.map((it) => ({ it, s: fuzzyScore(q.trim(), `${it.label} ${it.kind === 'Champion' ? '' : it.kind}`) })).filter((x) => x.s !== null).sort((a, b) => b.s - a.s).map((x) => x.it)
    : items.filter((it) => it.kind !== 'Champion');
  results = scored.slice(0, 40);
  active = 0;
  renderList();
}

export function openPalette(initial = '') {
  items = build();
  const pal = $('palette');
  pal.hidden = false;
  document.body.classList.add('modal-open');
  const input = $('pal-input');
  input.value = initial;
  search(initial);
  input.focus(); // synchronously, so keys typed right after Ctrl+K land in the box
}

export function closePalette() {
  $('palette').hidden = true;
  document.body.classList.remove('modal-open');
}

function runActive() {
  const it = results[active];
  if (!it) return;
  closePalette();
  it.run();
}

export function initPalette(getCommands) {
  commands = getCommands;
  const input = $('pal-input');
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); renderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('pal-list').addEventListener('mousemove', (e) => {
    const b = e.target.closest('.pal-item');
    if (b && Number(b.dataset.i) !== active) { active = Number(b.dataset.i); renderList(); }
  });
  $('pal-list').addEventListener('click', (e) => {
    const b = e.target.closest('.pal-item');
    if (b) { active = Number(b.dataset.i); runActive(); }
  });
  $('palette').addEventListener('mousedown', (e) => { if (e.target === $('palette')) closePalette(); });
}
