import { $, esc, changed, art, chip, statusOf, cardById, ordinal, tierOf, relSpan, fmtDate, num, dec, pct } from '../util.js';
import { icon } from '../icons.js';
import { placementBars, distribution } from '../charts.js';
import { refresh } from '../store.js';
import { championRecord, manualAction } from '../progress.js';

let confirmFor = '';
let confirmTimer = null;
let busy = false;
let message = '';

function actionHtml(card) {
  const action = manualAction(card);
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

/* The personal Arena profile is a list of sections, so later ones (a
   Match-V5 builds/augments history, say) slot in without reshaping the card. */
function statsSection(card, rec) {
  const stat = (label, value, sub = '', cls = '') => `<div class="pstat ${cls}"><dt class="label">${label}</dt><dd><span class="pstat-value num">${value}</span>${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
  const firstWin = card.firstWinAt ? fmtDate(card.firstWinAt, true) : card.manual ? 'Manual' : card.won ? 'Won' : 'Not yet';
  // "3d ago" helps for a recent first win; an older one would only repeat the date.
  const firstWinSub = card.firstWinAt ? (Date.now() - card.firstWinAt < 14 * 24 * 3600_000 ? relSpan(card.firstWinAt) : '') : card.manual ? 'before match history' : '';
  return `<dl class="pstats">
    ${stat('Best', rec.best ? ordinal(rec.best) : '—', '', rec.best === 1 ? 'gold' : '')}
    ${stat('Average', dec(rec.avg))}
    ${stat('Games', num(rec.games))}
    ${stat('Top 4', rec.placed ? `${rec.top4}<span class="of"> / ${rec.placed}</span>` : '—')}
    ${stat('Wins', num(rec.wins), rec.games ? `${pct((rec.wins / rec.games) * 100)} of games` : '')}
    ${stat('First win', firstWin, firstWinSub, 'text')}
    ${stat('Last', rec.last?.placement ? ordinal(rec.last.placement) : rec.last ? 'Unplaced' : '—', rec.last ? relSpan(rec.last.gameEnd) : '', rec.last?.placement === 1 ? 'gold' : '')}
  </dl>`;
}

function recentSection(rec) {
  if (!rec.recent.length) return '';
  return `<div class="precent"><span class="label">Recent</span>
    <ol class="recent-strip" aria-label="Recent placements, newest first">${rec.recent.map((p, i) => `<li class="place ${tierOf(p)}" title="${i === 0 ? 'Latest game · ' : ''}${ordinal(p)}">${p}</li>`).join('')}</ol>
    <span class="dim small">newest first</span></div>`;
}

function placementsSection(games) {
  const placed = games.filter((m) => m.placement).map((m) => m.placement);
  if (!placed.length) return '';
  return `<div class="profile-side"><div class="label">Placements</div>${placementBars(distribution(placed), { compact: true })}</div>`;
}

function profileCard(card, games) {
  const rec = championRecord(card, games);
  if (!rec.games) {
    return `<section class="card arena-profile">
      <header class="card-head"><div><h2>${icon('history', 16)} Your Arena history</h2><p class="sub">No Arena games on ${esc(card.name)} yet</p></div></header>
      <p class="profile-empty">${card.won
        ? `${icon('pencil', 14)} Marked as won by hand — match history has no games on ${esc(card.name)}.`
        : `${icon('sparkles', 14)} Your first game shows up here — and a win on ${esc(card.name)} counts toward Arena God.`}</p>
    </section>`;
  }
  return `<section class="card arena-profile">
    <header class="card-head"><div><h2>${icon('history', 16)} Your Arena history</h2><p class="sub">${num(rec.games)} ${rec.games === 1 ? 'game' : 'games'} on ${esc(card.name)}</p></div></header>
    <div class="profile-grid">
      <div class="profile-main">${statsSection(card, rec)}${recentSection(rec)}</div>
      ${placementsSection(games)}
    </div>
  </section>`;
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
  const sig = JSON.stringify([card, games.length, games[0]?.id, Boolean(st.matches), confirmFor, busy, message, st.status.ddragonVersion]);
  if (!changed(root, sig)) return;
  const st8 = statusOf(card);
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
    ${st.matches ? profileCard(card, games) : '<div class="card skeleton tall"></div>'}
    ${games.length ? `<section class="card"><header class="card-head"><div><h2>${icon('layers', 16)} Arena games</h2><p class="sub">${games.length > 40 ? `Latest 40 of ${games.length}` : 'Every game, newest first'}</p></div></header>
      <div class="game-list compact">${games.slice(0, 40).map((m) => `<div class="game-row static">
          <span class="place ${tierOf(m.placement)}">${m.placement ?? '?'}</span>
          <span class="game-name">${m.placement ? ordinal(m.placement) : 'Unplaced'}${m.firstWin ? `<span class="first-win">${icon('sparkles', 12)} First win</span>` : ''}</span>
          <span class="game-time" title="${esc(new Date(m.gameEnd).toLocaleString())}">${fmtDate(m.gameEnd)} · ${new Date(m.gameEnd).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}</div></section>` : ''}`;
  $('cd-toggle')?.addEventListener('click', () => toggle(card));
}
