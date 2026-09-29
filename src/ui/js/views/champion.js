import { $, esc, changed, art, chip, statusOf, cardById, ordinal, tierOf, relSpan, fmtDate, num, dec, pct } from '../util.js';
import { icon } from '../icons.js';
import { placementBars, distribution } from '../charts.js';
import { refresh } from '../store.js';

let confirmFor = '';
let confirmTimer = null;
let busy = false;
let message = '';

function actionHtml(card) {
  // Only a manual mark can be removed; a match-history win has nothing to toggle.
  const action = card.manual ? 'remove' : card.won ? null : 'add';
  if (!action) return `<div class="note">${icon('check', 14)} Won in match history — no manual mark needed.</div>`;
  const confirming = confirmFor === card.id;
  const label = action === 'remove'
    ? (confirming ? 'Click again to remove the mark' : 'Remove manual mark')
    : (confirming ? 'Click again to confirm' : 'Mark as won (manual)');
  return `<button id="cd-toggle" class="btn ${action === 'remove' ? 'ghost danger' : 'primary'} ${confirming ? 'confirming' : ''}" ${busy ? 'disabled' : ''}>${icon(action === 'remove' ? 'x' : 'pencil', 15)} ${label}</button>
    <span class="dim small">${action === 'add' ? 'For wins older than match history. Saved to arena-tracker.' : 'Marked by hand.'}</span>`;
}

async function toggle(card) {
  if (confirmFor !== card.id) {
    confirmFor = card.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmFor = ''; $('view-champion').dataset.sig = ''; window.dispatchEvent(new Event('ac-render')); }, 4000);
    $('view-champion').dataset.sig = '';
    window.dispatchEvent(new Event('ac-render'));
    return;
  }
  confirmFor = '';
  busy = true;
  message = '';
  window.dispatchEvent(new Event('ac-render'));
  try {
    const r = await fetch(`/api/manual/${encodeURIComponent(card.id)}`, { method: card.manual ? 'DELETE' : 'POST' });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  } catch (err) {
    message = `Couldn't save: ${err.message}`;
  } finally {
    busy = false;
    $('view-champion').dataset.sig = '';
    await refresh({ force: true });
  }
}

export function renderChampion(st, id) {
  const root = $('view-champion');
  const card = cardById(id);
  if (!st.status) { if (changed(root, 'skel')) root.innerHTML = '<div class="skel-hero skeleton"></div>'; return; }
  if (!card) {
    if (changed(root, `missing:${id}`)) root.innerHTML = `<div class="empty card"><div class="empty-icon">${icon('search', 22)}</div><h2>Champion not found</h2><p class="sub">${esc(id)} isn't in the checklist yet.</p><a class="btn ghost" href="#/champions">${icon('chevronLeft', 15)} All champions</a></div>`;
    return;
  }
  const games = (st.matches ?? []).filter((m) => m.championId === card.id);
  const sig = JSON.stringify([card, games.length, games[0]?.id, confirmFor, busy, message, st.status.ddragonVersion]);
  if (!changed(root, sig)) return;
  const st8 = statusOf(card);
  const placed = games.filter((m) => m.placement).map((m) => m.placement);
  const firstWin = games.find((m) => m.firstWin);
  root.innerHTML = `
    <a class="back-link" href="#/champions">${icon('chevronLeft', 15)} Champions</a>
    <section class="champ-hero card ${st8}">
      <div class="champ-hero-bg">${art(card, 'splash')}</div>
      <div class="champ-hero-splash">${art(card, 'splash')}</div>
      <div class="champ-hero-body">
        ${art(card, 'tile', 'champ-hero-portrait')}
        <div class="champ-hero-text">
          <div class="eyebrow">${esc((card.tags ?? []).join(' · ') || 'Champion')}</div>
          <h1>${esc(card.name)}</h1>
          ${card.title ? `<p class="champ-title">${esc(card.title)}</p>` : ''}
          <div class="champ-hero-chips">${chip(st8, icon)}${card.owned === false ? `<span class="chip muted">${icon('lock', 12)}Not owned</span>` : ''}${card.masteryLevel ? `<span class="chip mastery">${icon('award', 12)}Mastery ${card.masteryLevel} · ${num(card.masteryPoints)} pts</span>` : ''}</div>
          <div class="champ-actions">${actionHtml(card)}</div>
          ${message ? `<div class="form-error">${esc(message)}</div>` : ''}
        </div>
      </div>
    </section>
    <div class="tiles six">
      <div class="tile"><div class="tile-head">${icon('layers', 16)}<span class="label">Games</span></div><div class="tile-value num">${card.games}</div><div class="tile-sub">${card.last ? `last ${relSpan(card.last)}` : 'never played in Arena'}</div></div>
      <div class="tile gold-tile"><div class="tile-head">${icon('trophy', 16)}<span class="label">Wins</span></div><div class="tile-value num">${card.wins}</div><div class="tile-sub">${card.games ? `${pct((card.wins / card.games) * 100)} win rate` : '&nbsp;'}</div></div>
      <div class="tile"><div class="tile-head">${icon('gauge', 16)}<span class="label">Avg place</span></div><div class="tile-value num">${dec(card.avgPlacement)}</div><div class="tile-sub">${card.games ? `top 4 in ${card.top4} of ${placed.length}` : '&nbsp;'}</div></div>
      <div class="tile cyan-tile"><div class="tile-head">${icon('sparkles', 16)}<span class="label">First win</span></div><div class="tile-value small">${card.firstWinAt ? fmtDate(card.firstWinAt, true) : card.manual ? 'Manual' : '—'}</div><div class="tile-sub">${firstWin ? relSpan(firstWin.gameEnd) : card.won ? 'before match history' : 'still needed'}</div></div>
    </div>
    <div class="grid-2">
      <section class="card"><header class="card-head"><div><h2>${icon('award', 16)} Placements</h2><p class="sub">${placed.length ? `${placed.length} placed ${placed.length === 1 ? 'game' : 'games'}` : 'No games yet'}</p></div></header>
        ${placed.length ? placementBars(distribution(placed), { compact: true }) : '<div class="empty-inline">Play this champion in Arena to see placements.</div>'}</section>
      <section class="card"><header class="card-head"><div><h2>${icon('history', 16)} Arena games</h2></div></header>
        ${games.length ? `<div class="game-list compact">${games.slice(0, 40).map((m) => `<div class="game-row static">
          <span class="place ${tierOf(m.placement)}">${m.placement ?? '?'}</span>
          <span class="game-name">${m.placement ? ordinal(m.placement) : 'Unplaced'}${m.firstWin ? `<span class="first-win">${icon('sparkles', 12)} First win</span>` : ''}</span>
          <span class="game-time" title="${esc(new Date(m.gameEnd).toLocaleString())}">${fmtDate(m.gameEnd)} · ${new Date(m.gameEnd).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}</div>`
          : '<div class="empty-inline">No Arena games on this champion.</div>'}</section>
    </div>`;
  $('cd-toggle')?.addEventListener('click', () => toggle(card));
}
