/* Arena Companion UI: routing, shell chrome, shortcuts. Views live in ./views. */
import { state, onChange, refresh, postJson } from './store.js';
import { $, esc, art, cardByName, installImageHandlers, relTime, statusOf, reducedMotion } from './util.js';
import { icon } from './icons.js';
import { renderDashboard } from './views/dashboard.js';
import { renderChampions, focusChampionSearch, rescan } from './views/champions.js';
import { renderChampion } from './views/champion.js';
import { renderHistory } from './views/history.js';
import { renderChampSelect, toggleMini } from './views/champselect.js';
import { renderSettings, togglePreview } from './views/settings.js';
import { initPalette, openPalette, closePalette } from './palette.js';
import { renderLiveBar } from './livebar.js';

const VIEWS = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  champions: { title: 'Champions', render: renderChampions },
  champion: { title: 'Champion', render: renderChampion, parent: 'champions' },
  history: { title: 'Match History', render: renderHistory },
  champselect: { title: 'Champ Select', render: renderChampSelect },
  settings: { title: 'Settings', render: renderSettings },
};
const NAV_ORDER = ['dashboard', 'champions', 'history', 'champselect', 'settings'];

function route() {
  const [view, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return VIEWS[view] ? { view, param: decodeURIComponent(rest.join('/')) } : { view: 'dashboard', param: '' };
}

let current = route();

function renderView() {
  const { view, param } = current;
  VIEWS[view].render(state, param);
}

function renderChrome() {
  const s = state.status;
  const { view, param } = current;
  const meta = VIEWS[view];
  const card = view === 'champion' ? state.status?.cards?.find((c) => c.id === param) : null;
  $('page-title').innerHTML = meta.parent
    ? `<a href="#/${meta.parent}">${VIEWS[meta.parent].title}</a>${icon('chevronRight', 14, 'crumb-sep')}<span>${esc(card?.name ?? param)}</span>`
    : esc(meta.title);
  document.title = `${card?.name ?? meta.title} · Arena Companion`;
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.view === (meta.parent ?? view)));

  const pill = $('lcu-pill');
  const phase = s?.gameflowPhase ?? '';
  const live = s?.champSelect?.available || ['InProgress', 'GameStart', 'Reconnect'].includes(phase);
  pill.className = `pill ${!state.reachable ? 'bad' : s?.lcuConnected ? (live ? 'live' : 'ok') : 'off'}`;
  const phaseText = { None: 'Idle', Lobby: 'In lobby', Matchmaking: 'In queue', ReadyCheck: 'Ready check', ChampSelect: 'Champ select', GameStart: 'Loading', InProgress: 'In game', WaitingForStats: 'Post-game', PreEndOfGame: 'Post-game', EndOfGame: 'Post-game', Reconnect: 'Reconnect' }[phase];
  $('lcu-text').textContent = !state.reachable ? 'Backend offline' : !s ? 'Connecting…' : s.lcuConnected ? (phaseText ?? phase) : 'Client offline';

  const sync = $('sync-text');
  sync.textContent = s?.scanning ? 'Scanning…' : s?.lastSync ? `Synced ${relTime(Date.parse(s.lastSync))}` : 'Not synced';
  $('sync-pill').classList.toggle('stale', Boolean(s?.stale));
  $('sync-pill').title = s?.lastSync ? `Last sync ${new Date(s.lastSync).toLocaleString()}${s.stale ? ' — older than a day' : ''}` : 'No scan yet';
  $('sync-btn').classList.toggle('spinning', Boolean(s?.scanning));

  const who = s?.summoner?.gameName ? `${s.summoner.gameName}#${s.summoner.tagLine}` : s?.player?.split(':')[1] ?? 'No player';
  $('profile-name').textContent = who;
  $('profile-sub').textContent = `${s?.region?.label ?? '—'} · ${s?.lcuConnected ? 'online' : 'offline'}`;
  $('profile-dot').className = `status-dot ${s?.lcuConnected ? 'on' : ''}`;
  $('profile-avatar').textContent = (s?.summoner?.gameName ?? '?').slice(0, 1).toUpperCase();
  $('fixture-badge').hidden = !s?.fixture;
}

function renderAll() {
  renderChrome();
  renderView();
  renderLiveBar(state);
  handleEvent();
}

function showRoute() {
  current = route();
  NAV_ORDER.concat('champion').forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== current.view));
  if (current.view !== 'champselect' && document.body.classList.contains('mini')) toggleMini(false);
  $('content').scrollTop = 0;
  renderAll();
}

/* ---------- toasts & the first-win celebration ---------- */
let toastTimer = null;
function toast(text, kind = 'ok', ms = 3500) {
  const el = $('toast');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'info' : kind === 'win' ? 'sparkles' : 'check', 16)}<span>${esc(text)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
window.addEventListener('ac-toast', (e) => toast(e.detail.text, e.detail.kind, e.detail.kind === 'error' ? 8000 : 3500));
window.addEventListener('ac-render', () => renderAll());

const pageLoadedAt = Date.now();
let lastEventAt = null;
function handleEvent() {
  const ev = state.status?.lastEvent;
  if (!ev || ev.at === lastEventAt) return;
  lastEventAt = ev.at;
  // Events from before this page loaded were already celebrated (or missed long ago).
  if (Date.parse(ev.at) < pageLoadedAt - 60_000) return;
  if (ev.type === 'new-win') celebrate(ev);
  else toast('Checklist updated after your game.', 'ok');
}

function celebrate(ev) {
  const card = cardByName(ev.champion);
  const el = $('celebrate');
  const confetti = reducedMotion() ? '' : Array.from({ length: 26 }, (_, i) => `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--c:${['var(--cyan)', 'var(--blue-bright)', 'var(--gold)', 'var(--won)'][i % 4]}"></i>`).join('');
  el.innerHTML = `<div class="confetti">${confetti}</div><div class="celebrate-card">
    ${card ? art(card, 'splash', 'celebrate-art') : ''}
    <div class="celebrate-body"><div class="eyebrow">${icon('sparkles', 14)} First Arena win</div><h2>${esc(ev.champion ?? 'New champion')}</h2>
    <p class="num">${ev.wonCount} / ${state.status?.checklist?.total ?? '–'} champions won</p><button class="btn primary" id="celebrate-ok">Nice</button></div></div>`;
  el.hidden = false;
  const close = () => { el.hidden = true; el.innerHTML = ''; };
  $('celebrate-ok').addEventListener('click', close);
  setTimeout(close, 9000);
}

/* ---------- commands & shortcuts ---------- */
function exportCsv() {
  const cards = state.status?.cards ?? [];
  if (!cards.length) { toast('Nothing to export yet — run a scan first.', 'error'); return; }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Champion', 'Status', 'Owned', 'Classes', 'Arena games', 'Wins', 'Avg placement', 'Top 4', 'First win', 'Mastery level', 'Mastery points']]
    .concat(cards.map((c) => [c.name, statusOf(c), c.owned === false ? 'no' : 'yes', (c.tags ?? []).join('/'), c.games, c.wins, c.avgPlacement ?? '', c.top4 ?? '', c.firstWinAt ? new Date(c.firstWinAt).toISOString().slice(0, 10) : '', c.masteryLevel, c.masteryPoints]));
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arena-checklist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function toggleRail() {
  const collapsed = document.body.classList.toggle('rail-collapsed');
  try { localStorage.setItem('ac.rail', collapsed ? 'collapsed' : 'open'); } catch { /* convenience only */ }
}

async function toggleOnTop() {
  const next = !state.status?.config?.alwaysOnTop;
  try { await postJson('/api/config', { alwaysOnTop: next }); toast(next ? 'Always on top.' : 'No longer on top.'); }
  catch (err) { toast(`Not saved: ${err.message}`, 'error'); }
  await refresh({ force: true });
}

function shortcutsSheet(show = true) {
  $('shortcuts').hidden = !show;
  document.body.classList.toggle('modal-open', show);
}

function commands() {
  const go = (view, label, keys, iconName) => ({ kind: 'Go to', label, keys, icon: iconName, run: () => { location.hash = `#/${view}`; } });
  return [
    go('dashboard', 'Dashboard', '1', 'dashboard'), go('champions', 'Champions', '2', 'swords'), go('history', 'Match history', '3', 'history'),
    go('champselect', 'Champ select', '4', 'target'), go('settings', 'Settings', '5', 'settings'),
    { kind: 'Command', label: 'Update scan', icon: 'refresh', run: () => rescan($('sync-btn')) },
    { kind: 'Command', label: 'Full rescan', hint: 'Rebuild from all match history', icon: 'refresh', run: () => { toast('Full rescan started — this can take several minutes…'); void rescan($('sync-btn'), true); } },
    { kind: 'Command', label: 'Search champions', keys: '/', icon: 'search', run: focusChampionSearch },
    { kind: 'Command', label: 'Toggle mini mode', icon: 'minimize', run: () => { location.hash = '#/champselect'; setTimeout(() => toggleMini(), 0); } },
    { kind: 'Command', label: 'Toggle always on top', icon: 'pin', run: toggleOnTop },
    { kind: 'Command', label: state.status?.overlayPreview ? 'Hide overlay preview' : 'Show overlay preview', hint: 'Position the Crowd Favorites panel', icon: 'eye', run: togglePreview },
    { kind: 'Command', label: 'Export checklist (CSV)', icon: 'download', run: exportCsv },
    { kind: 'Command', label: 'Toggle sidebar', keys: '[', icon: 'panel', run: toggleRail },
    { kind: 'Command', label: 'Keyboard shortcuts', keys: '?', icon: 'keyboard', run: () => shortcutsSheet(true) },
  ];
}

const typing = (el) => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') {
    if (!$('shortcuts').hidden) { shortcutsSheet(false); return; }
    if (!$('celebrate').hidden) { $('celebrate').hidden = true; return; }
    if (document.body.classList.contains('mini')) { toggleMini(false); return; }
  }
  if (mod || e.altKey || typing(e.target) || !$('palette').hidden) return;
  if (e.key >= '1' && e.key <= '5') { location.hash = `#/${NAV_ORDER[Number(e.key) - 1]}`; e.preventDefault(); }
  else if (e.key === '/') { e.preventDefault(); focusChampionSearch(); }
  else if (e.key === '?') { e.preventDefault(); shortcutsSheet($('shortcuts').hidden); }
  else if (e.key === '[') { e.preventDefault(); toggleRail(); }
});

/* ---------- boot ---------- */
function boot() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18); });
  installImageHandlers();
  try {
    const saved = localStorage.getItem('ac.rail');
    if (saved === 'collapsed' || (!saved && window.innerWidth < 1100)) document.body.classList.add('rail-collapsed');
  } catch { /* default open */ }
  $('rail-toggle').addEventListener('click', toggleRail);
  $('open-palette').addEventListener('click', () => openPalette());
  $('sync-btn').addEventListener('click', () => rescan($('sync-btn')));
  $('shortcuts').addEventListener('mousedown', (e) => { if (e.target === $('shortcuts')) shortcutsSheet(false); });
  $('shortcuts-close').addEventListener('click', () => shortcutsSheet(false));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="shortcuts"]')) shortcutsSheet(true); });
  initPalette(commands);
  window.addEventListener('hashchange', showRoute);
  onChange(renderAll);
  showRoute();
  refresh();
  setInterval(() => refresh(), 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  // Relative times ("Synced 2m ago") age even when nothing else changes.
  setInterval(() => {
    renderChrome();
    document.querySelectorAll('[data-rel]').forEach((el) => { el.textContent = relTime(Number(el.dataset.rel)); });
  }, 30_000);
}

boot();
