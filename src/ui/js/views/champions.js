import { $, esc, changed, art, chip, statusOf, CLASSES, plural, relSpan, num, dec, pct } from '../util.js';
import { icon } from '../icons.js';
import { bar } from '../charts.js';
import { refresh, postJson } from '../store.js';

const KEY = 'ac.champions';
const defaults = { filter: 'needed', owned: false, cls: '', played: '', sort: 'name', dir: 1, layout: 'grid' };
export const ui = { ...defaults, search: '' };
try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}'), { search: '' }); } catch { /* defaults */ }
const save = () => { try { const { search, ...rest } = ui; void search; localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* per-viewer convenience only */ } };

const SORTS = [
  ['name', 'Name'], ['games', 'Games'], ['wins', 'Wins'], ['winrate', 'Win rate'],
  ['avg', 'Avg place'], ['last', 'Last played'], ['mastery', 'Mastery'],
];

function sortValue(c, key) {
  switch (key) {
    case 'games': return c.games;
    case 'wins': return c.wins;
    case 'winrate': return c.games ? c.wins / c.games : -1;
    case 'avg': return c.avgPlacement ?? 99;
    case 'last': return c.last || 0;
    case 'mastery': return c.masteryPoints || 0;
    default: return c.name.toLowerCase();
  }
}

export function filteredCards(cards) {
  const q = ui.search.trim().toLowerCase();
  let list = cards.filter((c) => {
    if (ui.filter === 'needed' && c.won) return false;
    if (ui.filter === 'won' && !c.won) return false;
    if (ui.filter === 'manual' && !c.manual) return false;
    if (ui.owned && c.owned === false) return false;
    if (ui.cls && !(c.tags ?? []).includes(ui.cls)) return false;
    if (ui.played === 'played' && !c.games) return false;
    if (ui.played === 'never' && c.games) return false;
    if (q && !c.name.toLowerCase().includes(q) && !(c.title ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
  // Numbers read best largest-first; "avg place" and names smallest-first.
  const natural = ui.sort === 'name' || ui.sort === 'avg' ? 1 : -1;
  list = [...list].sort((a, b) => {
    const va = sortValue(a, ui.sort), vb = sortValue(b, ui.sort);
    const order = va < vb ? -1 : va > vb ? 1 : 0;
    return order * natural * ui.dir || a.name.localeCompare(b.name);
  });
  return list;
}

function toolbar() {
  const pill = (group, value, label) => `<button class="pill-btn" data-group="${group}" data-value="${value}">${label}</button>`;
  return `<div class="champ-header">
      <div><div class="eyebrow">${icon('swords', 14)} Champions</div><h1 class="page-title"><span class="num" id="ch-won">–</span> <span class="dim">/ <span class="num" id="ch-total">–</span> won</span></h1></div>
      <div id="ch-classes" class="class-progress"></div>
    </div>
    <div class="toolbar card">
      <label class="search-field">${icon('search', 16)}<input id="ch-search" type="search" placeholder="Search champions…" aria-label="Search champions"><kbd>/</kbd></label>
      <div class="pill-group" role="group" aria-label="Status">${pill('filter', 'needed', 'Needed')}${pill('filter', 'all', 'All')}${pill('filter', 'won', 'Won')}${pill('filter', 'manual', 'Manual')}</div>
      <div class="pill-group" role="group" aria-label="Class">${pill('cls', '', 'All classes')}${CLASSES.map((c) => pill('cls', c, plural(c))).join('')}</div>
      <div class="toolbar-row">
        <button class="toggle-pill" id="ch-owned" aria-pressed="false">${icon('lock', 14)} Owned only</button>
        <select id="ch-played" aria-label="Played"><option value="">Played or not</option><option value="played">Played</option><option value="never">Never played</option></select>
        <select id="ch-sort" aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <button class="icon-btn" id="ch-dir" title="Reverse order" aria-label="Reverse order">${icon('arrowUpDown', 16)}</button>
        <span class="toolbar-spacer"></span>
        <span id="ch-count" class="dim num"></span>
        <div class="seg" role="group" aria-label="Layout"><button id="ch-grid" aria-label="Grid view" title="Grid view">${icon('grid', 16)}</button><button id="ch-list" aria-label="List view" title="List view">${icon('list', 16)}</button></div>
        <button class="btn ghost" id="ch-rescan">${icon('refresh', 15)} Update scan</button>
      </div>
    </div>
    <div id="ch-results"></div>`;
}

function syncControls() {
  document.querySelectorAll('#view-champions .pill-btn').forEach((b) => {
    const active = String(ui[b.dataset.group] ?? '') === b.dataset.value;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  $('ch-owned').setAttribute('aria-pressed', String(ui.owned));
  $('ch-played').value = ui.played;
  $('ch-sort').value = ui.sort;
  $('ch-grid').classList.toggle('active', ui.layout === 'grid');
  $('ch-list').classList.toggle('active', ui.layout === 'list');
}

function bind(rerender) {
  const set = (patch) => { Object.assign(ui, patch); save(); syncControls(); rerender(); };
  document.querySelectorAll('#view-champions .pill-btn').forEach((b) => b.addEventListener('click', () => set({ [b.dataset.group]: b.dataset.value })));
  $('ch-search').addEventListener('input', (e) => { ui.search = e.target.value; rerender(); });
  $('ch-owned').addEventListener('click', () => set({ owned: !ui.owned }));
  $('ch-played').addEventListener('change', (e) => set({ played: e.target.value }));
  $('ch-sort').addEventListener('change', (e) => set({ sort: e.target.value, dir: 1 }));
  $('ch-dir').addEventListener('click', () => set({ dir: -ui.dir }));
  $('ch-grid').addEventListener('click', () => set({ layout: 'grid' }));
  $('ch-list').addEventListener('click', () => set({ layout: 'list' }));
  $('ch-rescan').addEventListener('click', () => rescan($('ch-rescan')));
}

export async function rescan(btn, full = false) {
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try {
    const r = await postJson('/api/rescan', { full });
    if (!r?.ok) window.dispatchEvent(new CustomEvent('ac-toast', { detail: { kind: 'error', text: `Scan failed: ${r?.error ?? 'unknown error'}` } }));
    else window.dispatchEvent(new CustomEvent('ac-toast', { detail: { kind: 'ok', text: full ? 'Full rescan complete.' : 'Scan complete.' } }));
  } catch (err) {
    window.dispatchEvent(new CustomEvent('ac-toast', { detail: { kind: 'error', text: `Scan failed: ${err.message}` } }));
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    await refresh({ force: true });
  }
}

function tileHtml(c) {
  const st = statusOf(c);
  return `<a class="champ-tile ${st} ${c.owned === false ? 'unowned' : ''}" href="#/champion/${encodeURIComponent(c.id)}" title="${esc(c.name)} · ${c.games} games · ${c.wins} wins">
    ${art(c, 'tile', 'tile-art')}
    <span class="ctile-badge ${st}">${icon(st === 'won' ? 'check' : st === 'manual' ? 'pencil' : 'x', 12)}</span>
    ${c.owned === false ? `<span class="ctile-lock">${icon('lock', 13)}</span>` : ''}
    ${c.masteryLevel ? `<span class="ctile-mastery num">M${c.masteryLevel}</span>` : ''}
    <span class="ctile-name">${esc(c.name)}</span>
    <span class="ctile-sub num">${c.games}g · ${c.wins}w${c.avgPlacement ? ` · ${dec(c.avgPlacement)}` : ''}</span>
  </a>`;
}

function tableHtml(list) {
  const th = (key, label, cls = '') => `<th class="${cls}"><button data-sort="${key}" class="${ui.sort === key ? 'sorted' : ''}">${label}${ui.sort === key ? icon(ui.dir === 1 ? 'chevronRight' : 'chevronLeft', 12, 'sort-ico') : ''}</button></th>`;
  return `<div class="table-wrap card"><table class="champ-table">
    <thead><tr>${th('name', 'Champion')}<th>Status</th>${th('games', 'Games', 'r')}${th('wins', 'Wins', 'r')}${th('winrate', 'Win rate', 'r')}${th('avg', 'Avg place', 'r')}${th('last', 'Last played', 'r')}${th('mastery', 'Mastery', 'r')}</tr></thead>
    <tbody>${list.map((c) => `<tr class="${c.owned === false ? 'unowned' : ''}" data-id="${esc(c.id)}" tabindex="0">
      <td><span class="cell-champ">${art(c, 'tile', 'row-art')}<span><b>${esc(c.name)}</b><small>${esc((c.tags ?? []).join(' · '))}</small></span>${c.owned === false ? icon('lock', 13, 'dim') : ''}</span></td>
      <td>${chip(statusOf(c), icon)}</td>
      <td class="r num">${c.games}</td><td class="r num">${c.wins}</td>
      <td class="r num">${c.games ? pct((c.wins / c.games) * 100) : '–'}</td>
      <td class="r num">${dec(c.avgPlacement)}</td>
      <td class="r">${c.last ? relSpan(c.last) : "—"}</td>
      <td class="r num">${c.masteryLevel ? `M${c.masteryLevel} · ${num(Math.round((c.masteryPoints || 0) / 1000))}k` : '—'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

let built = false;
let lastState = null;

export function renderChampions(st) {
  const root = $('view-champions');
  lastState = st;
  if (!built) {
    root.innerHTML = toolbar();
    built = true;
    bind(() => renderChampions(lastState));
    syncControls();
    root.addEventListener('click', (e) => {
      const sortBtn = e.target.closest('button[data-sort]');
      if (sortBtn) {
        const key = sortBtn.dataset.sort;
        Object.assign(ui, key === ui.sort ? { dir: -ui.dir } : { sort: key, dir: 1 });
        save(); syncControls(); renderChampions(lastState);
        return;
      }
      const row = e.target.closest('tr[data-id]');
      if (row) location.hash = `#/champion/${encodeURIComponent(row.dataset.id)}`;
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest?.('tr[data-id]');
      if (row && e.key === 'Enter') location.hash = `#/champion/${encodeURIComponent(row.dataset.id)}`;
    });
  }
  const cards = st.status?.cards ?? [];
  const cl = st.status?.checklist;
  $('ch-won').textContent = cl ? String(cl.wonCount) : '–';
  $('ch-total').textContent = cl ? String(cl.total) : '–';
  const classes = $('ch-classes');
  const classSig = cards.map((c) => `${c.id}${c.won ? 1 : 0}`).join();
  if (changed(classes, classSig) && cards.length) {
    classes.innerHTML = CLASSES.map((cls) => {
      const inClass = cards.filter((c) => (c.tags ?? []).includes(cls));
      const won = inClass.filter((c) => c.won).length;
      return `<button class="class-stat ${ui.cls === cls ? 'active' : ''}" data-cls="${cls}" title="Show ${plural(cls)}"><span class="class-name">${plural(cls)}</span><span class="class-count num">${won}/${inClass.length}</span>${bar(won, inClass.length)}</button>`;
    }).join('');
    classes.querySelectorAll('.class-stat').forEach((b) => b.addEventListener('click', () => {
      ui.cls = ui.cls === b.dataset.cls ? '' : b.dataset.cls; save(); syncControls(); classes.dataset.sig = ''; renderChampions(lastState);
    }));
  }
  classes.querySelectorAll('.class-stat').forEach((b) => b.classList.toggle('active', ui.cls === b.dataset.cls));

  const results = $('ch-results');
  if (!st.status) { if (changed(results, 'skel')) results.innerHTML = `<div class="champ-grid">${'<div class="champ-tile skeleton"></div>'.repeat(24)}</div>`; return; }
  const list = filteredCards(cards);
  $('ch-count').textContent = `${list.length} shown`;
  const sig = JSON.stringify([ui, st.status.ddragonVersion, list.map((c) => `${c.id}:${c.won}:${c.manual}:${c.owned}:${c.games}:${c.wins}:${c.masteryLevel}:${c.avgPlacement}`)]);
  if (!changed(results, sig)) return;
  if (!list.length) {
    results.innerHTML = `<div class="empty card"><div class="empty-icon">${icon('search', 22)}</div><h2>No champions match</h2><p class="sub">${cards.length ? 'Try another search or clear a filter.' : 'Run a scan to build your checklist.'}</p></div>`;
    return;
  }
  results.innerHTML = ui.layout === 'list' ? tableHtml(list) : `<div class="champ-grid">${list.map(tileHtml).join('')}</div>`;
}

export function focusChampionSearch() {
  location.hash = '#/champions';
  setTimeout(() => $('ch-search')?.focus(), 0);
}
