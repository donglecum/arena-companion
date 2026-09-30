// Remaining: the champions still needed for Arena God, grouped by primary
// class. The summary numbers double as filters (never played / played without
// a win / owned / not owned), and so do the class counts.
import { $, esc, changed, CLASSES, plural, num } from '../util.js';
import { icon } from '../icons.js';
import { bar } from '../charts.js';
import { champCard, closestLine, cardSkeletons } from '../cards.js';
import { arenaProgress, remainingSummary, filterRemaining, sortRemaining, groupByClass, REMAINING_SORTS } from '../progress.js';

const KEY = 'ac.remaining';
const ui = { kind: '', own: '', cls: '', sort: 'name', search: '' };
try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}'), { search: '' }); } catch { /* defaults */ }
const save = () => { try { const { search, ...rest } = ui; void search; localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* per-viewer convenience only */ } };

const groupName = (cls) => (cls === 'Other' ? 'Other' : plural(cls));

function layout() {
  return `<section id="rm-head" class="card rm-head"></section>
    <div id="rm-classes" class="class-progress rm-classes" role="group" aria-label="Filter by class"></div>
    <div class="toolbar card rm-toolbar">
      <label class="search-field">${icon('search', 16)}<input id="rm-search" type="search" placeholder="Search remaining champions…" aria-label="Search remaining champions"></label>
      <label class="rm-sort"><span class="label">Sort</span><select id="rm-sort" aria-label="Sort">${REMAINING_SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <button id="rm-clear" class="btn ghost small-btn" hidden>${icon('x', 14)} Clear filters</button>
      <span class="toolbar-spacer"></span>
      <span id="rm-count" class="dim num"></span>
    </div>
    <div id="rm-results" class="rm-results"></div>`;
}

const filtered = () => Boolean(ui.kind || ui.own || ui.cls || ui.search.trim());

function statButton(attr, value, count, label, hint) {
  const active = ui[attr] === value;
  return `<button class="rm-stat ${active ? 'active' : ''}" data-${attr}="${value}" aria-pressed="${active}" title="${esc(hint)}">
    <span class="rm-stat-value num">${num(count)}</span><span class="rm-stat-label">${label}</span></button>`;
}

function headHtml(p, s) {
  const title = !p.known ? 'Your checklist is loading'
    : p.complete ? 'Every champion won'
    : `<span class="num">${num(p.remaining)}</span> ${p.remaining === 1 ? 'champion' : 'champions'} to go`;
  // Nothing left to filter once every champion is won.
  const filters = s.left ? `<div class="rm-stats" role="group" aria-label="Filter remaining champions">
        ${statButton('kind', 'never', s.never, 'Never played', 'No Arena games on these yet')}
        ${statButton('kind', 'attempted', s.attempted, 'Played, no win', 'Played in Arena, never 1st')}
        ${statButton('own', 'owned', s.owned, 'Owned', 'Ready to play now')}
        ${statButton('own', 'locked', s.locked, 'Not owned', 'Unlock these to play them')}
      </div>` : '';
  // Riot counts wins older than match history; those champions are somewhere in this list.
  const note = p.unrecoverable > 0 && s.left > 0
    ? `<p class="rm-note">${icon('info', 14)}<span>Riot counts <b class="num">${p.unrecoverable}</b> more ${p.unrecoverable === 1 ? 'win' : 'wins'} than your match history shows, so <b class="num">${s.left}</b> champions here have no recorded win — ${p.unrecoverable} of them were won before match history. Mark the ones you remember on their pages.</span></p>`
    : '';
  return `<div class="rm-hero">
      <div class="rm-hero-main">
        <div class="eyebrow">${icon('checklist', 14)} Remaining · Arena God</div>
        <h1 class="rm-title">${title}</h1>
        <div class="rm-progress">${bar(p.count, p.total, p.complete ? 'wide gold' : 'wide')}<span class="dim num">${p.count} / ${p.total || '–'} won</span></div>
      </div>
      ${filters}
    </div>${note}`;
}

function classesHtml(summary) {
  return summary.byClass.map((g) => {
    const active = ui.cls === g.cls;
    return `<button class="class-stat ${active ? 'active' : ''} ${g.left ? '' : 'done'}" data-cls="${esc(g.cls)}" aria-pressed="${active}" title="${esc(`${groupName(g.cls)}: ${g.left} left of ${g.total}`)}">
      <span class="class-name">${esc(groupName(g.cls))}</span>
      <span class="class-count num">${g.left ? `${g.left} left` : `${icon('check', 12)} done`}</span>
      ${bar(g.won, g.total)}</button>`;
  }).join('');
}

function completeHtml(p, s) {
  return `<div class="card rm-complete">
    <div class="rm-crown">${icon('crown', 34)}</div>
    <h2>Arena God</h2>
    <p>Every one of the <b class="num">${p.total}</b> champions has a first-place win. Adapt to All Situations — complete.</p>
    ${s.left ? `<p class="sub">${s.left} ${s.left === 1 ? 'champion has' : 'champions have'} no win in your match history — Riot already counts ${s.left === 1 ? 'it' : 'them'}.</p>` : ''}
  </div>`;
}

function resultsHtml(p, s, st) {
  if (!p.known) return `<div class="empty card"><div class="empty-icon">${icon('checklist', 22)}</div><h2>No checklist yet</h2><p class="sub">Run a scan to see which champions you still need.</p></div>`;
  const list = sortRemaining(filterRemaining(s.items, ui), ui.sort);
  $('rm-count').textContent = `${list.length} shown`;
  const complete = p.complete || s.left === 0 ? completeHtml(p, s) : '';
  if (!list.length) {
    if (complete) return complete;
    return `<div class="empty card"><div class="empty-icon">${icon('search', 22)}</div><h2>No champions match</h2><p class="sub">Try another search, or clear a filter.</p>
      <button class="btn ghost" data-action="rm-clear">${icon('x', 14)} Clear filters</button></div>`;
  }
  const order = [...CLASSES, ...s.byClass.map((g) => g.cls).filter((c) => !CLASSES.includes(c))];
  const groups = groupByClass(list, order).map((g) => {
    const cls = s.byClass.find((b) => b.cls === g.cls);
    return `<section class="rm-group" aria-labelledby="rm-g-${esc(g.cls)}">
      <header class="rm-group-head"><h2 id="rm-g-${esc(g.cls)}">${esc(groupName(g.cls))}</h2>
        <span class="rm-group-count num">${cls.left} left</span>
        <span class="rm-group-sub num">${g.items.length !== cls.left ? `${g.items.length} shown · ` : ''}${cls.won} of ${cls.total} won</span></header>
      <div class="champ-grid">${g.items.map((i) => champCard(i.card, { line: closestLine(i.card, i.best) })).join('')}</div>
    </section>`;
  }).join('');
  return complete + groups;
}

function syncControls(left) {
  $('rm-sort').value = ui.sort;
  $('rm-clear').hidden = !filtered();
  document.querySelector('.rm-toolbar').hidden = left === 0;
  if (document.activeElement !== $('rm-search') && $('rm-search').value !== ui.search) $('rm-search').value = ui.search;
}

let built = false;
let last = null;

function bind() {
  const root = $('view-remaining');
  const set = (patch) => { Object.assign(ui, patch); save(); renderRemaining(last); };
  root.addEventListener('click', (e) => {
    const stat = e.target.closest('.rm-stat');
    if (stat?.dataset.kind) return set({ kind: ui.kind === stat.dataset.kind ? '' : stat.dataset.kind });
    if (stat?.dataset.own) return set({ own: ui.own === stat.dataset.own ? '' : stat.dataset.own });
    const cls = e.target.closest('.class-stat');
    if (cls) return set({ cls: ui.cls === cls.dataset.cls ? '' : cls.dataset.cls });
    if (e.target.closest('#rm-clear, [data-action="rm-clear"]')) return set({ kind: '', own: '', cls: '', search: '' });
  });
  $('rm-search').addEventListener('input', (e) => { ui.search = e.target.value; renderRemaining(last); });
  $('rm-sort').addEventListener('change', (e) => set({ sort: e.target.value }));
}

export function renderRemaining(st) {
  const root = $('view-remaining');
  last = st;
  if (!built) { root.innerHTML = layout(); built = true; bind(); }
  const s = st.status;
  const results = $('rm-results');
  if (!s) {
    syncControls(null);
    if (changed(results, 'skel')) { $('rm-head').innerHTML = '<div class="skeleton rm-skel"></div>'; results.innerHTML = cardSkeletons(18); }
    return;
  }
  const p = arenaProgress(s);
  const summary = remainingSummary(s.cards ?? [], st.matches);
  syncControls(p.known ? summary.left : null);
  const head = $('rm-head');
  const headSig = JSON.stringify([p, summary.never, summary.attempted, summary.owned, summary.locked, summary.left, ui.kind, ui.own]);
  if (changed(head, headSig)) head.innerHTML = headHtml(p, summary);
  const classes = $('rm-classes');
  if (changed(classes, JSON.stringify([summary.byClass, ui.cls]))) classes.innerHTML = classesHtml(summary);
  const sig = JSON.stringify([ui, p, s.ddragonVersion, summary.items.map((i) => `${i.card.id}:${i.card.owned}:${i.card.games}:${i.best}:${i.card.masteryLevel}`)]);
  if (changed(results, sig)) results.innerHTML = resultsHtml(p, summary, st);
}
