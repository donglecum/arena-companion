/* Arena Companion UI: routing, shell chrome, shortcuts. Views live in ./views. */
import { state, onChange, refresh, postJson } from './store.js';
import { $, esc, art, cardById, cardByName, installImageHandlers, relTime, statusOf, ordinal, tierOf } from './util.js';
import { icon } from './icons.js';
import { NAV, CHILD_VIEWS, parseRoute, viewForKey, viewMeta, activeNavView, showLiveNav } from './nav.js';
import { arenaProgress, postGameProgress, postGameResult } from './progress.js';
import { renderDashboard } from './views/dashboard.js';
import { renderRemaining } from './views/remaining.js';
import { renderChampions, focusChampionSearch, rescan } from './views/champions.js';
import { renderChampion } from './views/champion.js';
import { renderHistory } from './views/history.js';
import { renderChampSelect, toggleMini } from './views/champselect.js';
import { renderSettings, togglePreview, SAMPLE_SCENARIOS, loadScenario } from './views/settings.js';
import { initPalette, openPalette, closePalette } from './palette.js';
import { renderLiveBar } from './livebar.js';

const RENDER = {
  dashboard: renderDashboard,
  remaining: renderRemaining,
  champions: renderChampions,
  champion: renderChampion,
  history: renderHistory,
  champselect: renderChampSelect,
  settings: renderSettings,
};
const ALL_VIEWS = [...NAV.map((n) => n.view), ...Object.keys(CHILD_VIEWS)];

let current = parseRoute(location.hash);

function renderView() {
  const { view, param } = current;
  RENDER[view](state, param);
}

function renderChrome() {
  const s = state.status;
  const { view, param } = current;
  const meta = viewMeta(view);
  const card = view === 'champion' ? state.status?.cards?.find((c) => c.id === param) : null;
  $('page-title').innerHTML = meta.parent
    ? `<a href="#/${meta.parent}">${esc(viewMeta(meta.parent).title)}</a>${icon('chevronRight', 14, 'crumb-sep')}<span>${esc(card?.name ?? param)}</span>`
    : esc(meta.title);
  document.title = `${card?.name ?? meta.title} · Arena Companion`;
  const active = activeNavView(view);
  document.querySelectorAll('.nav-item').forEach((a) => {
    const on = a.dataset.view === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Champ Select is transient: in the sidebar while League is in champ select (or while open).
  document.querySelector('.nav-live').hidden = !showLiveNav(s?.champSelect?.available, view);
  const p = arenaProgress(s);
  $('nav-remaining').textContent = p.known && !p.complete ? String(p.remaining) : '';

  const pill = $('lcu-pill');
  const phase = s?.gameflowPhase ?? '';
  const live = s?.champSelect?.available || ['InProgress', 'GameStart', 'Reconnect'].includes(phase);
  pill.className = `pill ${!state.reachable ? 'bad' : s?.lcuConnected ? (live ? 'live' : 'ok') : 'off'}`;
  const phaseText = { None: 'Idle', Lobby: 'In lobby', Matchmaking: 'In queue', ReadyCheck: 'Ready check', ChampSelect: 'Champ select', GameStart: 'Loading', InProgress: 'In game', WaitingForStats: 'Post-game', PreEndOfGame: 'Post-game', EndOfGame: 'Post-game', Reconnect: 'Reconnect' }[phase];
  $('lcu-text').textContent = !state.reachable ? 'Backend offline' : !s ? 'Connecting…' : s.lcuConnected ? (phaseText ?? phase) : 'Client offline';

  const sync = $('sync-text');
  sync.textContent = s?.scanning ? 'Scanning…' : s?.lastSync ? `Synced ${relTime(Date.parse(s.lastSync))}` : 'Not synced';
  $('sync-pill').classList.toggle('stale', Boolean(s?.stale));
  $('sync-pill').title = s?.lastSync ? `Last sync ${new Date(s.lastSync).toLocaleString()}${s.stale ? ' (older than a day)' : ''}` : 'No scan yet';
  $('sync-btn').classList.toggle('spinning', Boolean(s?.scanning));

  const who = s?.summoner?.gameName ? `${s.summoner.gameName}#${s.summoner.tagLine}` : s?.player?.split(':')[1] ?? 'No player';
  $('profile-name').textContent = who;
  $('profile-sub').textContent = `${s?.region?.label ?? '—'} · ${s?.lcuConnected ? 'online' : 'offline'}`;
  $('profile-dot').className = `status-dot ${s?.lcuConnected ? 'on' : ''}`;
  $('profile-avatar').textContent = (s?.summoner?.gameName ?? '?').slice(0, 1).toUpperCase();
  $('fixture-badge').hidden = !s?.fixture;
  renderUpdateNote(s?.update);
}

/** Sidebar note while an update downloads or waits to install (the updater itself is silent). */
function renderUpdateNote(update) {
  const el = $('update-note');
  const text = updateText(update);
  if (!text) { el.hidden = true; el.dataset.sig = ''; return; }
  const sig = JSON.stringify(update);
  el.hidden = false;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.className = `update-note ${update.state}`;
  el.title = `${text.title}: ${text.sub}`;
  el.innerHTML = `<span class="update-icon">${icon(update.state === 'downloading' ? 'download' : update.state === 'ready' ? 'check' : 'refresh', 16, update.state === 'restarting' ? 'spin' : '')}</span>
    <span class="update-text"><b>${esc(text.title)}</b><small>${esc(text.sub)}</small>
    ${update.state === 'downloading' ? `<span class="bar"><span class="bar-fill" style="width:${update.percent ?? 0}%"></span></span>` : ''}</span>`;
}

export function updateText(update) {
  if (!update?.version) return null;
  if (update.state === 'downloading') return { title: `Downloading v${update.version}`, sub: `${update.percent ?? 0}% · installs automatically` };
  if (update.state === 'ready') return { title: `Update v${update.version} ready`, sub: 'Restarts once you’re out of champ select and games' };
  if (update.state === 'restarting') return { title: `Installing v${update.version}`, sub: 'Restarting now…' };
  return null;
}

function renderAll() {
  renderChrome();
  renderView();
  renderLiveBar(state);
  handleEvent();
  refreshCelebration();
}

function showRoute() {
  current = parseRoute(location.hash);
  ALL_VIEWS.forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== current.view));
  if (current.view !== 'champselect' && document.body.classList.contains('mini')) toggleMini(false);
  $('content').scrollTop = 0;
  renderAll();
}

/* ---------- toasts ---------- */
let toastTimer = null;
function toast(text, kind = 'ok', ms = 3500) {
  const el = $('toast');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'info' : 'check', 16)}<span>${esc(text)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
window.addEventListener('ac-toast', (e) => toast(e.detail.text, e.detail.kind, e.detail.kind === 'error' ? 8000 : 3500));
window.addEventListener('ac-render', () => renderAll());

/* ---------- post-game: the first-win celebration and the quieter result card ----------
   A game usually ends with this window hidden in the tray. The app never raises
   itself; the event waits until the window is next visible (the Windows
   notification for a first win opens it), and goes stale after 20 minutes. */
const pageLoadedAt = Date.now();
const POST_GAME_FRESH_MS = 20 * 60_000;
let lastEventAt = null;
let queuedEvent = null;

function handleEvent() {
  const ev = state.status?.lastEvent;
  if (!ev || ev.at === lastEventAt) return;
  lastEventAt = ev.at;
  // Events from before this page loaded were already shown (or missed long ago).
  if (Date.parse(ev.at) < pageLoadedAt - 60_000) return;
  // Still waiting for Riot's match record: the live bar says so; the card comes with the record.
  if (ev.pending) return;
  queuedEvent = ev;
  presentEvent();
}

function presentEvent() {
  if (!queuedEvent || document.hidden) return;
  const ev = queuedEvent;
  queuedEvent = null;
  if (Date.now() - Date.parse(ev.at) > POST_GAME_FRESH_MS) return;
  if (ev.type === 'new-win') celebrate(ev);
  else if (ev.game) showResult(ev);
  else toast('Checklist updated after your game.', 'ok');
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) presentEvent(); });

let celebrating = null;
let celebrateTimer = null;
let celebrateFocus = null;

function celebrationProgress(ev) {
  const s = state.status;
  const p = postGameProgress(ev, s);
  const total = s?.checklist?.total ?? ev.total ?? 0;
  const remaining = p?.remaining ?? arenaProgress(s).remaining;
  const step = p && p.after !== null
    ? `<div class="cel-label">Arena God +${p.gained}</div>
       <div class="cel-count num"><span class="cel-from">${p.before}</span>${icon('arrowRight', 18, 'cel-arrow')}<b class="cel-to">${p.after}</b></div>`
    // Riot counts older wins match history cannot place, so this may be one it already had.
    : `<div class="cel-label">Arena God</div>
       <div class="cel-count num"><b class="cel-to plain">${arenaProgress(s).count}</b><span class="cel-of">of ${total || '–'}</span></div>`;
  const left = remaining === 0 && total
    ? '<div class="cel-left done">Every champion won. Arena God.</div>'
    : `<div class="cel-left"><b class="num">${remaining}</b> ${remaining === 1 ? 'champion' : 'champions'} left</div>`;
  return step + left;
}

function celebrate(ev) {
  closeResult();
  const card = cardByName(ev.champion) ?? (ev.game ? cardById(ev.game.championId) : null);
  const name = card?.name ?? ev.champion ?? 'New champion';
  const others = (ev.newChampions ?? []).filter((n) => n !== ev.champion);
  const el = $('celebrate');
  celebrating = ev;
  celebrateFocus = document.activeElement;
  el.innerHTML = `<div class="celebrate-card" role="dialog" aria-modal="true" aria-labelledby="cel-name" aria-describedby="cel-progress">
    <div class="cel-art">${card ? art(card, 'splash') : ''}</div>
    <div class="celebrate-body">
      <div class="cel-eyebrow">First win</div>
      <h2 id="cel-name">${esc(name)}</h2>
      <div class="cel-place">1st place</div>
      <div class="cel-progress" id="cel-progress">${celebrationProgress(ev)}</div>
      ${others.length ? `<p class="cel-also">Also new: ${others.map(esc).join(', ')}</p>` : ''}
      <button class="btn primary" id="celebrate-ok">Close</button>
    </div>
  </div>`;
  el.hidden = false;
  $('celebrate-ok').addEventListener('click', closeCelebrate);
  $('celebrate-ok').focus({ preventScroll: true });
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(closeCelebrate, 9000);
}

/** Riot's count often lands a few seconds after the scan; update the numbers in place. */
function refreshCelebration() {
  const box = celebrating && document.getElementById('cel-progress');
  if (!box) return;
  const html = celebrationProgress(celebrating);
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}

function closeCelebrate() {
  const el = $('celebrate');
  clearTimeout(celebrateTimer);
  if (el.hidden) return;
  el.hidden = true;
  el.innerHTML = '';
  celebrating = null;
  if (celebrateFocus?.isConnected) celebrateFocus.focus({ preventScroll: true });
}

let resultTimer = null;
function showResult(ev) {
  const r = postGameResult(ev, state.status, state.insights);
  if (!r) return;
  const card = cardById(r.championId) ?? { id: r.championId, name: r.name };
  const verdictText = {
    'already-won': 'Already won, no change',
    'still-needed': r.placement === 2 ? 'Still needed, one place short' : 'Still needed',
    'first-win': 'First win',
    unknown: 'Not in your checklist yet',
  }[r.verdict];
  const session = r.session
    ? `<div class="result-meta">This session: <b class="num">${r.session.newWins}</b> new ${r.session.newWins === 1 ? 'win' : 'wins'} in <b class="num">${r.session.games}</b> ${r.session.games === 1 ? 'game' : 'games'}</div>` : '';
  const el = $('postgame');
  el.innerHTML = `<div class="result-card ${r.verdict}" role="status">
    <a class="result-art" href="#/champion/${encodeURIComponent(card.id)}" tabindex="-1" aria-hidden="true">${art(card, 'tile')}</a>
    <div class="result-body">
      <div class="result-title"><span class="result-place ${tierOf(r.placement)}">${r.placement ? ordinal(r.placement) : 'Unplaced'}</span><span class="dot-sep">·</span><a href="#/champion/${encodeURIComponent(card.id)}">${esc(r.name)}</a></div>
      <div class="result-verdict">${verdictText}</div>
      <div class="result-meta"><b class="num">${r.remaining}</b> ${r.remaining === 1 ? 'champion' : 'champions'} remaining</div>
      ${session}
    </div>
    <button class="icon-btn small result-close" aria-label="Dismiss">${icon('x', 14)}</button>
  </div>`;
  el.hidden = false;
  el.querySelector('.result-close').addEventListener('click', closeResult);
  el.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeResult));
  const arm = (ms) => { clearTimeout(resultTimer); resultTimer = setTimeout(closeResult, ms); };
  el.onmouseenter = () => clearTimeout(resultTimer);
  el.onmouseleave = () => arm(4000);
  arm(12_000);
}

function closeResult() {
  clearTimeout(resultTimer);
  const el = $('postgame');
  el.hidden = true;
  el.innerHTML = '';
}

/* ---------- commands & shortcuts ---------- */
function exportCsv() {
  const cards = state.status?.cards ?? [];
  if (!cards.length) { toast('Nothing to export yet. Run a scan first.', 'error'); return; }
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
  const go = ({ view, title, key, icon: iconName }) => ({ kind: 'Go to', label: title, keys: key, icon: iconName, run: () => { location.hash = `#/${view}`; } });
  const samples = state.status?.fixture
    ? SAMPLE_SCENARIOS.map(([name, label]) => ({ kind: 'Sample', label: `Sample: ${label}`, hint: 'Synthetic data', icon: 'layers', run: () => loadScenario(name) }))
    : [];
  return [
    ...NAV.map(go),
    { kind: 'Command', label: 'Update scan', icon: 'refresh', run: () => rescan($('sync-btn')) },
    { kind: 'Command', label: 'Full rescan', hint: 'Rebuild from all match history', icon: 'refresh', run: () => { toast('Full rescan started. This can take a few minutes.'); void rescan($('sync-btn'), true); } },
    { kind: 'Command', label: 'Search champions', keys: '/', icon: 'search', run: focusChampionSearch },
    { kind: 'Command', label: 'Toggle mini mode', icon: 'minimize', run: () => { location.hash = '#/champselect'; setTimeout(() => toggleMini(), 0); } },
    { kind: 'Command', label: 'Toggle always on top', icon: 'pin', run: toggleOnTop },
    { kind: 'Command', label: state.status?.overlayPreview ? 'Hide overlay preview' : 'Show overlay preview', hint: 'Position the Crowd Favorites panel', icon: 'eye', run: togglePreview },
    { kind: 'Command', label: 'Export checklist (CSV)', icon: 'download', run: exportCsv },
    { kind: 'Command', label: 'Toggle sidebar', keys: '[', icon: 'panel', run: toggleRail },
    { kind: 'Command', label: 'Keyboard shortcuts', keys: '?', icon: 'keyboard', run: () => shortcutsSheet(true) },
    ...samples,
  ];
}

const typing = (el) => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') {
    if (!$('shortcuts').hidden) { shortcutsSheet(false); return; }
    if (!$('celebrate').hidden) { closeCelebrate(); return; }
    if (!$('postgame').hidden) { closeResult(); return; }
    if (document.body.classList.contains('mini')) { toggleMini(false); return; }
  }
  if (mod || e.altKey || typing(e.target) || !$('palette').hidden) return;
  const view = viewForKey(e.key);
  if (view) { location.hash = `#/${view}`; e.preventDefault(); }
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
  $('celebrate').addEventListener('mousedown', (e) => { if (e.target === $('celebrate')) closeCelebrate(); });
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
