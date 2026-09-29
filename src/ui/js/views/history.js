import { $, esc, changed, dec } from '../util.js';
import { icon } from '../icons.js';
import { heatmap } from '../charts.js';
import { gameRow } from './dashboard.js';

const ui = { placement: '', range: '', search: '', limit: 120 };
const DAY = 24 * 3600_000;

function filters() {
  return `<div class="page-head"><div><div class="eyebrow">${icon('history', 14)} Match history</div><h1 class="page-title" id="hi-title">Arena games</h1></div></div>
    <section class="card heat-card"><header class="card-head"><div><h2>${icon('calendar', 16)} Activity</h2><p class="sub" id="hi-heat-sub"></p></div>
      <div class="heat-legend"><span>Less</span><i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i><span>More</span><i class="hm l2 win"></i><span>new win</span></div></header>
      <div id="hi-heat" class="heat-wrap"></div></section>
    <div class="toolbar card">
      <label class="search-field">${icon('search', 16)}<input id="hi-search" type="search" placeholder="Filter by champion…" aria-label="Filter by champion"></label>
      <select id="hi-place" aria-label="Placement"><option value="">Any placement</option><option value="1">1st only</option><option value="top4">Top 4</option><option value="bottom4">Bottom 4</option><option value="8">8th only</option><option value="first">First wins</option></select>
      <select id="hi-range" aria-label="Date range"><option value="">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <span class="toolbar-spacer"></span><span id="hi-count" class="dim num"></span>
    </div>
    <div id="hi-list"></div>`;
}

let built = false;
let last = null;

function matchesFilter(m) {
  if (ui.search && !m.championName.toLowerCase().includes(ui.search.toLowerCase())) return false;
  if (ui.range && m.gameEnd < Date.now() - Number(ui.range) * DAY) return false;
  switch (ui.placement) {
    case '1': return m.placement === 1;
    case '8': return m.placement === 8;
    case 'top4': return m.placement !== null && m.placement <= 4;
    case 'bottom4': return m.placement !== null && m.placement >= 5;
    case 'first': return m.firstWin;
    default: return true;
  }
}

export function renderHistory(st) {
  const root = $('view-history');
  last = st;
  if (!built) {
    root.innerHTML = filters();
    built = true;
    const rerender = () => { ui.limit = 120; renderHistory(last); };
    $('hi-search').addEventListener('input', (e) => { ui.search = e.target.value; rerender(); });
    $('hi-place').addEventListener('change', (e) => { ui.placement = e.target.value; rerender(); });
    $('hi-range').addEventListener('change', (e) => { ui.range = e.target.value; rerender(); });
    root.addEventListener('click', (e) => {
      if (e.target.closest('#hi-more')) { ui.limit += 200; renderHistory(last); }
    });
  }
  const matches = st.matches;
  const heat = $('hi-heat');
  if (changed(heat, `${matches?.length}|${matches?.[0]?.id}|${new Date().toDateString()}`)) {
    heat.innerHTML = matches ? heatmap(matches) : '<div class="skeleton heat-skel"></div>';
    const recent = (matches ?? []).filter((m) => m.gameEnd >= Date.now() - 365 * DAY);
    const days = new Set(recent.map((m) => new Date(m.gameEnd).toDateString())).size;
    $('hi-heat-sub').textContent = matches ? `${recent.length} games on ${days} days in the last year` : '';
  }
  const list = $('hi-list');
  if (!matches) { if (changed(list, 'skel')) list.innerHTML = `<div class="card skeleton tall"></div>`; return; }
  const rows = matches.filter(matchesFilter);
  $('hi-count').textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'game' : 'games'}`;
  $('hi-title').textContent = `${matches.length.toLocaleString()} Arena games`;
  const sig = JSON.stringify([ui, rows.length, rows[0]?.id, st.status?.ddragonVersion, new Date().toDateString()]);
  if (!changed(list, sig)) return;
  if (!rows.length) {
    list.innerHTML = `<div class="empty card"><div class="empty-icon">${icon('history', 22)}</div><h2>No games match</h2><p class="sub">${matches.length ? 'Try a wider date range or another placement.' : 'Scanned Arena games show up here.'}</p></div>`;
    return;
  }
  const groups = [];
  for (const m of rows.slice(0, ui.limit)) {
    const key = new Date(m.gameEnd).toDateString();
    if (groups.at(-1)?.key !== key) groups.push({ key, day: m.gameEnd, games: [] });
    groups.at(-1).games.push(m);
  }
  const dayLabel = (ms) => {
    const d = new Date(ms).toDateString();
    if (d === new Date().toDateString()) return 'Today';
    if (d === new Date(Date.now() - DAY).toDateString()) return 'Yesterday';
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  list.innerHTML = groups.map((g) => {
    const placed = g.games.filter((m) => m.placement);
    const avg = placed.length ? placed.reduce((a, m) => a + m.placement, 0) / placed.length : null;
    const wins = g.games.filter((m) => m.placement === 1).length;
    const firsts = g.games.filter((m) => m.firstWin).length;
    return `<section class="day card">
      <header class="day-head"><h3>${esc(dayLabel(g.day))}</h3><span class="day-summary num">${g.games.length} ${g.games.length === 1 ? 'game' : 'games'} · avg ${dec(avg)} · ${wins} ${wins === 1 ? 'win' : 'wins'}${firsts ? ` · <span class="cyan">${firsts} new</span>` : ''}</span></header>
      <div class="game-list">${g.games.map(gameRow).join('')}</div>
    </section>`;
  }).join('') + (rows.length > ui.limit ? `<button id="hi-more" class="btn ghost more-btn">Show more (${(rows.length - ui.limit).toLocaleString()} left)</button>` : '');
}
